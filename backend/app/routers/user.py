from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import AuthSession, CircuitTask, TaskEvent, User, UserSettings, UserState
from app.schemas import UserStateRead, UserStateWrite

router = APIRouter(prefix="/api/user", tags=["user"])
_IST = ZoneInfo("Asia/Kolkata")


def _today_ist() -> str:
    return datetime.now(_IST).date().isoformat()


def _override_active(row: UserState) -> bool:
    return bool(row.energy_manual_override and row.energy_manual_override_date == _today_ist())


@router.get("/state", response_model=UserStateRead)
def get_user_state(user: User = Depends(require_user), db: Session = Depends(get_db)):
    row = db.query(UserState).filter(UserState.user_id == user.id).first()
    if not row:
        return UserStateRead(
            energy_level=0.7,
            energy_manual_override=False,
            energy_manual_override_date=None,
            stress_level=0.3,
            time_available_minutes=480,
            focus_mode="normal",
            updated_at=datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z",
        )
    if row.energy_manual_override and row.energy_manual_override_date != _today_ist():
        row.energy_manual_override = False
        row.energy_manual_override_date = None
        db.commit()
        db.refresh(row)
    return UserStateRead(
        energy_level=row.energy_level,
        energy_manual_override=_override_active(row),
        energy_manual_override_date=row.energy_manual_override_date,
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
    provided = payload.model_fields_set
    if "energy_level" in provided:
        row.energy_level = payload.energy_level
    if "energy_manual_override" in provided:
        row.energy_manual_override = payload.energy_manual_override
        row.energy_manual_override_date = _today_ist() if payload.energy_manual_override else None
    if "stress_level" in provided:
        row.stress_level = payload.stress_level
    if "time_available_minutes" in provided:
        row.time_available_minutes = payload.time_available_minutes
    if "focus_mode" in provided:
        row.focus_mode = payload.focus_mode
    row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(row)
    return UserStateRead(
        energy_level=row.energy_level,
        energy_manual_override=_override_active(row),
        energy_manual_override_date=row.energy_manual_override_date,
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
