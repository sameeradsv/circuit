from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, SleepLog, TaskEvent, User, UserState

_IST = ZoneInfo("Asia/Kolkata")

router = APIRouter(prefix="/api/energy", tags=["energy"])


def _task_delta(event_type: str, task: CircuitTask) -> float:
    """
    Signed energy delta for a task event.
    Positive = restores energy, negative = drains it.

    Completing a high-reward task can be net-positive because the sense of
    accomplishment offsets the cognitive cost. Low-reward/heavy tasks drain.
    """
    if event_type == "completed":
        reward = task.energy_to_reward_ratio        # 0–1
        cost   = task.cognitive_load * 0.15         # 0–0.15
        delta  = reward * 0.12 - cost               # −0.15 to +0.12
    elif event_type == "skipped":
        delta = -(task.activation_energy * 0.15 + 0.05)   # −0.05 to −0.20
    elif event_type == "uncompleted":
        delta = -(task.recovery_cost * 0.20 + 0.05)       # −0.05 to −0.25
    else:
        delta = -0.02   # created/rescheduled: tiny planning overhead
    return round(max(-0.30, min(0.15, delta)), 3)


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
    raw = sleep_factor * 0.70 + eod * 0.30
    return round(min(1.0, max(0.0, raw)), 3)


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

    Viewing yesterday's timeline stores its `end_energy` as the carry-over
    base for tomorrow.
    """
    if date:
        try:
            from datetime import date as _date
            target = _date.fromisoformat(date)
        except ValueError:
            raise HTTPException(400, "date must be YYYY-MM-DD")
    else:
        target = datetime.now(_IST).date()

    day_start_ist = datetime(target.year, target.month, target.day, tzinfo=_IST)
    day_end_ist   = day_start_ist + timedelta(days=1)
    day_start_utc = day_start_ist.astimezone(timezone.utc).replace(tzinfo=None)
    day_end_utc   = day_end_ist.astimezone(timezone.utc).replace(tzinfo=None)

    rows = (
        db.query(TaskEvent, CircuitTask)
        .join(CircuitTask, TaskEvent.task_id == CircuitTask.id)
        .filter(
            TaskEvent.user_id == user.id,
            TaskEvent.occurred_at >= day_start_utc,
            TaskEvent.occurred_at < day_end_utc,
        )
        .order_by(TaskEvent.occurred_at)
        .all()
    )

    # Compute sleep factor for this date
    from app.routers.sleep import compute_sleep_factor, _get_work_signals
    date_str = target.isoformat()
    prev_str  = (target - timedelta(days=1)).isoformat()
    sleep_log = (
        db.query(SleepLog).filter_by(user_id=user.id, date=date_str).first()
        or db.query(SleepLog).filter_by(user_id=user.id, date=prev_str).first()
    )
    work_end_h, work_span_h, first_today_h = _get_work_signals(user.id, db)
    sleep_factor, _ = compute_sleep_factor(sleep_log, work_end_h, work_span_h, first_today_h)

    state = db.query(UserState).filter_by(user_id=user.id).first()
    s_energy = _start_energy(state, sleep_factor)

    # Build events with running balance
    running = s_energy
    events = []
    for ev, task in rows:
        delta = _task_delta(ev.event_type, task)
        running = round(min(1.0, max(0.0, running + delta)), 3)
        label   = _task_label(delta)
        local_time = ev.occurred_at.replace(tzinfo=timezone.utc).astimezone(_IST)
        events.append({
            "occurred_at":    ev.occurred_at.isoformat() + "Z",
            "time":           local_time.strftime("%H:%M"),
            "energy":         round(min(1.0, max(0.0, (delta + 0.25) / 0.50)), 3),  # map delta→0–1 for compat
            "delta":          delta,
            "running_energy": running,
            "label":          label,
            "note":           f"{task.text[:80]} ({ev.event_type})",
            "source":         "circuit",
        })

    end_energy = running  # balance after last event (or start_energy if no events)

    # Persist end_energy as carry-over when viewing yesterday
    now_ist       = datetime.now(_IST)
    yesterday_str = (now_ist - timedelta(days=1)).strftime("%Y-%m-%d")
    if target.isoformat() == yesterday_str and state:
        state.energy_eod = end_energy
        db.commit()

    return {
        "date":         target.isoformat(),
        "source":       "circuit",
        "start_energy": s_energy,
        "end_energy":   end_energy,
        "events":       events,
        "avg_energy":   round(sum(e["energy"] for e in events) / len(events), 3) if events else None,
    }


def _task_drain(event_type: str, task: CircuitTask) -> float:
    """Absolute drain cost for sync endpoint — kept for backward compat."""
    if event_type == "completed":
        base = task.cognitive_load * 0.35 * (1.0 - task.energy_to_reward_ratio * 0.5)
    elif event_type == "skipped":
        base = task.activation_energy * 0.25
    elif event_type == "uncompleted":
        base = task.recovery_cost * 0.30
    else:
        base = 0.08
    return round(max(0.05, min(0.40, base)), 3)


def _scheduled_drain(task: CircuitTask) -> float:
    effort_mult = {"high": 1.3, "medium": 1.0, "low": 0.6}.get(task.effort or "medium", 1.0)
    base = (task.cognitive_load * 0.4 + task.activation_energy * 0.2) * effort_mult
    return round(max(0.05, min(0.40, base)), 3)


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

    past_rows = (
        db.query(TaskEvent, CircuitTask)
        .join(CircuitTask, TaskEvent.task_id == CircuitTask.id)
        .filter(
            TaskEvent.user_id == user.id,
            TaskEvent.occurred_at >= day_start_utc,
            TaskEvent.occurred_at <= now_utc,
        )
        .all()
    )

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

    from app.routers.sleep import compute_sleep_factor, _get_work_signals
    today_str     = now_ist.strftime("%Y-%m-%d")
    yesterday_str = (now_ist - timedelta(days=1)).strftime("%Y-%m-%d")
    sleep_log = (
        db.query(SleepLog).filter_by(user_id=user.id, date=today_str).first()
        or db.query(SleepLog).filter_by(user_id=user.id, date=yesterday_str).first()
    )
    work_end_h, work_span_h, first_today_h = _get_work_signals(user.id, db)
    sleep_factor, sleep_notes = compute_sleep_factor(sleep_log, work_end_h, work_span_h, first_today_h)

    s_energy = _start_energy(state, sleep_factor)

    # Running energy: start + cumulative deltas from past events
    delta_so_far = sum(_task_delta(ev.event_type, task) for ev, task in past_rows)
    running_energy = round(min(1.0, max(0.0, s_energy + delta_so_far)), 3)

    # Also compute legacy drain fields for backward compat
    drain_so_far = min(1.0, sum(_task_drain(ev.event_type, task) for ev, task in past_rows))
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
