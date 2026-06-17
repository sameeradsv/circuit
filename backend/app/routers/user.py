from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import AuthSession, CircuitTask, TaskEvent, User, UserSettings, UserState
from app.schemas import UserStateRead, UserStateWrite

router = APIRouter(prefix="/api/user", tags=["user"])


@router.get("/state", response_model=UserStateRead)
def get_user_state(user: User = Depends(require_user), db: Session = Depends(get_db)):
    row = db.query(UserState).filter(UserState.user_id == user.id).first()
    if not row:
        return UserStateRead(
            energy_level=0.7,
            energy_manual_override=False,
            stress_level=0.3,
            time_available_minutes=480,
            focus_mode="normal",
            updated_at=datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
        )
    return UserStateRead(
        energy_level=row.energy_level,
        energy_manual_override=bool(row.energy_manual_override),
        stress_level=row.stress_level,
        time_available_minutes=row.time_available_minutes,
        focus_mode=row.focus_mode,
        updated_at=row.updated_at.isoformat() + "Z",
    )


@router.post("/state", response_model=UserStateRead)
def set_user_state(
    payload: UserStateWrite,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    row = db.query(UserState).filter(UserState.user_id == user.id).first()
    if not row:
        row = UserState(user_id=user.id)
        db.add(row)
    row.energy_level = payload.energy_level
    row.energy_manual_override = payload.energy_manual_override
    row.stress_level = payload.stress_level
    row.time_available_minutes = payload.time_available_minutes
    row.focus_mode = payload.focus_mode
    row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(row)
    return UserStateRead(
        energy_level=row.energy_level,
        energy_manual_override=bool(row.energy_manual_override),
        stress_level=row.stress_level,
        time_available_minutes=row.time_available_minutes,
        focus_mode=row.focus_mode,
        updated_at=row.updated_at.isoformat() + "Z",
    )


@router.delete("/data", status_code=204)
def delete_user_data(user: User = Depends(require_user), db: Session = Depends(get_db)):
    """Delete all tasks, events, settings, and state for the user. Account is retained."""
    db.query(TaskEvent).filter(TaskEvent.user_id == user.id).delete()
    db.query(CircuitTask).filter(CircuitTask.user_id == user.id).delete()
    db.query(UserSettings).filter(UserSettings.user_id == user.id).delete()
    db.query(UserState).filter(UserState.user_id == user.id).delete()
    db.commit()
