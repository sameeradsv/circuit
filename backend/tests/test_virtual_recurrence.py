from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.limiter import limiter
from app.main import app

_IST = ZoneInfo("Asia/Kolkata")


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    old_enabled = limiter.enabled
    limiter.enabled = False
    with TestClient(app) as c:
        yield c
    limiter.enabled = old_enabled
    app.dependency_overrides.clear()


@pytest.fixture()
def auth(client):
    r = client.post("/api/auth/register", json={"username": "virtual", "password": "test1234"})
    assert r.status_code == 201
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _create_recurring(client, auth, text: str, start: datetime, recurrence: str, duration: int = 30):
    r = client.post(
        "/api/tasks",
        json={
            "text": text,
            "scheduled_at": _ms(start),
            "duration": duration,
            "recurrence": recurrence,
        },
        headers=auth,
    )
    assert r.status_code == 201
    return r.json()


def _create_recurring_with_payload(client, auth, payload: dict):
    r = client.post("/api/tasks", json=payload, headers=auth)
    assert r.status_code == 201
    return r.json()


def _range(client, auth, start: datetime, end: datetime, completed: bool | None = None):
    params = {
        "scheduled_from_ms": _ms(start),
        "scheduled_to_ms": _ms(end),
    }
    if completed is not None:
        params["completed"] = str(completed).lower()
    r = client.get("/api/tasks", params=params, headers=auth)
    assert r.status_code == 200
    return r.json()


def test_daily_recurrence_expands_in_visible_range(client, auth):
    start = datetime(2026, 1, 5, 9, 0, tzinfo=_IST)
    _create_recurring(client, auth, "Daily standup", start, "daily")

    items = _range(client, auth, start, start + timedelta(days=3))
    starts = [i["scheduled_at"] for i in items if i["text"] == "Daily standup"]

    assert starts == [_ms(start), _ms(start + timedelta(days=1)), _ms(start + timedelta(days=2)), _ms(start + timedelta(days=3))]
    assert all(str(i["id"]).startswith("r_") for i in items)


def test_weekly_recurrence_expands_matching_days(client, auth):
    start = datetime(2026, 1, 5, 10, 0, tzinfo=_IST)  # Monday
    _create_recurring(client, auth, "MWF practice", start, "weekly:MO,WE,FR")

    items = _range(client, auth, start, start + timedelta(days=7))
    starts = [datetime.fromtimestamp(i["scheduled_at"] / 1000, tz=_IST).weekday() for i in items]

    assert starts[:3] == [0, 2, 4]


def test_monthly_recurrence_expands(client, auth):
    start = datetime(2026, 1, 15, 11, 0, tzinfo=_IST)
    _create_recurring(client, auth, "Monthly review", start, "monthly:15")

    items = _range(client, auth, start, datetime(2026, 3, 16, 0, 0, tzinfo=_IST))
    dates = [datetime.fromtimestamp(i["scheduled_at"] / 1000, tz=_IST).date().isoformat() for i in items]

    assert dates[:3] == ["2026-01-15", "2026-02-15", "2026-03-15"]


def test_skipped_occurrence_is_hidden(client, auth):
    start = datetime(2026, 1, 5, 9, 0, tzinfo=_IST)
    _create_recurring(client, auth, "Daily block", start, "daily")
    item = _range(client, auth, start, start)[0]

    r = client.patch(f"/api/tasks/{item['id']}", json={"skipped_count": 1}, headers=auth)
    assert r.status_code == 200

    items = _range(client, auth, start, start)
    assert [i for i in items if i["text"] == "Daily block"] == []


def test_completed_occurrence_is_an_override(client, auth):
    start = datetime(2026, 1, 5, 9, 0, tzinfo=_IST)
    _create_recurring(client, auth, "Daily completion", start, "daily")
    item = _range(client, auth, start, start)[0]

    r = client.patch(f"/api/tasks/{item['id']}", json={"completed": True}, headers=auth)
    assert r.status_code == 200

    open_items = _range(client, auth, start, start, completed=False)
    done_items = _range(client, auth, start, start, completed=True)
    assert [i for i in open_items if i["text"] == "Daily completion"] == []
    assert done_items[0]["completed"] is True


def test_rescheduled_single_occurrence_moves_only_that_instance(client, auth):
    start = datetime(2026, 1, 5, 9, 0, tzinfo=_IST)
    new_start = datetime(2026, 1, 5, 15, 0, tzinfo=_IST)
    _create_recurring(client, auth, "Daily movable", start, "daily")
    item = _range(client, auth, start, start)[0]

    r = client.patch(f"/api/tasks/{item['id']}", json={"scheduled_at": _ms(new_start)}, headers=auth)
    assert r.status_code == 200

    items = _range(client, auth, start, start + timedelta(days=1))
    movable = [i for i in items if i["text"] == "Daily movable"]
    assert [i["scheduled_at"] for i in movable] == [_ms(new_start), _ms(start + timedelta(days=1))]


def test_scheduler_avoids_virtual_recurring_busy_slot(client, auth):
    now_ist = datetime.now(_IST)
    tomorrow_9 = (now_ist + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    _create_recurring(client, auth, "Daily busy slot", tomorrow_9 - timedelta(days=1), "daily", duration=60)
    task = client.post(
        "/api/tasks",
        json={"text": "Deep work", "focus_type": "deep", "duration": 30},
        headers=auth,
    ).json()

    r = client.get(f"/api/tasks/{task['id']}/suggest-slot", headers=auth)
    assert r.status_code == 200
    suggested = r.json()["scheduled_at"]

    assert not (_ms(tomorrow_9) <= suggested < _ms(tomorrow_9 + timedelta(hours=1)))


def test_expansion_respects_requested_boundary(client, auth):
    start = datetime(2026, 1, 5, 9, 0, tzinfo=_IST)
    _create_recurring(client, auth, "Boundary daily", start, "daily")

    items = _range(client, auth, start + timedelta(days=1), start + timedelta(days=1, hours=23))
    starts = [i["scheduled_at"] for i in items if i["text"] == "Boundary daily"]

    assert starts == [_ms(start + timedelta(days=1))]


def test_existing_materialized_recurrence_rows_do_not_double_expand(client, auth):
    start = datetime(2026, 1, 5, 9, 0, tzinfo=_IST)
    _create_recurring(client, auth, "Legacy daily", start, "daily")
    _create_recurring(client, auth, "Legacy daily", start + timedelta(days=1), "daily")

    items = _range(client, auth, start, start + timedelta(days=2))
    legacy = [i for i in items if i["text"] == "Legacy daily"]

    assert [i["scheduled_at"] for i in legacy] == [
        _ms(start),
        _ms(start + timedelta(days=1)),
        _ms(start + timedelta(days=2)),
    ]


def test_weekend_time_override_does_not_shift_weekday_clock(client, auth):
    friday = datetime(2026, 1, 2, 8, 0, tzinfo=_IST)
    _create_recurring_with_payload(
        client,
        auth,
        {
            "text": "Morning practice",
            "scheduled_at": _ms(friday),
            "duration": 30,
            "recurrence": "daily",
            "day_time_overrides": {"SA": "10:00", "SU": "10:00"},
        },
    )

    items = _range(client, auth, friday, friday + timedelta(days=3))
    starts = [
        datetime.fromtimestamp(i["scheduled_at"] / 1000, tz=_IST)
        for i in items
        if i["text"] == "Morning practice"
    ]

    assert [(dt.weekday(), dt.hour, dt.minute) for dt in starts[:4]] == [
        (4, 8, 0),
        (5, 10, 0),
        (6, 10, 0),
        (0, 8, 0),
    ]


def test_completing_materialized_recurring_slot_hides_that_virtual_occurrence(client, auth):
    start = datetime(2026, 1, 5, 9, 0, tzinfo=_IST)
    task = _create_recurring(client, auth, "Materialized daily", start, "daily")

    r = client.patch(f"/api/tasks/{task['id']}", json={"completed": True}, headers=auth)
    assert r.status_code == 200

    open_items = _range(client, auth, start, start, completed=False)
    assert [i for i in open_items if i["text"] == "Materialized daily"] == []


def test_materialized_completion_keeps_original_weekday_time_after_weekend_override(client, auth):
    saturday = datetime(2026, 1, 3, 10, 0, tzinfo=_IST)
    task = _create_recurring_with_payload(
        client,
        auth,
        {
            "text": "Weekend adjusted daily",
            "scheduled_at": _ms(saturday),
            "duration": 30,
            "recurrence": "daily",
            "metadata": {"recurrence_time_ref_ms": _ms(datetime(2026, 1, 2, 8, 0, tzinfo=_IST))},
            "day_time_overrides": {"SA": "10:00", "SU": "10:00"},
        },
    )

    r = client.patch(f"/api/tasks/{task['id']}", json={"completed": True}, headers=auth)
    assert r.status_code == 200

    tasks = client.get("/api/tasks?completed=false", headers=auth).json()
    created = [i for i in tasks if i["text"] == "Weekend adjusted daily"]
    assert created
    next_dt = datetime.fromtimestamp(created[0]["scheduled_at"] / 1000, tz=_IST)
    assert (next_dt.weekday(), next_dt.hour, next_dt.minute) == (6, 10, 0)

    r = client.patch(f"/api/tasks/{created[0]['id']}", json={"completed": True}, headers=auth)
    assert r.status_code == 200
    tasks = client.get("/api/tasks?completed=false", headers=auth).json()
    created = [i for i in tasks if i["text"] == "Weekend adjusted daily"]
    next_dt = datetime.fromtimestamp(created[0]["scheduled_at"] / 1000, tz=_IST)
    assert (next_dt.weekday(), next_dt.hour, next_dt.minute) == (0, 8, 0)


def test_repeated_virtual_completions_do_not_leave_open_duplicates(client, auth):
    start = datetime(2026, 1, 5, 9, 0, tzinfo=_IST)
    _create_recurring(client, auth, "Daily no dupes", start, "daily")

    for day in range(4):
        window_start = start + timedelta(days=day)
        items = _range(client, auth, window_start, window_start, completed=False)
        matches = [i for i in items if i["text"] == "Daily no dupes"]
        assert len(matches) == 1

        r = client.patch(f"/api/tasks/{matches[0]['id']}", json={"completed": True}, headers=auth)
        assert r.status_code == 200

    items = _range(client, auth, start, start + timedelta(days=5), completed=False)
    starts = [i["scheduled_at"] for i in items if i["text"] == "Daily no dupes"]

    assert len(starts) == len(set(starts))
    assert starts == [_ms(start + timedelta(days=4)), _ms(start + timedelta(days=5))]
