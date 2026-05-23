from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, User

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


class TaskIn(BaseModel):
    client_id: Optional[str] = None
    text: str
    tag: str = "general"
    completed: bool = False
    tiny_step: str = ""
    effort: str = "medium"
    duration: int = 30
    deadline_type: str = "none"
    time_sensitivity: float = 0.5
    scheduled_at: Optional[int] = None
    recurrence: Optional[str] = None
    cognitive_load: float = 0.5
    emotional_resistance: float = 0.5
    activation_energy: float = 0.5
    recovery_cost: float = 0.3
    focus_type: str = "shallow"
    importance: float = 0.5
    urgency: float = 0.5
    consequence_of_delay: float = 0.3
    momentum_value: float = 0.5
    compound_benefit: float = 0.3
    identity_alignment: float = 0.3
    historical_completion_rate: float = 0.7
    skipped_count: int = 0
    last_skipped_at: Optional[int] = None
    energy_to_reward_ratio: float = 0.5
    task_decomposition_potential: float = 0.3
    required_resources: list[str] = []
    dependencies: list[str] = []
    metadata: dict[str, Any] = {}
    preferred_execution_window: Optional[str] = None
    delay_pattern: Optional[str] = None
    location_dependency: Optional[str] = None
    client_created_at: Optional[int] = None
    client_updated_at: Optional[int] = None


class TaskPatch(BaseModel):
    text: Optional[str] = None
    completed: Optional[bool] = None
    tag: Optional[str] = None
    tiny_step: Optional[str] = None
    effort: Optional[str] = None
    duration: Optional[int] = None
    deadline_type: Optional[str] = None
    time_sensitivity: Optional[float] = None
    scheduled_at: Optional[int] = None
    urgency: Optional[float] = None
    importance: Optional[float] = None
    skipped_count: Optional[int] = None
    last_skipped_at: Optional[int] = None
    preferred_execution_window: Optional[str] = None
    delay_pattern: Optional[str] = None
    client_updated_at: Optional[int] = None


def _task_to_dict(t: CircuitTask) -> dict:
    return {
        "id": t.id,
        "client_id": t.client_id,
        "text": t.text,
        "tag": t.tag,
        "completed": t.completed,
        "tiny_step": t.tiny_step,
        "effort": t.effort,
        "duration": t.duration,
        "deadline_type": t.deadline_type,
        "time_sensitivity": t.time_sensitivity,
        "scheduled_at": t.scheduled_at,
        "recurrence": t.recurrence,
        "cognitive_load": t.cognitive_load,
        "emotional_resistance": t.emotional_resistance,
        "activation_energy": t.activation_energy,
        "recovery_cost": t.recovery_cost,
        "focus_type": t.focus_type,
        "importance": t.importance,
        "urgency": t.urgency,
        "consequence_of_delay": t.consequence_of_delay,
        "momentum_value": t.momentum_value,
        "compound_benefit": t.compound_benefit,
        "identity_alignment": t.identity_alignment,
        "historical_completion_rate": t.historical_completion_rate,
        "skipped_count": t.skipped_count,
        "last_skipped_at": t.last_skipped_at,
        "energy_to_reward_ratio": t.energy_to_reward_ratio,
        "task_decomposition_potential": t.task_decomposition_potential,
        "required_resources": json.loads(t.required_resources),
        "dependencies": json.loads(t.dependencies),
        "metadata": json.loads(t.metadata_json),
        "preferred_execution_window": t.preferred_execution_window,
        "delay_pattern": t.delay_pattern,
        "location_dependency": t.location_dependency,
        "client_created_at": t.client_created_at,
        "client_updated_at": t.client_updated_at,
        "created_at": t.created_at.isoformat(),
        "updated_at": t.updated_at.isoformat(),
    }


@router.get("")
def list_tasks(user: User = Depends(require_user), db: Session = Depends(get_db)):
    tasks = db.query(CircuitTask).filter(CircuitTask.user_id == user.id).all()
    return [_task_to_dict(t) for t in tasks]


@router.post("", status_code=201)
def create_task(payload: TaskIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    task = CircuitTask(
        user_id=user.id,
        **{k: json.dumps(v) if k in ("required_resources", "dependencies") else
           json.dumps(v) if k == "metadata" else v
           for k, v in payload.model_dump(exclude={"metadata", "required_resources", "dependencies"}).items()},
        required_resources=json.dumps(payload.required_resources),
        dependencies=json.dumps(payload.dependencies),
        metadata_json=json.dumps(payload.metadata),
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return _task_to_dict(task)


@router.patch("/{task_id}")
def update_task(task_id: int, payload: TaskPatch, user: User = Depends(require_user), db: Session = Depends(get_db)):
    task = db.get(CircuitTask, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task not found")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(task, field, value)
    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    return _task_to_dict(task)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    task = db.get(CircuitTask, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()


@router.post("/migrate", status_code=201)
def migrate_from_localstorage(
    payload: list[TaskIn],
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Accept a dump of localStorage tasks and upsert by client_id."""
    created = 0
    skipped = 0
    for item in payload:
        if item.client_id:
            existing = db.query(CircuitTask).filter(
                CircuitTask.user_id == user.id,
                CircuitTask.client_id == item.client_id,
            ).first()
            if existing:
                skipped += 1
                continue
        task = CircuitTask(
            user_id=user.id,
            **{k: v for k, v in item.model_dump(exclude={"metadata", "required_resources", "dependencies"}).items()},
            required_resources=json.dumps(item.required_resources),
            dependencies=json.dumps(item.dependencies),
            metadata_json=json.dumps(item.metadata),
        )
        db.add(task)
        created += 1
    db.commit()
    return {"created": created, "skipped": skipped}


# ── Energy sync ───────────────────────────────────────────────────────────────

_EFFORT_WEIGHT = {"low": 0.6, "medium": 1.0, "high": 1.4}


def _task_drain(task: CircuitTask) -> float:
    """Per-task drain on a 0–1 scale. A full hard day of tasks sums to ~1.0."""
    cognitive = (
        task.cognitive_load * 0.35
        + task.emotional_resistance * 0.30
        + task.activation_energy * 0.20
        + task.recovery_cost * 0.15
    )
    effort_mult = _EFFORT_WEIGHT.get(task.effort, 1.0)
    duration_mult = min(task.duration / 60.0, 2.0) / 2.0  # 60 min = 0.5, cap at 2 h
    return cognitive * effort_mult * duration_mult * 0.4


def _ms_to_dt(ts: Optional[int]) -> Optional[datetime]:
    """Convert epoch ms (JS) or epoch s to datetime."""
    if ts is None:
        return None
    return datetime.utcfromtimestamp(ts / 1000 if ts > 1e10 else ts)


@router.get("/sync/energy")
def energy_summary(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """
    Returns the user's task-based energy drain split at the current moment.
    - drain_so_far: load already absorbed today (completed + overdue tasks)
    - drain_ahead:  load still coming today (scheduled future + unscheduled backlog fraction)
    All values are 0–1 floats; 1.0 = completely drained by tasks alone.
    """
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    now_ms = int(now.timestamp() * 1000)
    today_start_ms = int(today_start.timestamp() * 1000)
    today_end_ms = int(today_end.timestamp() * 1000)

    all_tasks = (
        db.query(CircuitTask)
        .filter(CircuitTask.user_id == user.id)
        .all()
    )

    past_drain = 0.0
    future_drain = 0.0
    past_count = 0
    future_count = 0

    for t in all_tasks:
        sched = _ms_to_dt(t.scheduled_at)
        drain = _task_drain(t)

        if t.completed:
            # Count completed tasks updated today as sunk cost
            if t.updated_at >= today_start:
                past_drain += drain
                past_count += 1
        elif sched is not None and today_start <= sched < today_end:
            # Scheduled today: split by now
            if sched <= now:
                past_drain += drain   # overdue — already weighing on you
                past_count += 1
            else:
                future_drain += drain
                future_count += 1
        elif sched is None and not t.completed:
            # Unscheduled backlog: counts as mild future pressure (20% weight)
            future_drain += drain * 0.2

    return {
        "as_of": now.isoformat() + "Z",
        "source": "circuit",
        "drain_so_far": round(min(past_drain, 1.0), 3),
        "drain_ahead": round(min(future_drain, 1.0), 3),
        "tasks_done_today": past_count,
        "tasks_ahead_today": future_count,
    }
