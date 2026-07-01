"""Blackout overlap checks and task rescheduling."""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Optional

from sqlalchemy.orm import Session
from zoneinfo import ZoneInfo

from app.engines.recurrence import first_catch_up_slot_after, is_hourly_recurrence, next_occurrence, shifted_rrule, shifted_series_pattern
from app.models import Blackout, CircuitTask, TaskEvent
from app.services.reschedule import resolve_schedule_conflicts
from app.services.virtual_recurrence import materialize_occurrences_for_user, sync_recurring_definition

if TYPE_CHECKING:
    pass

_IST = ZoneInfo("Asia/Kolkata")
_WEEKDAY = {0: "MO", 1: "TU", 2: "WE", 3: "TH", 4: "FR", 5: "SA", 6: "SU"}

_NEXT_SLOT_SHIFT = frozenset({"resume", "catch_up", "catch_up_once"})
_SHIFT_SERIES = frozenset({"resume", "catch_up", "catch_up_once", "catch_up_imm_shift"})
_SUITABLE_SLOT_CATCHUP = _NEXT_SLOT_SHIFT
_IMMEDIATE_CATCHUP = frozenset({"catch_up_immediate", "catch_up_imm_shift"})
_ANCHOR_PRESERVING_CATCHUP = frozenset({"catch_up_immediate"})


def task_affected_by(task: CircuitTask, blackout_type: str) -> bool:
    flags = set(json.loads(task.blackout_skip_flags) if task.blackout_skip_flags else [])
    return blackout_type in flags


def _overlapping_blackouts(ms: int, task: CircuitTask, blackouts: list) -> list:
    flags = set(json.loads(task.blackout_skip_flags) if task.blackout_skip_flags else [])
    return [
        b for b in blackouts
        if getattr(b, "is_active", True)
        and b.blackout_type in flags
        and b.start_date_ms <= ms <= b.end_date_ms
    ]


def _catch_up_after_ms(ms: int, hits: list, from_dt: datetime) -> int:
    latest_end = max(b.end_date_ms for b in hits)
    latest_end_dt = datetime.fromtimestamp(latest_end / 1000, tz=_IST)
    candidate = latest_end_dt.replace(
        hour=from_dt.hour, minute=from_dt.minute, second=from_dt.second, microsecond=0
    )
    if candidate <= latest_end_dt:
        candidate += timedelta(days=1)
    return int(candidate.timestamp() * 1000)


def _catch_up_suitable_ms(
    hits: list,
    task: CircuitTask,
    from_dt: datetime,
) -> int:
    """Next valid recurrence slot on or after blackout ends (not the first calendar day)."""
    after_ms = max(b.end_date_ms for b in hits) + 1
    after_dt = datetime.fromtimestamp(after_ms / 1000, tz=_IST)

    if task.rrule and task.is_recurring_template:
        from app.routers.calendar import _expand_rrule
        candidates = _expand_rrule(
            task.rrule_dtstart_ms or task.scheduled_at,
            task.rrule,
            set(),
            cutoff_ms=after_ms,
        )
        raw = next((ts for ts in candidates if ts >= after_ms), None)
        if raw:
            raw_dt = datetime.fromtimestamp(raw / 1000, tz=_IST)
            raw_dt = raw_dt.replace(
                hour=from_dt.hour, minute=from_dt.minute,
                second=from_dt.second, microsecond=0,
            )
            return int(raw_dt.timestamp() * 1000)

    if task.recurrence:
        slot = first_catch_up_slot_after(task.recurrence, after_dt, from_dt)
        if slot:
            if not is_hourly_recurrence(task.recurrence):
                slot = slot.replace(
                    hour=from_dt.hour, minute=from_dt.minute,
                    second=from_dt.second, microsecond=0,
                )
            return int(slot.timestamp() * 1000)

    return _catch_up_after_ms(task.scheduled_at or after_ms, hits, from_dt)


def _metadata_dict(task: CircuitTask) -> dict:
    try:
        return json.loads(task.metadata_json or "{}")
    except Exception:
        return {}


def _recurrence_time_ref_dt(task: CircuitTask) -> datetime:
    meta = _metadata_dict(task)
    value = meta.get("recurrence_time_ref_ms")
    if isinstance(value, int):
        return datetime.fromtimestamp(value / 1000, tz=_IST)
    fallback_ms = task.recurrence_anchor_ms or task.rrule_dtstart_ms or task.scheduled_at
    if fallback_ms:
        return datetime.fromtimestamp(fallback_ms / 1000, tz=_IST)
    return datetime.now(tz=_IST)


def adjust_for_blackouts(
    next_ms: int,
    task: CircuitTask,
    blackouts: list,
    from_dt: datetime,
) -> int:
    """Advance next_ms past relevant blackout periods per task.post_blackout_behavior."""
    if not blackouts:
        return next_ms

    behavior = task.post_blackout_behavior or "resume"
    current_ms = next_ms

    for _ in range(365):
        hits = _overlapping_blackouts(current_ms, task, blackouts)
        if not hits:
            return current_ms

        if behavior in _SUITABLE_SLOT_CATCHUP:
            if task.recurrence or (task.rrule and task.is_recurring_template):
                current_ms = _catch_up_suitable_ms(hits, task, from_dt)
            else:
                current_ms = _catch_up_after_ms(current_ms, hits, from_dt)
            continue

        if behavior in _IMMEDIATE_CATCHUP:
            current_ms = _catch_up_after_ms(current_ms, hits, from_dt)
            continue

        # Legacy fallback: advance one recurrence period at a time.
        if task.rrule and task.is_recurring_template:
            from app.routers.calendar import _expand_rrule
            candidates = _expand_rrule(
                task.rrule_dtstart_ms or task.scheduled_at,
                task.rrule,
                set(),
                cutoff_ms=current_ms,
            )
            raw = next((ts for ts in candidates if ts > current_ms), None)
            if not raw:
                return current_ms
            raw_dt = datetime.fromtimestamp(raw / 1000, tz=_IST)
            raw_dt = raw_dt.replace(
                hour=from_dt.hour, minute=from_dt.minute,
                second=from_dt.second, microsecond=0,
            )
            current_ms = int(raw_dt.timestamp() * 1000)
        elif task.recurrence:
            iter_dt = datetime.fromtimestamp(current_ms / 1000, tz=_IST)
            nd = next_occurrence(task.recurrence, iter_dt)
            if not nd:
                return current_ms
            nd = nd.replace(
                hour=from_dt.hour, minute=from_dt.minute,
                second=from_dt.second, microsecond=0,
            )
            current_ms = int(nd.timestamp() * 1000)
        else:
            # One-off task: move to first day after blackout ends
            current_ms = _catch_up_after_ms(current_ms, hits, from_dt)

    return current_ms


def _apply_day_time_override(dt: datetime, overrides_json: Optional[str], time_ref: datetime) -> datetime:
    if not overrides_json:
        return dt
    if time_ref.hour >= 12:
        return dt
    overrides = json.loads(overrides_json)
    wd = _WEEKDAY[dt.weekday()]
    time_str = overrides.get(wd)
    if time_str:
        h, m = map(int, time_str.split(":"))
        return dt.replace(hour=h, minute=m, second=0, microsecond=0)
    return dt


def reschedule_tasks_for_blackout(user_id: int, blackout: Blackout, db: Session) -> int:
    """Move open tasks parked during a blackout to their post-blackout slot."""
    all_blackouts = db.query(Blackout).filter(
        Blackout.user_id == user_id,
        Blackout.is_active.is_(True),
    ).all()
    candidates = (
        db.query(CircuitTask)
        .filter(
            CircuitTask.user_id == user_id,
            CircuitTask.completed.is_(False),
            CircuitTask.scheduled_at.isnot(None),
            CircuitTask.scheduled_at >= blackout.start_date_ms,
            CircuitTask.scheduled_at <= blackout.end_date_ms,
        )
        .all()
    )

    moved_task_ids: set[int] = set()
    now = datetime.now(tz=_IST).replace(tzinfo=None)
    for task in candidates:
        if not task_affected_by(task, blackout.blackout_type):
            continue
        if not task.scheduled_at:
            continue

        from_dt = _recurrence_time_ref_dt(task)
        new_ms = adjust_for_blackouts(task.scheduled_at, task, all_blackouts, from_dt)

        if task.recurrence_ends_at and new_ms > task.recurrence_ends_at:
            continue
        if task.day_time_overrides:
            adj_dt = datetime.fromtimestamp(new_ms / 1000, tz=_IST)
            adj_dt = _apply_day_time_override(adj_dt, task.day_time_overrides, from_dt)
            new_ms = int(adj_dt.timestamp() * 1000)

        if new_ms == task.scheduled_at:
            continue

        old_ms = task.scheduled_at
        if task.post_blackout_behavior in _SHIFT_SERIES and task.recurrence:
            shifted_dt = datetime.fromtimestamp(new_ms / 1000, tz=_IST)
            task.recurrence = shifted_series_pattern(task.recurrence, shifted_dt)
        if task.post_blackout_behavior in _SHIFT_SERIES and task.rrule:
            shifted_dt = datetime.fromtimestamp(new_ms / 1000, tz=_IST)
            task.rrule = shifted_rrule(task.rrule, shifted_dt)
            task.rrule_dtstart_ms = new_ms
        task.scheduled_at = new_ms
        if task.post_blackout_behavior in _ANCHOR_PRESERVING_CATCHUP and new_ms != old_ms:
            task.recurrence_anchor_ms = task.recurrence_anchor_ms or old_ms
        sync_recurring_definition(db, task)
        db.add(TaskEvent(
            user_id=user_id,
            task_id=task.id,
            event_type="rescheduled",
            occurred_at=now,
            metadata_json=json.dumps({
                "reason": "blackout",
                "blackout_type": blackout.blackout_type,
                "from_ms": old_ms,
                "to_ms": new_ms,
            }),
        ))
        moved_task_ids.add(task.id)
        for change in resolve_schedule_conflicts(
            db,
            user_id,
            task,
            now_utc=now,
            event_reason="blackout_conflict_resolution",
        ):
            moved_task = change.get("task")
            if isinstance(moved_task, CircuitTask):
                moved_task_ids.add(moved_task.id)

    moved = len(moved_task_ids)
    if moved:
        materialize_occurrences_for_user(db, user_id)
        db.commit()
    return moved
