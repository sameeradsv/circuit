from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import Blackout, CircuitTask, User
from app.services.blackout import reschedule_tasks_for_blackout

router = APIRouter(prefix="/api/blackouts", tags=["blackouts"])

_VALID_TYPES = {"travelling", "period", "sickness", "leave", "wfh"}
_HOUR_MS = 3_600_000


class BlackoutIn(BaseModel):
    blackout_type: str
    start_date_ms: int
    end_date_ms: int


def _to_dict(b: Blackout, tasks_rescheduled: int = 0) -> dict:
    return {
        "id": b.id,
        "blackout_type": b.blackout_type,
        "start_date_ms": b.start_date_ms,
        "end_date_ms": b.end_date_ms,
        "created_at": b.created_at.isoformat(),
        "tasks_rescheduled": tasks_rescheduled,
    }


def _overlaps_work(user_id: int, start_ms: int, duration_mins: int, db: Session) -> bool:
    end_ms = start_ms + duration_mins * 60_000
    rows = (
        db.query(CircuitTask)
        .filter(
            CircuitTask.user_id == user_id,
            CircuitTask.completed.is_(False),
            CircuitTask.scheduled_at.isnot(None),
        )
        .all()
    )
    for task in rows:
        if (task.tag or "").lower() != "work" and "work" not in (task.text or "").lower():
            continue
        task_end = task.scheduled_at + (task.duration or 30) * 60_000
        if start_ms < task_end and end_ms > task.scheduled_at:
            return True
    return False


def _create_period_change_tasks(user_id: int, blackout: Blackout, db: Session) -> int:
    existing = (
        db.query(CircuitTask.id)
        .filter(
            CircuitTask.user_id == user_id,
            CircuitTask.text == "Change!",
            CircuitTask.scheduled_at >= blackout.start_date_ms,
            CircuitTask.scheduled_at <= blackout.end_date_ms,
        )
        .all()
    )
    if existing:
        return 0

    duration_mins = 10
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    scheduled = max(now_ms, blackout.start_date_ms)
    created = 0
    while scheduled <= blackout.end_date_ms:
        db.add(CircuitTask(
            user_id=user_id,
            text="Change!",
            tag="health",
            effort="low",
            duration=duration_mins,
            deadline_type="today",
            time_sensitivity=0.8,
            scheduled_at=scheduled,
            cognitive_load=0.1,
            emotional_resistance=0.1,
            activation_energy=0.1,
            recovery_cost=0.05,
            focus_type="admin",
            importance=0.7,
            urgency=0.8,
            consequence_of_delay=0.5,
            momentum_value=0.2,
            energy_to_reward_ratio=0.4,
            recurrence_ends_at=blackout.end_date_ms,
            metadata_json=json.dumps({
                "period_blackout_id": blackout.id,
                "generated_by": "period_blackout",
            }),
        ))
        created += 1
        next_default = scheduled + 5 * _HOUR_MS
        interval = 4 * _HOUR_MS if _overlaps_work(user_id, next_default, duration_mins, db) else 5 * _HOUR_MS
        scheduled += interval
    if created:
        db.commit()
    return created


@router.get("")
def list_blackouts(user: User = Depends(require_user), db: Session = Depends(get_db)):
    rows = db.query(Blackout).filter(Blackout.user_id == user.id).order_by(Blackout.start_date_ms).all()
    return [_to_dict(b) for b in rows]


@router.post("", status_code=201)
def create_blackout(payload: BlackoutIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    if payload.blackout_type not in _VALID_TYPES:
        raise HTTPException(400, f"blackout_type must be one of: {', '.join(sorted(_VALID_TYPES))}")
    if payload.end_date_ms <= payload.start_date_ms:
        raise HTTPException(400, "end_date_ms must be after start_date_ms")
    b = Blackout(
        user_id=user.id,
        blackout_type=payload.blackout_type,
        start_date_ms=payload.start_date_ms,
        end_date_ms=payload.end_date_ms,
    )
    db.add(b)
    db.commit()
    db.refresh(b)

    moved = reschedule_tasks_for_blackout(user.id, b, db)
    if b.blackout_type == "period":
        _create_period_change_tasks(user.id, b, db)
    return _to_dict(b, tasks_rescheduled=moved)


@router.patch("/{blackout_id}", status_code=200)
def update_blackout(blackout_id: int, payload: BlackoutIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    b = db.get(Blackout, blackout_id)
    if not b or b.user_id != user.id:
        raise HTTPException(404, "Blackout not found")
    if payload.blackout_type not in _VALID_TYPES:
        raise HTTPException(400, f"blackout_type must be one of: {', '.join(sorted(_VALID_TYPES))}")
    if payload.end_date_ms <= payload.start_date_ms:
        raise HTTPException(400, "end_date_ms must be after start_date_ms")
    b.blackout_type = payload.blackout_type
    b.start_date_ms = payload.start_date_ms
    b.end_date_ms = payload.end_date_ms
    db.commit()
    db.refresh(b)
    return _to_dict(b)


@router.delete("/{blackout_id}", status_code=204)
def delete_blackout(blackout_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    b = db.get(Blackout, blackout_id)
    if not b or b.user_id != user.id:
        raise HTTPException(404, "Blackout not found")
    db.delete(b)
    db.commit()
