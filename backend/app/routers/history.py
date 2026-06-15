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

router = APIRouter(prefix="/api/history", tags=["history"])

_VALID_EVENTS = {"completed", "skipped", "rescheduled", "split", "created", "uncompleted"}


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

    occurred = (
        datetime.utcfromtimestamp(payload.occurred_at / 1000)
        if payload.occurred_at
        else datetime.now(timezone.utc).replace(tzinfo=None)
    )
    event = TaskEvent(
        user_id=user.id,
        task_id=payload.task_id,
        event_type=payload.event_type,
        occurred_at=occurred,
        metadata_json=json.dumps(payload.metadata),
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return _event_to_read(event)


@router.get("/events", response_model=list[TaskEventRead])
def list_events(
    task_id: Optional[int] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    q = db.query(TaskEvent).filter(TaskEvent.user_id == user.id)
    if task_id is not None:
        q = q.filter(TaskEvent.task_id == task_id)
    events = q.order_by(TaskEvent.occurred_at.desc()).limit(limit).all()
    return [_event_to_read(e) for e in events]


def _event_to_read(e: TaskEvent) -> TaskEventRead:
    return TaskEventRead(
        id=e.id,
        task_id=e.task_id,
        event_type=e.event_type,
        occurred_at=e.occurred_at.isoformat() + "Z",
        metadata=json.loads(e.metadata_json),
    )
