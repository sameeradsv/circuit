from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.behavioral import record_completion_rate
from app.models import CircuitTask, TaskEvent
from app.routers.energy import recompute_energy_carryover_from
from app.services.adaptive_learning import apply_complete_learning
from app.services.reminders import cancel_pending_reminders_for_task, reminder_offsets
from app.services.virtual_recurrence import sync_recurring_definition
from app.task_event_time import effective_event_time, task_event_occurred_at

logger = logging.getLogger(__name__)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _ms_from_dt(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _has_reminders(task: CircuitTask) -> bool:
    return bool(reminder_offsets(task))


def _completion_ms(task: CircuitTask) -> Optional[int]:
    if task.scheduled_at is None:
        return None
    return int(task.scheduled_at) + max(1, int(task.duration or 30)) * 60_000


def _complete_task(db: Session, task: CircuitTask, completion_ms: int) -> None:
    task.completed = True
    task.historical_completion_rate = record_completion_rate(task.historical_completion_rate)
    task.updated_at = _now_utc()
    apply_complete_learning(task)

    metadata = {
        "reason": "auto_no_reminder",
        "actual_completed_at_ms": completion_ms,
    }
    if task.scheduled_at is not None:
        metadata["scheduled_at_ms"] = task.scheduled_at
        metadata["delay_minutes"] = round((completion_ms - task.scheduled_at) / 60_000)

    event = TaskEvent(
        user_id=task.user_id,
        task_id=task.id,
        event_type="completed",
        occurred_at=task_event_occurred_at(task, explicit_ms=completion_ms),
        metadata_json=json.dumps(metadata),
    )
    db.add(event)
    db.flush()
    recompute_energy_carryover_from(task.user_id, effective_event_time(event, task), db)

    try:
        from app.routers.tasks import _create_next_occurrence_for_completed_task

        _create_next_occurrence_for_completed_task(db, task.user_id, task)
    except Exception:
        logger.exception("Failed to materialize next occurrence after auto completion", extra={"task_id": task.id})

    sync_recurring_definition(db, task)
    cancel_pending_reminders_for_task(db, task.id, task.user_id)


def auto_complete_due_no_reminder_tasks(
    db: Session,
    *,
    now: Optional[datetime] = None,
    limit: int = 250,
) -> dict[str, int]:
    """Complete scheduled tasks whose block has ended and that have no reminders.

    A task counts as no-reminder when browser notifications are disabled for the
    task or both reminder offsets are explicitly empty.
    """
    now_dt = now or _now_utc()
    now_ms = _ms_from_dt(now_dt)
    candidates = (
        db.query(CircuitTask)
        .filter(
            CircuitTask.completed == False,  # noqa: E712
            CircuitTask.scheduled_at.isnot(None),
            CircuitTask.scheduled_at <= now_ms,
            or_(CircuitTask.import_review_pending == False, CircuitTask.import_review_pending.is_(None)),  # noqa: E712
        )
        .order_by(CircuitTask.scheduled_at.asc(), CircuitTask.id.asc())
        .limit(limit)
        .all()
    )

    completed = skipped_with_reminders = skipped_not_due = failed = 0
    for task in candidates:
        completion_ms = _completion_ms(task)
        if completion_ms is None or completion_ms > now_ms:
            skipped_not_due += 1
            continue
        if _has_reminders(task):
            skipped_with_reminders += 1
            continue
        try:
            with db.begin_nested():
                _complete_task(db, task, completion_ms)
            completed += 1
        except Exception:
            failed += 1
            logger.exception("Failed to auto-complete no-reminder task", extra={"task_id": task.id})

    db.flush()
    return {
        "auto_completed_count": completed,
        "auto_complete_failed_count": failed,
        "auto_complete_skipped_with_reminders_count": skipped_with_reminders,
        "auto_complete_skipped_not_due_count": skipped_not_due,
    }
