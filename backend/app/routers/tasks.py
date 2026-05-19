from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
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
