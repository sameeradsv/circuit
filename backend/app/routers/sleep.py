"""Sleep + work-session context router.

Endpoints:
  POST /api/sleep          — upsert today's sleep log (idempotent, keyed by date)
  GET  /api/sleep          — list recent sleep logs (?days=7)
  GET  /api/sleep/factor   — computed energy factor for today (0–1) + breakdown

Energy factor formula
---------------------
base = 1.0, then penalties:
  Sleep duration  < 4 h  → −0.35
                 4–5 h  → −0.25
                 5–6 h  → −0.15
                 6–7 h  → −0.07
  Late bedtime    2–6 AM → −0.12   (very late / all-nighter)
                 0–2 AM → −0.06   (late)
  Early wake    < 5 AM   → −0.08
                 5–6 AM  → −0.04
  Quality (0–10) blended: factor = factor*0.65 + (quality/10)*0.35
  Disturbed sleep         → −0.10
  Yesterday work ended   ≥23h → −0.12 | ≥22h → −0.08 | ≥21h → −0.04
  Yesterday work span    >10h → −0.12 | >8h  → −0.06
  Today first event      <6h  → −0.08 | <7h  → −0.04
Result is clamped to [0.10, 1.00].
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import SleepLog, TaskEvent, User

_IST = ZoneInfo("Asia/Kolkata")

router = APIRouter(prefix="/api/sleep", tags=["sleep"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class SleepLogWrite(BaseModel):
    date: Optional[str] = None          # "YYYY-MM-DD" IST; defaults to today IST
    bedtime_ms: Optional[int] = None    # epoch ms
    wake_ms: Optional[int] = None       # epoch ms
    quality: Optional[float] = Field(default=None, ge=0.0, le=10.0)
    disturbed: Optional[bool] = None
    notes: Optional[str] = Field(default=None, max_length=500)


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
        "disturbed": log.disturbed,
        "notes": log.notes,
        "duration_h": duration_h,
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
    """Create or replace today's (or specified date's) sleep log."""
    date_str = payload.date or datetime.now(_IST).strftime("%Y-%m-%d")
    try:
        datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "date must be YYYY-MM-DD")

    if payload.bedtime_ms and payload.wake_ms and payload.wake_ms <= payload.bedtime_ms:
        raise HTTPException(400, "wake_ms must be after bedtime_ms")

    row = db.query(SleepLog).filter_by(user_id=user.id, date=date_str).first()
    if row:
        for field in ("bedtime_ms", "wake_ms", "quality", "disturbed", "notes"):
            val = getattr(payload, field)
            if val is not None:
                setattr(row, field, val)
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
    return _log_dict(row)


@router.get("")
def list_sleep_logs(
    days: int = 7,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Return the last `days` sleep logs (default 7), most recent first."""
    today_ist = datetime.now(_IST).date()
    cutoff = (today_ist - timedelta(days=days)).isoformat()
    logs = (
        db.query(SleepLog)
        .filter(SleepLog.user_id == user.id, SleepLog.date >= cutoff)
        .order_by(SleepLog.date.desc())
        .all()
    )
    return [_log_dict(l) for l in logs]


# ── Energy factor computation ─────────────────────────────────────────────────

def compute_sleep_factor(
    log: Optional[SleepLog],
    work_end_hour_yesterday: Optional[int],
    work_span_hours_yesterday: Optional[float],
    first_event_hour_today: Optional[int],
) -> tuple[float, list[str]]:
    """Core formula — returns (factor 0–1, list of human-readable penalty notes)."""
    factor = 1.0
    notes: list[str] = []

    if log and log.bedtime_ms and log.wake_ms and log.wake_ms > log.bedtime_ms:
        duration_h = (log.wake_ms - log.bedtime_ms) / 3_600_000

        # Duration penalty
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

        # Late bedtime — circadian disruption penalty
        bedtime_ist = datetime.fromtimestamp(log.bedtime_ms / 1000, tz=_IST)
        bh = bedtime_ist.hour
        if 2 <= bh < 6:
            factor -= 0.12
            notes.append(f"very late bedtime ({bedtime_ist.strftime('%H:%M')})")
        elif bh == 1 or bh == 0:
            factor -= 0.06
            notes.append(f"late bedtime ({bedtime_ist.strftime('%H:%M')})")

        # Early wake penalty
        wake_ist = datetime.fromtimestamp(log.wake_ms / 1000, tz=_IST)
        wh = wake_ist.hour
        if wh < 5:
            factor -= 0.08
            notes.append(f"very early wake ({wake_ist.strftime('%H:%M')})")
        elif wh < 6:
            factor -= 0.04
            notes.append(f"early wake ({wake_ist.strftime('%H:%M')})")

        # Quality modifier (blended with duration-derived factor)
        if log.quality is not None:
            q = log.quality / 10.0
            factor = factor * 0.65 + q * 0.35
            if q < 0.3:
                notes.append("poor quality sleep")
            elif q < 0.6:
                notes.append("fair quality sleep")

        # Disturbed / fragmented
        if log.disturbed:
            factor -= 0.10
            notes.append("disturbed/fragmented sleep")

    # Work session penalties (derived from task events, no user input required)
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


def _get_work_signals(user_id: int, db: Session) -> tuple[Optional[int], Optional[float], Optional[int]]:
    """Derive yesterday's work end hour, yesterday's work span, and today's first event hour
    from TaskEvent timestamps. Returns (end_hour_yesterday, span_h_yesterday, first_hour_today)."""
    now_ist = datetime.now(_IST)
    today_start = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday_start = today_start - timedelta(days=1)

    today_start_utc = today_start.astimezone(timezone.utc).replace(tzinfo=None)
    yesterday_start_utc = yesterday_start.astimezone(timezone.utc).replace(tzinfo=None)

    # Yesterday's task events
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
        last_ev  = yesterday_events[-1][0].replace(tzinfo=timezone.utc).astimezone(_IST)
        work_end_h = last_ev.hour
        span = (last_ev - first_ev).total_seconds() / 3600
        if span > 1:  # ignore if all events in <1h (just a quick check-in)
            work_span_h = round(span, 1)

    # Today's first task event
    today_events = (
        db.query(TaskEvent.occurred_at)
        .filter(
            TaskEvent.user_id == user_id,
            TaskEvent.occurred_at >= today_start_utc,
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
    """Return today's energy factor (0–1) derived from last sleep log + work session signals."""
    today_str = datetime.now(_IST).strftime("%Y-%m-%d")
    log = db.query(SleepLog).filter_by(user_id=user.id, date=today_str).first()
    if not log:
        # Fallback: check yesterday's log
        yesterday_str = (datetime.now(_IST) - timedelta(days=1)).strftime("%Y-%m-%d")
        log = db.query(SleepLog).filter_by(user_id=user.id, date=yesterday_str).first()

    work_end_h, work_span_h, first_today_h = _get_work_signals(user.id, db)
    factor, notes = compute_sleep_factor(log, work_end_h, work_span_h, first_today_h)

    return {
        "date": today_str,
        "sleep_factor": factor,
        "notes": notes,
        "has_sleep_log": log is not None,
        "sleep_log": _log_dict(log) if log else None,
        "work_signals": {
            "work_end_hour_yesterday": work_end_h,
            "work_span_hours_yesterday": work_span_h,
            "first_event_hour_today": first_today_h,
        },
    }
