from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, User
from app.schemas import AnalyticsTaskBrief, AttentionItem, SearchResult, SummaryResponse, TaskSearchItem

_STALE_MS = 3 * 24 * 60 * 60 * 1000

router = APIRouter(prefix="/api", tags=["search"])


@router.get("/search", response_model=SearchResult)
def search_tasks(
    q: str = Query(..., min_length=1, max_length=200),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    term = f"%{q.lower()}%"
    tasks = (
        db.query(CircuitTask)
        .filter(
            CircuitTask.user_id == user.id,
            or_(
                func.lower(CircuitTask.text).like(term),
                func.lower(CircuitTask.tiny_step).like(term),
                func.lower(CircuitTask.tag).like(term),
            ),
        )
        .limit(50)
        .all()
    )
    items = [
        TaskSearchItem(
            id=t.id,
            text=t.text,
            tag=t.tag,
            completed=t.completed,
            urgency=t.urgency,
            importance=t.importance,
            effort=t.effort,
            scheduled_at=t.scheduled_at,
        )
        for t in tasks
    ]
    return SearchResult(query=q, tasks=items, total=len(items))


@router.get("/summary", response_model=SummaryResponse)
def get_summary(user: User = Depends(require_user), db: Session = Depends(get_db)):
    tasks = db.query(CircuitTask).filter(CircuitTask.user_id == user.id).all()
    total = len(tasks)
    open_tasks = [t for t in tasks if not t.completed]
    completed = total - len(open_tasks)
    pending = len(open_tasks)
    total_pending_minutes = sum(t.duration for t in open_tasks)
    avg_skip = sum(t.skipped_count for t in open_tasks) / pending if pending else 0.0
    by_tag: dict[str, int] = {}
    for t in open_tasks:
        by_tag[t.tag] = by_tag.get(t.tag, 0) + 1

    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    most_skipped = sorted(open_tasks, key=lambda t: t.skipped_count or 0, reverse=True)
    most_skipped = [t for t in most_skipped if (t.skipped_count or 0) > 0][:5]

    stale_tasks: list[CircuitTask] = []
    attention_needed: list[AttentionItem] = []
    for t in open_tasks:
        created_ms = int(t.created_at.replace(tzinfo=timezone.utc).timestamp() * 1000)
        age_ms = now_ms - created_ms
        days_open = max(0, age_ms // 86_400_000)
        if age_ms > _STALE_MS:
            stale_tasks.append(t)
            attention_needed.append(
                AttentionItem(
                    message=f'"{t.text}" has been open for {days_open} days — try a tiny step',
                    task_id=t.id,
                )
            )
        elif (t.skipped_count or 0) >= 2:
            attention_needed.append(
                AttentionItem(
                    message=f'"{t.text}" was skipped {t.skipped_count} times',
                    task_id=t.id,
                )
            )

    stale_tasks.sort(key=lambda t: t.created_at)

    return SummaryResponse(
        total_tasks=total,
        completed_tasks=completed,
        pending_tasks=pending,
        completion_rate=round(completed / total, 3) if total else 0.0,
        total_pending_minutes=total_pending_minutes,
        avg_skip_count=round(avg_skip, 2),
        by_tag=by_tag,
        most_skipped=[
            AnalyticsTaskBrief(id=t.id, text=t.text, skipped_count=t.skipped_count or 0)
            for t in most_skipped
        ],
        stale_tasks=[
            AnalyticsTaskBrief(
                id=t.id,
                text=t.text,
                days_open=max(
                    0,
                    (
                        now_ms
                        - int(t.created_at.replace(tzinfo=timezone.utc).timestamp() * 1000)
                    )
                    // 86_400_000,
                ),
            )
            for t in stale_tasks
        ],
        attention_needed=attention_needed,
    )
