from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import CircuitTask
from app.services.icloud_calendar import ICloudCalendarSetupError, cleanup_icloud_calendar, sync_icloud_calendar
from app.services.reminders import materialize_reminders_for_user
from app.services.virtual_recurrence import materialize_occurrences_for_all_users

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/cron", tags=["cron"])


def _require_cron(authorization: Optional[str]) -> None:
    if not settings.cron_secret:
        raise HTTPException(status_code=503, detail="Cron endpoints are not configured")
    if authorization != f"Bearer {settings.cron_secret}":
        raise HTTPException(status_code=401, detail="Invalid cron token")


def _materialize_reminders_for_all_task_users(db: Session) -> int:
    user_ids = [row[0] for row in db.query(CircuitTask.user_id).distinct().all()]
    generated = 0
    for user_id in user_ids:
        generated += materialize_reminders_for_user(db, int(user_id), horizon_days=7)
    return generated


@router.post("/materialize-occurrences")
def materialize_occurrences(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    _require_cron(authorization)
    occurrence_stats = materialize_occurrences_for_all_users(db)
    reminders_generated = _materialize_reminders_for_all_task_users(db)
    db.commit()
    result = {
        "materialized_count": occurrence_stats["materialized"],
        "reminders_generated_count": reminders_generated,
        "calendar_created_count": 0,
        "updated_count": occurrence_stats["updated"],
        "deleted_count": occurrence_stats["deleted"],
        "skipped_count": occurrence_stats["skipped"],
        "failed_count": occurrence_stats["failed"],
    }
    logger.info("Cron materialized occurrences", extra=result)
    return result


@router.post("/sync-icloud-calendar")
def sync_calendar(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    _require_cron(authorization)
    reminders_generated = _materialize_reminders_for_all_task_users(db)
    try:
        stats = sync_icloud_calendar(db)
    except ICloudCalendarSetupError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    stats["reminders_generated_count"] = int(stats.get("reminders_generated_count", 0)) + reminders_generated
    db.commit()
    logger.info("Cron synced iCloud calendar", extra=stats)
    return stats


@router.post("/cleanup-icloud-calendar")
def cleanup_calendar(
    confirm: bool = False,
    authorization: Optional[str] = Header(default=None),
):
    _require_cron(authorization)
    try:
        result = cleanup_icloud_calendar(confirm=confirm)
    except ICloudCalendarSetupError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    logger.info("Cron cleanup iCloud calendar", extra=result)
    return result
