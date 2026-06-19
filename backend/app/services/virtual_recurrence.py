from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.engines.recurrence import next_occurrence
from app.models import CircuitTask, OccurrenceOverride, RecurringTask

_IST = ZoneInfo("Asia/Kolkata")
_MAX_EXPANSION_DAYS = 120
_MAX_OCCURRENCES_PER_SERIES = 500


def is_virtual_id(value: str) -> bool:
    return value.startswith("r_")


def parse_virtual_id(value: str) -> tuple[int, int]:
    _, recurring_id, occurrence_start = value.split("_", 2)
    return int(recurring_id), int(occurrence_start)


def _task_metadata(task: CircuitTask) -> dict[str, Any]:
    return {
        "source_task_id": task.id,
        "client_id": task.client_id,
        "tag": task.tag,
        "completed": False,
        "tiny_step": task.tiny_step,
        "effort": task.effort,
        "deadline_type": task.deadline_type,
        "time_sensitivity": task.time_sensitivity,
        "cognitive_load": task.cognitive_load,
        "emotional_resistance": task.emotional_resistance,
        "activation_energy": task.activation_energy,
        "recovery_cost": task.recovery_cost,
        "focus_type": task.focus_type,
        "importance": task.importance,
        "urgency": task.urgency,
        "consequence_of_delay": task.consequence_of_delay,
        "momentum_value": task.momentum_value,
        "compound_benefit": task.compound_benefit,
        "identity_alignment": task.identity_alignment,
        "historical_completion_rate": task.historical_completion_rate,
        "skipped_count": task.skipped_count,
        "last_skipped_at": task.last_skipped_at,
        "energy_to_reward_ratio": task.energy_to_reward_ratio,
        "task_decomposition_potential": task.task_decomposition_potential,
        "required_resources": json.loads(task.required_resources),
        "dependencies": json.loads(task.dependencies),
        "metadata": json.loads(task.metadata_json),
        "preferred_execution_window": task.preferred_execution_window,
        "delay_pattern": task.delay_pattern,
        "location_dependency": task.location_dependency,
        "client_created_at": task.client_created_at,
        "client_updated_at": task.client_updated_at,
        "blackout_skip_flags": json.loads(task.blackout_skip_flags) if task.blackout_skip_flags else [],
        "post_blackout_behavior": task.post_blackout_behavior or "resume",
        "recurrence_anchor_ms": task.recurrence_anchor_ms,
        "group_id": task.group_id,
        "day_time_overrides": json.loads(task.day_time_overrides) if task.day_time_overrides else {},
        "travel_buffer_before_mins": task.travel_buffer_before_mins,
        "travel_buffer_after_mins": task.travel_buffer_after_mins,
        "notifications_enabled": bool(task.notifications_enabled),
        "notification_offset_1_mins": task.notification_offset_1_mins,
        "notification_offset_2_mins": task.notification_offset_2_mins,
        "import_review_pending": bool(task.import_review_pending),
    }


def sync_recurring_definition(db: Session, task: CircuitTask) -> Optional[RecurringTask]:
    if not task.scheduled_at or not (task.recurrence or task.rrule):
        existing = db.query(RecurringTask).filter(RecurringTask.source_task_id == task.id).first()
        if existing:
            existing.active = False
            existing.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        return None

    row = db.query(RecurringTask).filter(RecurringTask.source_task_id == task.id).first()
    if row is None:
        row = RecurringTask(user_id=task.user_id, source_task_id=task.id)
        db.add(row)
    row.title = task.text
    row.start_datetime_ms = task.rrule_dtstart_ms or task.scheduled_at
    row.duration = task.duration or 30
    row.recurrence = task.recurrence
    row.rrule = task.rrule
    row.rrule_dtstart_ms = task.rrule_dtstart_ms
    row.recurrence_ends_at = task.recurrence_ends_at
    row.metadata_json = json.dumps(_task_metadata(task))
    row.active = True
    row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    return row


def ensure_recurring_definitions(db: Session, user_id: int) -> None:
    tasks = (
        db.query(CircuitTask)
        .filter(
            CircuitTask.user_id == user_id,
            CircuitTask.scheduled_at.isnot(None),
            or_(CircuitTask.recurrence.isnot(None), CircuitTask.rrule.isnot(None)),
        )
        .all()
    )
    for task in tasks:
        sync_recurring_definition(db, task)
    db.flush()


def _bounded_to_ms(from_ms: int, to_ms: int) -> int:
    max_to = from_ms + _MAX_EXPANSION_DAYS * 86_400_000
    return min(to_ms, max_to)


def _expand_simple(row: RecurringTask, from_ms: int, to_ms: int) -> list[int]:
    if not row.recurrence:
        return []
    anchor = datetime.fromtimestamp(row.start_datetime_ms / 1000, tz=_IST)
    current = anchor
    out: list[int] = []
    for _ in range(_MAX_OCCURRENCES_PER_SERIES):
        current_ms = int(current.timestamp() * 1000)
        if current_ms + (row.duration or 30) * 60_000 > from_ms and current_ms <= to_ms:
            out.append(current_ms)
        if current_ms > to_ms:
            break
        nxt = next_occurrence(row.recurrence, current)
        if not nxt or nxt <= current:
            break
        current = nxt
        if row.recurrence_ends_at and int(current.timestamp() * 1000) > row.recurrence_ends_at:
            break
    return out


def _expand_rrule(row: RecurringTask, from_ms: int, to_ms: int) -> list[int]:
    if not row.rrule:
        return []
    from app.routers.calendar import _expand_rrule as expand_ics_rrule

    anchor_ms = row.rrule_dtstart_ms or row.start_datetime_ms
    orig_dt = datetime.fromtimestamp(anchor_ms / 1000, tz=_IST)
    out: list[int] = []
    for raw_ms in expand_ics_rrule(anchor_ms, row.rrule, set(), cutoff_ms=from_ms):
        if row.recurrence_ends_at and raw_ms > row.recurrence_ends_at:
            break
        if raw_ms > to_ms:
            break
        raw_dt = datetime.fromtimestamp(raw_ms / 1000, tz=_IST)
        corrected = raw_dt.replace(
            hour=orig_dt.hour,
            minute=orig_dt.minute,
            second=orig_dt.second,
            microsecond=0,
        )
        ts = int(corrected.timestamp() * 1000)
        if ts + (row.duration or 30) * 60_000 > from_ms and ts <= to_ms:
            out.append(ts)
    return out[:_MAX_OCCURRENCES_PER_SERIES]


def _base_virtual_dict(row: RecurringTask, start_ms: int) -> dict[str, Any]:
    meta = json.loads(row.metadata_json or "{}")
    now_iso = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    return {
        "id": f"r_{row.id}_{start_ms}",
        "client_id": meta.get("client_id"),
        "text": row.title,
        "tag": meta.get("tag", "general"),
        "completed": False,
        "tiny_step": meta.get("tiny_step", ""),
        "effort": meta.get("effort", "medium"),
        "duration": row.duration or 30,
        "deadline_type": meta.get("deadline_type", "none"),
        "time_sensitivity": meta.get("time_sensitivity", 0.5),
        "scheduled_at": start_ms,
        "recurrence": row.recurrence,
        "cognitive_load": meta.get("cognitive_load", 0.5),
        "emotional_resistance": meta.get("emotional_resistance", 0.5),
        "activation_energy": meta.get("activation_energy", 0.5),
        "recovery_cost": meta.get("recovery_cost", 0.3),
        "focus_type": meta.get("focus_type", "shallow"),
        "importance": meta.get("importance", 0.5),
        "urgency": meta.get("urgency", 0.5),
        "consequence_of_delay": meta.get("consequence_of_delay", 0.3),
        "momentum_value": meta.get("momentum_value", 0.5),
        "compound_benefit": meta.get("compound_benefit", 0.3),
        "identity_alignment": meta.get("identity_alignment", 0.3),
        "historical_completion_rate": meta.get("historical_completion_rate", 0.7),
        "skipped_count": meta.get("skipped_count", 0),
        "last_skipped_at": meta.get("last_skipped_at"),
        "energy_to_reward_ratio": meta.get("energy_to_reward_ratio", 0.5),
        "task_decomposition_potential": meta.get("task_decomposition_potential", 0.3),
        "required_resources": meta.get("required_resources", []),
        "dependencies": meta.get("dependencies", []),
        "metadata": meta.get("metadata", {}),
        "preferred_execution_window": meta.get("preferred_execution_window"),
        "delay_pattern": meta.get("delay_pattern"),
        "location_dependency": meta.get("location_dependency"),
        "client_created_at": meta.get("client_created_at"),
        "client_updated_at": meta.get("client_updated_at"),
        "created_at": now_iso,
        "updated_at": now_iso,
        "blackout_skip_flags": meta.get("blackout_skip_flags", []),
        "rrule": row.rrule,
        "rrule_dtstart_ms": row.rrule_dtstart_ms,
        "is_recurring_template": bool(row.rrule),
        "recurrence_ends_at": row.recurrence_ends_at,
        "post_blackout_behavior": meta.get("post_blackout_behavior", "resume"),
        "recurrence_anchor_ms": meta.get("recurrence_anchor_ms"),
        "group_id": meta.get("group_id"),
        "day_time_overrides": meta.get("day_time_overrides", {}),
        "travel_buffer_before_mins": meta.get("travel_buffer_before_mins"),
        "travel_buffer_after_mins": meta.get("travel_buffer_after_mins"),
        "notifications_enabled": meta.get("notifications_enabled", True),
        "notification_offset_1_mins": meta.get("notification_offset_1_mins", 10),
        "notification_offset_2_mins": meta.get("notification_offset_2_mins"),
        "import_review_pending": meta.get("import_review_pending", False),
        "is_virtual_occurrence": True,
        "recurring_task_id": row.id,
        "occurrence_start_ms": start_ms,
        "source_task_id": meta.get("source_task_id"),
    }


def expand_virtual_occurrences(
    db: Session,
    user_id: int,
    from_ms: int,
    to_ms: int,
    *,
    completed: Optional[bool] = None,
) -> list[dict[str, Any]]:
    ensure_recurring_definitions(db, user_id)
    bounded_to = _bounded_to_ms(from_ms, to_ms)
    rows = (
        db.query(RecurringTask)
        .filter(
            RecurringTask.user_id == user_id,
            RecurringTask.active == True,  # noqa: E712
            RecurringTask.start_datetime_ms <= bounded_to,
            or_(RecurringTask.recurrence_ends_at.is_(None), RecurringTask.recurrence_ends_at >= from_ms),
        )
        .all()
    )
    overrides = (
        db.query(OccurrenceOverride)
        .filter(
            OccurrenceOverride.user_id == user_id,
            or_(
                and_(
                    OccurrenceOverride.occurrence_start_ms >= from_ms,
                    OccurrenceOverride.occurrence_start_ms <= bounded_to,
                ),
                and_(
                    OccurrenceOverride.modified_start_ms.isnot(None),
                    OccurrenceOverride.modified_start_ms >= from_ms,
                    OccurrenceOverride.modified_start_ms <= bounded_to,
                ),
            ),
        )
        .all()
    )
    override_map = {(o.recurring_task_id, o.occurrence_start_ms): o for o in overrides}

    out: list[dict[str, Any]] = []
    for row in rows:
        starts = _expand_rrule(row, from_ms, bounded_to) if row.rrule else _expand_simple(row, from_ms, bounded_to)
        for start in starts:
            override = override_map.get((row.id, start))
            if override and override.status == "skipped":
                continue
            item = _base_virtual_dict(row, start)
            if override:
                if override.status == "completed":
                    item["completed"] = True
                elif override.status == "rescheduled":
                    item["scheduled_at"] = override.modified_start_ms
                    item["duration"] = override.modified_duration or item["duration"]
                item["occurrence_override_status"] = override.status
            if completed is not None and bool(item["completed"]) != completed:
                continue
            scheduled_at = item.get("scheduled_at")
            duration = item.get("duration") or 30
            if scheduled_at is None:
                continue
            if scheduled_at <= bounded_to and scheduled_at + duration * 60_000 > from_ms:
                out.append(item)
    out.sort(key=lambda t: (t.get("scheduled_at") or 0, str(t.get("id"))))
    return out


def upsert_occurrence_override(
    db: Session,
    user_id: int,
    recurring_task_id: int,
    occurrence_start_ms: int,
    *,
    status: str,
    modified_start_ms: Optional[int] = None,
    modified_duration: Optional[int] = None,
) -> OccurrenceOverride:
    row = (
        db.query(OccurrenceOverride)
        .filter(
            OccurrenceOverride.user_id == user_id,
            OccurrenceOverride.recurring_task_id == recurring_task_id,
            OccurrenceOverride.occurrence_start_ms == occurrence_start_ms,
        )
        .first()
    )
    if row is None:
        row = OccurrenceOverride(
            user_id=user_id,
            recurring_task_id=recurring_task_id,
            occurrence_start_ms=occurrence_start_ms,
            status=status,
        )
        db.add(row)
    row.status = status
    row.modified_start_ms = modified_start_ms
    row.modified_duration = modified_duration
    row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    return row


def virtual_busy_tasks(db: Session, user_id: int, from_ms: int, to_ms: int) -> list[CircuitTask]:
    tasks: list[CircuitTask] = []
    for item in expand_virtual_occurrences(db, user_id, from_ms, to_ms, completed=False):
        task = CircuitTask(
            id=0,
            user_id=user_id,
            text=item["text"],
            tag=item["tag"],
            completed=False,
            scheduled_at=item["scheduled_at"],
            duration=item["duration"],
            recurrence=item.get("recurrence"),
            rrule=item.get("rrule"),
            focus_type=item.get("focus_type", "shallow"),
            preferred_execution_window=item.get("preferred_execution_window"),
        )
        tasks.append(task)
    return tasks
