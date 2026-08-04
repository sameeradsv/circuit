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
    materialize_reminders_for_user,
    next_pending_reminder_at,
    process_due_reminders,
)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])
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
    device_name: Optional[str] = None
    platform: Optional[str] = None


def _disable_matching_device_subscriptions(
    db: Session,
    *,
    user_id: int,
    current_endpoint: str,
    device_name: Optional[str],
    platform: Optional[str],
    now: datetime,
) -> None:
    if not device_name or not platform:
        return
    rows = (
        db.query(PushSubscription)
        .filter(
            PushSubscription.user_id == user_id,
            PushSubscription.device_name == device_name,
            PushSubscription.platform == platform,
            PushSubscription.endpoint != current_endpoint,
            PushSubscription.enabled == True,  # noqa: E712
        )
        .all()
    )
    for row in rows:
        row.enabled = False
        row.updated_at = now


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
    _disable_matching_device_subscriptions(
        db,
        user_id=user.id,
        current_endpoint=payload.endpoint,
        device_name=payload.device_name,
        platform=payload.platform,
        now=now,
    )
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
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        row.updated_at = now
        _disable_matching_device_subscriptions(
            db,
            user_id=user.id,
            current_endpoint=payload.endpoint,
            device_name=payload.device_name,
            platform=payload.platform,
            now=now,
        )
        db.commit()
    return {"status": "ok"}


@router.post("/process")
def process_reminders(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    global _db_outage_until
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

    try:
        next_due = next_pending_reminder_at(db, now=now)
        lookahead = max(0, settings.reminder_process_lookahead_seconds)
        if next_due and next_due > now + timedelta(seconds=lookahead):
            result = {
                "claimed": 0,
                "sent": 0,
                "failed": 0,
                "cancelled": 0,
                "stale_cancelled": 0,
                "subscriptions_disabled": 0,
                "processing_skipped": True,
                "next_due_at": next_due.isoformat(),
                "seconds_until_next_due": max(0, int((next_due - now).total_seconds())),
            }
        else:
            result = process_due_reminders(db)
            next_after = next_pending_reminder_at(db, now=now)
            result["processing_skipped"] = False
            result["next_due_at"] = next_after.isoformat() if next_after else None
            result["seconds_until_next_due"] = max(0, int((next_after - now).total_seconds())) if next_after else None
    except OperationalError:
        _db_outage_until = now + timedelta(minutes=5)
        raise
    return result
