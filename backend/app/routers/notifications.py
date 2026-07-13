from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps.auth import require_user
from app.models import PushSubscription, User
from app.services.reminders import (
    materialize_reminders_for_enabled_push_users,
    materialize_reminders_for_user,
    process_due_reminders,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])
_last_process_materialized_at: datetime | None = None
_db_outage_until: datetime | None = None


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=1)
    auth: str = Field(min_length=1)


class SubscribePayload(BaseModel):
    endpoint: str = Field(min_length=1)
    keys: PushKeys
    device_name: Optional[str] = None
    platform: Optional[str] = None


class UnsubscribePayload(BaseModel):
    endpoint: str = Field(min_length=1)


@router.get("/vapid-public-key")
def vapid_public_key():
    if not settings.vapid_public_key:
        raise HTTPException(status_code=503, detail="Push notifications are not configured")
    return {"public_key": settings.vapid_public_key}


@router.get("/subscriptions")
def list_subscriptions(user: User = Depends(require_user), db: Session = Depends(get_db)):
    rows = (
        db.query(PushSubscription)
        .filter(PushSubscription.user_id == user.id)
        .order_by(PushSubscription.updated_at.desc())
        .all()
    )
    return [
        {
            "id": row.id,
            "endpoint": row.endpoint,
            "device_name": row.device_name,
            "platform": row.platform,
            "enabled": bool(row.enabled),
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
        }
        for row in rows
    ]


@router.post("/subscribe", status_code=201)
def subscribe(payload: SubscribePayload, user: User = Depends(require_user), db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    row = (
        db.query(PushSubscription)
        .filter(PushSubscription.user_id == user.id, PushSubscription.endpoint == payload.endpoint)
        .first()
    )
    if row is None:
        row = PushSubscription(user_id=user.id, endpoint=payload.endpoint)
        db.add(row)
    row.p256dh = payload.keys.p256dh
    row.auth = payload.keys.auth
    row.device_name = payload.device_name
    row.platform = payload.platform
    row.enabled = True
    row.updated_at = now
    materialize_reminders_for_user(db, user.id)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "enabled": bool(row.enabled)}


@router.post("/unsubscribe")
def unsubscribe(payload: UnsubscribePayload, user: User = Depends(require_user), db: Session = Depends(get_db)):
    row = (
        db.query(PushSubscription)
        .filter(PushSubscription.user_id == user.id, PushSubscription.endpoint == payload.endpoint)
        .first()
    )
    if row:
        row.enabled = False
        row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()
    return {"status": "ok"}


@router.post("/process")
def process_reminders(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    global _last_process_materialized_at, _db_outage_until
    if not settings.reminder_cron_secret:
        raise HTTPException(status_code=503, detail="Reminder processing is not configured")
    expected = f"Bearer {settings.reminder_cron_secret}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Invalid reminder processor token")

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if _db_outage_until and now < _db_outage_until:
        retry_after = max(1, int((_db_outage_until - now).total_seconds()))
        raise HTTPException(
            status_code=503,
            detail={"detail": "Database temporarily unavailable", "code": "database_unavailable"},
            headers={"Retry-After": str(retry_after)},
        )

    interval = max(1, settings.reminder_process_materialize_interval_minutes)
    should_materialize = (
        _last_process_materialized_at is None
        or now - _last_process_materialized_at >= timedelta(minutes=interval)
    )
    materialized = 0
    try:
        if should_materialize:
            materialized = materialize_reminders_for_enabled_push_users(db)
            _last_process_materialized_at = now
        result = process_due_reminders(db)
    except OperationalError:
        _db_outage_until = now + timedelta(minutes=5)
        raise
    result["materialized"] = materialized
    result["materialization_skipped"] = not should_materialize
    return result
