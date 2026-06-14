from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, TaskEvent, User, UserState

_IST = ZoneInfo("Asia/Kolkata")

router = APIRouter(prefix="/api/energy", tags=["energy"])


def _event_energy(event_type: str, task: CircuitTask) -> float:
    if event_type == "completed":
        return round(task.energy_to_reward_ratio, 3)
    if event_type == "skipped":
        return round(max(0.0, 1.0 - task.activation_energy), 3)
    if event_type == "uncompleted":
        return round(max(0.0, 1.0 - task.recovery_cost), 3)
    # created, rescheduled, split → neutral
    return 0.5


@router.get("/timeline")
def energy_timeline(
    date: Optional[str] = None,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """
    Per-task-event energy for a given calendar day (default: today in IST).
    Returns a common shape shared by all personal apps:
      { date, source, events: [{occurred_at, time, energy, label, note, source}], avg_energy }
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
    day_end_ist = day_start_ist + timedelta(days=1)
    day_start_utc = day_start_ist.astimezone(timezone.utc).replace(tzinfo=None)
    day_end_utc = day_end_ist.astimezone(timezone.utc).replace(tzinfo=None)

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

    events = []
    for ev, task in rows:
        energy = _event_energy(ev.event_type, task)
        label = "draining" if energy < 0.35 else "energising" if energy > 0.65 else "neutral"
        local_time = ev.occurred_at.replace(tzinfo=timezone.utc).astimezone(_IST)
        events.append({
            "occurred_at": ev.occurred_at.isoformat() + "Z",
            "time": local_time.strftime("%H:%M"),
            "energy": energy,
            "label": label,
            "note": f"{task.text[:80]} ({ev.event_type})",
            "source": "circuit",
        })

    avg = round(sum(e["energy"] for e in events) / len(events), 3) if events else None
    return {
        "date": target.isoformat(),
        "source": "circuit",
        "events": events,
        "avg_energy": avg,
    }


def _task_drain(event_type: str, task: CircuitTask) -> float:
    """Drain cost for a task event, clamped to [0.05, 0.40]. Mirrors Canopy's _interaction_drain pattern."""
    if event_type == "completed":
        # Completing a high-reward task is energising; high cognitive load still costs
        base = task.cognitive_load * 0.35 * (1.0 - task.energy_to_reward_ratio * 0.5)
    elif event_type == "skipped":
        base = task.activation_energy * 0.25
    elif event_type == "uncompleted":
        base = task.recovery_cost * 0.30
    else:
        base = 0.08
    return round(max(0.05, min(0.40, base)), 3)


def _scheduled_drain(task: CircuitTask) -> float:
    """Estimated drain for an upcoming scheduled task."""
    effort_mult = {"high": 1.3, "medium": 1.0, "low": 0.6}.get(task.effort or "medium", 1.0)
    base = (task.cognitive_load * 0.4 + task.activation_energy * 0.2) * effort_mult
    return round(max(0.05, min(0.40, base)), 3)


@router.get("/sync")
def energy_sync(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """
    Task-event energy drain split at the current moment — same response shape as
    Canopy /sync/energy and Chef /sync/energy so the frontend can aggregate all three.
    """
    now_ist = datetime.now(_IST)
    day_start_ist = now_ist.replace(hour=0, minute=0, second=0, microsecond=0)
    day_end_ist = day_start_ist + timedelta(days=1)
    day_start_utc = day_start_ist.astimezone(timezone.utc).replace(tzinfo=None)
    day_end_utc = day_end_ist.astimezone(timezone.utc).replace(tzinfo=None)
    now_utc = now_ist.astimezone(timezone.utc).replace(tzinfo=None)

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

    drain_so_far = min(1.0, sum(_task_drain(ev.event_type, task) for ev, task in past_rows))
    drain_ahead = min(1.0, sum(_scheduled_drain(t) for t in future_tasks))

    state = db.query(UserState).filter_by(user_id=user.id).first()

    return {
        "as_of": now_ist.isoformat(),
        "source": "circuit",
        "drain_so_far": round(drain_so_far, 3),
        "energy_so_far": round(1.0 - drain_so_far, 3),
        "drain_ahead": round(drain_ahead, 3),
        "energy_ahead": round(1.0 - drain_ahead, 3),
        "events_so_far": len(past_rows),
        "events_ahead": len(future_tasks),
        "manual_energy": round(state.energy_level, 3) if state else 0.7,
        "stress_level": round(state.stress_level, 3) if state else 0.3,
    }
