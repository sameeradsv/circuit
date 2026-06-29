"""Sleep + work-session context router.

Endpoints:
  POST /api/sleep          — upsert daily sleep overrides (quality, disturbed, notes)
  GET  /api/sleep          — list recent resolved sleep logs (?days=7)
  GET  /api/sleep/overrides — paginated manual sleep overrides
  DELETE /api/sleep/{date} — remove overrides for a wake-up date (YYYY-MM-DD IST)
  GET  /api/sleep/factor   — computed energy factor for today (0–1) + breakdown

Bedtime and wake time are read from a calendar/task event titled "Sleep"
(scheduled_at = bedtime, wake = scheduled_at + duration). Users can override
quality and disturbed sleep on the account page; quality defaults to the user's
default_sleep_quality setting (7/10) when not overridden.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, SleepLog, TaskEvent, User, UserSettings

_IST = ZoneInfo("Asia/Kolkata")

DEFAULT_SLEEP_QUALITY = 7.0
SETTINGS_KEY_DEFAULT_QUALITY = "default_sleep_quality"
SETTINGS_KEY_DEFAULT_BEDTIME = "default_bedtime"   # "HH:MM", e.g. "23:00"
SETTINGS_KEY_DEFAULT_WAKE_TIME = "default_wake_time"  # "HH:MM", e.g. "07:00"

router = APIRouter(prefix="/api/sleep", tags=["sleep"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class SleepLogWrite(BaseModel):
    date: Optional[str] = None          # "YYYY-MM-DD" IST wake-up date; defaults to today IST
    bedtime_ms: Optional[int] = None    # optional manual override (legacy)
    wake_ms: Optional[int] = None       # optional manual override (legacy)
    quality: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    disturbed: Optional[bool] = None
    notes: Optional[str] = Field(default=None, max_length=500)


@dataclass
class SleepContext:
    date: str
    bedtime_ms: int
    wake_ms: int
    quality: float
    quality_is_default: bool
    disturbed: bool
    notes: Optional[str]
    source: str  # "task" | "manual" | "mixed"
    manual_log_id: Optional[int] = None


# ── Sleep task resolution ───────────────────────────────────────────────────────

def _is_sleep_task(task: CircuitTask) -> bool:
    return task.text.strip().lower() == "sleep"


def _get_default_sleep_quality(db: Session, user_id: int) -> float:
    row = (
        db.query(UserSettings)
        .filter(UserSettings.user_id == user_id, UserSettings.key == SETTINGS_KEY_DEFAULT_QUALITY)
        .first()
    )
    if not row:
        return DEFAULT_SLEEP_QUALITY
    try:
        val = json.loads(row.value)
        if isinstance(val, (int, float)) and 0 <= val <= 10:
            return float(val)
    except (json.JSONDecodeError, TypeError):
        pass
    return DEFAULT_SLEEP_QUALITY


def _get_str_setting(db: Session, user_id: int, key: str) -> Optional[str]:
    row = db.query(UserSettings).filter(UserSettings.user_id == user_id, UserSettings.key == key).first()
    if not row:
        return None
    try:
        val = json.loads(row.value)
        return val if isinstance(val, str) else None
    except (json.JSONDecodeError, TypeError):
        return None


def _get_default_sleep_window(db: Session, user_id: int, wake_date_str: str) -> Optional[tuple[int, int]]:
    """Return (bedtime_ms, wake_ms) from default_bedtime/default_wake_time settings for wake_date."""
    bedtime_str = _get_str_setting(db, user_id, SETTINGS_KEY_DEFAULT_BEDTIME)
    wake_str = _get_str_setting(db, user_id, SETTINGS_KEY_DEFAULT_WAKE_TIME)
    if not bedtime_str or not wake_str:
        return None
    try:
        bh, bm = (int(p) for p in bedtime_str.split(":"))
        wh, wm = (int(p) for p in wake_str.split(":"))
    except (ValueError, AttributeError):
        return None
    wake_date = date.fromisoformat(wake_date_str)
    wake_dt = datetime(wake_date.year, wake_date.month, wake_date.day, wh, wm, tzinfo=_IST)
    wake_ms = int(wake_dt.timestamp() * 1000)
    # Evening bedtime (≥ noon) is on the prior calendar day
    bed_date = wake_date - timedelta(days=1) if bh >= 12 else wake_date
    bed_dt = datetime(bed_date.year, bed_date.month, bed_date.day, bh, bm, tzinfo=_IST)
    bedtime_ms = int(bed_dt.timestamp() * 1000)
    if wake_ms <= bedtime_ms:
        return None
    return bedtime_ms, wake_ms


def _find_sleep_task_times(user_id: int, wake_date_str: str, db: Session) -> Optional[tuple[int, int]]:
    """Return (bedtime_ms, wake_ms) from the Sleep task whose wake falls on wake_date (IST)."""
    wake_date = date.fromisoformat(wake_date_str)
    window_start = datetime(wake_date.year, wake_date.month, wake_date.day, tzinfo=_IST) - timedelta(days=2)
    window_end = datetime(wake_date.year, wake_date.month, wake_date.day, tzinfo=_IST) + timedelta(days=1)
    start_ms = int(window_start.timestamp() * 1000)
    end_ms = int(window_end.timestamp() * 1000)

    tasks = (
        db.query(CircuitTask)
        .filter(
            CircuitTask.user_id == user_id,
            CircuitTask.scheduled_at.isnot(None),
            CircuitTask.scheduled_at >= start_ms,
            CircuitTask.scheduled_at < end_ms,
        )
        .all()
    )

    best: Optional[tuple[int, int, int]] = None  # bedtime, wake, wake (sort key)
    for task in tasks:
        if not _is_sleep_task(task):
            continue
        bedtime_ms = task.scheduled_at
        wake_ms = bedtime_ms + task.duration * 60_000
        if wake_ms <= bedtime_ms:
            continue
        wake_ist = datetime.fromtimestamp(wake_ms / 1000, tz=_IST)
        if wake_ist.date() != wake_date:
            continue
        if best is None or wake_ms > best[2]:
            best = (bedtime_ms, wake_ms, wake_ms)

    return (best[0], best[1]) if best else None


def resolve_sleep_for_wake_date(
    user_id: int,
    wake_date_str: str,
    db: Session,
    default_quality: Optional[float] = None,
) -> Optional[SleepContext]:
    """Merge Sleep task timing with optional manual overrides for one wake-up date."""
    if default_quality is None:
        default_quality = _get_default_sleep_quality(db, user_id)

    manual = db.query(SleepLog).filter_by(user_id=user_id, date=wake_date_str).first()
    task_times = _find_sleep_task_times(user_id, wake_date_str, db)

    has_manual_times = (
        manual is not None
        and manual.bedtime_ms is not None
        and manual.wake_ms is not None
        and manual.wake_ms > manual.bedtime_ms
    )
    if has_manual_times:
        bedtime_ms, wake_ms = manual.bedtime_ms, manual.wake_ms  # type: ignore[union-attr]
    elif task_times:
        bedtime_ms, wake_ms = task_times
    else:
        return None

    has_override = manual is not None and (
        manual.quality is not None
        or manual.disturbed is not None
        or bool(manual.notes)
        or has_manual_times
    )
    if has_manual_times and task_times:
        source = "mixed"
    elif has_manual_times:
        source = "manual"
    elif has_override and task_times:
        source = "mixed"
    else:
        source = "task"

    quality_is_default = manual is None or manual.quality is None
    quality = manual.quality if manual and manual.quality is not None else default_quality
    disturbed = bool(manual.disturbed) if manual and manual.disturbed is not None else False
    notes = manual.notes if manual else None

    return SleepContext(
        date=wake_date_str,
        bedtime_ms=bedtime_ms,
        wake_ms=wake_ms,
        quality=quality,
        quality_is_default=quality_is_default,
        disturbed=disturbed,
        notes=notes,
        source=source,
        manual_log_id=manual.id if manual else None,
    )


def resolve_sleep_with_fallback(user_id: int, wake_date_str: str, db: Session) -> Optional[SleepContext]:
    """Resolve sleep for wake_date. Falls back to default_bedtime/default_wake_time settings,
    then to yesterday's task-derived times (not manual overrides) as a last resort."""
    ctx = resolve_sleep_for_wake_date(user_id, wake_date_str, db)
    if ctx:
        return ctx
    # Use the user's configured default sleep window when no Sleep task exists for the date
    default_window = _get_default_sleep_window(db, user_id, wake_date_str)
    if default_window:
        bedtime_ms, wake_ms = default_window
        quality = _get_default_sleep_quality(db, user_id)
        return SleepContext(
            date=wake_date_str,
            bedtime_ms=bedtime_ms,
            wake_ms=wake_ms,
            quality=quality,
            quality_is_default=True,
            disturbed=False,
            notes=None,
            source="default",
            manual_log_id=None,
        )
    # Legacy fallback: yesterday's task-derived times only (skip manual overrides that were date-specific)
    prev = (date.fromisoformat(wake_date_str) - timedelta(days=1)).isoformat()
    prev_ctx = resolve_sleep_for_wake_date(user_id, prev, db)
    if prev_ctx and prev_ctx.source == "task":
        return prev_ctx
    return None


def _context_dict(ctx: SleepContext) -> dict:
    duration_h = round((ctx.wake_ms - ctx.bedtime_ms) / 3_600_000, 2)
    return {
        "id": ctx.manual_log_id,
        "date": ctx.date,
        "bedtime_ms": ctx.bedtime_ms,
        "wake_ms": ctx.wake_ms,
        "quality": ctx.quality,
        "quality_is_default": ctx.quality_is_default,
        "disturbed": ctx.disturbed,
        "notes": ctx.notes,
        "duration_h": duration_h,
        "source": ctx.source,
        "created_at": None,
        "updated_at": None,
    }


def _log_dict(log: SleepLog) -> dict:
    duration_h = None
    if log.bedtime_ms and log.wake_ms and log.wake_ms > log.bedtime_ms:
        duration_h = round((log.wake_ms - log.bedtime_ms) / 3_600_000, 2)
    return {
        "id": log.id,
        "date": log.date,
        "bedtime_ms": log.bedtime_ms,
        "wake_ms": log.wake_ms,
        "quality": log.quality,
        "quality_is_default": log.quality is None,
        "disturbed": log.disturbed,
        "notes": log.notes,
        "duration_h": duration_h,
        "source": "manual",
        "created_at": log.created_at.isoformat() + "Z",
        "updated_at": log.updated_at.isoformat() + "Z",
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("", status_code=200)
def upsert_sleep_log(
    payload: SleepLogWrite,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Upsert sleep overrides for a wake-up date (quality, disturbed, notes)."""
    date_str = payload.date or datetime.now(_IST).strftime("%Y-%m-%d")
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")

    if payload.bedtime_ms and payload.wake_ms and payload.wake_ms <= payload.bedtime_ms:
        raise HTTPException(400, "wake_ms must be after bedtime_ms")

    row = db.query(SleepLog).filter_by(user_id=user.id, date=date_str).first()
    if row:
        for field in ("bedtime_ms", "wake_ms"):
            val = getattr(payload, field)
            if val is not None:
                setattr(row, field, val)
        row.quality = payload.quality
        if payload.disturbed is not None:
            row.disturbed = payload.disturbed
        if payload.notes is not None:
            row.notes = payload.notes
        row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    else:
        row = SleepLog(
            user_id=user.id,
            date=date_str,
            bedtime_ms=payload.bedtime_ms,
            wake_ms=payload.wake_ms,
            quality=payload.quality,
            disturbed=payload.disturbed,
            notes=payload.notes,
        )
        db.add(row)
    db.commit()
    db.refresh(row)

    ctx = resolve_sleep_for_wake_date(user.id, date_str, db)
    if ctx:
        return _context_dict(ctx)
    return _log_dict(row)


@router.get("")
def list_sleep_logs(
    days: int = 7,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Return resolved sleep for the last `days` wake-up dates (most recent first)."""
    today_ist = datetime.now(_IST).date()
    results = []
    for offset in range(days):
        d = (today_ist - timedelta(days=offset)).isoformat()
        ctx = resolve_sleep_for_wake_date(user.id, d, db)
        if ctx:
            results.append(_context_dict(ctx))
    return results


def _is_override_row(log: SleepLog) -> bool:
    return (
        log.quality is not None
        or log.disturbed is True
        or bool(log.notes and log.notes.strip())
        or (log.bedtime_ms is not None and log.wake_ms is not None)
    )


@router.get("/overrides")
def list_sleep_overrides(
    page: int = 1,
    limit: int = 10,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Paginated list of days with manual sleep overrides (quality, disturbed, notes)."""
    page = max(1, page)
    limit = max(1, min(50, limit))
    offset = (page - 1) * limit

    query = (
        db.query(SleepLog)
        .filter(SleepLog.user_id == user.id)
        .filter(
            or_(
                SleepLog.quality.isnot(None),
                SleepLog.disturbed.is_(True),
                and_(SleepLog.notes.isnot(None), SleepLog.notes != ""),
                and_(SleepLog.bedtime_ms.isnot(None), SleepLog.wake_ms.isnot(None)),
            )
        )
    )
    total = query.count()
    rows = query.order_by(SleepLog.date.desc()).offset(offset).limit(limit).all()

    items = []
    for row in rows:
        ctx = resolve_sleep_for_wake_date(user.id, row.date, db)
        if ctx:
            item = _context_dict(ctx)
            item["id"] = row.id
            item["created_at"] = row.created_at.isoformat() + "Z"
            item["updated_at"] = row.updated_at.isoformat() + "Z"
            items.append(item)
        elif _is_override_row(row):
            items.append(_log_dict(row))

    pages = max(1, (total + limit - 1) // limit) if total else 0
    return {"items": items, "total": total, "page": page, "limit": limit, "pages": pages}


@router.delete("/{date}", status_code=204)
def delete_sleep_override(
    date: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Remove manual sleep overrides for a wake-up date. Timing reverts to the Sleep task + defaults."""
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")

    row = db.query(SleepLog).filter_by(user_id=user.id, date=date).first()
    if not row:
        raise HTTPException(404, "No sleep override for that date")
    if not _is_override_row(row):
        raise HTTPException(404, "No sleep override for that date")

    db.delete(row)
    db.commit()


# ── Energy factor computation ─────────────────────────────────────────────────

def compute_sleep_factor(
    ctx: Optional[SleepContext],
    work_end_hour_yesterday: Optional[int],
    work_span_hours_yesterday: Optional[float],
    first_event_hour_today: Optional[int],
) -> tuple[float, list[str]]:
    """Core formula — returns (factor 0–1, list of human-readable penalty notes)."""
    factor = 1.0
    notes: list[str] = []

    if ctx and ctx.wake_ms > ctx.bedtime_ms:
        duration_h = (ctx.wake_ms - ctx.bedtime_ms) / 3_600_000

        if duration_h < 4:
            factor -= 0.35
            notes.append(f"{duration_h:.1f}h sleep — severe deficit")
        elif duration_h < 5:
            factor -= 0.25
            notes.append(f"{duration_h:.1f}h sleep — significant deficit")
        elif duration_h < 6:
            factor -= 0.15
            notes.append(f"{duration_h:.1f}h sleep — mild deficit")
        elif duration_h < 7:
            factor -= 0.07
            notes.append(f"{duration_h:.1f}h sleep — slightly short")
        else:
            notes.append(f"{duration_h:.1f}h sleep")

        bedtime_ist = datetime.fromtimestamp(ctx.bedtime_ms / 1000, tz=_IST)
        bh = bedtime_ist.hour
        if 2 <= bh < 6:
            factor -= 0.12
            notes.append(f"very late bedtime ({bedtime_ist.strftime('%H:%M')})")
        elif bh == 1 or bh == 0:
            factor -= 0.06
            notes.append(f"late bedtime ({bedtime_ist.strftime('%H:%M')})")

        wake_ist = datetime.fromtimestamp(ctx.wake_ms / 1000, tz=_IST)
        wh = wake_ist.hour
        if wh < 5:
            factor -= 0.08
            notes.append(f"very early wake ({wake_ist.strftime('%H:%M')})")
        elif wh < 6:
            factor -= 0.04
            notes.append(f"early wake ({wake_ist.strftime('%H:%M')})")

        q = ctx.quality / 10.0
        factor = factor * 0.65 + q * 0.35
        if ctx.quality_is_default:
            notes.append(f"quality assumed {ctx.quality:.0f}/10 (default)")
        elif q < 0.3:
            notes.append("poor quality sleep")
        elif q < 0.6:
            notes.append("fair quality sleep")

        if ctx.disturbed:
            factor -= 0.10
            notes.append("disturbed/fragmented sleep")

    if work_end_hour_yesterday is not None:
        weh = work_end_hour_yesterday
        if weh >= 23:
            factor -= 0.12
            notes.append(f"worked until {weh}:xx last night")
        elif weh >= 22:
            factor -= 0.08
            notes.append(f"worked until {weh}:xx last night")
        elif weh >= 21:
            factor -= 0.04
            notes.append("worked late last night")

    if work_span_hours_yesterday is not None and work_span_hours_yesterday > 8:
        if work_span_hours_yesterday > 10:
            factor -= 0.12
            notes.append(f"long day yesterday ({work_span_hours_yesterday:.1f}h)")
        else:
            factor -= 0.06
            notes.append(f"extended day yesterday ({work_span_hours_yesterday:.1f}h)")

    if first_event_hour_today is not None:
        feh = first_event_hour_today
        if feh < 6:
            factor -= 0.08
            notes.append(f"very early start today ({feh}:xx)")
        elif feh < 7:
            factor -= 0.04
            notes.append(f"early start today ({feh}:xx)")

    return round(max(0.10, min(1.0, factor)), 3), notes


def _get_work_signals(user_id: int, db: Session, target_date: Optional[date] = None) -> tuple[Optional[int], Optional[float], Optional[int]]:
    """Derive yesterday's work end hour, yesterday's work span, and today's first event hour
    from TaskEvent timestamps. Returns (end_hour_yesterday, span_h_yesterday, first_hour_today)."""
    target = target_date or datetime.now(_IST).date()
    today_start = datetime(target.year, target.month, target.day, tzinfo=_IST)
    yesterday_start = today_start - timedelta(days=1)
    tomorrow_start = today_start + timedelta(days=1)

    today_start_utc = today_start.astimezone(timezone.utc).replace(tzinfo=None)
    yesterday_start_utc = yesterday_start.astimezone(timezone.utc).replace(tzinfo=None)
    tomorrow_start_utc = tomorrow_start.astimezone(timezone.utc).replace(tzinfo=None)

    yesterday_events = (
        db.query(TaskEvent.occurred_at)
        .filter(
            TaskEvent.user_id == user_id,
            TaskEvent.occurred_at >= yesterday_start_utc,
            TaskEvent.occurred_at < today_start_utc,
        )
        .order_by(TaskEvent.occurred_at)
        .all()
    )

    work_end_h: Optional[int] = None
    work_span_h: Optional[float] = None
    if yesterday_events:
        first_ev = yesterday_events[0][0].replace(tzinfo=timezone.utc).astimezone(_IST)
        last_ev = yesterday_events[-1][0].replace(tzinfo=timezone.utc).astimezone(_IST)
        work_end_h = last_ev.hour
        span = (last_ev - first_ev).total_seconds() / 3600
        if span > 1:
            work_span_h = round(span, 1)

    today_events = (
        db.query(TaskEvent.occurred_at)
        .filter(
            TaskEvent.user_id == user_id,
            TaskEvent.occurred_at >= today_start_utc,
            TaskEvent.occurred_at < tomorrow_start_utc,
        )
        .order_by(TaskEvent.occurred_at)
        .limit(1)
        .all()
    )
    first_today_h: Optional[int] = None
    if today_events:
        fe = today_events[0][0].replace(tzinfo=timezone.utc).astimezone(_IST)
        first_today_h = fe.hour

    return work_end_h, work_span_h, first_today_h


@router.get("/factor")
def get_sleep_factor(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Return today's energy factor (0–1) from Sleep task + overrides + work signals."""
    today_str = datetime.now(_IST).strftime("%Y-%m-%d")
    ctx = resolve_sleep_with_fallback(user.id, today_str, db)

    work_end_h, work_span_h, first_today_h = _get_work_signals(user.id, db)
    factor, notes = compute_sleep_factor(ctx, work_end_h, work_span_h, first_today_h)

    return {
        "date": today_str,
        "sleep_factor": factor,
        "notes": notes,
        "has_sleep_log": ctx is not None,
        "sleep_log": _context_dict(ctx) if ctx else None,
        "default_sleep_quality": _get_default_sleep_quality(db, user.id),
        "default_bedtime": _get_str_setting(db, user.id, SETTINGS_KEY_DEFAULT_BEDTIME),
        "default_wake_time": _get_str_setting(db, user.id, SETTINGS_KEY_DEFAULT_WAKE_TIME),
        "work_signals": {
            "work_end_hour_yesterday": work_end_h,
            "work_span_hours_yesterday": work_span_h,
            "first_event_hour_today": first_today_h,
        },
    }
