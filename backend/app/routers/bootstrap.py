from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import Blackout, CircuitTask, SleepLog, User, UserSettings
from app.routers.blackouts import _to_dict as _blackout_to_dict
from app.routers.calendar import get_calendar_expiry
from app.routers.search import get_summary
from app.routers.sleep import get_sleep_factor
from app.routers.tasks import list_tasks
from app.routers.user import get_user_state
from app.schemas import SettingsRead

router = APIRouter(prefix="/api/bootstrap", tags=["bootstrap"])

_IST = ZoneInfo("Asia/Kolkata")


def _settings_read(db: Session, user_id: int) -> SettingsRead:
    rows = db.query(UserSettings).filter(UserSettings.user_id == user_id).all()
    return SettingsRead(values={r.key: json.loads(r.value) for r in rows})


def _blackouts(db: Session, user_id: int) -> list[dict]:
    rows = db.query(Blackout).filter(Blackout.user_id == user_id).order_by(Blackout.start_date_ms).all()
    return [_blackout_to_dict(row) for row in rows]


def _sleep_override_total(db: Session, user_id: int) -> int:
    return (
        db.query(SleepLog)
        .filter(SleepLog.user_id == user_id)
        .filter(
            or_(
                SleepLog.quality.isnot(None),
                SleepLog.disturbed.is_(True),
                and_(SleepLog.notes.isnot(None), SleepLog.notes != ""),
                and_(SleepLog.bedtime_ms.isnot(None), SleepLog.wake_ms.isnot(None)),
            )
        )
        .count()
    )


@router.get("/home")
def home_bootstrap(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Reduced Home payload: actionable open tasks plus small counters/metadata."""
    now = datetime.now(_IST)
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end = day_start + timedelta(days=1)
    horizon = day_start + timedelta(days=4)

    today_start_ms = int(day_start.timestamp() * 1000)
    today_end_ms = int(day_end.timestamp() * 1000) - 1
    horizon_ms = int(horizon.timestamp() * 1000) - 1

    tasks = list_tasks(
        completed=False,
        scheduled_from_ms=0,
        scheduled_to_ms=horizon_ms,
        include_unscheduled=True,
        page=None,
        limit=None,
        user=user,
        db=db,
    )

    completed_today = (
        db.query(CircuitTask.id)
        .filter(
            CircuitTask.user_id == user.id,
            CircuitTask.completed.is_(True),
            CircuitTask.updated_at >= day_start.astimezone(timezone.utc).replace(tzinfo=None),
            CircuitTask.updated_at < day_end.astimezone(timezone.utc).replace(tzinfo=None),
        )
        .count()
    )

    return {
        "tasks": tasks,
        "completed_today": completed_today,
        "calendar_expiry": get_calendar_expiry(user=user, db=db),
        "today_range": {"from_ms": today_start_ms, "to_ms": today_end_ms},
    }


@router.get("/account")
def account_bootstrap(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Account page bootstrap to avoid four separate protected DB requests."""
    return {
        "settings": _settings_read(db, user.id).model_dump(),
        "user_state": get_user_state(user=user, db=db).model_dump(),
        "blackouts": _blackouts(db, user.id),
        "sleep_factor": get_sleep_factor(user=user, db=db),
        "sleep_override_total": _sleep_override_total(db, user.id),
    }


@router.get("/calendar")
def calendar_bootstrap(
    from_ms: int = Query(..., description="Inclusive visible range lower bound"),
    to_ms: int = Query(..., description="Inclusive visible range upper bound"),
    include_blackouts: bool = Query(True),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Calendar visible range plus blackout rows in one request."""
    return {
        "tasks": list_tasks(
            completed=False,
            scheduled_from_ms=from_ms,
            scheduled_to_ms=to_ms,
            include_unscheduled=True,
            page=None,
            limit=None,
            user=user,
            db=db,
        ),
        "blackouts": _blackouts(db, user.id) if include_blackouts else None,
    }


@router.get("/tasks")
def tasks_bootstrap(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Tasks page bootstrap: open tasks, completed count metadata, active blackouts."""
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    done_total = (
        db.query(CircuitTask.id)
        .filter(CircuitTask.user_id == user.id, CircuitTask.completed.is_(True))
        .count()
    )
    active_blackouts = [
        b for b in _blackouts(db, user.id)
        if b["is_active"] and b["start_date_ms"] <= now_ms <= b["end_date_ms"]
    ]
    return {
        "tasks": list_tasks(completed=False, page=None, limit=None, user=user, db=db),
        "done_total": done_total,
        "active_blackouts": active_blackouts,
    }


@router.get("/analytics")
def analytics_bootstrap(
    date: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Analytics page bootstrap: summary plus open tasks for local insight scoring."""
    return {
        "summary": get_summary(date=date, user=user, db=db).model_dump(),
        "tasks": list_tasks(completed=False, page=None, limit=None, user=user, db=db),
    }
