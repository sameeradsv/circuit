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
from app.models import CircuitTask, TaskEvent, User
from app.behavioral import record_completion_rate
from app.engines.recurrence import is_hourly_recurrence, next_occurrence, skip_occurrences_too_close_after_catchup
from app.services.blackout import adjust_for_blackouts
from app.services.adaptive_learning import apply_complete_learning, update_delay_pattern_on_skip
from app.services.suggest_slot import suggest_slot_for_task
from app.task_event_time import task_event_occurred_at

_IST = ZoneInfo("Asia/Kolkata")
_WEEKDAY = {0: "MO", 1: "TU", 2: "WE", 3: "TH", 4: "FR", 5: "SA", 6: "SU"}

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


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
    return [_task_to_dict(t) for t in tasks]


@router.post("", status_code=201)
def create_task(payload: TaskIn, user: User = Depends(require_user), db: Session = Depends(get_db)):
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
    db.commit()
    db.refresh(task)
    return _task_to_dict(task)


@router.patch("/{task_id}")
def update_task(task_id: int, payload: TaskPatch, user: User = Depends(require_user), db: Session = Depends(get_db)):
    task = db.get(CircuitTask, task_id)
    if not task or task.user_id != user.id:
        raise HTTPException(status_code=404, detail="Task not found")

    was_completed = task.completed
    old_scheduled_at = task.scheduled_at
    old_skipped = task.skipped_count or 0
    _JSON_FIELDS = {"required_resources", "dependencies"}

    for field, value in payload.model_dump(exclude_unset=True).items():
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

    if payload.skipped_count is not None and payload.skipped_count > old_skipped:
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        task.last_skipped_at = now_ms
        task.delay_pattern = update_delay_pattern_on_skip(task, now_ms)

    # Group propagation: shift all linked tasks by the same delta when scheduled_at changes
    if (
        payload.scheduled_at is not None
        and task.group_id
        and old_scheduled_at is not None
        and task.scheduled_at != old_scheduled_at
    ):
        delta_ms = task.scheduled_at - old_scheduled_at
        group_members = (
            db.query(CircuitTask)
            .filter(
                CircuitTask.group_id == task.group_id,
                CircuitTask.id != task_id,
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

    # Auto-log completion/uncompletion event
    if payload.completed is not None and payload.completed != was_completed:
        if payload.completed:
            task.historical_completion_rate = record_completion_rate(task.historical_completion_rate)
            apply_complete_learning(task)
        event_type = "completed" if payload.completed else "uncompleted"
        db.add(TaskEvent(
            user_id=user.id,
            task_id=task_id,
            event_type=event_type,
            occurred_at=task_event_occurred_at(task),
            metadata_json="{}",
        ))

        # If task is being completed, create next occurrence if recurring
        if payload.completed and task.scheduled_at:
            try:
                from app.models import Blackout
                user_blackouts = db.query(Blackout).filter(Blackout.user_id == user.id).all()
                # catch_up_once / catch_up_immediate: use stored anchor (original pre-blackout
                # scheduled_at) so subsequent occurrences compute from the original series.
                anchor_ms = task.recurrence_anchor_ms or task.scheduled_at
                from_dt = datetime.fromtimestamp(anchor_ms / 1000, tz=_IST)
                next_ms: Optional[int] = None

                if task.rrule and task.is_recurring_template:
                    # RRULE-based calendar template: use RRULE parser for next occurrence.
                    # cutoff_ms=task.scheduled_at (not +1): the expander includes the current
                    # occurrence as the first result; the filter ts > task.scheduled_at skips it,
                    # and the next element is the true next occurrence. Adding +1 caused the
                    # first generated ms to round back to task.scheduled_at after time-preservation.
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
                        raw_dt = raw_dt.replace(hour=from_dt.hour, minute=from_dt.minute, second=from_dt.second)
                        raw_dt = _apply_day_time_override(raw_dt, task.day_time_overrides)
                        next_ms = int(raw_dt.timestamp() * 1000)
                elif task.recurrence:
                    # Simple pattern (user-created tasks)
                    next_dt = next_occurrence(task.recurrence, from_dt)
                    if next_dt:
                        hourly = is_hourly_recurrence(task.recurrence)
                        if not hourly:
                            next_dt = next_dt.replace(hour=from_dt.hour, minute=from_dt.minute, second=from_dt.second)
                            next_dt = _apply_day_time_override(next_dt, task.day_time_overrides)
                        next_ms = int(next_dt.timestamp() * 1000)

                # Respect recurrence end date — don't create occurrences past it
                if next_ms and task.recurrence_ends_at and next_ms > task.recurrence_ends_at:
                    next_ms = None

                # Skip over blackout periods per task's post_blackout_behavior
                next_anchor_ms: Optional[int] = None
                if next_ms:
                    pre_adjust_ms = next_ms
                    next_ms = adjust_for_blackouts(next_ms, task, user_blackouts, from_dt)
                    # catch_up_once: if the date was moved by blackout adjustment, store the
                    # original pre-adjustment scheduled_at as recurrence_anchor_ms so the
                    # next completion computes from that anchor (series stays on schedule).
                    if (task.post_blackout_behavior in ("catch_up_once", "catch_up_immediate")
                            and next_ms != pre_adjust_ms):
                        next_anchor_ms = pre_adjust_ms
                    if task.recurrence_ends_at and next_ms > task.recurrence_ends_at:
                        next_ms = None
                    # Re-apply day-time override after blackout may have shifted the date
                    if next_ms and task.day_time_overrides and not is_hourly_recurrence(task.recurrence):
                        adj_dt = datetime.fromtimestamp(next_ms / 1000, tz=_IST)
                        adj_dt = _apply_day_time_override(adj_dt, task.day_time_overrides)
                        next_ms = int(adj_dt.timestamp() * 1000)
                    # catch_up_once: drop anchor-based slots too close to the catch-up date
                    if (next_ms
                            and task.post_blackout_behavior == "catch_up_once"
                            and task.recurrence
                            and task.recurrence_anchor_ms):
                        next_ms = skip_occurrences_too_close_after_catchup(
                            task.recurrence,
                            next_ms,
                            task.scheduled_at,
                            task.recurrence_anchor_ms,
                        )
                        if task.recurrence_ends_at and next_ms > task.recurrence_ends_at:
                            next_ms = None

                if next_ms:
                    next_task = CircuitTask(
                        user_id=user.id,
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
            except Exception:
                # Silently fail recurrence creation; don't block task completion
                pass

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
    patch_data = payload.patch.model_dump(exclude_unset=True)
    for task in tasks:
        was_completed = task.completed
        for field, value in patch_data.items():
            if field == "metadata":
                task.metadata_json = json.dumps(value)
            elif field in _JSON_FIELDS:
                setattr(task, field, json.dumps(value))
            elif field == "blackout_skip_flags":
                task.blackout_skip_flags = json.dumps(value) if value is not None else None
            else:
                setattr(task, field, value)
        if patch_data.get("completed") is True and not was_completed:
            task.historical_completion_rate = record_completion_rate(task.historical_completion_rate)
        task.updated_at = datetime.utcnow()
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
    return suggest_slot_for_task(task, others, energy_level=energy, stress_level=stress)


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
            **{k: v for k, v in item.model_dump(exclude={"metadata", "required_resources", "dependencies", "blackout_skip_flags", "day_time_overrides"}).items()},
            required_resources=json.dumps(item.required_resources),
            dependencies=json.dumps(item.dependencies),
            metadata_json=json.dumps(item.metadata),
            blackout_skip_flags=json.dumps(item.blackout_skip_flags) if item.blackout_skip_flags else None,
            day_time_overrides=json.dumps(item.day_time_overrides) if item.day_time_overrides else None,
            # travel buffer ints pass through via ** spread
        )
        db.add(task)
        created += 1
    db.commit()
    return {"created": created, "skipped": skipped}
