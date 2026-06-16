from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from app.models import CircuitTask, TaskEvent


def ms_to_utc_naive(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).replace(tzinfo=None)


def task_event_occurred_at(
    task: CircuitTask,
    *,
    explicit_ms: Optional[int] = None,
    fallback: Optional[datetime] = None,
) -> datetime:
    """
    When to place a task event on the energy timeline.

    Prefer the user-supplied timestamp, then the task's scheduled time (the
    original calendar slot), then an explicit fallback (usually now).
    """
    if explicit_ms is not None:
        return ms_to_utc_naive(explicit_ms)
    if task.scheduled_at is not None:
        return ms_to_utc_naive(task.scheduled_at)
    return fallback or datetime.now(timezone.utc).replace(tzinfo=None)


def effective_event_time(event: TaskEvent, task: CircuitTask) -> datetime:
    """Read-side mapping: scheduled slot when present, else stored occurred_at."""
    if task.scheduled_at is not None:
        return ms_to_utc_naive(task.scheduled_at)
    return event.occurred_at
