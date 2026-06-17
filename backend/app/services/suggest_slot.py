"""Server-side slot suggestion — port of frontend/lib/suggest-slot.ts (deterministic)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.models import CircuitTask

_IST = ZoneInfo("Asia/Kolkata")
_IST_OFFSET = timedelta(hours=5, minutes=30)
_WORKDAY_END = 19


def _ist_hour(ms: int) -> int:
    return datetime.fromtimestamp(ms / 1000, tz=_IST).hour


def _is_weekday(ms: int) -> bool:
    return datetime.fromtimestamp(ms / 1000, tz=_IST).weekday() < 5


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


def suggest_slot_for_task(
    task: CircuitTask,
    others: list[CircuitTask],
    now_ms: int | None = None,
    energy_level: float = 0.6,
    stress_level: float = 0.3,
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
        candidate = conflict.scheduled_at + (conflict.duration or 30) * 60_000 + 5 * 60_000
        if len(rationale) < 4:
            rationale.append("moved past conflict")

    if _is_weekday(candidate) and _ist_hour(candidate) >= _WORKDAY_END:
        candidate = _next_ist_slot(9 if focus != "admin" else 14, candidate)
        rationale.append("after hours — next morning")

    if candidate <= now_ms:
        candidate = now_ms + 3_600_000

    return {"scheduled_at": candidate, "rationale": rationale or ["next available slot"]}
