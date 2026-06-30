from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.services.suggest_slot import suggest_slot_for_task

_IST = ZoneInfo("Asia/Kolkata")


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _task(**kwargs) -> SimpleNamespace:
    defaults = {
        "id": 1,
        "text": "Task",
        "completed": False,
        "scheduled_at": None,
        "duration": 30,
        "focus_type": "shallow",
        "preferred_execution_window": None,
        "delay_pattern": None,
        "deadline_type": "none",
        "effort": "medium",
        "importance": 0.5,
        "urgency": 0.5,
        "consequence_of_delay": 0.3,
        "time_sensitivity": 0.5,
        "momentum_value": 0.5,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_suggest_slot_moves_past_overloaded_day():
    now = _ms(datetime(2026, 1, 5, 16, 0, tzinfo=_IST))
    candidate_task = _task(id=1, text="Long focus block", duration=120)
    existing = [
        _task(
            id=2,
            text="Already full day",
            scheduled_at=_ms(datetime(2026, 1, 5, 9, 0, tzinfo=_IST)),
            duration=420,
        )
    ]

    suggestion = suggest_slot_for_task(candidate_task, existing, now_ms=now)
    suggested_dt = datetime.fromtimestamp(suggestion["scheduled_at"] / 1000, tz=_IST)

    assert suggested_dt.date() == datetime(2026, 1, 6, tzinfo=_IST).date()
    assert "moved past overloaded day" in suggestion["rationale"]
