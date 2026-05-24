from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, User
from app.schemas import SearchResult, SummaryResponse, TaskSearchItem

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
    completed = sum(1 for t in tasks if t.completed)
    pending = total - completed
    total_pending_minutes = sum(t.duration for t in tasks if not t.completed)
    avg_skip = sum(t.skipped_count for t in tasks) / total if total else 0.0
    by_tag: dict[str, int] = {}
    for t in tasks:
        if not t.completed:
            by_tag[t.tag] = by_tag.get(t.tag, 0) + 1
    return SummaryResponse(
        total_tasks=total,
        completed_tasks=completed,
        pending_tasks=pending,
        completion_rate=round(completed / total, 3) if total else 0.0,
        total_pending_minutes=total_pending_minutes,
        avg_skip_count=round(avg_skip, 2),
        by_tag=by_tag,
    )
