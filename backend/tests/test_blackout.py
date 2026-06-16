"""Blackout catch-up and post-blackout recurrence tests."""
from __future__ import annotations

from datetime import datetime, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.engines.recurrence import (
    first_catch_up_slot_after,
    skip_occurrences_too_close_after_catchup,
)
from app.services.blackout import adjust_for_blackouts

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
    )


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


def test_skip_sat_after_catch_up_fri_for_weekly_wed_sat():
    """Wed+Sat series: Wed catch-up on Fri → skip Sat, keep Wed."""
    anchor = datetime(2026, 1, 7, 10, 0, tzinfo=_IST)   # Wed (original slot)
    catch_up = datetime(2026, 1, 9, 10, 0, tzinfo=_IST)  # Fri (after blackout)
    sat_next = datetime(2026, 1, 10, 10, 0, tzinfo=_IST)  # Sat from anchor series
    wed_after = datetime(2026, 1, 14, 10, 0, tzinfo=_IST)  # next Wed

    skipped = skip_occurrences_too_close_after_catchup(
        "weekly:WE,SA",
        _ms(sat_next),
        _ms(catch_up),
        _ms(anchor),
        min_gap_days=2,
    )
    result = datetime.fromtimestamp(skipped / 1000, tz=_IST)
    assert result.weekday() == 2  # Wednesday
    assert result.date() == wed_after.date()


def test_resume_still_skips_to_next_series_tick():
    """resume on every:2w skips the missed Saturday to the next biweekly tick."""
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
    assert new_dt.date() == datetime(2026, 1, 24, tzinfo=_IST).date()


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
