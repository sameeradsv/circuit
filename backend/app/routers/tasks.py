from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, RecurringTask, TaskEvent, User
from app.behavioral import record_completion_rate
from app.engines.recurrence import is_hourly_recurrence, next_occurrence
from app.services.blackout import adjust_for_blackouts
from app.services.adaptive_learning import apply_complete_learning, update_delay_pattern_on_skip
from app.services.ai import suggest_task_defaults
from app.services.suggest_slot import suggest_slot_for_task
from app.services.reschedule import resolve_schedule_conflicts
from app.services.reminders import cancel_pending_reminders_for_task, materialize_reminders_for_task, materialize_reminders_for_user
from app.services.virtual_recurrence import (
    expand_virtual_occurrences,
    is_virtual_id,
    materialize_occurrences_for_user,
    materialization_window_ms,
    materialized_occurrences,
    parse_virtual_id,
    sync_recurring_definition,
    upsert_occurrence_override,
    virtual_busy_tasks,
)
from app.task_event_time import task_event_occurred_at

_IST = ZoneInfo("Asia/Kolkata")
_WEEKDAY = {0: "MO", 1: "TU", 2: "WE", 3: "TH", 4: "FR", 5: "SA", 6: "SU"}

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _refresh_task_reminders(db: Session, task: CircuitTask) -> None:
    try:
        materialize_reminders_for_task(db, task)
    except Exception:
        # Reminder row maintenance must not block task CRUD.
        pass


def _refresh_user_reminders(db: Session, user_id: int) -> None:
    try:
        materialize_reminders_for_user(db, user_id)
    except Exception:
        pass


def _apply_day_time_override(dt: datetime, overrides_json: Optional[str]) -> datetime:
    """Apply a day-specific time from day_time_overrides JSON if one exists for dt's weekday.
    Only applies to morning tasks (original hour < 12); afternoon/evening tasks keep their time."""
    if not overrides_json:
        return dt
    if dt.hour >= 12:  # afternoon/evening tasks are never shifted
        return dt
    overrides = json.loads(overrides_json)
    wd = _WEEKDAY[dt.weekday()]
    time_str = overrides.get(wd)
    if time_str:
        h, m = map(int, time_str.split(":"))
        return dt.replace(hour=h, minute=m, second=0, microsecond=0)
    return dt


def _metadata_dict(task: CircuitTask) -> dict[str, Any]:
    try:
        return json.loads(task.metadata_json or "{}")
    except Exception:
        return {}


def _recurrence_time_ref_ms(task: CircuitTask) -> Optional[int]:
    meta = _metadata_dict(task)
    value = meta.get("recurrence_time_ref_ms")
    if isinstance(value, int):
        return value
    return task.recurrence_anchor_ms or task.scheduled_at


def _metadata_with_recurrence_time_ref(task: CircuitTask, time_ref_ms: Optional[int]) -> str:
    meta = _metadata_dict(task)
    if time_ref_ms is not None:
        meta["recurrence_time_ref_ms"] = time_ref_ms
    return json.dumps(meta)


def _is_weekend_override_slot(ms: Optional[int], overrides_json: Optional[str]) -> bool:
    if not ms or not overrides_json:
        return False
    try:
        overrides = json.loads(overrides_json)
    except Exception:
        return False
    dt = datetime.fromtimestamp(ms / 1000, tz=_IST)
    time_str = overrides.get(_WEEKDAY[dt.weekday()])
    if not time_str:
        return False
    try:
        h, m = map(int, time_str.split(":"))
    except Exception:
        return False
    return dt.hour == h and dt.minute == m


def _normalize_recurrence_time_ref(
    task: CircuitTask,
    previous_ref_ms: Optional[int] = None,
    *,
    scheduled_at_changed: bool = False,
) -> None:
    if not task.scheduled_at or not (task.recurrence or task.rrule):
        return

    meta = _metadata_dict(task)
    existing = meta.get("recurrence_time_ref_ms")
    if isinstance(existing, int) and not scheduled_at_changed:
        return

    if scheduled_at_changed and not _is_weekend_override_slot(task.scheduled_at, task.day_time_overrides):
        meta["recurrence_time_ref_ms"] = task.scheduled_at
    elif previous_ref_ms is not None:
        meta["recurrence_time_ref_ms"] = previous_ref_ms
    elif isinstance(existing, int):
        meta["recurrence_time_ref_ms"] = existing
    elif not _is_weekend_override_slot(task.scheduled_at, task.day_time_overrides):
        meta["recurrence_time_ref_ms"] = task.scheduled_at
    else:
        meta["recurrence_time_ref_ms"] = task.recurrence_anchor_ms or task.scheduled_at
    task.metadata_json = json.dumps(meta)


def _create_next_occurrence_for_completed_task(db: Session, user_id: int, task: CircuitTask) -> None:
    """Record the completed slot and materialize the next concrete recurrence row.

    This mirrors the single-task completion behavior for batch commands. It is
    intentionally fail-safe: recurrence maintenance must not block completion.
    """
    if not task.scheduled_at:
        return
    try:
        from app.models import Blackout
        user_blackouts = db.query(Blackout).filter(Blackout.user_id == user_id).all()
        occurrence_dt = datetime.fromtimestamp(task.scheduled_at / 1000, tz=_IST)
        time_ref_ms = _recurrence_time_ref_ms(task)
        time_ref_dt = datetime.fromtimestamp((time_ref_ms or task.scheduled_at) / 1000, tz=_IST)
        next_ms: Optional[int] = None

        recurring_def = sync_recurring_definition(db, task)
        if recurring_def:
            upsert_occurrence_override(
                db,
                user_id,
                recurring_def.id,
                task.scheduled_at,
                status="completed",
            )

        if task.rrule and task.is_recurring_template:
            from app.routers.calendar import _expand_rrule
            candidates = _expand_rrule(
                task.rrule_dtstart_ms or task.scheduled_at,
                task.rrule,
                set(),
                cutoff_ms=task.scheduled_at,
            )
            raw_next = next((ts for ts in candidates if ts > task.scheduled_at), None)
            if raw_next:
                raw_dt = datetime.fromtimestamp(raw_next / 1000, tz=_IST)
                raw_dt = raw_dt.replace(hour=time_ref_dt.hour, minute=time_ref_dt.minute, second=time_ref_dt.second)
                raw_dt = _apply_day_time_override(raw_dt, task.day_time_overrides)
                next_ms = int(raw_dt.timestamp() * 1000)
        elif task.recurrence:
            next_dt = next_occurrence(task.recurrence, occurrence_dt)
            if next_dt:
                hourly = is_hourly_recurrence(task.recurrence)
                if not hourly:
                    next_dt = next_dt.replace(hour=time_ref_dt.hour, minute=time_ref_dt.minute, second=time_ref_dt.second)
                    next_dt = _apply_day_time_override(next_dt, task.day_time_overrides)
                next_ms = int(next_dt.timestamp() * 1000)

        if next_ms and task.recurrence_ends_at and next_ms > task.recurrence_ends_at:
            next_ms = None

        next_anchor_ms: Optional[int] = None
        if next_ms:
            pre_adjust_ms = next_ms
            next_ms = adjust_for_blackouts(next_ms, task, user_blackouts, time_ref_dt)
            if task.post_blackout_behavior == "catch_up_immediate" and next_ms != pre_adjust_ms:
                next_anchor_ms = pre_adjust_ms
            if task.recurrence_ends_at and next_ms > task.recurrence_ends_at:
                next_ms = None
            if next_ms and task.day_time_overrides and not is_hourly_recurrence(task.recurrence):
                adj_dt = datetime.fromtimestamp(next_ms / 1000, tz=_IST)
                adj_dt = _apply_day_time_override(adj_dt, task.day_time_overrides)
                next_ms = int(adj_dt.timestamp() * 1000)
        if not next_ms:
            return

        next_task = CircuitTask(
            user_id=user_id,
            client_id=task.client_id if task.is_recurring_template else None,
            text=task.text,
            tag=task.tag,
            scheduled_at=next_ms,
            recurrence=task.recurrence,
            rrule=task.rrule,
            rrule_dtstart_ms=task.rrule_dtstart_ms,
            is_recurring_template=task.is_recurring_template,
            effort=task.effort,
            duration=task.duration,
            cognitive_load=task.cognitive_load,
            emotional_resistance=task.emotional_resistance,
            activation_energy=task.activation_energy,
            recovery_cost=task.recovery_cost,
            focus_type=task.focus_type,
            importance=task.importance,
            urgency=task.urgency,
            consequence_of_delay=task.consequence_of_delay,
            momentum_value=task.momentum_value,
            compound_benefit=task.compound_benefit,
            identity_alignment=task.identity_alignment,
            historical_completion_rate=task.historical_completion_rate,
            energy_to_reward_ratio=task.energy_to_reward_ratio,
            task_decomposition_potential=task.task_decomposition_potential,
            tiny_step=task.tiny_step,
            preferred_execution_window=task.preferred_execution_window,
            blackout_skip_flags=task.blackout_skip_flags,
            recurrence_ends_at=task.recurrence_ends_at,
            post_blackout_behavior=task.post_blackout_behavior,
            recurrence_anchor_ms=next_anchor_ms,
            metadata_json=_metadata_with_recurrence_time_ref(task, time_ref_ms),
            group_id=task.group_id,
            day_time_overrides=task.day_time_overrides,
            travel_buffer_before_mins=task.travel_buffer_before_mins,
            travel_buffer_after_mins=task.travel_buffer_after_mins,
            notifications_enabled=task.notifications_enabled,
            notification_offset_1_mins=task.notification_offset_1_mins,
            notification_offset_2_mins=task.notification_offset_2_mins,
            import_review_pending=False,
        )
        db.add(next_task)
        db.flush()
        resolve_schedule_conflicts(
            db,
            user_id,
            next_task,
            event_reason="recurrence_conflict_resolution",
        )
        materialize_occurrences_for_user(db, user_id)
    except Exception:
        pass


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
    recurrence_ends_at: Optional[int] = None
    post_blackout_behavior: str = "resume"
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
    blackout_skip_flags: list[str] = []
    rrule: Optional[str] = None
    rrule_dtstart_ms: Optional[int] = None
    is_recurring_template: bool = False
    group_id: Optional[str] = None
    day_time_overrides: Optional[dict] = None  # {"SA": "10:00", "SU": "10:00"}
    travel_buffer_before_mins: Optional[int] = None
    travel_buffer_after_mins: Optional[int] = None
    notifications_enabled: bool = True
    notification_offset_1_mins: Optional[int] = 10
    notification_offset_2_mins: Optional[int] = None


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
    cognitive_load: Optional[float] = None
    emotional_resistance: Optional[float] = None
    activation_energy: Optional[float] = None
    recovery_cost: Optional[float] = None
    focus_type: Optional[str] = None
    consequence_of_delay: Optional[float] = None
    momentum_value: Optional[float] = None
    compound_benefit: Optional[float] = None
    identity_alignment: Optional[float] = None
    energy_to_reward_ratio: Optional[float] = None
    task_decomposition_potential: Optional[float] = None
    historical_completion_rate: Optional[float] = None
    recurrence: Optional[str] = None
    recurrence_ends_at: Optional[int] = None
    post_blackout_behavior: Optional[str] = None
    location_dependency: Optional[str] = None
    required_resources: Optional[list[str]] = None
    dependencies: Optional[list[str]] = None
    metadata: Optional[dict[str, Any]] = None
    client_updated_at: Optional[int] = None
    blackout_skip_flags: Optional[list[str]] = None
    group_id: Optional[str] = None
    day_time_overrides: Optional[dict] = None  # {"SA": "10:00", "SU": "10:00"}
    travel_buffer_before_mins: Optional[int] = None
    travel_buffer_after_mins: Optional[int] = None
    notifications_enabled: Optional[bool] = None
    notification_offset_1_mins: Optional[int] = None
    notification_offset_2_mins: Optional[int] = None
    recurrence_anchor_ms: Optional[int] = None
    import_review_pending: Optional[bool] = None
    propagate_group: Optional[bool] = True
    auto_reschedule_conflicts: Optional[bool] = False
    completion_occurred_at: Optional[int] = None


_AI_DEFAULT_FIELDS = {
    "tag",
    "urgency",
    "importance",
    "cognitive_load",
    "effort",
    "duration",
    "deadline_type",
    "time_sensitivity",
    "scheduled_at",
    "recurrence",
    "recurrence_ends_at",
    "post_blackout_behavior",
    "emotional_resistance",
    "activation_energy",
    "recovery_cost",
    "focus_type",
    "consequence_of_delay",
    "momentum_value",
    "compound_benefit",
    "identity_alignment",
    "energy_to_reward_ratio",
    "task_decomposition_potential",
    "tiny_step",
    "preferred_execution_window",
    "location_dependency",
    "required_resources",
    "dependencies",
    "blackout_skip_flags",
    "travel_buffer_before_mins",
    "travel_buffer_after_mins",
    "notifications_enabled",
    "notification_offset_1_mins",
    "notification_offset_2_mins",
}


def _apply_ai_defaults(payload: TaskIn) -> TaskIn:
    if payload.rrule or payload.is_recurring_template:
        return payload
    provided = payload.model_fields_set
    missing = _AI_DEFAULT_FIELDS - provided
    if not missing:
        return payload
    suggested = suggest_task_defaults(payload.text, payload.metadata.get("context") if isinstance(payload.metadata, dict) else None)
    updates = {field: suggested[field] for field in missing if field in suggested}
    metadata = dict(payload.metadata or {})
    if suggested.get("reasoning") and "ai_default_reasoning" not in metadata:
        metadata["ai_default_reasoning"] = suggested["reasoning"]
        updates["metadata"] = metadata
    return payload.model_copy(update=updates)


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
        "blackout_skip_flags": json.loads(t.blackout_skip_flags) if t.blackout_skip_flags else [],
        "rrule": t.rrule,
        "rrule_dtstart_ms": t.rrule_dtstart_ms,
        "is_recurring_template": bool(t.is_recurring_template),
        "recurrence_ends_at": t.recurrence_ends_at,
        "post_blackout_behavior": t.post_blackout_behavior or "resume",
        "recurrence_anchor_ms": t.recurrence_anchor_ms,
        "group_id": t.group_id,
        "day_time_overrides": json.loads(t.day_time_overrides) if t.day_time_overrides else {},
        "travel_buffer_before_mins": t.travel_buffer_before_mins,
        "travel_buffer_after_mins": t.travel_buffer_after_mins,
        "notifications_enabled": bool(t.notifications_enabled),
        "notification_offset_1_mins": t.notification_offset_1_mins,
        "notification_offset_2_mins": t.notification_offset_2_mins,
        "import_review_pending": bool(t.import_review_pending),
        "is_virtual_occurrence": False,
        "recurring_task_id": None,
        "occurrence_start_ms": None,
        "source_task_id": None,
    }


@router.get("")
def list_tasks(
    completed: Optional[bool] = Query(None, description="Filter by completion status"),
    scheduled_from_ms: Optional[int] = Query(None, description="Inclusive scheduled_at lower bound (ms epoch)"),
    scheduled_to_ms: Optional[int] = Query(None, description="Inclusive scheduled_at upper bound (ms epoch)"),
    include_unscheduled: bool = Query(
        False,
        description="With a scheduled range, also return open tasks with no scheduled_at",
    ),
    page: Optional[int] = Query(None, ge=1, description="Page number (1-based); returns paginated payload"),
    limit: Optional[int] = Query(None, ge=1, le=100, description="Page size when paginating"),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    q = db.query(CircuitTask).filter(CircuitTask.user_id == user.id)
    if completed is not None:
        q = q.filter(CircuitTask.completed == completed)

    if scheduled_from_ms is not None or scheduled_to_ms is not None:
        from_ms = scheduled_from_ms if scheduled_from_ms is not None else 0
        to_ms = scheduled_to_ms if scheduled_to_ms is not None else 2**62
        in_range = and_(
            CircuitTask.scheduled_at.isnot(None),
            CircuitTask.scheduled_at >= from_ms,
            CircuitTask.scheduled_at <= to_ms,
        )
        # Tasks that started before the window but extend into it (e.g. overnight sleep)
        overnight_overlap = and_(
            CircuitTask.scheduled_at.isnot(None),
            CircuitTask.duration.isnot(None),
            CircuitTask.scheduled_at < from_ms,
            CircuitTask.scheduled_at + (CircuitTask.duration * 60_000) > from_ms,
        )
        scheduled_in_window = or_(in_range, overnight_overlap)
        if include_unscheduled:
            q = q.filter(
                or_(
                    scheduled_in_window,
                    and_(CircuitTask.scheduled_at.is_(None), CircuitTask.completed.is_(False)),
                )
            )
        else:
            q = q.filter(scheduled_in_window)
        # Recurring rows act as definitions for ranged views; virtual occurrences
        # below provide the concrete blocks so future slots are visible without
        # materializing every instance.
        q = q.filter(CircuitTask.recurrence.is_(None), CircuitTask.rrule.is_(None))

    if page is not None or limit is not None:
        page_n = max(1, page or 1)
        limit_n = max(1, min(100, limit or 20))
        offset = (page_n - 1) * limit_n
        total = q.count()
        if completed is True:
            rows = (
                q.order_by(CircuitTask.updated_at.desc(), CircuitTask.id.desc())
                .offset(offset)
                .limit(limit_n)
                .all()
            )
        else:
            rows = (
                q.order_by(
                    CircuitTask.scheduled_at.asc().nulls_last(),
                    CircuitTask.id.desc(),
                )
                .offset(offset)
                .limit(limit_n)
                .all()
            )
        pages = max(1, (total + limit_n - 1) // limit_n) if total else 0
        return {
            "items": [_task_to_dict(t) for t in rows],
            "total": total,
            "page": page_n,
            "limit": limit_n,
            "pages": pages,
        }

    tasks = q.order_by(
        CircuitTask.completed.asc(),
        CircuitTask.scheduled_at.asc().nulls_last(),
        CircuitTask.id.desc(),
    ).all()
    items = [_task_to_dict(t) for t in tasks]
    if scheduled_from_ms is not None or scheduled_to_ms is not None:
        from_ms = scheduled_from_ms if scheduled_from_ms is not None else 0
        to_ms = scheduled_to_ms if scheduled_to_ms is not None else 2**62
        materialized_from, materialized_to = materialization_window_ms()
        if to_ms >= materialized_from and from_ms <= materialized_to:
            segment_from = max(from_ms, materialized_from)
            segment_to = min(to_ms, materialized_to)
            materialized_items = materialized_occurrences(
                db,
                user.id,
                segment_from,
                segment_to,
                completed=completed,
            )
            if materialized_items:
                items.extend(materialized_items)
            else:
                items.extend(expand_virtual_occurrences(db, user.id, segment_from, segment_to, completed=completed))
        if from_ms < materialized_from:
            items.extend(
                expand_virtual_occurrences(
                    db,
                    user.id,
                    from_ms,
                    min(to_ms, materialized_from - 1),
                    completed=completed,
                )
            )
        if to_ms > materialized_to:
            items.extend(
                expand_virtual_occurrences(
                    db,
                    user.id,
                    max(from_ms, materialized_to + 1),
                    to_ms,
                    completed=completed,
                )
            )
        items.sort(key=lambda t: (t.get("completed", False), t.get("scheduled_at") is None, t.get("scheduled_at") or 0, str(t.get("id"))))
    return items


@router.post("", status_code=201)
def create_task(payload: TaskIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
    payload = _apply_ai_defaults(payload)
    _exclude = {"metadata", "required_resources", "dependencies", "blackout_skip_flags", "day_time_overrides"}
    task = CircuitTask(
        user_id=user.id,
        **{k: v for k, v in payload.model_dump(exclude=_exclude).items()},
        required_resources=json.dumps(payload.required_resources),
        dependencies=json.dumps(payload.dependencies),
        metadata_json=json.dumps(payload.metadata),
        blackout_skip_flags=json.dumps(payload.blackout_skip_flags) if payload.blackout_skip_flags else None,
        day_time_overrides=json.dumps(payload.day_time_overrides) if payload.day_time_overrides else None,
        # travel buffers come through via the ** spread (int fields, not JSON)
    )
    db.add(task)
    db.flush()
    _normalize_recurrence_time_ref(task)
    recurring_row = sync_recurring_definition(db, task)
    if recurring_row or task.recurrence or task.rrule:
        materialize_occurrences_for_user(db, user.id)
    _refresh_task_reminders(db, task)
    db.commit()
    db.refresh(task)
    return _task_to_dict(task)


@router.patch("/{task_id}")
def update_task(task_id: str, payload: TaskPatch, user: User = Depends(require_user), db: Session = Depends(get_db)):
    if is_virtual_id(task_id):
        recurring_id, occurrence_start = parse_virtual_id(task_id)
        recurring = db.get(RecurringTask, recurring_id)
        if not recurring or recurring.user_id != user.id or not recurring.active:
            raise HTTPException(status_code=404, detail="Task not found")
        status = "rescheduled" if payload.scheduled_at is not None else "completed" if payload.completed else "skipped"
        modified_duration = payload.duration if payload.duration is not None else None
        upsert_occurrence_override(
            db,
            user.id,
            recurring_id,
            occurrence_start,
            status=status,
            modified_start_ms=payload.scheduled_at if status == "rescheduled" else None,
            modified_duration=modified_duration if status == "rescheduled" else None,
        )
        source_task_id = json.loads(recurring.metadata_json or "{}").get("source_task_id")
        if status == "completed" and source_task_id:
            source = db.get(CircuitTask, int(source_task_id))
            if source and source.user_id == user.id:
                source.historical_completion_rate = record_completion_rate(source.historical_completion_rate)
                completed_at = payload.completion_occurred_at or occurrence_start
                delay_mins = round((completed_at - occurrence_start) / 60_000)
                db.add(TaskEvent(
                    user_id=user.id,
                    task_id=source.id,
                    event_type="completed",
                    occurred_at=datetime.fromtimestamp(completed_at / 1000, tz=timezone.utc).replace(tzinfo=None),
                    metadata_json=json.dumps({
                        "virtual_occurrence_id": task_id,
                        "scheduled_at_ms": occurrence_start,
                        "actual_completed_at_ms": completed_at,
                        "delay_minutes": delay_mins,
                    }),
                ))
        if status == "rescheduled":
            materialize_occurrences_for_user(db, user.id)
        db.commit()
        from_ms = min(occurrence_start, payload.scheduled_at or occurrence_start) - 60_000
        to_ms = max(occurrence_start, payload.scheduled_at or occurrence_start) + (payload.duration or recurring.duration or 30) * 60_000
        matches = expand_virtual_occurrences(db, user.id, from_ms, to_ms)
        updated = next((item for item in matches if item.get("id") == task_id), None)
        if updated:
            _refresh_user_reminders(db, user.id)
            db.commit()
            return updated
        _refresh_user_reminders(db, user.id)
        db.commit()
        return {"id": task_id, "completed": status == "completed", "is_virtual_occurrence": True}

    task_int_id = int(task_id)
    task = db.get(CircuitTask, task_int_id)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task not found")

    was_completed = task.completed
    old_scheduled_at = task.scheduled_at
    old_skipped = task.skipped_count or 0
    old_recurrence_time_ref_ms = _recurrence_time_ref_ms(task)
    _JSON_FIELDS = {"required_resources", "dependencies"}

    for field, value in payload.model_dump(
        exclude_unset=True,
        exclude={"propagate_group", "auto_reschedule_conflicts", "completion_occurred_at"},
    ).items():
        if field == "metadata":
            task.metadata_json = json.dumps(value)
        elif field in _JSON_FIELDS:
            setattr(task, field, json.dumps(value))
        elif field == "blackout_skip_flags":
            task.blackout_skip_flags = json.dumps(value) if value is not None else None
        elif field == "day_time_overrides":
            task.day_time_overrides = json.dumps(value) if value else None
        else:
            setattr(task, field, value)

    task.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    _normalize_recurrence_time_ref(
        task,
        old_recurrence_time_ref_ms,
        scheduled_at_changed=payload.scheduled_at is not None and task.scheduled_at != old_scheduled_at,
    )

    if payload.skipped_count is not None and payload.skipped_count > old_skipped:
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        task.last_skipped_at = now_ms
        task.delay_pattern = update_delay_pattern_on_skip(task, now_ms)

    # Group propagation: shift all linked tasks by the same delta when scheduled_at changes
    if (
        payload.scheduled_at is not None
        and payload.propagate_group is not False
        and task.group_id
        and old_scheduled_at is not None
        and task.scheduled_at != old_scheduled_at
    ):
        delta_ms = task.scheduled_at - old_scheduled_at
        group_members = (
            db.query(CircuitTask)
            .filter(
                CircuitTask.group_id == task.group_id,
                CircuitTask.id != task_int_id,
                CircuitTask.user_id == user.id,
                CircuitTask.completed == False,  # noqa: E712
            )
            .all()
        )
        now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
        for member in group_members:
            if member.scheduled_at is not None:
                member.scheduled_at += delta_ms
                member.updated_at = now_utc

    if (
        payload.auto_reschedule_conflicts
        and payload.scheduled_at is not None
        and task.scheduled_at is not None
        and task.scheduled_at != old_scheduled_at
        and not task.completed
    ):
        resolve_schedule_conflicts(
            db,
            user.id,
            task,
            now_utc=datetime.now(timezone.utc).replace(tzinfo=None),
        )

    # Auto-log completion/uncompletion event
    if payload.completed is not None and payload.completed != was_completed:
        if payload.completed:
            task.historical_completion_rate = record_completion_rate(task.historical_completion_rate)
            apply_complete_learning(task)
        event_type = "completed" if payload.completed else "uncompleted"
        metadata: dict[str, Any] = {}
        if payload.completed and payload.completion_occurred_at is not None:
            metadata["actual_completed_at_ms"] = payload.completion_occurred_at
            if task.scheduled_at is not None:
                metadata["scheduled_at_ms"] = task.scheduled_at
                metadata["delay_minutes"] = round((payload.completion_occurred_at - task.scheduled_at) / 60_000)
        db.add(TaskEvent(
            user_id=user.id,
            task_id=task_int_id,
            event_type=event_type,
            occurred_at=task_event_occurred_at(
                task,
                explicit_ms=payload.completion_occurred_at if payload.completed else None,
            ),
            metadata_json=json.dumps(metadata),
        ))

        # If task is being completed, create next occurrence if recurring
        if payload.completed and task.scheduled_at:
            _create_next_occurrence_for_completed_task(db, user.id, task)

    sync_recurring_definition(db, task)
    if task.completed:
        cancel_pending_reminders_for_task(db, task.id, user.id)
    else:
        _refresh_task_reminders(db, task)
    db.commit()
    db.refresh(task)
    return _task_to_dict(task)


class BatchUpdatePayload(BaseModel):
    ids: list[int]
    patch: TaskPatch


@router.post("/batch-update")
def batch_update_tasks(
    payload: BatchUpdatePayload,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Apply the same patch to multiple tasks at once. Only updates tasks owned by the user."""
    tasks = (
        db.query(CircuitTask)
        .filter(CircuitTask.id.in_(payload.ids), CircuitTask.user_id == user.id)
        .all()
    )
    _JSON_FIELDS = {"required_resources", "dependencies"}
    patch_data = payload.patch.model_dump(
        exclude_unset=True,
        exclude={"propagate_group", "auto_reschedule_conflicts", "completion_occurred_at"},
    )
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    for task in tasks:
        was_completed = task.completed
        old_scheduled_at = task.scheduled_at
        old_skipped = task.skipped_count or 0
        old_recurrence_time_ref_ms = _recurrence_time_ref_ms(task)
        for field, value in patch_data.items():
            if field == "metadata":
                task.metadata_json = json.dumps(value)
            elif field in _JSON_FIELDS:
                setattr(task, field, json.dumps(value))
            elif field == "blackout_skip_flags":
                task.blackout_skip_flags = json.dumps(value) if value is not None else None
            elif field == "day_time_overrides":
                task.day_time_overrides = json.dumps(value) if value else None
            else:
                setattr(task, field, value)

        _normalize_recurrence_time_ref(
            task,
            old_recurrence_time_ref_ms,
            scheduled_at_changed=payload.patch.scheduled_at is not None and task.scheduled_at != old_scheduled_at,
        )

        if payload.patch.skipped_count is not None and payload.patch.skipped_count > old_skipped:
            skip_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            task.last_skipped_at = skip_ms
            task.delay_pattern = update_delay_pattern_on_skip(task, skip_ms)
            db.add(TaskEvent(
                user_id=user.id,
                task_id=task.id,
                event_type="skipped",
                occurred_at=now_utc,
                metadata_json=json.dumps({
                    "reason": "batch",
                    "from_ms": old_scheduled_at,
                    "to_ms": task.scheduled_at,
                }),
            ))

        if task.scheduled_at != old_scheduled_at and payload.patch.skipped_count is None:
            db.add(TaskEvent(
                user_id=user.id,
                task_id=task.id,
                event_type="rescheduled",
                occurred_at=now_utc,
                metadata_json=json.dumps({
                    "reason": "batch",
                    "from_ms": old_scheduled_at,
                    "to_ms": task.scheduled_at,
                }),
            ))
            if payload.patch.auto_reschedule_conflicts and task.scheduled_at is not None and not task.completed:
                resolve_schedule_conflicts(db, user.id, task, now_utc=now_utc)

        if task.completed != was_completed:
            event_type = "completed" if task.completed else "uncompleted"
            db.add(TaskEvent(
                user_id=user.id,
                task_id=task.id,
                event_type=event_type,
                occurred_at=task_event_occurred_at(
                    task,
                    explicit_ms=payload.patch.completion_occurred_at if task.completed else None,
                ),
                metadata_json=json.dumps({"reason": "batch"}),
            ))

        if patch_data.get("completed") is True and not was_completed:
            task.historical_completion_rate = record_completion_rate(task.historical_completion_rate)
            apply_complete_learning(task)
            _create_next_occurrence_for_completed_task(db, user.id, task)
        task.updated_at = now_utc
        sync_recurring_definition(db, task)
        if task.completed:
            cancel_pending_reminders_for_task(db, task.id, user.id)
        else:
            _refresh_task_reminders(db, task)
    db.commit()
    return {"updated": len(tasks), "ids": [t.id for t in tasks]}


@router.delete("/cleanup", status_code=200)
def cleanup_tasks(
    after_ms: Optional[int] = None,
    before_ms: Optional[int] = None,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Delete scheduled tasks outside a date range in batches.
    Pass after_ms to remove far-future events, before_ms to remove old past events.
    Only tasks with a scheduled_at are affected — floating tasks are untouched."""
    if after_ms is None and before_ms is None:
        raise HTTPException(400, "Provide after_ms or before_ms")

    batch_size = 1000
    total_deleted = 0

    while True:
        q = db.query(CircuitTask.id).filter(
            CircuitTask.user_id == user.id,
            CircuitTask.scheduled_at.isnot(None),
        )
        if after_ms is not None:
            q = q.filter(CircuitTask.scheduled_at > after_ms)
        if before_ms is not None:
            q = q.filter(CircuitTask.scheduled_at < before_ms)

        # Get IDs in a batch
        ids = [row[0] for row in q.limit(batch_size).all()]
        if not ids:
            break

        # Delete the batch
        db.query(CircuitTask).filter(CircuitTask.id.in_(ids)).delete(synchronize_session=False)
        db.commit()
        total_deleted += len(ids)

    return {"deleted": total_deleted}


@router.get("/{task_id}/suggest-slot")
def suggest_slot(
    task_id: int,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    task = db.get(CircuitTask, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(404, "Task not found")
    from app.models import UserState
    state = db.query(UserState).filter(UserState.user_id == user.id).first()
    energy = state.energy_level if state else 0.6
    stress = state.stress_level if state else 0.3
    others = (
        db.query(CircuitTask)
        .filter(CircuitTask.user_id == user.id, CircuitTask.completed == False)  # noqa: E712
        .all()
    )
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    others.extend(virtual_busy_tasks(db, user.id, now_ms, now_ms + 90 * 86_400_000))
    return suggest_slot_for_task(task, others, energy_level=energy, stress_level=stress)


@router.delete("/{task_id}", status_code=204)
def delete_task(task_id: int, user: User = Depends(require_user), db: Session = Depends(get_db)):
    task = db.get(CircuitTask, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task not found")
    cancel_pending_reminders_for_task(db, task.id, user.id)
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
            **{k: v for k, v in item.model_dump(exclude={"metadata", "required_resources", "dependencies", "blackout_skip_flags", "day_time_overrides"}).items()},
            required_resources=json.dumps(item.required_resources),
            dependencies=json.dumps(item.dependencies),
            metadata_json=json.dumps(item.metadata),
            blackout_skip_flags=json.dumps(item.blackout_skip_flags) if item.blackout_skip_flags else None,
            day_time_overrides=json.dumps(item.day_time_overrides) if item.day_time_overrides else None,
            # travel buffer ints pass through via ** spread
        )
        db.add(task)
        db.flush()
        _normalize_recurrence_time_ref(task)
        sync_recurring_definition(db, task)
        if task.recurrence or task.rrule:
            materialize_occurrences_for_user(db, user.id)
        _refresh_task_reminders(db, task)
        created += 1
    db.commit()
    return {"created": created, "skipped": skipped}
