"""Deterministic scheduling predictions (Phase 6) — no LLM."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models import CircuitTask, TaskEvent


def compute_scheduling_insights(db: Session, user_id: int) -> list[dict[str, str]]:
    tasks = db.query(CircuitTask).filter(CircuitTask.user_id == user_id).all()
    open_tasks = [t for t in tasks if not t.completed]
    if not open_tasks:
        return []

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    insights: list[dict[str, str]] = []

    pending_mins = sum(t.duration or 0 for t in open_tasks)
    if pending_mins > 480:
        insights.append({
            "type": "prediction",
            "message": (
                f"Backlog is ~{pending_mins // 60}h of scheduled work — "
                "defer or shorten low-priority tasks to avoid overload."
            ),
        })

    overdue = [t for t in open_tasks if t.scheduled_at and t.scheduled_at < now_ms]
    if len(overdue) >= 3:
        insights.append({
            "type": "prediction",
            "message": f"{len(overdue)} tasks are past their scheduled slot — batch-reschedule or complete the smallest first.",
        })

    heavy = [t for t in open_tasks if (t.cognitive_load or 0) >= 0.7]
    if len(heavy) >= 2 and pending_mins > 240:
        insights.append({
            "type": "prediction",
            "message": f"{len(heavy)} high cognitive-load tasks open — pair with a low-energy block before deep work.",
        })

    # Completion velocity from last 7 days
    week_ago_dt = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=7)
    recent_done = (
        db.query(TaskEvent)
        .filter(
            TaskEvent.user_id == user_id,
            TaskEvent.event_type == "completed",
            TaskEvent.occurred_at >= week_ago_dt,
        )
        .count()
    )
    if recent_done < 3 and len(open_tasks) > 8:
        insights.append({
            "type": "prediction",
            "message": "Completion pace is slow this week — protect one 25-minute focus block today.",
        })
    elif recent_done >= 10 and pending_mins < 180:
        insights.append({
            "type": "prediction",
            "message": "Strong completion week — good window to schedule one ambitious task.",
        })

    high_skip = [t for t in open_tasks if (t.skipped_count or 0) >= 2]
    if high_skip:
        t = max(high_skip, key=lambda x: x.skipped_count or 0)
        insights.append({
            "type": "prediction",
            "message": f'"{t.text}" keeps getting skipped — try a tiny step or reschedule out of peak hours.',
        })

    return insights[:5]
