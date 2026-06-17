"""Deterministic delay-pattern and execution-window learning (no ML)."""
from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from app.models import CircuitTask

_IST = ZoneInfo("Asia/Kolkata")


def _hour_bucket(ts_ms: int) -> str:
    h = datetime.fromtimestamp(ts_ms / 1000, tz=_IST).hour
    if h < 12:
        return "morning"
    if h < 17:
        return "afternoon"
    return "evening"


def update_delay_pattern_on_skip(task: CircuitTask, now_ms: int | None = None) -> str | None:
    """Mirror frontend `updateDelayPattern` — peak-skip after repeated skips in same bucket."""
    now_ms = now_ms or int(datetime.now(timezone.utc).timestamp() * 1000)
    bucket = _hour_bucket(now_ms)
    skips = (task.skipped_count or 0) + 1
    if skips < 2:
        return task.delay_pattern
    existing = task.delay_pattern
    if existing == f"peak-skip:{bucket}":
        return existing
    if skips >= 3:
        return f"peak-skip:{bucket}"
    return existing


def learn_preferred_window_on_complete(task: CircuitTask) -> str | None:
    """Set preferred_execution_window from completion hour when not already set."""
    if task.preferred_execution_window or not task.scheduled_at:
        return task.preferred_execution_window
    return _hour_bucket(task.scheduled_at)


def apply_skip_learning(task: CircuitTask, now_ms: int | None = None) -> None:
    task.last_skipped_at = now_ms or int(datetime.now(timezone.utc).timestamp() * 1000)
    task.skipped_count = (task.skipped_count or 0) + 1
    task.delay_pattern = update_delay_pattern_on_skip(task, task.last_skipped_at)


def apply_complete_learning(task: CircuitTask) -> None:
    window = learn_preferred_window_on_complete(task)
    if window:
        task.preferred_execution_window = window
