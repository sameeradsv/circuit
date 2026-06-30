"""Server-side slot suggestion — port of frontend/lib/suggest-slot.ts (deterministic)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.models import CircuitTask

_IST = ZoneInfo("Asia/Kolkata")
_IST_OFFSET = timedelta(hours=5, minutes=30)
_WORKDAY_END = 19
_SOON_MS = 3 * 86_400_000
_DAY_CAPACITY_MINS = 8 * 60


def _ist_hour(ms: int) -> int:
    return datetime.fromtimestamp(ms / 1000, tz=_IST).hour


def _is_weekday(ms: int) -> bool:
    return datetime.fromtimestamp(ms / 1000, tz=_IST).weekday() < 5


def _ist_day_bounds(ms: int) -> tuple[int, int]:
    dt = datetime.fromtimestamp(ms / 1000, tz=_IST)
    start = dt.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def _next_ist_slot(ist_hour: int, after_ms: int) -> int:
    after = datetime.fromtimestamp(after_ms / 1000, tz=timezone.utc)
    ist_now = after + _IST_OFFSET
    base = ist_now.replace(hour=ist_hour, minute=0, second=0, microsecond=0)
    target_utc = base - _IST_OFFSET
    target_ms = int(target_utc.timestamp() * 1000)
    return target_ms if target_ms > after_ms else target_ms + 86_400_000


def _window_start(window: str, now_ms: int) -> int:
    hours = {"morning": 9, "afternoon": 13, "evening": 18}
    return _next_ist_slot(hours.get(window, 9), now_ms)


def _clamp01(value: float | None, fallback: float = 0.0) -> float:
    if value is None:
        return fallback
    return max(0.0, min(1.0, float(value)))


def _day_workload_minutes(candidate: int, others: list[CircuitTask]) -> int:
    start, end = _ist_day_bounds(candidate)
    total = 0
    for task in others:
        if task.completed or not task.scheduled_at:
            continue
        duration = task.duration or 30
        task_end = task.scheduled_at + duration * 60_000
        if task.scheduled_at < end and task_end > start:
            total += duration
    return total


def _deadline_weight(task: CircuitTask, now_ms: int) -> float:
    type_weight = {
        "hard": 0.18,
        "soft": 0.10,
        "today": 0.12,
    }.get(task.deadline_type or "none", 0.0)
    if not task.scheduled_at:
        return type_weight
    if task.scheduled_at < now_ms:
        return type_weight + 0.14
    if task.scheduled_at - now_ms <= _SOON_MS:
        return type_weight + 0.08
    return type_weight


def task_conflict_weight(task: CircuitTask, now_ms: int) -> float:
    effort_weight = {
        "high": 0.08,
        "medium": 0.04,
    }.get(task.effort or "low", 0.01)
    return (
        _clamp01(task.importance, 0.5) * 0.28
        + _clamp01(task.urgency, 0.5) * 0.24
        + _clamp01(task.consequence_of_delay, 0.3) * 0.18
        + _clamp01(task.time_sensitivity, 0.5) * 0.10
        + _clamp01(task.momentum_value, 0.5) * 0.06
        + effort_weight
        + _deadline_weight(task, now_ms)
    )


def suggest_slot_for_task(
    task: CircuitTask,
    others: list[CircuitTask],
    now_ms: int | None = None,
    energy_level: float = 0.6,
    stress_level: float = 0.3,
    workload_capacity_mins: int = _DAY_CAPACITY_MINS,
) -> dict:
    now_ms = now_ms or int(datetime.now(timezone.utc).timestamp() * 1000)
    rationale: list[str] = []
    duration_ms = (task.duration or 30) * 60_000
    focus = task.focus_type or "shallow"
    open_others = [
        t for t in others
        if t.id != task.id and not t.completed and t.scheduled_at
    ]

    win = task.preferred_execution_window
    if win in ("morning", "afternoon", "evening"):
        candidate = _window_start(win, now_ms)
        rationale.append(f"preferred {win} window")
    elif focus in ("deep", "creative"):
        if energy_level < 0.35:
            candidate = _next_ist_slot(9, now_ms + 86_400_000)
            rationale.append(f"energy low ({int(energy_level * 100)}%) — defer to tomorrow morning")
        else:
            candidate = _next_ist_slot(9, now_ms)
            rationale.append("deep work → morning slot")
    elif focus == "admin":
        candidate = _next_ist_slot(14, now_ms)
        rationale.append("admin task → afternoon slot")
    else:
        candidate = now_ms + 2 * 3_600_000
        rationale.append("next flexible slot")

    if stress_level > 0.65:
        candidate += 30 * 60_000
        rationale.append("30 min buffer (high stress)")

    pattern = task.delay_pattern or ""
    if pattern.startswith("peak-skip:"):
        peak = pattern.split(":", 1)[1]
        bucket = (
            "morning" if _ist_hour(candidate) < 12
            else "afternoon" if _ist_hour(candidate) < 17
            else "evening"
        )
        if bucket == peak:
            candidate += 3 * 3_600_000
            rationale.append(f"moved past {peak} skip pattern")

    for _ in range(8):
        conflict = None
        end = candidate + duration_ms
        for o in open_others:
            o_end = o.scheduled_at + (o.duration or 30) * 60_000
            if candidate < o_end and end > o.scheduled_at:
                conflict = o
                break
        if not conflict:
            break
        if task_conflict_weight(task, now_ms) > task_conflict_weight(conflict, now_ms):
            rationale.append(f"kept slot over lower-priority conflict: {conflict.text}")
            break
        candidate = conflict.scheduled_at + (conflict.duration or 30) * 60_000 + 5 * 60_000
        if len(rationale) < 4:
            rationale.append("moved past conflict")

    duration_mins = task.duration or 30
    for _ in range(7):
        day_load = _day_workload_minutes(candidate, open_others)
        if day_load + duration_mins <= workload_capacity_mins:
            break
        candidate = _next_ist_slot(9 if focus != "admin" else 14, candidate)
        if len(rationale) < 4:
            rationale.append("moved past overloaded day")

    if _is_weekday(candidate) and _ist_hour(candidate) >= _WORKDAY_END:
        candidate = _next_ist_slot(9 if focus != "admin" else 14, candidate)
        rationale.append("after hours — next morning")

    if candidate <= now_ms:
        candidate = now_ms + 3_600_000

    return {"scheduled_at": candidate, "rationale": rationale or ["next available slot"]}
