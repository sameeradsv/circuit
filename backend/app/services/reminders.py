from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.config import settings
from app.models import CircuitTask, PushSubscription, Reminder
from app.services.push import PushGoneError, send_web_push
from app.services.virtual_recurrence import expand_virtual_occurrences

logger = logging.getLogger(__name__)
_IST = ZoneInfo("Asia/Kolkata")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _dt_from_ms(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).replace(tzinfo=None)


def _ms_from_dt(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _format_scheduled_time(ms: Optional[int]) -> str:
    if not ms:
        return "unscheduled"
    dt = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone(_IST)
    hour = dt.hour % 12 or 12
    suffix = "AM" if dt.hour < 12 else "PM"
    return f"{hour}:{dt.minute:02d} {suffix} IST"


def _compact_percent(value: Optional[float]) -> str:
    value = 0.0 if value is None else max(0.0, min(1.0, float(value)))
    return f"{round(value * 100)}%"


def _task_parameter_summary(task: CircuitTask) -> str:
    parts = [
        f"imp {_compact_percent(task.importance)}",
        f"urg {_compact_percent(task.urgency)}",
        f"delay {_compact_percent(task.consequence_of_delay)}",
        f"drain {_compact_percent(task.recovery_cost)}",
    ]
    if task.cognitive_load is not None and task.cognitive_load >= 0.65:
        parts.append(f"load {_compact_percent(task.cognitive_load)}")
    return " · ".join(parts)


def reminder_offsets(task: Any) -> list[int]:
    if task.get("notifications_enabled") is False if isinstance(task, dict) else task.notifications_enabled is False:
        return []
    if isinstance(task, dict):
        raw = [task.get("notification_offset_1_mins", 10), task.get("notification_offset_2_mins")]
    else:
        raw = [task.notification_offset_1_mins, task.notification_offset_2_mins]
    out: list[int] = []
    for item in raw:
        if item is None:
            continue
        value = int(item)
        if value < 0:
            continue
        if value not in out:
            out.append(value)
    return out


def _upsert_reminder(db: Session, *, user_id: int, task_id: int, occurrence_at_ms: int, remind_at: datetime) -> bool:
    existing = (
        db.query(Reminder)
        .filter(
            Reminder.user_id == user_id,
            Reminder.task_id == task_id,
            Reminder.remind_at == remind_at,
        )
        .first()
    )
    if existing:
        if existing.status == "cancelled":
            existing.status = "pending"
            existing.sent_at = None
            existing.last_error = None
            existing.updated_at = _now_utc()
        existing.occurrence_at_ms = occurrence_at_ms
        return False

    db.add(Reminder(
        user_id=user_id,
        task_id=task_id,
        remind_at=remind_at,
        occurrence_at_ms=occurrence_at_ms,
        status="pending",
    ))
    db.flush()
    return True


def _task_occurrences(db: Session, user_id: int, from_ms: int, to_ms: int) -> Iterable[dict[str, Any]]:
    concrete = (
        db.query(CircuitTask)
        .filter(
            CircuitTask.user_id == user_id,
            CircuitTask.completed == False,  # noqa: E712
            CircuitTask.scheduled_at.isnot(None),
            CircuitTask.scheduled_at >= from_ms,
            CircuitTask.scheduled_at <= to_ms,
        )
        .all()
    )
    for task in concrete:
        yield {
            "task_id": task.id,
            "text": task.text,
            "scheduled_at": task.scheduled_at,
            "duration": task.duration or 30,
            "notifications_enabled": task.notifications_enabled,
            "notification_offset_1_mins": task.notification_offset_1_mins,
            "notification_offset_2_mins": task.notification_offset_2_mins,
            "is_virtual_occurrence": False,
        }

    for item in expand_virtual_occurrences(db, user_id, from_ms, to_ms, completed=False):
        source_task_id = item.get("source_task_id")
        scheduled_at = item.get("scheduled_at")
        if not isinstance(source_task_id, int) or not isinstance(scheduled_at, int):
            continue
        yield {
            **item,
            "task_id": source_task_id,
        }


def materialize_reminders_for_user(
    db: Session,
    user_id: int,
    *,
    now: Optional[datetime] = None,
    horizon_days: Optional[int] = None,
) -> int:
    now_dt = now or _now_utc()
    from_ms = _ms_from_dt(now_dt - timedelta(minutes=5))
    to_ms = _ms_from_dt(now_dt + timedelta(days=horizon_days or settings.reminder_materialize_days))
    created = 0
    keep_keys: set[tuple[int, datetime]] = set()

    for occurrence in _task_occurrences(db, user_id, from_ms, to_ms):
        scheduled_at = occurrence.get("scheduled_at")
        task_id = occurrence.get("task_id")
        if not isinstance(scheduled_at, int) or not isinstance(task_id, int):
            continue
        for offset in reminder_offsets(occurrence):
            remind_ms = scheduled_at - offset * 60_000
            if remind_ms < from_ms or remind_ms > to_ms:
                continue
            remind_at = _dt_from_ms(remind_ms)
            keep_keys.add((task_id, remind_at))
            if _upsert_reminder(
                db,
                user_id=user_id,
                task_id=task_id,
                occurrence_at_ms=scheduled_at,
                remind_at=remind_at,
            ):
                created += 1

    pending = (
        db.query(Reminder)
        .filter(
            Reminder.user_id == user_id,
            Reminder.status == "pending",
            Reminder.remind_at >= _dt_from_ms(from_ms),
            Reminder.remind_at <= _dt_from_ms(to_ms),
        )
        .all()
    )
    for row in pending:
        if (row.task_id, row.remind_at) not in keep_keys:
            row.status = "cancelled"
            row.updated_at = _now_utc()

    db.flush()
    return created


def materialize_reminders_for_task(db: Session, task: CircuitTask) -> int:
    db.query(Reminder).filter(
        Reminder.user_id == task.user_id,
        Reminder.task_id == task.id,
        Reminder.status.in_(["pending", "processing", "failed"]),
    ).update({"status": "cancelled", "updated_at": _now_utc()}, synchronize_session=False)
    return materialize_reminders_for_user(db, task.user_id)


def materialize_reminders_for_enabled_push_users(db: Session) -> int:
    user_ids = [
        row[0]
        for row in (
            db.query(PushSubscription.user_id)
            .filter(PushSubscription.enabled == True)  # noqa: E712
            .distinct()
            .all()
        )
    ]
    created = 0
    for user_id in user_ids:
        created += materialize_reminders_for_user(db, int(user_id))
    db.commit()
    return created


def _claim_due_reminders(db: Session, now: datetime, limit: int) -> list[Reminder]:
    due = (
        db.query(Reminder.id)
        .filter(
            Reminder.status.in_(["pending", "failed"]),
            Reminder.remind_at <= now,
            Reminder.attempts < settings.reminder_max_attempts,
        )
        .order_by(Reminder.remind_at.asc(), Reminder.id.asc())
        .limit(limit)
        .all()
    )
    claimed: list[Reminder] = []
    for (reminder_id,) in due:
        updated = (
            db.query(Reminder)
            .filter(
                Reminder.id == reminder_id,
                Reminder.status.in_(["pending", "failed"]),
                Reminder.attempts < settings.reminder_max_attempts,
            )
            .update({"status": "processing", "updated_at": now}, synchronize_session=False)
        )
        db.commit()
        if updated == 1:
            row = db.get(Reminder, reminder_id)
            if row:
                claimed.append(row)
    return claimed


def _payload_for(task: CircuitTask, reminder: Reminder) -> dict[str, Any]:
    occurrence_ms = reminder.occurrence_at_ms or task.scheduled_at
    return {
        "title": task.text,
        "body": f"{_format_scheduled_time(occurrence_ms)} · {_task_parameter_summary(task)}",
        "tag": f"circuit-task-{task.id}-{int(reminder.remind_at.timestamp())}",
        "url": "/calendar",
        "taskId": task.id,
        "scheduledAt": occurrence_ms,
    }


def process_due_reminders(db: Session, *, now: Optional[datetime] = None, limit: Optional[int] = None) -> dict[str, int]:
    now_dt = now or _now_utc()
    claimed = _claim_due_reminders(db, now_dt, limit or settings.reminder_batch_size)
    stats = {"claimed": len(claimed), "sent": 0, "failed": 0, "cancelled": 0, "subscriptions_disabled": 0}

    for reminder in claimed:
        task = db.get(CircuitTask, reminder.task_id)
        if not task or task.completed:
            reminder.status = "cancelled"
            reminder.updated_at = _now_utc()
            stats["cancelled"] += 1
            db.commit()
            continue

        subscriptions = (
            db.query(PushSubscription)
            .filter(PushSubscription.user_id == reminder.user_id, PushSubscription.enabled == True)  # noqa: E712
            .all()
        )
        if not subscriptions:
            reminder.status = "failed"
            reminder.attempts += 1
            reminder.last_error = "No enabled push subscriptions"
            reminder.updated_at = _now_utc()
            stats["failed"] += 1
            db.commit()
            continue

        payload = _payload_for(task, reminder)
        delivered = 0
        errors: list[str] = []
        for sub in subscriptions:
            try:
                send_web_push(sub, payload)
                delivered += 1
            except PushGoneError as exc:
                sub.enabled = False
                sub.updated_at = _now_utc()
                errors.append(str(exc))
                stats["subscriptions_disabled"] += 1
            except Exception as exc:  # pragma: no cover - network failures are integration tested
                errors.append(str(exc))

        reminder.attempts += 1
        reminder.updated_at = _now_utc()
        if delivered > 0:
            reminder.status = "sent"
            reminder.sent_at = _now_utc()
            reminder.last_error = None if delivered == len(subscriptions) else "; ".join(errors)[:1000]
            stats["sent"] += 1
        else:
            reminder.status = "failed"
            reminder.last_error = "; ".join(errors)[:1000] or "Unknown push delivery error"
            stats["failed"] += 1
        db.commit()
        logger.info("Processed reminder", extra={"reminder_id": reminder.id, "status": reminder.status})

    return stats


def cancel_pending_reminders_for_task(db: Session, task_id: int, user_id: int) -> int:
    return db.query(Reminder).filter(
        Reminder.task_id == task_id,
        Reminder.user_id == user_id,
        Reminder.status.in_(["pending", "processing", "failed"]),
    ).update({"status": "cancelled", "updated_at": _now_utc()}, synchronize_session=False)
