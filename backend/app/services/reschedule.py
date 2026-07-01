from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models import CircuitTask, TaskEvent
from app.services.reminders import materialize_reminders_for_task
from app.services.suggest_slot import suggest_slot_for_task, task_conflict_weight
from app.services.virtual_recurrence import sync_recurring_definition


def _refresh_task_reminders(db: Session, task: CircuitTask) -> None:
    try:
        materialize_reminders_for_task(db, task)
    except Exception:
        pass


def _task_end_ms(task: CircuitTask) -> Optional[int]:
    if task.scheduled_at is None:
        return None
    return task.scheduled_at + (task.duration or 30) * 60_000


def _tasks_overlap(a: CircuitTask, b: CircuitTask) -> bool:
    a_end = _task_end_ms(a)
    b_end = _task_end_ms(b)
    if a.scheduled_at is None or b.scheduled_at is None or a_end is None or b_end is None:
        return False
    return a.scheduled_at < b_end and a_end > b.scheduled_at


def resolve_schedule_conflicts(
    db: Session,
    user_id: int,
    anchor: CircuitTask,
    *,
    now_utc: Optional[datetime] = None,
    event_reason: str = "auto_conflict_resolution",
) -> list[dict[str, Any]]:
    """Move lower-weight tasks out of the anchor task's scheduled slot.

    The resolver is deterministic: the highest weighted task keeps the contested
    slot, while lower-weight tasks move to suggested slots that avoid conflicts
    and overloaded days.
    """
    if anchor.scheduled_at is None or anchor.completed:
        return []

    occurred_at = now_utc or datetime.now(timezone.utc).replace(tzinfo=None)
    now_ms = int(occurred_at.replace(tzinfo=timezone.utc).timestamp() * 1000)
    tasks = (
        db.query(CircuitTask)
        .filter(
            CircuitTask.user_id == user_id,
            CircuitTask.completed == False,  # noqa: E712
            CircuitTask.scheduled_at.isnot(None),
        )
        .all()
    )
    moved: list[dict[str, Any]] = []
    moved_ids: set[int] = set()

    for _ in range(12):
        if anchor.scheduled_at is None:
            break
        conflicts = [task for task in tasks if task.id != anchor.id and _tasks_overlap(anchor, task)]
        if not conflicts:
            break

        strongest = max(conflicts, key=lambda task: task_conflict_weight(task, now_ms))
        anchor_weight = task_conflict_weight(anchor, now_ms)
        if anchor_weight < task_conflict_weight(strongest, now_ms):
            old_ms = anchor.scheduled_at
            suggestion = suggest_slot_for_task(
                anchor,
                [task for task in tasks if task.id != anchor.id],
                now_ms=max(now_ms, _task_end_ms(strongest) or now_ms),
            )
            new_ms = int(suggestion["scheduled_at"])
            if new_ms == old_ms:
                break
            anchor.scheduled_at = new_ms
            anchor.updated_at = occurred_at
            moved.append({
                "task": anchor,
                "from_ms": old_ms,
                "to_ms": new_ms,
                "reason": "lower_priority_than_conflict",
                "rationale": suggestion.get("rationale", []),
            })
            moved_ids.add(anchor.id)
            continue

        moved_any = False
        for conflict in sorted(conflicts, key=lambda task: task_conflict_weight(task, now_ms)):
            old_ms = conflict.scheduled_at
            suggestion = suggest_slot_for_task(
                conflict,
                tasks,
                now_ms=max(now_ms, _task_end_ms(anchor) or now_ms),
            )
            new_ms = int(suggestion["scheduled_at"])
            if old_ms is None or new_ms == old_ms:
                continue
            conflict.scheduled_at = new_ms
            conflict.updated_at = occurred_at
            moved.append({
                "task": conflict,
                "from_ms": old_ms,
                "to_ms": new_ms,
                "reason": "conflict_with_higher_priority_task",
                "rationale": suggestion.get("rationale", []),
            })
            moved_ids.add(conflict.id)
            moved_any = True
        if not moved_any:
            break

    for change in moved:
        moved_task = change["task"]
        db.add(TaskEvent(
            user_id=user_id,
            task_id=moved_task.id,
            event_type="rescheduled",
            occurred_at=occurred_at,
            metadata_json=json.dumps({
                "reason": event_reason,
                "from_ms": change["from_ms"],
                "to_ms": change["to_ms"],
                "trigger_task_id": anchor.id,
                "resolution": change["reason"],
                "rationale": change["rationale"],
            }),
        ))

    for task in tasks:
        if task.id in moved_ids:
            sync_recurring_definition(db, task)
            _refresh_task_reminders(db, task)

    return moved
