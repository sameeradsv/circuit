from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, User, UserState

router = APIRouter(prefix="/api/agent", tags=["agent"])

_IST = ZoneInfo("Asia/Kolkata")

_TOOLS = [
    {
        "name": "get_today_summary",
        "description": (
            "Get a summary of today's tasks: completed count, pending count, overdue count, "
            "total pending minutes, and a breakdown by tag. Also returns the task list."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "get_tasks",
        "description": (
            "List open (non-completed) tasks with optional filters. "
            "Returns task text, tag, effort, duration, scheduled time, cognitive load, focus type, importance, urgency."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "focus_type": {
                    "type": "string",
                    "description": "Filter by focus type: deep, shallow, creative, social, admin",
                },
                "tag": {
                    "type": "string",
                    "description": "Filter by tag, e.g. work, personal, health, social",
                },
                "min_cognitive_load": {
                    "type": "number",
                    "description": "Minimum cognitive load (0.0–1.0). Use 0.6 for 'high cognitive load'.",
                },
                "days_ahead": {
                    "type": "integer",
                    "description": "How many days ahead to include (0 = today only, 7 = this week). Default 7.",
                },
            },
        },
    },
    {
        "name": "get_energy_context",
        "description": "Get the user's current energy level, stress level, and focus mode.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
]


def _now_ist() -> datetime:
    return datetime.now(tz=_IST)


def _today_range_ms() -> tuple[int, int]:
    now = _now_ist()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = now.replace(hour=23, minute=59, second=59, microsecond=999999)
    return int(start.timestamp() * 1000), int(end.timestamp() * 1000)


def _fmt_time(ms: int | None) -> str | None:
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=_IST).strftime("%H:%M")


def _fmt_dt(ms: int | None) -> str | None:
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=_IST).strftime("%Y-%m-%d %H:%M")


def _execute_tool(name: str, inputs: dict[str, Any], db: Session, user_id: int) -> Any:
    if name == "get_today_summary":
        return _tool_today_summary(db, user_id)
    if name == "get_tasks":
        return _tool_get_tasks(db, user_id, inputs)
    if name == "get_energy_context":
        return _tool_energy_context(db, user_id)
    return {"error": f"Unknown tool: {name}"}


def _tool_today_summary(db: Session, user_id: int) -> dict:
    start_ms, end_ms = _today_range_ms()
    now_ms = int(_now_ist().timestamp() * 1000)
    tasks = (
        db.query(CircuitTask)
        .filter(
            CircuitTask.user_id == user_id,
            or_(
                and_(CircuitTask.scheduled_at >= start_ms, CircuitTask.scheduled_at <= end_ms),
                # overnight tasks that started before today but extend into it
                and_(
                    CircuitTask.duration.isnot(None),
                    CircuitTask.scheduled_at < start_ms,
                    CircuitTask.scheduled_at + (CircuitTask.duration * 60_000) > start_ms,
                ),
            ),
        )
        .order_by(CircuitTask.scheduled_at)
        .all()
    )

    completed = [t for t in tasks if t.completed]
    pending = [t for t in tasks if not t.completed]
    overdue = [t for t in pending if t.scheduled_at and t.scheduled_at < now_ms]

    by_tag: dict[str, int] = {}
    for t in pending:
        key = t.tag or "untagged"
        by_tag[key] = by_tag.get(key, 0) + 1

    return {
        "date": _now_ist().strftime("%Y-%m-%d"),
        "completed": len(completed),
        "pending": len(pending),
        "overdue": len(overdue),
        "total_pending_minutes": sum((t.duration or 0) for t in pending),
        "by_tag": by_tag,
        "tasks": [
            {
                "text": t.text,
                "tag": t.tag,
                "effort": t.effort,
                "duration_mins": t.duration,
                "focus_type": t.focus_type,
                "cognitive_load": round(t.cognitive_load or 0, 2),
                "scheduled_at": _fmt_time(t.scheduled_at),
                "completed": t.completed,
                "overdue": bool(t.scheduled_at and t.scheduled_at < now_ms and not t.completed),
            }
            for t in tasks
        ],
    }


def _tool_get_tasks(db: Session, user_id: int, inputs: dict) -> dict:
    days_ahead = int(inputs.get("days_ahead", 7))
    now = _now_ist()
    start_ms = int(now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
    end_ms = int(
        (now + timedelta(days=max(days_ahead, 0)))
        .replace(hour=23, minute=59, second=59, microsecond=0)
        .timestamp() * 1000
    )

    q = (
        db.query(CircuitTask)
        .filter(
            CircuitTask.user_id == user_id,
            CircuitTask.completed.is_(False),
            or_(
                and_(CircuitTask.scheduled_at >= start_ms, CircuitTask.scheduled_at <= end_ms),
                and_(
                    CircuitTask.duration.isnot(None),
                    CircuitTask.scheduled_at < start_ms,
                    CircuitTask.scheduled_at + (CircuitTask.duration * 60_000) > start_ms,
                ),
            ),
        )
    )

    if inputs.get("focus_type"):
        q = q.filter(CircuitTask.focus_type == inputs["focus_type"])
    if inputs.get("tag"):
        q = q.filter(CircuitTask.tag == inputs["tag"])
    if inputs.get("min_cognitive_load") is not None:
        q = q.filter(CircuitTask.cognitive_load >= float(inputs["min_cognitive_load"]))

    tasks = q.order_by(CircuitTask.scheduled_at).limit(50).all()

    return {
        "count": len(tasks),
        "tasks": [
            {
                "id": t.id,
                "text": t.text,
                "tag": t.tag,
                "effort": t.effort,
                "duration_mins": t.duration,
                "focus_type": t.focus_type,
                "cognitive_load": round(t.cognitive_load or 0, 2),
                "importance": round(t.importance or 0, 2),
                "urgency": round(t.urgency or 0, 2),
                "scheduled_at": _fmt_dt(t.scheduled_at),
            }
            for t in tasks
        ],
    }


def _tool_energy_context(db: Session, user_id: int) -> dict:
    state = db.query(UserState).filter(UserState.user_id == user_id).first()
    if not state:
        return {"energy_level": 0.7, "stress_level": 0.3, "focus_mode": "normal"}
    return {
        "energy_level": round(state.energy_level or 0.7, 2),
        "stress_level": round(state.stress_level or 0.3, 2),
        "focus_mode": state.focus_mode or "normal",
    }


def _build_system_prompt() -> str:
    now = _now_ist()
    return f"""You are Circuit's personal scheduling assistant. Circuit is a task management and scheduling app.

Today is {now.strftime("%A, %d %B %Y")}, {now.strftime("%H:%M")} IST.

## What you can help with

- **Day summary**: How busy is today? What's done vs pending?
- **Task queries**: What deep work tasks are scheduled this week? Any high cognitive-load tasks?
- **Energy-based suggestions**: Given the user's energy level, which tasks should be deferred vs done now?
- **Recurrence patterns**: Convert natural language to Circuit's recurrence format.
- **Scheduling advice**: Is today overloaded? What's a good time for a task?

## Recurrence patterns (answer directly — no tool needed)

| Pattern | Meaning |
|---------|---------|
| `daily` | Every day |
| `every:4d` | Every 4 days (`every:Nd`) |
| `every:2w` | Every 2 weeks (`every:Nw`) |
| `every:4h` | Every 4 hours (`every:Nh`) |
| `weekday` | Mon–Fri |
| `weekend` | Sat & Sun |
| `monday` … `sunday` | Every specific weekday |
| `weekly:MO,WE,FR` | Specific days (MO TU WE TH FR SA SU) |
| `monthly:15` | 15th of each month |
| `monthly:1MO` | 1st Monday of the month |
| `monthly:3FR` | 3rd Friday of the month |
| `monthly:LFR` | Last Friday of the month |
| `monthly:LWD` | Last working day (last Mon–Fri) of the month |

Use `every:Nd` / `every:Nw` / `every:Nh` for intervals — e.g. every 4 days → `every:4d`, not `FREQ=DAILY;INTERVAL=4` in the Recurrence field (RRULE is for calendar imports only).

## After-blackout behavior options

| Option | Meaning |
|--------|---------|
| `resume` | Skip missed events and continue the original series at its usual time |
| `catch_up` | Move to the next valid recurrence date after blackout; anchor the series from that date |
| `catch_up_once` | Legacy alias for `resume` |
| `catch_up_immediate` | Move the next event to the first available date after blackout; preserve the original series |
| `catch_up_imm_shift` | Move the next event to the first available date after blackout; re-anchor the series |

## Response style

- Be concise and actionable
- When suggesting task moves, phrase them as commands the user can type, e.g. "push deep work tasks to tomorrow"
- Use markdown for lists and tables
- Energy level 0–1: below 0.4 = low, 0.4–0.7 = moderate, above 0.7 = high
"""


class AgentChatRequest(BaseModel):
    messages: list[dict]


@router.post("/chat")
async def agent_chat(
    req: AgentChatRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    from app.services.circuit_agent import resolve_agent_provider, stream_groq_agent

    provider = resolve_agent_provider()
    system = _build_system_prompt()
    msgs = [
        {"role": m["role"], "content": m["content"]}
        for m in req.messages
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]

    if not provider:
        async def _no_key():
            yield (
                "data: "
                + json.dumps({
                    "error": "No AI provider configured. Set GROQ_API_KEY on the server.",
                })
                + "\n\n"
            )
            yield "data: [DONE]\n\n"
        return StreamingResponse(_no_key(), media_type="text/event-stream")

    async def generate():
        try:
            async for event in stream_groq_agent(
                system=system,
                messages=msgs,
                tools=_TOOLS,
                execute_tool=_execute_tool,
                db=db,
                user_id=user.id,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
