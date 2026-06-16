"""Recurrence pattern engine tests."""
from __future__ import annotations

from datetime import datetime

from app.engines.recurrence import is_hourly_recurrence, next_occurrence


def test_every_4_days():
    base = datetime(2026, 6, 17, 10, 0)
    nxt = next_occurrence("every:4d", base)
    assert nxt == datetime(2026, 6, 21, 10, 0)


def test_every_2_weeks():
    base = datetime(2026, 6, 17, 9, 30)
    nxt = next_occurrence("every:2w", base)
    assert nxt == datetime(2026, 7, 1, 9, 30)


def test_every_4_hours():
    base = datetime(2026, 6, 17, 10, 0)
    nxt = next_occurrence("every:4h", base)
    assert nxt == datetime(2026, 6, 17, 14, 0)


def test_daily_still_works():
    base = datetime(2026, 6, 17, 10, 0)
    nxt = next_occurrence("daily", base)
    assert nxt == datetime(2026, 6, 18, 10, 0)


def test_rrule_interval_not_accepted_as_recurrence():
    base = datetime(2026, 6, 17, 10, 0)
    assert next_occurrence("FREQ=DAILY;INTERVAL=4", base) is None


def test_invalid_interval():
    base = datetime(2026, 6, 17, 10, 0)
    assert next_occurrence("every:0d", base) is None
    assert next_occurrence("every:abc", base) is None


def test_is_hourly_recurrence():
    assert is_hourly_recurrence("every:2h")
    assert not is_hourly_recurrence("every:2d")
    assert not is_hourly_recurrence("daily")
