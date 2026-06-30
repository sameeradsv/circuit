"""Blackout catch-up and post-blackout recurrence tests."""
from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.engines.recurrence import (
    first_catch_up_slot_after,
    shifted_rrule,
    shifted_series_pattern,
)
from app.models import Blackout, CircuitTask
from app.services.blackout import adjust_for_blackouts, reschedule_tasks_for_blackout, task_affected_by

_IST = ZoneInfo("Asia/Kolkata")


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def _task(**kwargs) -> SimpleNamespace:
    defaults = {
        "recurrence": None,
        "rrule": None,
        "is_recurring_template": False,
        "rrule_dtstart_ms": None,
        "scheduled_at": None,
        "post_blackout_behavior": "catch_up",
        "blackout_skip_flags": '["travelling"]',
        "tag": "general",
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def _blackout(start: datetime, end: datetime, btype: str = "travelling") -> SimpleNamespace:
    return SimpleNamespace(
        blackout_type=btype,
        start_date_ms=_ms(start),
        end_date_ms=_ms(end),
        is_active=True,
    )


def test_leave_blackout_requires_explicit_skip_flag_not_work_tag():
    sleep = _task(text="Sleep", tag="work", blackout_skip_flags=None)
    assert task_affected_by(sleep, "leave") is False

    flagged = _task(tag="work", blackout_skip_flags='["leave"]')
    assert task_affected_by(flagged, "leave") is True


def test_catch_up_biweekly_saturday_moves_to_next_saturday_not_blackout_end():
    """every:2w on Saturday in blackout → next Saturday, not first day after blackout."""
    sat = datetime(2026, 1, 10, 10, 0, tzinfo=_IST)  # Saturday
    blackout_end = datetime(2026, 1, 14, 23, 59, tzinfo=_IST)  # Wednesday
    after_dt = datetime.fromtimestamp((_ms(blackout_end) + 1) / 1000, tz=_IST)

    slot = first_catch_up_slot_after("every:2w", after_dt, sat)
    assert slot is not None
    assert slot.weekday() == 5  # Saturday
    assert slot.date() == datetime(2026, 1, 17, tzinfo=_IST).date()
    assert slot.date() != datetime(2026, 1, 15, tzinfo=_IST).date()  # not Thu after blackout


def test_adjust_for_blackouts_catch_up_uses_suitable_slot():
    sat = datetime(2026, 1, 10, 10, 0, tzinfo=_IST)
    blackout = _blackout(
        datetime(2026, 1, 8, 0, 0, tzinfo=_IST),
        datetime(2026, 1, 14, 23, 59, tzinfo=_IST),
    )
    task = _task(
        recurrence="every:2w",
        scheduled_at=_ms(sat),
        post_blackout_behavior="catch_up",
    )
    from_dt = sat
    new_ms = adjust_for_blackouts(_ms(sat), task, [blackout], from_dt)
    new_dt = datetime.fromtimestamp(new_ms / 1000, tz=_IST)
    assert new_dt.weekday() == 5
    assert new_dt.date() == datetime(2026, 1, 17, tzinfo=_IST).date()


def test_inactive_blackout_does_not_adjust_occurrence():
    sat = datetime(2026, 1, 10, 10, 0, tzinfo=_IST)
    blackout = _blackout(
        datetime(2026, 1, 8, 0, 0, tzinfo=_IST),
        datetime(2026, 1, 14, 23, 59, tzinfo=_IST),
    )
    blackout.is_active = False
    task = _task(
        recurrence="every:2w",
        scheduled_at=_ms(sat),
        post_blackout_behavior="resume",
    )
    assert adjust_for_blackouts(_ms(sat), task, [blackout], sat) == _ms(sat)


def test_resume_shifts_to_next_suitable_slot():
    """resume is now the next-slot shift behavior, not skip-and-continue."""
    sat = datetime(2026, 1, 10, 10, 0, tzinfo=_IST)
    blackout = _blackout(
        datetime(2026, 1, 8, 0, 0, tzinfo=_IST),
        datetime(2026, 1, 14, 23, 59, tzinfo=_IST),
    )
    task = _task(
        recurrence="every:2w",
        scheduled_at=_ms(sat),
        post_blackout_behavior="resume",
    )
    new_ms = adjust_for_blackouts(_ms(sat), task, [blackout], sat)
    new_dt = datetime.fromtimestamp(new_ms / 1000, tz=_IST)
    assert new_dt.date() == datetime(2026, 1, 17, tzinfo=_IST).date()


def test_one_off_resumes_at_original_time_on_disable_day_when_possible():
    task_dt = datetime(2026, 1, 10, 15, 30, tzinfo=_IST)
    blackout = _blackout(
        datetime(2026, 1, 10, 0, 0, tzinfo=_IST),
        datetime(2026, 1, 10, 10, 0, tzinfo=_IST),
    )
    task = _task(
        recurrence=None,
        scheduled_at=_ms(task_dt),
        post_blackout_behavior="resume",
    )
    new_ms = adjust_for_blackouts(_ms(task_dt), task, [blackout], task_dt)
    new_dt = datetime.fromtimestamp(new_ms / 1000, tz=_IST)
    assert new_dt == task_dt


def test_one_off_resumes_next_day_at_original_time_when_time_has_passed():
    task_dt = datetime(2026, 1, 10, 9, 30, tzinfo=_IST)
    blackout = _blackout(
        datetime(2026, 1, 10, 0, 0, tzinfo=_IST),
        datetime(2026, 1, 10, 10, 0, tzinfo=_IST),
    )
    task = _task(
        recurrence=None,
        scheduled_at=_ms(task_dt),
        post_blackout_behavior="resume",
    )
    new_ms = adjust_for_blackouts(_ms(task_dt), task, [blackout], task_dt)
    new_dt = datetime.fromtimestamp(new_ms / 1000, tz=_IST)
    assert new_dt == datetime(2026, 1, 11, 9, 30, tzinfo=_IST)


def test_shifted_monthly_nth_weekday_pattern_follows_new_series_anchor():
    shifted = datetime(2026, 1, 24, 10, 0, tzinfo=_IST)  # fourth Saturday
    assert shifted_series_pattern("monthly:3SA", shifted) == "monthly:4sa"


def test_shifted_weekly_pattern_keeps_same_weekly_rule():
    shifted = datetime(2026, 1, 24, 10, 0, tzinfo=_IST)
    assert shifted_series_pattern("weekly:SA", shifted) == "weekly:sa"


def test_shifted_monthly_rrule_follows_new_series_anchor():
    shifted = datetime(2026, 1, 24, 10, 0, tzinfo=_IST)  # fourth Saturday
    assert shifted_rrule("FREQ=MONTHLY;BYDAY=SA;BYSETPOS=3", shifted) == "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=4"


def test_catch_up_immediate_uses_day_after_blackout():
    sat = datetime(2026, 1, 10, 10, 0, tzinfo=_IST)
    blackout = _blackout(
        datetime(2026, 1, 8, 0, 0, tzinfo=_IST),
        datetime(2026, 1, 14, 23, 59, tzinfo=_IST),
    )
    task = _task(
        recurrence="every:2w",
        scheduled_at=_ms(sat),
        post_blackout_behavior="catch_up_immediate",
    )
    new_ms = adjust_for_blackouts(_ms(sat), task, [blackout], sat)
    new_dt = datetime.fromtimestamp(new_ms / 1000, tz=_IST)
    assert new_dt.date() == datetime(2026, 1, 15, tzinfo=_IST).date()
    assert new_dt.weekday() != 5


def test_catch_up_imm_shift_uses_day_after_blackout_not_next_saturday():
    sat = datetime(2026, 1, 10, 10, 0, tzinfo=_IST)
    blackout = _blackout(
        datetime(2026, 1, 8, 0, 0, tzinfo=_IST),
        datetime(2026, 1, 14, 23, 59, tzinfo=_IST),
    )
    task = _task(
        recurrence="every:26w",
        scheduled_at=_ms(sat),
        post_blackout_behavior="catch_up_imm_shift",
    )
    new_ms = adjust_for_blackouts(_ms(sat), task, [blackout], sat)
    new_dt = datetime.fromtimestamp(new_ms / 1000, tz=_IST)
    assert new_dt.date() == datetime(2026, 1, 15, tzinfo=_IST).date()
    assert new_dt.weekday() != 5


def test_blackout_reschedule_retains_original_weekday_clock_after_weekend_override():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    friday_ref = datetime(2026, 1, 2, 8, 0, tzinfo=_IST)
    saturday_override = datetime(2026, 1, 3, 10, 0, tzinfo=_IST)
    blackout = Blackout(
        user_id=1,
        blackout_type="travelling",
        start_date_ms=_ms(datetime(2026, 1, 3, 0, 0, tzinfo=_IST)),
        end_date_ms=_ms(datetime(2026, 1, 4, 23, 59, tzinfo=_IST)),
        is_active=True,
    )
    task = CircuitTask(
        user_id=1,
        text="Morning practice",
        scheduled_at=_ms(saturday_override),
        duration=30,
        recurrence="daily",
        post_blackout_behavior="resume",
        blackout_skip_flags='["travelling"]',
        metadata_json=f'{{"recurrence_time_ref_ms": {_ms(friday_ref)}}}',
        day_time_overrides='{"SA": "10:00", "SU": "10:00"}',
    )

    with SessionLocal() as db:
        db.add_all([blackout, task])
        db.commit()
        moved = reschedule_tasks_for_blackout(1, blackout, db)
        db.refresh(task)

    moved_dt = datetime.fromtimestamp(task.scheduled_at / 1000, tz=_IST)
    assert moved == 1
    assert (moved_dt.weekday(), moved_dt.hour, moved_dt.minute) == (0, 8, 0)
