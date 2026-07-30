from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.database import Base, get_db
from app.limiter import limiter
from app.main import app
from app.models import CircuitTask, PushSubscription, Reminder, TaskEvent
from app.services.auto_complete import auto_complete_due_no_reminder_tasks
from app.services.push import PushGoneError
from app.services.reminders import materialize_reminders_for_user, process_due_reminders


def _ms(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


@pytest.fixture()
def client():
    from app.routers import notifications

    notifications._last_process_materialized_at = None
    notifications._db_outage_until = None
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
    notifications._last_process_materialized_at = None
    notifications._db_outage_until = None
    limiter.enabled = old_enabled
    app.dependency_overrides.clear()


@pytest.fixture()
def auth(client):
    r = client.post("/api/auth/register", json={"username": "push", "password": "test1234"})
    assert r.status_code == 201
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_subscribe_device_upserts_push_subscription(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "vapid_public_key", "public")
    r = client.post(
        "/api/notifications/subscribe",
        json={
            "endpoint": "https://push.example/device-1",
            "keys": {"p256dh": "key", "auth": "auth"},
            "device_name": "Laptop",
            "platform": "Windows",
        },
        headers=auth,
    )

    assert r.status_code == 201
    with client.testing_session() as db:
        rows = db.query(PushSubscription).all()
        assert len(rows) == 1
        assert rows[0].enabled is True
        assert rows[0].device_name == "Laptop"


def test_subscribe_device_disables_stale_matching_endpoint(client, auth):
    first = client.post(
        "/api/notifications/subscribe",
        json={
            "endpoint": "https://push.example/device-old",
            "keys": {"p256dh": "old", "auth": "old"},
            "device_name": "Laptop",
            "platform": "Windows",
        },
        headers=auth,
    )
    second = client.post(
        "/api/notifications/subscribe",
        json={
            "endpoint": "https://push.example/device-new",
            "keys": {"p256dh": "new", "auth": "new"},
            "device_name": "Laptop",
            "platform": "Windows",
        },
        headers=auth,
    )

    assert first.status_code == 201
    assert second.status_code == 201
    with client.testing_session() as db:
        rows = {
            row.endpoint: row.enabled
            for row in db.query(PushSubscription).order_by(PushSubscription.endpoint).all()
        }

    assert rows["https://push.example/device-old"] is False
    assert rows["https://push.example/device-new"] is True


def test_materialize_reminders_for_upcoming_task(client, auth):
    now = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)
    task_time = now + timedelta(minutes=30)
    task = client.post(
        "/api/tasks",
        json={
            "text": "Prepare standup",
            "scheduled_at": _ms(task_time),
            "notification_offset_1_mins": 10,
            "notification_offset_2_mins": 0,
        },
        headers=auth,
    ).json()

    with client.testing_session() as db:
        created = materialize_reminders_for_user(db, 1, now=now.replace(tzinfo=None), horizon_days=1)
        db.commit()
        rows = db.query(Reminder).filter(Reminder.task_id == task["id"]).order_by(Reminder.remind_at.asc()).all()

    assert created >= 0
    assert [row.remind_at for row in rows] == [
        (task_time - timedelta(minutes=10)).replace(tzinfo=None),
        task_time.replace(tzinfo=None),
    ]
    assert all(row.status == "pending" for row in rows)


def test_null_reminder_offsets_do_not_materialize_reminders(client, auth):
    now = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc)
    task_time = now + timedelta(minutes=30)
    task = client.post(
        "/api/tasks",
        json={
            "text": "No reminder focus block",
            "scheduled_at": _ms(task_time),
            "notification_offset_1_mins": None,
            "notification_offset_2_mins": None,
        },
        headers=auth,
    ).json()

    with client.testing_session() as db:
        created = materialize_reminders_for_user(db, 1, now=now.replace(tzinfo=None), horizon_days=1)
        db.commit()
        rows = db.query(Reminder).filter(Reminder.task_id == task["id"]).all()

    assert created == 0
    assert rows == []


def test_process_due_reminder_sends_to_all_devices(client, auth, monkeypatch):
    now = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc).replace(tzinfo=None)
    task = client.post(
        "/api/tasks",
        json={"text": "Call supplier", "scheduled_at": _ms(now.replace(tzinfo=timezone.utc)), "notification_offset_1_mins": 0},
        headers=auth,
    ).json()
    sent: list[dict] = []

    def fake_send(sub, payload):
        sent.append({"endpoint": sub.endpoint, "payload": payload})
        assert payload["taskId"] == task["id"]

    monkeypatch.setattr("app.services.reminders.send_web_push", fake_send)
    with client.testing_session() as db:
        db.add(PushSubscription(user_id=1, endpoint="https://push.example/a", p256dh="a", auth="a"))
        db.add(PushSubscription(user_id=1, endpoint="https://push.example/b", p256dh="b", auth="b"))
        materialize_reminders_for_user(db, 1, now=now, horizon_days=1)
        stats = process_due_reminders(db, now=now + timedelta(seconds=1))
        row = db.query(Reminder).filter(Reminder.task_id == task["id"]).one()

    assert stats["sent"] == 1
    assert sorted(item["endpoint"] for item in sent) == ["https://push.example/a", "https://push.example/b"]
    assert sent[0]["payload"]["title"] == "Call supplier"
    assert sent[0]["payload"]["body"] == "1:30 PM IST · imp 50% · urg 50% · delay 35% · drain 35%"
    assert row.status == "sent"
    assert row.sent_at is not None


def test_auto_complete_due_no_reminder_task_logs_energy_event(client, auth):
    now = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)
    scheduled = now - timedelta(minutes=45)
    task = client.post(
        "/api/tasks",
        json={
            "text": "Auto complete focus block",
            "scheduled_at": _ms(scheduled),
            "duration": 30,
            "notifications_enabled": False,
            "cognitive_load": 0.8,
            "energy_to_reward_ratio": 0.1,
        },
        headers=auth,
    ).json()

    with client.testing_session() as db:
        stats = auto_complete_due_no_reminder_tasks(db, now=now.replace(tzinfo=None))
        db.commit()
        updated = db.get(CircuitTask, task["id"])
        event = db.query(TaskEvent).filter(TaskEvent.task_id == task["id"], TaskEvent.event_type == "completed").one()

    completion_time = scheduled + timedelta(minutes=30)
    assert stats["auto_completed_count"] == 1
    assert updated is not None and updated.completed is True
    assert event.occurred_at == completion_time.replace(tzinfo=None)
    metadata = event.metadata_json
    assert "auto_no_reminder" in metadata

    from zoneinfo import ZoneInfo

    target_date = completion_time.astimezone(ZoneInfo("Asia/Kolkata")).date().isoformat()
    r = client.get(f"/api/energy/timeline?date={target_date}", headers=auth)
    assert r.status_code == 200
    assert any("Auto complete focus block" in e["note"] for e in r.json()["events"])


def test_auto_complete_keeps_reminder_enabled_task_open(client, auth):
    now = datetime(2026, 1, 1, 9, 0, tzinfo=timezone.utc)
    scheduled = now - timedelta(hours=2)
    task = client.post(
        "/api/tasks",
        json={
            "text": "Manual reminder task",
            "scheduled_at": _ms(scheduled),
            "duration": 30,
            "notification_offset_1_mins": 10,
        },
        headers=auth,
    ).json()

    with client.testing_session() as db:
        stats = auto_complete_due_no_reminder_tasks(db, now=now.replace(tzinfo=None))
        db.commit()
        updated = db.get(CircuitTask, task["id"])
        events = db.query(TaskEvent).filter(TaskEvent.task_id == task["id"]).all()

    assert stats["auto_completed_count"] == 0
    assert stats["auto_complete_skipped_with_reminders_count"] == 1
    assert updated is not None and updated.completed is False
    assert events == []


def test_cron_materialization_processes_due_reminders(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "cron_secret", "secret")
    now = datetime.now(timezone.utc)
    task = client.post(
        "/api/tasks",
        json={
            "text": "Leave for appointment",
            "scheduled_at": _ms(now - timedelta(seconds=1)),
            "notification_offset_1_mins": 0,
        },
        headers=auth,
    ).json()
    sent: list[int] = []

    def fake_send(_sub, payload):
        sent.append(payload["taskId"])

    monkeypatch.setattr("app.services.reminders.send_web_push", fake_send)
    with client.testing_session() as db:
        db.add(PushSubscription(user_id=1, endpoint="https://push.example/cron", p256dh="a", auth="a"))
        db.commit()

    response = client.post("/api/cron/materialize-occurrences", headers={"Authorization": "Bearer secret"})

    assert response.status_code == 200
    body = response.json()
    assert body["claimed"] == 1
    assert body["sent"] == 1
    assert sent == [task["id"]]
    with client.testing_session() as db:
        reminder = db.query(Reminder).filter(Reminder.task_id == task["id"]).one()
        assert reminder.status == "sent"


def test_notification_process_throttles_materialization(client, monkeypatch):
    from app.routers import notifications

    monkeypatch.setattr(settings, "reminder_cron_secret", "secret")
    monkeypatch.setattr(settings, "reminder_process_materialize_interval_minutes", 30)
    notifications._last_process_materialized_at = None
    notifications._db_outage_until = None
    calls = {"materialize": 0, "process": 0}

    def fake_materialize(_db):
        calls["materialize"] += 1
        return 2

    def fake_process(_db):
        calls["process"] += 1
        return {"claimed": 0, "sent": 0, "failed": 0, "cancelled": 0, "subscriptions_disabled": 0}

    monkeypatch.setattr(notifications, "materialize_reminders_for_enabled_push_users", fake_materialize)
    monkeypatch.setattr(notifications, "process_due_reminders", fake_process)

    first = client.post("/api/notifications/process", headers={"Authorization": "Bearer secret"})
    second = client.post("/api/notifications/process", headers={"Authorization": "Bearer secret"})

    assert first.status_code == 200
    assert first.json()["materialized"] == 2
    assert first.json()["materialization_skipped"] is False
    assert second.status_code == 200
    assert second.json()["materialized"] == 0
    assert second.json()["materialization_skipped"] is True
    assert calls == {"materialize": 1, "process": 2}


def test_notification_process_skips_claiming_before_next_due(client, monkeypatch):
    from app.routers import notifications

    monkeypatch.setattr(settings, "reminder_cron_secret", "secret")
    monkeypatch.setattr(settings, "reminder_process_materialize_interval_minutes", 30)
    monkeypatch.setattr(settings, "reminder_process_lookahead_seconds", 75)
    notifications._last_process_materialized_at = datetime.now(timezone.utc).replace(tzinfo=None)
    notifications._db_outage_until = None
    calls = {"process": 0}

    def fake_next_due(_db, *, now=None):
        return now + timedelta(minutes=10)

    def fake_process(_db):
        calls["process"] += 1
        return {"claimed": 0, "sent": 0, "failed": 0, "cancelled": 0, "subscriptions_disabled": 0}

    monkeypatch.setattr(notifications, "next_pending_reminder_at", fake_next_due)
    monkeypatch.setattr(notifications, "process_due_reminders", fake_process)

    response = client.post("/api/notifications/process", headers={"Authorization": "Bearer secret"})

    assert response.status_code == 200
    data = response.json()
    assert data["processing_skipped"] is True
    assert data["seconds_until_next_due"] >= 500
    assert calls == {"process": 0}


def test_cron_auto_completes_due_no_reminder_tasks(client, auth, monkeypatch):
    monkeypatch.setattr(settings, "cron_secret", "secret")
    now = datetime.now(timezone.utc)
    task = client.post(
        "/api/tasks",
        json={
            "text": "Cron completes this",
            "scheduled_at": _ms(now - timedelta(minutes=10)),
            "duration": 5,
            "notification_offset_1_mins": None,
            "notification_offset_2_mins": None,
        },
        headers=auth,
    ).json()

    response = client.post("/api/cron/materialize-occurrences", headers={"Authorization": "Bearer secret"})

    assert response.status_code == 200
    body = response.json()
    assert body["auto_completed_count"] == 1
    with client.testing_session() as db:
        updated = db.get(CircuitTask, task["id"])
        event = db.query(TaskEvent).filter(TaskEvent.task_id == task["id"], TaskEvent.event_type == "completed").one()
    assert updated is not None and updated.completed is True
    assert "auto_no_reminder" in event.metadata_json


def test_process_due_reminder_disables_invalid_subscription(client, auth, monkeypatch):
    now = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc).replace(tzinfo=None)
    client.post(
        "/api/tasks",
        json={"text": "Journal", "scheduled_at": _ms(now.replace(tzinfo=timezone.utc)), "notification_offset_1_mins": 0},
        headers=auth,
    )

    def fake_send(_sub, _payload):
        raise PushGoneError("gone")

    monkeypatch.setattr("app.services.reminders.send_web_push", fake_send)
    with client.testing_session() as db:
        db.add(PushSubscription(user_id=1, endpoint="https://push.example/gone", p256dh="a", auth="a"))
        materialize_reminders_for_user(db, 1, now=now, horizon_days=1)
        stats = process_due_reminders(db, now=now + timedelta(seconds=1))
        sub = db.query(PushSubscription).one()
        reminder = db.query(Reminder).one()

    assert stats["subscriptions_disabled"] == 1
    assert sub.enabled is False
    assert reminder.status == "failed"
