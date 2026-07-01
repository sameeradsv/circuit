from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, TaskEvent, User
from app.schemas import TaskEventRead
from app.task_event_time import effective_event_time, task_event_occurred_at
from app.routers.energy import recompute_energy_carryover_from

router = APIRouter(prefix="/api/history", tags=["history"])

_VALID_EVENTS = {"completed", "skipped", "rescheduled", "split", "created", "uncompleted"}
_UNDOABLE_EVENTS = {"completed", "uncompleted", "skipped", "rescheduled"}


class EventIn(BaseModel):
    task_id: int
    event_type: str
    occurred_at: Optional[int] = None  # epoch ms; defaults to now
    metadata: dict[str, Any] = {}


@router.post("/events", response_model=TaskEventRead, status_code=201)
def log_event(
    payload: EventIn,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if payload.event_type not in _VALID_EVENTS:
        raise HTTPException(400, f"Unknown event type '{payload.event_type}'. Valid: {sorted(_VALID_EVENTS)}")
    task = db.get(CircuitTask, payload.task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(404, "Task not found")

    occurred = task_event_occurred_at(
        task,
        explicit_ms=payload.occurred_at,
        fallback=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    event = TaskEvent(
        user_id=user.id,
        task_id=payload.task_id,
        event_type=payload.event_type,
        occurred_at=occurred,
        metadata_json=json.dumps(payload.metadata),
    )
    db.add(event)
    db.flush()
    if event.event_type == "completed":
        recompute_energy_carryover_from(user.id, effective_event_time(event, task), db)
    db.commit()
    db.refresh(event)
    return _event_to_read(event, task)


@router.get("/events", response_model=list[TaskEventRead])
def list_events(
    task_id: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    q = db.query(TaskEvent, CircuitTask).join(CircuitTask, TaskEvent.task_id == CircuitTask.id).filter(TaskEvent.user_id == user.id)
    if task_id is not None:
        q = q.filter(TaskEvent.task_id == task_id)
    rows = q.order_by(TaskEvent.occurred_at.desc()).limit(limit).all()
    return [_event_to_read(event, task) for event, task in rows]


@router.post("/events/{event_id}/undo")
def undo_event(
    event_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    event = db.get(TaskEvent, event_id)
    if not event or event.user_id != user.id:
        raise HTTPException(404, "Event not found")
    if event.event_type not in _UNDOABLE_EVENTS:
        raise HTTPException(400, f"Event type '{event.event_type}' cannot be undone")

    task = db.get(CircuitTask, event.task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(404, "Task not found")

    metadata = _metadata(event)
    recompute_from = effective_event_time(event, task) if event.event_type == "completed" else None

    if event.event_type == "completed":
        db.delete(event)
        db.flush()
        remaining_completed = (
            db.query(TaskEvent)
            .filter(
                TaskEvent.user_id == user.id,
                TaskEvent.task_id == task.id,
                TaskEvent.event_type == "completed",
            )
            .count()
        )
        task.completed = remaining_completed > 0
    elif event.event_type == "uncompleted":
        db.delete(event)
        db.flush()
        task.completed = (
            db.query(TaskEvent)
            .filter(
                TaskEvent.user_id == user.id,
                TaskEvent.task_id == task.id,
                TaskEvent.event_type == "completed",
            )
            .count()
            > 0
        )
    elif event.event_type in {"skipped", "rescheduled"}:
        from_ms = metadata.get("from_ms")
        if isinstance(from_ms, int):
            task.scheduled_at = from_ms
        if event.event_type == "skipped" or metadata.get("incremented_skip") is True:
            task.skipped_count = max(0, (task.skipped_count or 0) - 1)
        db.delete(event)

    if recompute_from is not None:
        recompute_energy_carryover_from(user.id, recompute_from, db)

    db.commit()
    db.refresh(task)
    return {
        "status": "undone",
        "event_id": event_id,
        "task_id": task.id,
        "task_completed": bool(task.completed),
        "scheduled_at": task.scheduled_at,
    }


def _metadata(e: TaskEvent) -> dict[str, Any]:
    try:
        return json.loads(e.metadata_json or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}


def _event_to_read(e: TaskEvent, task: CircuitTask | None = None) -> TaskEventRead:
    return TaskEventRead(
        id=e.id,
        task_id=e.task_id,
        event_type=e.event_type,
        occurred_at=e.occurred_at.isoformat() + "Z",
        metadata=_metadata(e),
        task_text=task.text if task else None,
        undoable=e.event_type in _UNDOABLE_EVENTS,
    )
