from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import User, UserSettings
from app.schemas import SettingsRead, SettingsWrite

router = APIRouter(prefix="/api/settings", tags=["settings"])

_ALLOWED_KEYS = {
    "default_energy_mode",
    "working_hours_start",
    "working_hours_end",
    "daily_capacity_minutes",
    "preferred_tags",
    "show_scoring_reasons",
    "auto_reschedule_overdue",
}


def _get_setting(db: Session, user_id: int, key: str) -> Any | None:
    row = db.query(UserSettings).filter(
        UserSettings.user_id == user_id,
        UserSettings.key == key,
    ).first()
    return json.loads(row.value) if row else None


def _set_setting(db: Session, user_id: int, key: str, value: Any) -> None:
    row = db.query(UserSettings).filter(
        UserSettings.user_id == user_id,
        UserSettings.key == key,
    ).first()
    if row:
        row.value = json.dumps(value)
    else:
        db.add(UserSettings(user_id=user_id, key=key, value=json.dumps(value)))


@router.get("", response_model=SettingsRead)
def get_settings(user: User = Depends(require_user), db: Session = Depends(get_db)):
    rows = db.query(UserSettings).filter(UserSettings.user_id == user.id).all()
    return SettingsRead(values={r.key: json.loads(r.value) for r in rows})


@router.put("", response_model=SettingsRead)
def update_settings(
    payload: SettingsWrite,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    for key, value in payload.values.items():
        _set_setting(db, user.id, key, value)
    db.commit()
    rows = db.query(UserSettings).filter(UserSettings.user_id == user.id).all()
    return SettingsRead(values={r.key: json.loads(r.value) for r in rows})


@router.get("/{key}")
def get_setting(
    key: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    value = _get_setting(db, user.id, key)
    return {"key": key, "value": value}


@router.put("/{key}")
def set_setting(
    key: str,
    payload: dict,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    value = payload.get("value")
    _set_setting(db, user.id, key, value)
    db.commit()
    return {"key": key, "value": value}
