from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import CircuitTask
from app.services.auto_complete import auto_complete_due_no_reminder_tasks
from app.services.icloud_calendar import ICloudCalendarSetupError, cleanup_icloud_calendar, sync_icloud_calendar
from app.services.reminders import materialize_reminders_for_user, process_due_reminders
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


def _run_reminder_job(db: Session) -> dict[str, int]:
    generated = _materialize_reminders_for_all_task_users(db)
    auto_complete_stats = auto_complete_due_no_reminder_tasks(db)
    stats = process_due_reminders(db)
    stats["reminders_generated_count"] = generated
    stats.update(auto_complete_stats)
    return stats


@router.post("/materialize-occurrences")
def materialize_occurrences(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    _require_cron(authorization)
    occurrence_stats = materialize_occurrences_for_all_users(db)
    reminder_stats = _run_reminder_job(db)
    db.commit()
    result = {
        "materialized_count": occurrence_stats["materialized"],
        "calendar_created_count": 0,
        "updated_count": occurrence_stats["updated"],
        "deleted_count": occurrence_stats["deleted"],
        "skipped_count": occurrence_stats["skipped"],
        "failed_count": occurrence_stats["failed"],
        **reminder_stats,
    }
    logger.info("Cron materialized occurrences", extra=result)
    return result


@router.post("/sync-icloud-calendar")
def sync_calendar(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
):
    _require_cron(authorization)
    reminder_stats = _run_reminder_job(db)
    try:
        stats = sync_icloud_calendar(db)
    except ICloudCalendarSetupError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    stats["reminders_generated_count"] = int(stats.get("reminders_generated_count", 0)) + reminder_stats.pop("reminders_generated_count", 0)
    stats.update(reminder_stats)
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
