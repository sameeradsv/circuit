from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.engines.recurrence import next_occurrence
from app.models import CircuitTask, MaterializedOccurrence, OccurrenceOverride, RecurringTask, Reminder

_IST = ZoneInfo("Asia/Kolkata")
_WEEKDAY = {0: "MO", 1: "TU", 2: "WE", 3: "TH", 4: "FR", 5: "SA", 6: "SU"}
_MAX_EXPANSION_DAYS = 120
_MAX_OCCURRENCES_PER_SERIES = 500


def _series_key(task: CircuitTask) -> str:
    if task.client_id:
        return f"client:{task.client_id}"
    anchor_ms = task.rrule_dtstart_ms or task.recurrence_anchor_ms or task.scheduled_at or 0
    anchor_dt = datetime.fromtimestamp(anchor_ms / 1000, tz=_IST)
    clock = f"{anchor_dt.hour:02d}:{anchor_dt.minute:02d}:{anchor_dt.second:02d}"
    rule = task.rrule or task.recurrence or ""
    return "|".join([
        f"user:{task.user_id}",
        f"title:{task.text.strip().lower()}",
        f"rule:{rule}",
        f"duration:{task.duration or 30}",
        f"clock:{clock}",
        f"ends:{task.recurrence_ends_at or ''}",
    ])


def series_key_for_task(task: CircuitTask) -> str:
    return _series_key(task)


def _row_series_key(row: RecurringTask) -> str:
    meta = json.loads(row.metadata_json or "{}")
    if isinstance(meta.get("series_key"), str):
        return meta["series_key"]
    if meta.get("client_id"):
        return f"client:{meta['client_id']}"
    anchor_ms = row.rrule_dtstart_ms or row.start_datetime_ms or 0
    anchor_dt = datetime.fromtimestamp(anchor_ms / 1000, tz=_IST)
    clock = f"{anchor_dt.hour:02d}:{anchor_dt.minute:02d}:{anchor_dt.second:02d}"
    rule = row.rrule or row.recurrence or ""
    return "|".join([
        f"user:{row.user_id}",
        f"title:{row.title.strip().lower()}",
        f"rule:{rule}",
        f"duration:{row.duration or 30}",
        f"clock:{clock}",
        f"ends:{row.recurrence_ends_at or ''}",
    ])


def _store_row_series_key(row: RecurringTask, key: str) -> None:
    meta = json.loads(row.metadata_json or "{}")
    if meta.get("series_key") == key:
        return
    meta["series_key"] = key
    row.metadata_json = json.dumps(meta)


def is_virtual_id(value: str) -> bool:
    return value.startswith("r_")


def parse_virtual_id(value: str) -> tuple[int, int]:
    _, recurring_id, occurrence_start = value.split("_", 2)
    return int(recurring_id), int(occurrence_start)


def _task_metadata(task: CircuitTask) -> dict[str, Any]:
    task_meta = json.loads(task.metadata_json)
    recurrence_time_ref_ms = task_meta.get("recurrence_time_ref_ms")
    if not isinstance(recurrence_time_ref_ms, int):
        recurrence_time_ref_ms = task.recurrence_anchor_ms or task.scheduled_at
    return {
        "source_task_id": task.id,
        "client_id": task.client_id,
        "tag": task.tag,
        "completed": False,
        "tiny_step": task.tiny_step,
        "effort": task.effort,
        "deadline_type": task.deadline_type,
        "time_sensitivity": task.time_sensitivity,
        "cognitive_load": task.cognitive_load,
        "emotional_resistance": task.emotional_resistance,
        "activation_energy": task.activation_energy,
        "recovery_cost": task.recovery_cost,
        "focus_type": task.focus_type,
        "importance": task.importance,
        "urgency": task.urgency,
        "consequence_of_delay": task.consequence_of_delay,
        "momentum_value": task.momentum_value,
        "compound_benefit": task.compound_benefit,
        "identity_alignment": task.identity_alignment,
        "historical_completion_rate": task.historical_completion_rate,
        "skipped_count": task.skipped_count,
        "last_skipped_at": task.last_skipped_at,
        "energy_to_reward_ratio": task.energy_to_reward_ratio,
        "task_decomposition_potential": task.task_decomposition_potential,
        "required_resources": json.loads(task.required_resources),
        "dependencies": json.loads(task.dependencies),
        "metadata": task_meta,
        "recurrence_time_ref_ms": recurrence_time_ref_ms,
        "preferred_execution_window": task.preferred_execution_window,
        "delay_pattern": task.delay_pattern,
        "location_dependency": task.location_dependency,
        "client_created_at": task.client_created_at,
        "client_updated_at": task.client_updated_at,
        "blackout_skip_flags": json.loads(task.blackout_skip_flags) if task.blackout_skip_flags else [],
        "post_blackout_behavior": task.post_blackout_behavior or "resume",
        "recurrence_anchor_ms": task.recurrence_anchor_ms,
        "group_id": task.group_id,
        "day_time_overrides": json.loads(task.day_time_overrides) if task.day_time_overrides else {},
        "travel_buffer_before_mins": task.travel_buffer_before_mins,
        "travel_buffer_after_mins": task.travel_buffer_after_mins,
        "notifications_enabled": bool(task.notifications_enabled),
        "notification_offset_1_mins": task.notification_offset_1_mins,
        "notification_offset_2_mins": task.notification_offset_2_mins,
        "import_review_pending": bool(task.import_review_pending),
    }


def _apply_day_time_override(dt: datetime, overrides: dict[str, str], time_ref: datetime) -> datetime:
    if not overrides or time_ref.hour >= 12:
        return dt
    time_str = overrides.get(_WEEKDAY[dt.weekday()])
    if not time_str:
        return dt
    h, m = map(int, time_str.split(":"))
    return dt.replace(hour=h, minute=m, second=0, microsecond=0)


def sync_recurring_definition(db: Session, task: CircuitTask) -> Optional[RecurringTask]:
    if not task.scheduled_at or not (task.recurrence or task.rrule):
        existing = db.query(RecurringTask).filter(RecurringTask.source_task_id == task.id).first()
        if existing:
            existing.active = False
            existing.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        return None

    key = _series_key(task)
    metadata = _task_metadata(task)
    metadata["series_key"] = key

    row = next(
        (
            pending
            for pending in db.new
            if isinstance(pending, RecurringTask) and pending.source_task_id == task.id
        ),
        None,
    )
    if row is None:
        row = db.query(RecurringTask).filter(RecurringTask.source_task_id == task.id).first()
    if row is None:
        for candidate in db.query(RecurringTask).filter(RecurringTask.user_id == task.user_id, RecurringTask.active == True).all():  # noqa: E712
            if _row_series_key(candidate) == key:
                row = candidate
                break
    if row is None:
        row = RecurringTask(user_id=task.user_id, source_task_id=task.id)
        db.add(row)
    else:
        row.source_task_id = task.id
    for candidate in db.query(RecurringTask).filter(RecurringTask.user_id == task.user_id, RecurringTask.active == True).all():  # noqa: E712
        if candidate is row or candidate.id == row.id:
            continue
        if _row_series_key(candidate) == key:
            candidate.active = False
            candidate.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    row.title = task.text
    row.start_datetime_ms = task.rrule_dtstart_ms or task.scheduled_at
    row.duration = task.duration or 30
    row.recurrence = task.recurrence
    row.rrule = task.rrule
    row.rrule_dtstart_ms = task.rrule_dtstart_ms
    row.recurrence_ends_at = task.recurrence_ends_at
    row.metadata_json = json.dumps(metadata)
    row.active = True
    row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    return row


def recurring_definition_for_task(db: Session, user_id: int, task: CircuitTask) -> Optional[RecurringTask]:
    row = db.query(RecurringTask).filter(
        RecurringTask.user_id == user_id,
        RecurringTask.source_task_id == task.id,
    ).first()
    if row:
        return row
    if task.scheduled_at and (task.recurrence or task.rrule):
        return sync_recurring_definition(db, task)
    if task.client_id:
        client_key = f"client:{task.client_id}"
        rows = db.query(RecurringTask).filter(RecurringTask.user_id == user_id).all()
        for candidate in rows:
            if _row_series_key(candidate) == client_key:
                return candidate
    return None


def _ics_series_uid(client_id: Optional[str]) -> Optional[str]:
    if not client_id or not client_id.startswith("ics:"):
        return None
    inner = client_id[4:]
    last_colon = inner.rfind(":")
    if last_colon >= 0:
        suffix = inner[last_colon + 1:]
        if suffix.isdigit() and len(suffix) >= 10:
            return inner[:last_colon]
    return inner or None


def _has_ics_occurrence_suffix(client_id: Optional[str]) -> bool:
    if not client_id or not client_id.startswith("ics:"):
        return False
    inner = client_id[4:]
    last_colon = inner.rfind(":")
    if last_colon < 0:
        return False
    suffix = inner[last_colon + 1:]
    return suffix.isdigit() and len(suffix) >= 10


def _same_series_tasks(db: Session, user_id: int, source: CircuitTask) -> list[CircuitTask]:
    tasks: list[CircuitTask] = []
    seen: set[int] = set()

    def add(rows: list[CircuitTask]) -> None:
        for row in rows:
            if row.id not in seen:
                seen.add(row.id)
                tasks.append(row)

    add([source])

    uid = _ics_series_uid(source.client_id)
    if uid:
        pattern = f"ics:{uid}:%"
        add(db.query(CircuitTask).filter(
            CircuitTask.user_id == user_id,
            or_(CircuitTask.client_id == f"ics:{uid}", CircuitTask.client_id.like(pattern)),
        ).all())

    key = _series_key(source) if (source.recurrence or source.rrule or source.client_id) else None
    if key:
        candidates = db.query(CircuitTask).filter(
            CircuitTask.user_id == user_id,
            or_(CircuitTask.recurrence.isnot(None), CircuitTask.rrule.isnot(None), CircuitTask.client_id.isnot(None)),
        ).all()
        add([candidate for candidate in candidates if _series_key(candidate) == key])

    return tasks


def delete_recurring_series(
    db: Session,
    user_id: int,
    source: CircuitTask,
    from_scheduled_at: Optional[int] = None,
) -> int:
    recurring = recurring_definition_for_task(db, user_id, source)
    if not recurring and not source.recurrence and not source.rrule and not _has_ics_occurrence_suffix(source.client_id):
        return 0
    affected = 0
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    if recurring:
        row_filters = [
            MaterializedOccurrence.user_id == user_id,
            MaterializedOccurrence.recurring_task_id == recurring.id,
        ]
        override_filters = [
            OccurrenceOverride.user_id == user_id,
            OccurrenceOverride.recurring_task_id == recurring.id,
        ]
        if from_scheduled_at is not None:
            row_filters.append(or_(
                MaterializedOccurrence.occurrence_start_ms >= from_scheduled_at,
                MaterializedOccurrence.scheduled_start_ms >= from_scheduled_at,
            ))
            override_filters.append(or_(
                OccurrenceOverride.occurrence_start_ms >= from_scheduled_at,
                OccurrenceOverride.modified_start_ms >= from_scheduled_at,
            ))

        affected += db.query(MaterializedOccurrence).filter(*row_filters).delete(synchronize_session=False)
        affected += db.query(OccurrenceOverride).filter(*override_filters).delete(synchronize_session=False)

        if from_scheduled_at is None or from_scheduled_at <= recurring.start_datetime_ms:
            if recurring.active:
                affected += 1
            recurring.active = False
        else:
            new_end = from_scheduled_at - 1
            if recurring.recurrence_ends_at is None or recurring.recurrence_ends_at > new_end:
                recurring.recurrence_ends_at = new_end
                affected += 1
        recurring.updated_at = now_utc

    tasks = _same_series_tasks(db, user_id, source)
    for task in tasks:
        if from_scheduled_at is not None and (task.scheduled_at is None or task.scheduled_at < from_scheduled_at):
            if task.recurrence or task.rrule:
                new_end = from_scheduled_at - 1
                if task.recurrence_ends_at is None or task.recurrence_ends_at > new_end:
                    task.recurrence_ends_at = new_end
                    task.updated_at = now_utc
                    affected += 1
                    sync_recurring_definition(db, task)
            continue
        db.query(Reminder).filter(Reminder.user_id == user_id, Reminder.task_id == task.id).delete(synchronize_session=False)
        db.delete(task)
        affected += 1

    return affected


def propagate_recurring_series_fields(
    db: Session,
    user_id: int,
    source: CircuitTask,
    *,
    include_classification: bool,
    include_text: bool,
    classification_fields: tuple[str, ...],
    from_scheduled_at: Optional[int] = None,
) -> int:
    recurring = recurring_definition_for_task(db, user_id, source)
    affected = 0

    if recurring:
        meta = json.loads(recurring.metadata_json or "{}")
        if include_classification:
            for field in classification_fields:
                meta[field] = getattr(source, field)
        if include_text:
            recurring.title = source.text
            meta["tiny_step"] = source.tiny_step
        recurring.metadata_json = json.dumps(meta)
        recurring.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        affected += 1

    for sibling in _same_series_tasks(db, user_id, source):
        if sibling.id == source.id:
            continue
        if from_scheduled_at is not None and (sibling.scheduled_at is None or sibling.scheduled_at < from_scheduled_at):
            continue
        if include_classification:
            for field in classification_fields:
                setattr(sibling, field, getattr(source, field))
        if include_text:
            sibling.text = source.text
            sibling.tiny_step = source.tiny_step
        sibling.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        sync_recurring_definition(db, sibling)
        affected += 1

    return affected


def ensure_recurring_definitions(db: Session, user_id: int) -> None:
    tasks = (
        db.query(CircuitTask)
        .filter(
            CircuitTask.user_id == user_id,
            CircuitTask.scheduled_at.isnot(None),
            or_(CircuitTask.recurrence.isnot(None), CircuitTask.rrule.isnot(None)),
        )
        .order_by(CircuitTask.completed.asc(), CircuitTask.scheduled_at.asc(), CircuitTask.id.asc())
        .all()
    )
    seen: set[str] = set()
    for task in tasks:
        key = _series_key(task)
        existing = db.query(RecurringTask).filter(RecurringTask.source_task_id == task.id).first()
        if key in seen:
            if existing:
                existing.active = False
                existing.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
            continue
        seen.add(key)
        sync_recurring_definition(db, task)
    active_defs = db.query(RecurringTask).filter(RecurringTask.user_id == user_id, RecurringTask.active == True).all()  # noqa: E712
    active_seen: dict[str, RecurringTask] = {}
    for row in sorted(active_defs, key=lambda r: (r.source_task_id is None, r.start_datetime_ms, r.id)):
        key = _row_series_key(row)
        _store_row_series_key(row, key)
        if key in active_seen:
            row.active = False
            row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
        else:
            active_seen[key] = row
    db.flush()


def _bounded_to_ms(from_ms: int, to_ms: int) -> int:
    max_to = from_ms + _MAX_EXPANSION_DAYS * 86_400_000
    return min(to_ms, max_to)


def _expand_simple(row: RecurringTask, from_ms: int, to_ms: int) -> list[int]:
    if not row.recurrence:
        return []
    meta = json.loads(row.metadata_json or "{}")
    anchor = datetime.fromtimestamp(row.start_datetime_ms / 1000, tz=_IST)
    time_ref_ms = meta.get("recurrence_time_ref_ms")
    time_ref = datetime.fromtimestamp((time_ref_ms if isinstance(time_ref_ms, int) else row.start_datetime_ms) / 1000, tz=_IST)
    overrides = meta.get("day_time_overrides", {})
    current = anchor
    out: list[int] = []
    for _ in range(_MAX_OCCURRENCES_PER_SERIES):
        display = current
        if not row.recurrence.lower().startswith("every:") or not row.recurrence.lower().endswith("h"):
            display = display.replace(
                hour=time_ref.hour,
                minute=time_ref.minute,
                second=time_ref.second,
                microsecond=0,
            )
            display = _apply_day_time_override(display, overrides, time_ref)
        current_ms = int(display.timestamp() * 1000)
        if current_ms + (row.duration or 30) * 60_000 > from_ms and current_ms <= to_ms:
            out.append(current_ms)
        if int(current.timestamp() * 1000) > to_ms:
            break
        nxt = next_occurrence(row.recurrence, current)
        if not nxt or nxt <= current:
            break
        current = nxt
        if row.recurrence_ends_at and int(current.timestamp() * 1000) > row.recurrence_ends_at:
            break
    return out


def _expand_rrule(row: RecurringTask, from_ms: int, to_ms: int) -> list[int]:
    if not row.rrule:
        return []
    from app.routers.calendar import _expand_rrule as expand_ics_rrule

    anchor_ms = row.rrule_dtstart_ms or row.start_datetime_ms
    meta = json.loads(row.metadata_json or "{}")
    time_ref_ms = meta.get("recurrence_time_ref_ms")
    orig_dt = datetime.fromtimestamp((time_ref_ms if isinstance(time_ref_ms, int) else anchor_ms) / 1000, tz=_IST)
    overrides = meta.get("day_time_overrides", {})
    out: list[int] = []
    for raw_ms in expand_ics_rrule(anchor_ms, row.rrule, set(), cutoff_ms=from_ms):
        if row.recurrence_ends_at and raw_ms > row.recurrence_ends_at:
            break
        if raw_ms > to_ms:
            break
        raw_dt = datetime.fromtimestamp(raw_ms / 1000, tz=_IST)
        corrected = raw_dt.replace(
            hour=orig_dt.hour,
            minute=orig_dt.minute,
            second=orig_dt.second,
            microsecond=0,
        )
        corrected = _apply_day_time_override(corrected, overrides, orig_dt)
        ts = int(corrected.timestamp() * 1000)
        if ts + (row.duration or 30) * 60_000 > from_ms and ts <= to_ms:
            out.append(ts)
    return out[:_MAX_OCCURRENCES_PER_SERIES]


def _base_virtual_dict(row: RecurringTask, start_ms: int) -> dict[str, Any]:
    meta = json.loads(row.metadata_json or "{}")
    now_iso = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    return {
        "id": f"r_{row.id}_{start_ms}",
        "client_id": meta.get("client_id"),
        "text": row.title,
        "tag": meta.get("tag", "general"),
        "completed": False,
        "tiny_step": meta.get("tiny_step", ""),
        "effort": meta.get("effort", "medium"),
        "duration": row.duration or 30,
        "deadline_type": meta.get("deadline_type", "none"),
        "time_sensitivity": meta.get("time_sensitivity", 0.5),
        "scheduled_at": start_ms,
        "recurrence": row.recurrence,
        "cognitive_load": meta.get("cognitive_load", 0.5),
        "emotional_resistance": meta.get("emotional_resistance", 0.5),
        "activation_energy": meta.get("activation_energy", 0.5),
        "recovery_cost": meta.get("recovery_cost", 0.3),
        "focus_type": meta.get("focus_type", "shallow"),
        "importance": meta.get("importance", 0.5),
        "urgency": meta.get("urgency", 0.5),
        "consequence_of_delay": meta.get("consequence_of_delay", 0.3),
        "momentum_value": meta.get("momentum_value", 0.5),
        "compound_benefit": meta.get("compound_benefit", 0.3),
        "identity_alignment": meta.get("identity_alignment", 0.3),
        "historical_completion_rate": meta.get("historical_completion_rate", 0.7),
        "skipped_count": meta.get("skipped_count", 0),
        "last_skipped_at": meta.get("last_skipped_at"),
        "energy_to_reward_ratio": meta.get("energy_to_reward_ratio", 0.5),
        "task_decomposition_potential": meta.get("task_decomposition_potential", 0.3),
        "required_resources": meta.get("required_resources", []),
        "dependencies": meta.get("dependencies", []),
        "metadata": meta.get("metadata", {}),
        "preferred_execution_window": meta.get("preferred_execution_window"),
        "delay_pattern": meta.get("delay_pattern"),
        "location_dependency": meta.get("location_dependency"),
        "client_created_at": meta.get("client_created_at"),
        "client_updated_at": meta.get("client_updated_at"),
        "created_at": now_iso,
        "updated_at": now_iso,
        "blackout_skip_flags": meta.get("blackout_skip_flags", []),
        "rrule": row.rrule,
        "rrule_dtstart_ms": row.rrule_dtstart_ms,
        "is_recurring_template": bool(row.rrule),
        "recurrence_ends_at": row.recurrence_ends_at,
        "post_blackout_behavior": meta.get("post_blackout_behavior", "resume"),
        "recurrence_anchor_ms": meta.get("recurrence_anchor_ms"),
        "group_id": meta.get("group_id"),
        "day_time_overrides": meta.get("day_time_overrides", {}),
        "travel_buffer_before_mins": meta.get("travel_buffer_before_mins"),
        "travel_buffer_after_mins": meta.get("travel_buffer_after_mins"),
        "notifications_enabled": meta.get("notifications_enabled", True),
        "notification_offset_1_mins": meta.get("notification_offset_1_mins", 10),
        "notification_offset_2_mins": meta.get("notification_offset_2_mins"),
        "import_review_pending": meta.get("import_review_pending", False),
        "is_virtual_occurrence": True,
        "recurring_task_id": row.id,
        "occurrence_start_ms": start_ms,
        "source_task_id": meta.get("source_task_id"),
    }


def occurrence_key_for(start_ms: int) -> str:
    return str(start_ms)


def materialization_window_ms(now: Optional[datetime] = None) -> tuple[int, int]:
    today = (now or datetime.now(_IST)).astimezone(_IST).replace(hour=0, minute=0, second=0, microsecond=0)
    if today.month == 12:
        next_month = today.replace(year=today.year + 1, month=1, day=1)
    else:
        next_month = today.replace(month=today.month + 1, day=1)
    end_of_month = next_month - timedelta(milliseconds=1)
    seven_day_end = today + timedelta(days=8) - timedelta(milliseconds=1)
    return int(today.timestamp() * 1000), int(max(end_of_month, seven_day_end).timestamp() * 1000)


def _materialized_to_virtual_dict(row: MaterializedOccurrence, recurring: RecurringTask) -> dict[str, Any]:
    item = _base_virtual_dict(recurring, row.occurrence_start_ms)
    item["id"] = f"r_{row.recurring_task_id}_{row.occurrence_start_ms}"
    item["scheduled_at"] = row.scheduled_start_ms
    item["duration"] = max(1, round((row.occurrence_end_ms - row.scheduled_start_ms) / 60_000))
    item["is_materialized_occurrence"] = True
    item["materialized_occurrence_id"] = row.id
    item["occurrence_key"] = row.occurrence_key
    return item


def materialized_occurrences(
    db: Session,
    user_id: int,
    from_ms: int,
    to_ms: int,
    *,
    completed: Optional[bool] = None,
) -> list[dict[str, Any]]:
    rows = (
        db.query(MaterializedOccurrence, RecurringTask)
        .join(RecurringTask, MaterializedOccurrence.recurring_task_id == RecurringTask.id)
        .filter(
            MaterializedOccurrence.user_id == user_id,
            MaterializedOccurrence.status == "pending",
            RecurringTask.active == True,  # noqa: E712
        )
        .all()
    )
    overrides = (
        db.query(OccurrenceOverride)
        .filter(
            OccurrenceOverride.user_id == user_id,
            or_(
                and_(
                    OccurrenceOverride.occurrence_start_ms >= from_ms,
                    OccurrenceOverride.occurrence_start_ms <= to_ms,
                ),
                and_(
                    OccurrenceOverride.modified_start_ms.isnot(None),
                    OccurrenceOverride.modified_start_ms >= from_ms,
                    OccurrenceOverride.modified_start_ms <= to_ms,
                ),
            ),
        )
        .all()
    )
    override_map = {(o.recurring_task_id, o.occurrence_start_ms): o for o in overrides}

    out: list[dict[str, Any]] = []
    for row, recurring in rows:
        override = override_map.get((row.recurring_task_id, row.occurrence_start_ms))
        if override and override.status == "skipped":
            continue
        item = _materialized_to_virtual_dict(row, recurring)
        if override:
            if override.status == "completed":
                item["completed"] = True
            elif override.status == "rescheduled":
                item["scheduled_at"] = override.modified_start_ms
                item["duration"] = override.modified_duration or item["duration"]
            item["occurrence_override_status"] = override.status
        if completed is not None and bool(item["completed"]) != completed:
            continue
        scheduled_at = item.get("scheduled_at")
        duration = item.get("duration") or 30
        if scheduled_at is None:
            continue
        if scheduled_at <= to_ms and scheduled_at + duration * 60_000 > from_ms:
            out.append(item)
    out.sort(key=lambda t: (t.get("scheduled_at") or 0, str(t.get("id"))))
    return out


def materialize_occurrences_for_user(
    db: Session,
    user_id: int,
    *,
    now: Optional[datetime] = None,
) -> dict[str, int]:
    from_ms, to_ms = materialization_window_ms(now)
    ensure_recurring_definitions(db, user_id)
    desired: dict[tuple[int, int], dict[str, Any]] = {}
    created = updated = skipped = 0

    for item in expand_virtual_occurrences(db, user_id, from_ms, to_ms, completed=False):
        recurring_id = item.get("recurring_task_id")
        occurrence_start = item.get("occurrence_start_ms") or item.get("scheduled_at")
        scheduled_at = item.get("scheduled_at")
        source_task_id = item.get("source_task_id")
        duration = item.get("duration") or 30
        if not all(isinstance(v, int) for v in [recurring_id, occurrence_start, scheduled_at, source_task_id]):
            skipped += 1
            continue
        desired[(int(recurring_id), int(occurrence_start))] = {
            "source_task_id": int(source_task_id),
            "start": int(scheduled_at),
            "end": int(scheduled_at) + int(duration) * 60_000,
            "occurrence_key": occurrence_key_for(int(occurrence_start)),
        }

    existing = (
        db.query(MaterializedOccurrence)
        .filter(
            MaterializedOccurrence.user_id == user_id,
            MaterializedOccurrence.occurrence_start_ms >= from_ms,
            MaterializedOccurrence.occurrence_start_ms <= to_ms,
        )
        .all()
    )
    existing_map = {(row.recurring_task_id, row.occurrence_start_ms): row for row in existing}
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)

    for key, payload in desired.items():
        row = existing_map.get(key)
        if row is None:
            db.add(MaterializedOccurrence(
                user_id=user_id,
                recurring_task_id=key[0],
                source_task_id=payload["source_task_id"],
                occurrence_key=payload["occurrence_key"],
                occurrence_start_ms=key[1],
                scheduled_start_ms=payload["start"],
                occurrence_end_ms=payload["end"],
                status="pending",
                generated=True,
            ))
            created += 1
            continue
        changed = (
            row.source_task_id != payload["source_task_id"]
            or row.occurrence_key != payload["occurrence_key"]
            or row.scheduled_start_ms != payload["start"]
            or row.occurrence_end_ms != payload["end"]
            or row.status != "pending"
        )
        if changed:
            row.source_task_id = payload["source_task_id"]
            row.occurrence_key = payload["occurrence_key"]
            row.occurrence_start_ms = key[1]
            row.scheduled_start_ms = payload["start"]
            row.occurrence_end_ms = payload["end"]
            row.status = "pending"
            row.updated_at = now_utc
            updated += 1

    deleted = 0
    for key, row in existing_map.items():
        if key in desired:
            continue
        if row.status == "pending" and row.generated and row.occurrence_start_ms >= from_ms:
            db.delete(row)
            deleted += 1

    db.flush()
    return {
        "materialized": created + updated,
        "created": created,
        "updated": updated,
        "deleted": deleted,
        "skipped": skipped,
        "failed": 0,
        "from_ms": from_ms,
        "to_ms": to_ms,
    }


def materialize_occurrences_for_all_users(db: Session, *, now: Optional[datetime] = None) -> dict[str, int]:
    user_ids = [row[0] for row in db.query(CircuitTask.user_id).distinct().all()]
    totals = {"materialized": 0, "created": 0, "updated": 0, "deleted": 0, "skipped": 0, "failed": 0}
    for user_id in user_ids:
        try:
            stats = materialize_occurrences_for_user(db, int(user_id), now=now)
            for key in totals:
                totals[key] += int(stats.get(key, 0))
        except Exception:
            totals["failed"] += 1
    db.flush()
    return totals


def expand_virtual_occurrences(
    db: Session,
    user_id: int,
    from_ms: int,
    to_ms: int,
    *,
    completed: Optional[bool] = None,
) -> list[dict[str, Any]]:
    ensure_recurring_definitions(db, user_id)
    bounded_to = _bounded_to_ms(from_ms, to_ms)
    rows = (
        db.query(RecurringTask)
        .filter(
            RecurringTask.user_id == user_id,
            RecurringTask.active == True,  # noqa: E712
            RecurringTask.start_datetime_ms <= bounded_to,
            or_(RecurringTask.recurrence_ends_at.is_(None), RecurringTask.recurrence_ends_at >= from_ms),
        )
        .all()
    )
    overrides = (
        db.query(OccurrenceOverride)
        .filter(
            OccurrenceOverride.user_id == user_id,
            or_(
                and_(
                    OccurrenceOverride.occurrence_start_ms >= from_ms,
                    OccurrenceOverride.occurrence_start_ms <= bounded_to,
                ),
                and_(
                    OccurrenceOverride.modified_start_ms.isnot(None),
                    OccurrenceOverride.modified_start_ms >= from_ms,
                    OccurrenceOverride.modified_start_ms <= bounded_to,
                ),
            ),
        )
        .all()
    )
    override_map = {(o.recurring_task_id, o.occurrence_start_ms): o for o in overrides}

    out: list[dict[str, Any]] = []
    for row in rows:
        starts = _expand_rrule(row, from_ms, bounded_to) if row.rrule else _expand_simple(row, from_ms, bounded_to)
        for start in starts:
            override = override_map.get((row.id, start))
            if override and override.status == "skipped":
                continue
            item = _base_virtual_dict(row, start)
            if override:
                if override.status == "completed":
                    item["completed"] = True
                elif override.status == "rescheduled":
                    item["scheduled_at"] = override.modified_start_ms
                    item["duration"] = override.modified_duration or item["duration"]
                item["occurrence_override_status"] = override.status
            if completed is not None and bool(item["completed"]) != completed:
                continue
            scheduled_at = item.get("scheduled_at")
            duration = item.get("duration") or 30
            if scheduled_at is None:
                continue
            if scheduled_at <= bounded_to and scheduled_at + duration * 60_000 > from_ms:
                out.append(item)
    out.sort(key=lambda t: (t.get("scheduled_at") or 0, str(t.get("id"))))
    return out


def upsert_occurrence_override(
    db: Session,
    user_id: int,
    recurring_task_id: int,
    occurrence_start_ms: int,
    *,
    status: str,
    modified_start_ms: Optional[int] = None,
    modified_duration: Optional[int] = None,
) -> OccurrenceOverride:
    row = (
        db.query(OccurrenceOverride)
        .filter(
            OccurrenceOverride.user_id == user_id,
            OccurrenceOverride.recurring_task_id == recurring_task_id,
            OccurrenceOverride.occurrence_start_ms == occurrence_start_ms,
        )
        .first()
    )
    if row is None:
        row = OccurrenceOverride(
            user_id=user_id,
            recurring_task_id=recurring_task_id,
            occurrence_start_ms=occurrence_start_ms,
            status=status,
        )
        db.add(row)
    row.status = status
    row.modified_start_ms = modified_start_ms
    row.modified_duration = modified_duration
    row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    return row


def virtual_busy_tasks(db: Session, user_id: int, from_ms: int, to_ms: int) -> list[CircuitTask]:
    tasks: list[CircuitTask] = []
    for item in expand_virtual_occurrences(db, user_id, from_ms, to_ms, completed=False):
        task = CircuitTask(
            id=0,
            user_id=user_id,
            text=item["text"],
            tag=item["tag"],
            completed=False,
            scheduled_at=item["scheduled_at"],
            duration=item["duration"],
            recurrence=item.get("recurrence"),
            rrule=item.get("rrule"),
            focus_type=item.get("focus_type", "shallow"),
            preferred_execution_window=item.get("preferred_execution_window"),
        )
        tasks.append(task)
    return tasks
