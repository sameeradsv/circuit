from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import Blackout, User

router = APIRouter(prefix="/api/blackouts", tags=["blackouts"])

_VALID_TYPES = {"travelling", "period", "sickness"}


class BlackoutIn(BaseModel):
    blackout_type: str
    start_date_ms: int
    end_date_ms: int


def _to_dict(b: Blackout) -> dict:
    return {
        "id": b.id,
        "blackout_type": b.blackout_type,
        "start_date_ms": b.start_date_ms,
        "end_date_ms": b.end_date_ms,
        "created_at": b.created_at.isoformat(),
    }


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
    return _to_dict(b)


@router.delete("/{blackout_id}", status_code=204)
def delete_blackout(blackout_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    b = db.get(Blackout, blackout_id)
    if not b or b.user_id != user.id:
        raise HTTPException(404, "Blackout not found")
    db.delete(b)
    db.commit()
