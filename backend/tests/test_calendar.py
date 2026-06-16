"""ICS import and RRULE expansion tests."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from app.routers.calendar import _first_future_ms, parse_ics

_IST = ZoneInfo("Asia/Kolkata")


def _today_ist() -> datetime:
    return datetime.now(_IST).replace(hour=0, minute=0, second=0, microsecond=0)


def test_weekly_without_byday_not_today():
    """iCloud often exports RRULE:FREQ=WEEKLY with weekday implied by DTSTART."""
    today = _today_ist()
    # Anchor on Monday, years ago
    days_since_mon = today.weekday()
    last_mon = today - timedelta(days=days_since_mon)
    orig = last_mon.replace(hour=9, minute=30) - timedelta(weeks=52)
    dtstart_ms = int(orig.timestamp() * 1000)

    result = _first_future_ms(dtstart_ms, "FREQ=WEEKLY", set())
    assert result is not None

    result_dt = datetime.fromtimestamp(result / 1000, tz=_IST)
    assert result_dt.weekday() == 0  # Monday
    assert result_dt.date() >= today.date()
    if today.weekday() != 0:
        assert result_dt.date() != today.date()


def test_weekly_with_byday_picks_next_matching_day():
    today = _today_ist()
    orig = today.replace(hour=14, minute=0) - timedelta(days=365)
    dtstart_ms = int(orig.timestamp() * 1000)

    result = _first_future_ms(dtstart_ms, "FREQ=WEEKLY;BYDAY=FR", set())
    assert result is not None
    result_dt = datetime.fromtimestamp(result / 1000, tz=_IST)
    assert result_dt.weekday() == 4  # Friday
    assert result_dt.date() >= today.date()


def test_parse_ics_icloud_weekly_master():
    today = _today_ist()
    mon = today - timedelta(days=today.weekday())
    dtstart = (mon - timedelta(weeks=100)).strftime("%Y%m%dT%H%M%S")
    ics = f"""BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Apple Inc.//Mac OS X 10.15//EN
BEGIN:VEVENT
UID:test-weekly-standup
DTSTART;TZID=Asia/Kolkata:{dtstart}
DTEND;TZID=Asia/Kolkata:{dtstart}
RRULE:FREQ=WEEKLY
SUMMARY:Weekly standup
END:VEVENT
END:VCALENDAR
"""
    events = parse_ics(ics)
    assert len(events) == 1
    assert events[0]["rrule"] == "FREQ=WEEKLY"
    first = _first_future_ms(events[0]["scheduled_at"], events[0]["rrule"], set())
    assert first is not None
    first_dt = datetime.fromtimestamp(first / 1000, tz=_IST)
    assert first_dt.weekday() == datetime.strptime(dtstart, "%Y%m%dT%H%M%S").replace(tzinfo=_IST).weekday()
    assert first_dt.date() >= today.date()


def test_parse_ics_one_off_keeps_future_date():
    today = _today_ist()
    future = today + timedelta(days=5)
    ds = future.strftime("%Y%m%d")
    ics = f"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:test-one-off
DTSTART;VALUE=DATE:{ds}
SUMMARY:Dentist
END:VEVENT
END:VCALENDAR
"""
    events = parse_ics(ics)
    assert len(events) == 1
    assert events[0]["rrule"] is None
    ev_dt = datetime.fromtimestamp(events[0]["scheduled_at"] / 1000, tz=_IST)
    assert ev_dt.date() == future.date()


def test_recurrence_id_imports_as_one_off():
    today = _today_ist()
    future = today + timedelta(days=3)
    ds = future.strftime("%Y%m%dT%H%M%S")
    ics = f"""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:test-series
RECURRENCE-ID;TZID=Asia/Kolkata:{ds}
DTSTART;TZID=Asia/Kolkata:{ds}
RRULE:FREQ=WEEKLY;BYDAY=MO
SUMMARY:Moved instance
END:VEVENT
END:VCALENDAR
"""
    events = parse_ics(ics)
    assert len(events) == 1
    assert events[0]["rrule"] is None
