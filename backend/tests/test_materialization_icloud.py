from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import Base, get_db
from app.limiter import limiter
from app.main import app
from app.models import CalendarSyncLedger, CircuitTask, MaterializedOccurrence, OccurrenceOverride
from app.services import icloud_calendar
from app.services.icloud_calendar import CalendarEvent, DesiredEvent, _vevent, sync_icloud_calendar
from app.services.virtual_recurrence import materialize_occurrences_for_user, sync_recurring_definition

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
        c.testing_session = TestingSessionLocal
        yield c
    limiter.enabled = old_enabled
    app.dependency_overrides.clear()


@pytest.fixture()
def auth(client):
    r = client.post("/api/auth/register", json={"username": "icloud", "password": "test1234"})
    assert r.status_code == 201
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _create_recurring(db, *, start: datetime, recurrence: str = "daily") -> CircuitTask:
    task = CircuitTask(user_id=1, text="Morning plan", scheduled_at=_ms(start), duration=30, recurrence=recurrence)
    db.add(task)
    db.flush()
    sync_recurring_definition(db, task)
    db.flush()
    return task


def test_materialization_window_stores_through_later_of_month_or_seven_days(client, auth):
    now = datetime(2026, 1, 20, 9, 0, tzinfo=_IST)
    with client.testing_session() as db:
        _create_recurring(db, start=now)
        stats = materialize_occurrences_for_user(db, 1, now=now)
        rows = db.query(MaterializedOccurrence).order_by(MaterializedOccurrence.occurrence_start_ms).all()

    assert stats["created"] == 12
    assert rows[0].occurrence_start_ms == _ms(datetime(2026, 1, 20, 9, 0, tzinfo=_IST))
    assert rows[-1].occurrence_start_ms == _ms(datetime(2026, 1, 31, 9, 0, tzinfo=_IST))
    assert all(row.occurrence_start_ms < _ms(datetime(2026, 2, 1, 0, 0, tzinfo=_IST)) for row in rows)


def test_completed_occurrence_override_is_preserved_when_materializing(client, auth):
    now = datetime(2026, 1, 20, 9, 0, tzinfo=_IST)
    with client.testing_session() as db:
        task = _create_recurring(db, start=now)
        recurring = sync_recurring_definition(db, task)
        db.add(OccurrenceOverride(
            user_id=1,
            recurring_task_id=recurring.id,
            occurrence_start_ms=_ms(now + timedelta(days=1)),
            status="completed",
        ))
        materialize_occurrences_for_user(db, 1, now=now)
        override = db.query(OccurrenceOverride).one()
        materialized_starts = {row.occurrence_start_ms for row in db.query(MaterializedOccurrence).all()}

    assert override.status == "completed"
    assert _ms(now + timedelta(days=1)) not in materialized_starts


def test_recurrence_change_prunes_only_future_pending_generated_occurrences(client, auth):
    now = datetime(2026, 1, 20, 9, 0, tzinfo=_IST)
    with client.testing_session() as db:
        task = _create_recurring(db, start=now)
        materialize_occurrences_for_user(db, 1, now=now)
        task.recurrence = "weekly:MO,WE,FR"
        task.scheduled_at = _ms(datetime(2026, 1, 21, 18, 0, tzinfo=_IST))
        sync_recurring_definition(db, task)
        materialize_occurrences_for_user(db, 1, now=now)
        starts = {row.scheduled_start_ms for row in db.query(MaterializedOccurrence).all()}

    assert _ms(datetime(2026, 1, 21, 9, 0, tzinfo=_IST)) not in starts
    assert _ms(datetime(2026, 1, 21, 18, 0, tzinfo=_IST)) in starts
    assert _ms(datetime(2026, 1, 23, 18, 0, tzinfo=_IST)) in starts


def test_icloud_vevent_is_one_off_without_rrule():
    event = DesiredEvent(
        task_id=42,
        occurrence_id=7,
        occurrence_key="1767229200000",
        uid="circuit-42-1767229200000",
        title="Write review",
        start_ms=_ms(datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)),
        end_ms=_ms(datetime(2026, 1, 1, 10, 0, tzinfo=timezone.utc)),
        completed=False,
    )
    ics = _vevent(event)

    assert "UID:circuit-42-1767229200000" in ics
    assert "RRULE" not in ics
    assert "Managed by Circuit" in ics
    assert "taskId: 42" in ics


class FakeCalDAVClient:
    events: dict[str, CalendarEvent] = {}
    puts: list[str] = []
    deletes: list[str] = []

    def __init__(self):
        pass

    def close(self):
        pass

    def discover_circuit_calendar(self):
        return "https://cal.example/Circuit/"

    def read_events(self, _calendar_url, _from_ms, _to_ms):
        return list(self.events.values())

    def put_event(self, calendar_url, event, href=None, etag=None):
        data = _vevent(event)
        target = href or f"{calendar_url}{event.uid}.ics"
        self.events[target] = CalendarEvent(target, '"2"', event.uid, data)
        self.puts.append(event.uid)
        return target, '"2"'

    def delete_event(self, href, etag=None):
        self.deletes.append(href)
        self.events.pop(href, None)


def test_icloud_sync_is_idempotent_and_recovers_ledger_by_uid(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "icloud_apple_id", "apple@example.com")
    monkeypatch.setattr(settings, "icloud_app_specific_password", "pw")
    monkeypatch.setattr(settings, "icloud_caldav_base_url", "https://cal.example/")
    monkeypatch.setattr(icloud_calendar, "CalDAVClient", FakeCalDAVClient)
    FakeCalDAVClient.events = {}
    FakeCalDAVClient.puts = []
    FakeCalDAVClient.deletes = []
    now = datetime(2026, 1, 20, 9, 0, tzinfo=_IST)
    with client.testing_session() as db:
        _create_recurring(db, start=now)
        first = sync_icloud_calendar(db, now=now)
        db.commit()
        db.query(CalendarSyncLedger).update({"calendar_href": None})
        db.commit()
        second = sync_icloud_calendar(db, now=now)
        ledgers = db.query(CalendarSyncLedger).all()

    assert first["calendar_created_count"] > 0
    assert second["calendar_created_count"] == 0
    assert second["skipped_count"] > 0
    assert len(FakeCalDAVClient.events) == len(ledgers)
    assert all(row.calendar_href for row in ledgers)


def test_calendar_cleanup_only_deletes_app_owned_window_events(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "icloud_apple_id", "apple@example.com")
    monkeypatch.setattr(settings, "icloud_app_specific_password", "pw")
    monkeypatch.setattr(settings, "icloud_caldav_base_url", "https://cal.example/")
    monkeypatch.setattr(icloud_calendar, "CalDAVClient", FakeCalDAVClient)
    FakeCalDAVClient.events = {
        "https://cal.example/Circuit/orphan.ics": CalendarEvent(
            "https://cal.example/Circuit/orphan.ics", '"1"', "circuit-99-old", "BEGIN:VEVENT\nUID:circuit-99-old\nDTSTART:20260120T090000Z\nDESCRIPTION:Managed by Circuit\nEND:VEVENT"
        ),
        "https://cal.example/Circuit/manual.ics": CalendarEvent(
            "https://cal.example/Circuit/manual.ics", '"1"', "manual", "BEGIN:VEVENT\nUID:manual\nDTSTART:20260120T090000Z\nSUMMARY:Manual\nEND:VEVENT"
        ),
    }
    FakeCalDAVClient.puts = []
    FakeCalDAVClient.deletes = []

    with client.testing_session() as db:
        stats = sync_icloud_calendar(db, now=datetime(2026, 1, 20, 9, 0, tzinfo=_IST))

    assert stats["deleted_count"] == 1
    assert "https://cal.example/Circuit/orphan.ics" in FakeCalDAVClient.deletes
    assert "https://cal.example/Circuit/manual.ics" in FakeCalDAVClient.events


def test_past_completed_calendar_events_are_never_deleted(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "icloud_apple_id", "apple@example.com")
    monkeypatch.setattr(settings, "icloud_app_specific_password", "pw")
    monkeypatch.setattr(settings, "icloud_caldav_base_url", "https://cal.example/")
    monkeypatch.setattr(icloud_calendar, "CalDAVClient", FakeCalDAVClient)
    FakeCalDAVClient.events = {
        "https://cal.example/Circuit/past.ics": CalendarEvent(
            "https://cal.example/Circuit/past.ics",
            '"1"',
            "circuit-99-past",
            "BEGIN:VEVENT\nUID:circuit-99-past\nDTSTART:20260119T090000Z\nSUMMARY:\\u2705 Old\nDESCRIPTION:Managed by Circuit\nEND:VEVENT",
        ),
    }
    FakeCalDAVClient.deletes = []

    with client.testing_session() as db:
        stats = sync_icloud_calendar(db, now=datetime(2026, 1, 20, 9, 0, tzinfo=_IST))

    assert stats["deleted_count"] == 0
    assert FakeCalDAVClient.deletes == []
    assert "https://cal.example/Circuit/past.ics" in FakeCalDAVClient.events
