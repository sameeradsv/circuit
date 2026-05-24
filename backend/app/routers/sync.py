from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, User, UserSettings, UserState
from app.schemas import ExportRequest, ImportRequest
from app.services.export_crypto import decrypt_export, encrypt_export

router = APIRouter(prefix="/api/sync", tags=["sync"])


def _collect_export(db: Session, user_id: int) -> dict:
    tasks = db.query(CircuitTask).filter(CircuitTask.user_id == user_id).all()
    settings = db.query(UserSettings).filter(UserSettings.user_id == user_id).all()
    state = db.query(UserState).filter(UserState.user_id == user_id).first()

    return {
        "tasks": [
            {
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
            }
            for t in tasks
        ],
        "settings": {r.key: json.loads(r.value) for r in settings},
        "user_state": {
            "energy_level": state.energy_level if state else 0.7,
            "stress_level": state.stress_level if state else 0.3,
            "time_available_minutes": state.time_available_minutes if state else 480,
            "focus_mode": state.focus_mode if state else "normal",
        } if state else None,
    }


@router.post("/export")
def export_data(
    payload: ExportRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    data = _collect_export(db, user.id)
    return encrypt_export(data, payload.passphrase)


@router.post("/import")
def import_data(
    payload: ImportRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    try:
        inner = decrypt_export(payload.blob, payload.passphrase)
    except Exception as exc:
        raise HTTPException(400, "Could not decrypt export — check passphrase and blob") from exc

    created = 0
    skipped = 0

    for task_data in inner.get("tasks", []):
        client_id = task_data.get("client_id")
        if client_id:
            existing = db.query(CircuitTask).filter(
                CircuitTask.user_id == user.id,
                CircuitTask.client_id == client_id,
            ).first()
            if existing:
                skipped += 1
                continue

        task = CircuitTask(
            user_id=user.id,
            client_id=client_id,
            text=task_data.get("text", ""),
            tag=task_data.get("tag", "general"),
            completed=task_data.get("completed", False),
            tiny_step=task_data.get("tiny_step", ""),
            effort=task_data.get("effort", "medium"),
            duration=task_data.get("duration", 30),
            deadline_type=task_data.get("deadline_type", "none"),
            time_sensitivity=task_data.get("time_sensitivity", 0.5),
            scheduled_at=task_data.get("scheduled_at"),
            recurrence=task_data.get("recurrence"),
            cognitive_load=task_data.get("cognitive_load", 0.5),
            emotional_resistance=task_data.get("emotional_resistance", 0.5),
            activation_energy=task_data.get("activation_energy", 0.5),
            recovery_cost=task_data.get("recovery_cost", 0.3),
            focus_type=task_data.get("focus_type", "shallow"),
            importance=task_data.get("importance", 0.5),
            urgency=task_data.get("urgency", 0.5),
            consequence_of_delay=task_data.get("consequence_of_delay", 0.3),
            momentum_value=task_data.get("momentum_value", 0.5),
            compound_benefit=task_data.get("compound_benefit", 0.3),
            identity_alignment=task_data.get("identity_alignment", 0.3),
            historical_completion_rate=task_data.get("historical_completion_rate", 0.7),
            skipped_count=task_data.get("skipped_count", 0),
            last_skipped_at=task_data.get("last_skipped_at"),
            energy_to_reward_ratio=task_data.get("energy_to_reward_ratio", 0.5),
            task_decomposition_potential=task_data.get("task_decomposition_potential", 0.3),
            required_resources=json.dumps(task_data.get("required_resources", [])),
            dependencies=json.dumps(task_data.get("dependencies", [])),
            metadata_json=json.dumps(task_data.get("metadata", {})),
            preferred_execution_window=task_data.get("preferred_execution_window"),
            delay_pattern=task_data.get("delay_pattern"),
            location_dependency=task_data.get("location_dependency"),
            client_created_at=task_data.get("client_created_at"),
            client_updated_at=task_data.get("client_updated_at"),
        )
        db.add(task)
        created += 1

    # Upsert settings
    for key, value in inner.get("settings", {}).items():
        row = db.query(UserSettings).filter(
            UserSettings.user_id == user.id,
            UserSettings.key == key,
        ).first()
        if row:
            row.value = json.dumps(value)
        else:
            db.add(UserSettings(user_id=user.id, key=key, value=json.dumps(value)))

    # Upsert user state
    state_data = inner.get("user_state")
    if state_data:
        from app.models import UserState
        row = db.query(UserState).filter(UserState.user_id == user.id).first()
        if not row:
            row = UserState(user_id=user.id)
            db.add(row)
        row.energy_level = state_data.get("energy_level", 0.7)
        row.stress_level = state_data.get("stress_level", 0.3)
        row.time_available_minutes = state_data.get("time_available_minutes", 480)
        row.focus_mode = state_data.get("focus_mode", "normal")

    db.commit()
    return {
        "status": "merged",
        "exported_at": inner.get("exported_at"),
        "tasks_created": created,
        "tasks_skipped": skipped,
    }
