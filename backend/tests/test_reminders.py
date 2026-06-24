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
from app.models import PushSubscription, Reminder
from app.services.push import PushGoneError
from app.services.reminders import materialize_reminders_for_user, process_due_reminders


def _ms(dt: datetime) -> int:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
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


def test_process_due_reminder_sends_to_all_devices(client, auth, monkeypatch):
    now = datetime(2026, 1, 1, 8, 0, tzinfo=timezone.utc).replace(tzinfo=None)
    task = client.post(
        "/api/tasks",
        json={"text": "Call supplier", "scheduled_at": _ms(now.replace(tzinfo=timezone.utc)), "notification_offset_1_mins": 0},
        headers=auth,
    ).json()
    sent: list[str] = []

    def fake_send(sub, payload):
        sent.append(sub.endpoint)
        assert payload["taskId"] == task["id"]

    monkeypatch.setattr("app.services.reminders.send_web_push", fake_send)
    with client.testing_session() as db:
        db.add(PushSubscription(user_id=1, endpoint="https://push.example/a", p256dh="a", auth="a"))
        db.add(PushSubscription(user_id=1, endpoint="https://push.example/b", p256dh="b", auth="b"))
        materialize_reminders_for_user(db, 1, now=now, horizon_days=1)
        stats = process_due_reminders(db, now=now + timedelta(seconds=1))
        row = db.query(Reminder).filter(Reminder.task_id == task["id"]).one()

    assert stats["sent"] == 1
    assert sorted(sent) == ["https://push.example/a", "https://push.example/b"]
    assert row.status == "sent"
    assert row.sent_at is not None


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
