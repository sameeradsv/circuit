from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, TaskEvent, User

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
    Per-task-event energy for a given calendar day (default: today UTC).
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
        target = datetime.utcnow().date()

    day_start = datetime(target.year, target.month, target.day)
    day_end = day_start + timedelta(days=1)

    rows = (
        db.query(TaskEvent, CircuitTask)
        .join(CircuitTask, TaskEvent.task_id == CircuitTask.id)
        .filter(
            TaskEvent.user_id == user.id,
            TaskEvent.occurred_at >= day_start,
            TaskEvent.occurred_at < day_end,
        )
        .order_by(TaskEvent.occurred_at)
        .all()
    )

    events = []
    for ev, task in rows:
        energy = _event_energy(ev.event_type, task)
        label = "draining" if energy < 0.35 else "energising" if energy > 0.65 else "neutral"
        events.append({
            "occurred_at": ev.occurred_at.isoformat() + "Z",
            "time": ev.occurred_at.strftime("%H:%M"),
            "energy": energy,
            "label": label,
            "note": f"{task.text[:60]} ({ev.event_type})",
            "source": "circuit",
        })

    avg = round(sum(e["energy"] for e in events) / len(events), 3) if events else None
    return {
        "date": target.isoformat(),
        "source": "circuit",
        "events": events,
        "avg_energy": avg,
    }
