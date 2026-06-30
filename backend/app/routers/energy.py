from __future__ import annotations

from datetime import date as date_type, datetime, timedelta, timezone
import json
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, TaskEvent, User, UserState
from app.task_event_time import effective_event_time

_IST = ZoneInfo("Asia/Kolkata")

router = APIRouter(prefix="/api/energy", tags=["energy"])

_ENERGY_EVENT_TYPES = {"completed"}


def _task_delta(event_type: str, task: CircuitTask, metadata_json: str | None = None) -> float:
    """
    Signed energy delta for a task event.
    Positive = restores energy, negative = drains it.

    Completing a high-reward task can be net-positive because the sense of
    accomplishment offsets the cognitive cost. Low-reward/heavy tasks drain.
    Duration scales sublinearly so long imported calendar blocks do not
    single-handedly flatten the balance (30 min = 0.7x, 60 min = 1.0x,
    480 min = 2.8x).
    """
    duration_mins = max(5, task.duration or 30)
    dur_factor = min(3.0, max(0.5, (duration_mins / 60) ** 0.5))
    metadata = {}
    if metadata_json:
        try:
            metadata = json.loads(metadata_json)
        except (TypeError, json.JSONDecodeError):
            metadata = {}

    if event_type == "completed":
        reward = task.energy_to_reward_ratio        # 0–1; sense of accomplishment is fixed
        cost   = task.cognitive_load * 0.15 * dur_factor   # effort cost scales with duration
        delay_minutes = 0
        try:
            delay_minutes = max(0, int(metadata.get("delay_minutes") or 0))
        except (TypeError, ValueError):
            delay_minutes = 0
        delay_penalty = min(0.18, (delay_minutes / 60) * 0.025) if delay_minutes > 30 else 0.0
        delta  = reward * 0.12 - cost - delay_penalty
    else:
        delta = 0.0
    return round(max(-0.85, min(0.15, delta)), 3)


def _task_label(delta: float) -> str:
    if delta < -0.05:
        return "draining"
    if delta > 0.03:
        return "energising"
    return "neutral"


def _start_energy(state: Optional[UserState], sleep_factor: float) -> float:
    """
    Compute today's opening energy balance.
    sleep_factor (0.10–1.0) is the primary restorer; yesterday's closing
    energy provides the carry-over base (30% weight).
    """
    eod = (state.energy_eod if state and state.energy_eod is not None else 0.70)
    return _start_energy_from_eod(eod, sleep_factor)


def _start_energy_from_eod(eod: float, sleep_factor: float) -> float:
    """
    Compute an opening balance from a known previous close and the day's sleep.
    """
    raw = sleep_factor * 0.70 + eod * 0.30
    return round(min(1.0, max(0.0, raw)), 3)


def _day_bounds(target: date_type) -> tuple[datetime, datetime, int, int]:
    day_start_ist = datetime(target.year, target.month, target.day, tzinfo=_IST)
    day_end_ist = day_start_ist + timedelta(days=1)
    day_start_utc = day_start_ist.astimezone(timezone.utc).replace(tzinfo=None)
    day_end_utc = day_end_ist.astimezone(timezone.utc).replace(tzinfo=None)
    return (
        day_start_utc,
        day_end_utc,
        int(day_start_utc.timestamp() * 1000),
        int(day_end_utc.timestamp() * 1000),
    )


def _timeline_rows(user_id: int, target: date_type, db: Session) -> list[tuple[TaskEvent, CircuitTask]]:
    day_start_utc, day_end_utc, day_start_ms, day_end_ms = _day_bounds(target)
    rows = (
        db.query(TaskEvent, CircuitTask)
        .join(CircuitTask, TaskEvent.task_id == CircuitTask.id)
        .filter(
            TaskEvent.user_id == user_id,
            TaskEvent.event_type.in_(_ENERGY_EVENT_TYPES),
            or_(
                and_(
                    TaskEvent.occurred_at >= day_start_utc,
                    TaskEvent.occurred_at < day_end_utc,
                ),
                and_(
                    CircuitTask.scheduled_at.isnot(None),
                    CircuitTask.scheduled_at >= day_start_ms,
                    CircuitTask.scheduled_at < day_end_ms,
                ),
            ),
        )
        .all()
    )
    rows = [
        row for row in rows
        if day_start_utc <= effective_event_time(row[0], row[1]) < day_end_utc
    ]
    rows.sort(key=lambda row: effective_event_time(row[0], row[1]))
    return rows


def _sleep_factor_for_date(user_id: int, target: date_type, db: Session) -> float:
    from app.routers.sleep import compute_sleep_factor, resolve_sleep_with_fallback, _get_work_signals

    sleep_ctx = resolve_sleep_with_fallback(user_id, target.isoformat(), db)
    work_end_h, work_span_h, first_today_h = _get_work_signals(user_id, db, target)
    sleep_factor, _ = compute_sleep_factor(sleep_ctx, work_end_h, work_span_h, first_today_h)
    return sleep_factor


def _end_energy_for_date(user_id: int, target: date_type, start_energy: float, db: Session) -> float:
    running = start_energy
    for ev, task in _timeline_rows(user_id, target, db):
        running = round(min(1.0, max(0.0, running + _task_delta(ev.event_type, task, ev.metadata_json))), 3)
    return running


def _timeline_start_energy(user_id: int, target: date_type, sleep_factor: float, state: Optional[UserState], db: Session) -> float:
    """
    Today's opening uses the live carry-over in user_state. Historical timelines
    derive their opening from that date's previous-day close, so browsing old
    dates does not reuse or mutate today's carry-over.
    """
    today = datetime.now(_IST).date()
    if target == today:
        return _start_energy(state, sleep_factor)

    previous_day = target - timedelta(days=1)
    previous_sleep = _sleep_factor_for_date(user_id, previous_day, db)
    previous_start = _start_energy_from_eod(0.70, previous_sleep)
    previous_end = _end_energy_for_date(user_id, previous_day, previous_start, db)
    return _start_energy_from_eod(previous_end, sleep_factor)


@router.get("/timeline")
def energy_timeline(
    date: Optional[str] = None,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """
    Cumulative energy timeline for a calendar day (default: today IST).

    Each event carries `delta` (signed energy change) and `running_energy`
    (balance after that event). The day opens at `start_energy` derived from
    sleep quality and previous-day carry-over.

    Historical dates derive their opening energy from that date's previous
    close, without mutating today's carry-over state.
    """
    if date:
        try:
            from datetime import date as _date
            target = _date.fromisoformat(date)
        except ValueError:
            raise HTTPException(400, "date must be YYYY-MM-DD")
    else:
        target = datetime.now(_IST).date()

    rows = _timeline_rows(user.id, target, db)
    sleep_factor = _sleep_factor_for_date(user.id, target, db)

    state = db.query(UserState).filter_by(user_id=user.id).first()
    s_energy = _timeline_start_energy(user.id, target, sleep_factor, state, db)

    # Build events with running balance
    running = s_energy
    events = []
    for ev, task in rows:
        delta = _task_delta(ev.event_type, task, ev.metadata_json)
        running = round(min(1.0, max(0.0, running + delta)), 3)
        label   = _task_label(delta)
        event_at = effective_event_time(ev, task)
        local_time = event_at.replace(tzinfo=timezone.utc).astimezone(_IST)
        events.append({
            "occurred_at":    event_at.isoformat() + "Z",
            "time":           local_time.strftime("%H:%M"),
            "energy":         round(min(1.0, max(0.0, (delta + 0.25) / 0.50)), 3),  # map delta→0–1 for compat
            "delta":          delta,
            "running_energy": running,
            "label":          label,
            "note":           f"{task.text[:80]} ({ev.event_type})",
            "source":         "circuit",
        })

    end_energy = running  # balance after last event (or start_energy if no events)

    return {
        "date":         target.isoformat(),
        "source":       "circuit",
        "start_energy": s_energy,
        "end_energy":   end_energy,
        "events":       events,
        "avg_energy":   round(sum(e["energy"] for e in events) / len(events), 3) if events else None,
    }


def _task_drain(event_type: str, task: CircuitTask, metadata_json: str | None = None) -> float:
    """Absolute drain cost for sync endpoint — kept for backward compat."""
    duration_mins = max(5, task.duration or 30)
    dur_factor = min(8.0, max(0.5, duration_mins / 60))
    if event_type == "completed":
        base = task.cognitive_load * 0.35 * (1.0 - task.energy_to_reward_ratio * 0.5) * dur_factor
    else:
        return 0.0
    return round(max(0.0, min(0.85, base)), 3)


def _scheduled_drain(task: CircuitTask) -> float:
    effort_mult = {"high": 1.3, "medium": 1.0, "low": 0.6}.get(task.effort or "medium", 1.0)
    duration_mins = max(5, task.duration or 30)
    dur_factor = min(8.0, max(0.5, duration_mins / 60))
    base = (task.cognitive_load * 0.4 + task.activation_energy * 0.2) * effort_mult * dur_factor
    return round(max(0.05, min(0.85, base)), 3)


@router.get("/sync")
def energy_sync(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """
    Real-time energy state. Includes `start_energy` (from sleep + carry-over)
    and `running_energy` (start_energy adjusted for today's events so far).
    Also writes the current running energy as the carry-over for tomorrow.
    """
    now_ist       = datetime.now(_IST)
    day_start_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end_ist   = day_start_ist + timedelta(days=1)
    day_start_utc = day_start_ist.astimezone(timezone.utc).replace(tzinfo=None)
    day_end_utc   = day_end_ist.astimezone(timezone.utc).replace(tzinfo=None)
    now_utc       = now_ist.astimezone(timezone.utc).replace(tzinfo=None)

    day_start_ms = int(day_start_utc.timestamp() * 1000)
    now_ms = int(now_utc.timestamp() * 1000)
    candidate_rows = (
        db.query(TaskEvent, CircuitTask)
        .join(CircuitTask, TaskEvent.task_id == CircuitTask.id)
        .filter(
            TaskEvent.user_id == user.id,
            TaskEvent.event_type.in_(_ENERGY_EVENT_TYPES),
            or_(
                and_(
                    TaskEvent.occurred_at >= day_start_utc,
                    TaskEvent.occurred_at <= now_utc,
                ),
                and_(
                    CircuitTask.scheduled_at.isnot(None),
                    CircuitTask.scheduled_at >= day_start_ms,
                    CircuitTask.scheduled_at <= now_ms,
                ),
            ),
        )
        .all()
    )
    past_rows = [
        row for row in candidate_rows
        if day_start_utc <= effective_event_time(row[0], row[1]) <= now_utc
    ]

    future_tasks = (
        db.query(CircuitTask)
        .filter(
            CircuitTask.user_id == user.id,
            CircuitTask.completed == False,  # noqa: E712
            CircuitTask.scheduled_at.isnot(None),
            CircuitTask.scheduled_at > int(now_utc.timestamp() * 1000),
            CircuitTask.scheduled_at < int(day_end_utc.timestamp() * 1000),
        )
        .all()
    )

    state = db.query(UserState).filter_by(user_id=user.id).first()

    from app.routers.sleep import compute_sleep_factor, resolve_sleep_with_fallback, _get_work_signals
    today_str = now_ist.strftime("%Y-%m-%d")
    sleep_ctx = resolve_sleep_with_fallback(user.id, today_str, db)
    work_end_h, work_span_h, first_today_h = _get_work_signals(user.id, db)
    sleep_factor, sleep_notes = compute_sleep_factor(sleep_ctx, work_end_h, work_span_h, first_today_h)

    s_energy = _start_energy(state, sleep_factor)

    # Running energy: start + cumulative deltas from past events
    delta_so_far = sum(_task_delta(ev.event_type, task, ev.metadata_json) for ev, task in past_rows)
    running_energy = round(min(1.0, max(0.0, s_energy + delta_so_far)), 3)

    # Also compute legacy drain fields for backward compat
    drain_so_far = min(1.0, sum(_task_drain(ev.event_type, task, ev.metadata_json) for ev, task in past_rows))
    drain_ahead  = min(1.0, sum(_scheduled_drain(t) for t in future_tasks))

    return {
        "as_of":          now_ist.isoformat(),
        "source":         "circuit",
        "start_energy":   s_energy,
        "running_energy": running_energy,
        "drain_so_far":   round(drain_so_far, 3),
        "energy_so_far":  round(1.0 - drain_so_far, 3),
        "drain_ahead":    round(drain_ahead, 3),
        "energy_ahead":   round(1.0 - drain_ahead, 3),
        "events_so_far":  len(past_rows),
        "events_ahead":   len(future_tasks),
        "manual_energy":  round(state.energy_level, 3) if state else 0.7,
        "stress_level":   round(state.stress_level, 3) if state else 0.3,
        "sleep_factor":   sleep_factor,
        "sleep_notes":    sleep_notes,
    }
