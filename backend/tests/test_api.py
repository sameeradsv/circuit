"""Backend API tests using an in-memory SQLite database."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app

TEST_DB_URL = "sqlite:///:memory:"


@pytest.fixture(scope="module")
def client():
    # StaticPool ensures all connections share the same in-memory database
    engine = create_engine(
        TEST_DB_URL,
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
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture(scope="module")
def auth(client):
    r = client.post("/api/auth/register", json={"username": "tester", "password": "test1234"})
    assert r.status_code == 201
    token = r.json()["token"]
    return {"Authorization": f"Bearer {token}"}


# ── Health ──────────────────────────────────────────────────────────────────


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ── Auth ─────────────────────────────────────────────────────────────────────


def test_register_duplicate(client, auth):
    r = client.post("/api/auth/register", json={"username": "tester", "password": "pass"})
    assert r.status_code == 409


def test_login(client):
    r = client.post("/api/auth/login", json={"username": "tester", "password": "test1234"})
    assert r.status_code == 200
    assert "token" in r.json()


def test_login_wrong_password(client):
    r = client.post("/api/auth/login", json={"username": "tester", "password": "wrong"})
    assert r.status_code == 401


def test_me(client, auth):
    r = client.get("/api/auth/me", headers=auth)
    assert r.status_code == 200
    assert r.json()["username"] == "tester"


# ── Tasks CRUD ───────────────────────────────────────────────────────────────


def test_create_task(client, auth):
    r = client.post("/api/tasks", json={"text": "Write tests", "tag": "work", "urgency": 0.8}, headers=auth)
    assert r.status_code == 201
    data = r.json()
    assert data["text"] == "Write tests"
    assert data["tag"] == "work"


def test_list_tasks(client, auth):
    r = client.get("/api/tasks", headers=auth)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    assert len(r.json()) >= 1


def test_list_tasks_paginated(client, auth):
    r = client.get("/api/tasks?completed=true&page=1&limit=5", headers=auth)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict)
    assert "items" in data
    assert "total" in data
    assert data["page"] == 1
    assert data["limit"] == 5


def test_list_tasks_completed_filter(client, auth):
    r = client.get("/api/tasks?completed=false", headers=auth)
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    assert all(not t["completed"] for t in items)


def test_list_tasks_scheduled_range(client, auth):
    client.post(
        "/api/tasks",
        json={"text": "In range", "scheduled_at": 1_700_000_000_000},
        headers=auth,
    )
    client.post(
        "/api/tasks",
        json={"text": "Out of range", "scheduled_at": 1_800_000_000_000},
        headers=auth,
    )
    client.post("/api/tasks", json={"text": "Unscheduled open"}, headers=auth)

    r = client.get(
        "/api/tasks",
        params={
            "scheduled_from_ms": 1_699_000_000_000,
            "scheduled_to_ms": 1_701_000_000_000,
            "include_unscheduled": True,
        },
        headers=auth,
    )
    assert r.status_code == 200
    texts = {t["text"] for t in r.json()}
    assert "In range" in texts
    assert "Unscheduled open" in texts
    assert "Out of range" not in texts


def test_summary_analytics_fields(client, auth):
    client.post(
        "/api/tasks",
        json={"text": "Skipped a lot", "skipped_count": 3},
        headers=auth,
    )
    r = client.get("/api/summary", headers=auth)
    assert r.status_code == 200
    data = r.json()
    assert "most_skipped" in data
    assert "stale_tasks" in data
    assert "attention_needed" in data
    assert any(item["text"] == "Skipped a lot" for item in data["most_skipped"])


def test_patch_task(client, auth):
    tasks = client.get("/api/tasks", headers=auth).json()
    task_id = tasks[0]["id"]
    r = client.patch(f"/api/tasks/{task_id}", json={"text": "Updated text"}, headers=auth)
    assert r.status_code == 200
    assert r.json()["text"] == "Updated text"


def test_patch_task_json_fields(client, auth):
    tasks = client.get("/api/tasks", headers=auth).json()
    task_id = tasks[0]["id"]
    r = client.patch(
        f"/api/tasks/{task_id}",
        json={"required_resources": ["laptop", "notes"], "dependencies": ["task-abc"]},
        headers=auth,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["required_resources"] == ["laptop", "notes"]
    assert data["dependencies"] == ["task-abc"]


def test_complete_task_logs_event(client, auth):
    tasks = client.get("/api/tasks", headers=auth).json()
    task_id = tasks[0]["id"]
    client.patch(f"/api/tasks/{task_id}", json={"completed": True}, headers=auth)
    r = client.get(f"/api/history/events?task_id={task_id}", headers=auth)
    assert r.status_code == 200
    events = r.json()
    assert any(e["event_type"] == "completed" for e in events)


def test_delete_task(client, auth):
    tasks = client.get("/api/tasks", headers=auth).json()
    task_id = tasks[0]["id"]
    r = client.delete(f"/api/tasks/{task_id}", headers=auth)
    assert r.status_code == 204


# ── Settings ─────────────────────────────────────────────────────────────────


def test_settings_empty(client, auth):
    r = client.get("/api/settings", headers=auth)
    assert r.status_code == 200
    assert "values" in r.json()


def test_settings_upsert(client, auth):
    r = client.put(
        "/api/settings",
        json={"values": {"default_energy_mode": "deep", "daily_capacity_minutes": 360}},
        headers=auth,
    )
    assert r.status_code == 200
    assert r.json()["values"]["default_energy_mode"] == "deep"


def test_settings_get_key(client, auth):
    r = client.get("/api/settings/default_energy_mode", headers=auth)
    assert r.status_code == 200
    assert r.json()["value"] == "deep"


# ── User state ────────────────────────────────────────────────────────────────


def test_user_state_default(client, auth):
    r = client.get("/api/user/state", headers=auth)
    assert r.status_code == 200
    data = r.json()
    assert "energy_level" in data
    assert "focus_mode" in data


def test_user_state_set(client, auth):
    r = client.post(
        "/api/user/state",
        json={"energy_level": 0.4, "stress_level": 0.6, "time_available_minutes": 120, "focus_mode": "low"},
        headers=auth,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["energy_level"] == 0.4
    assert data["focus_mode"] == "low"


# ── Search & summary ─────────────────────────────────────────────────────────


def test_search(client, auth):
    client.post("/api/tasks", json={"text": "Searchable task about writing"}, headers=auth)
    r = client.get("/api/search?q=writing", headers=auth)
    assert r.status_code == 200
    data = r.json()
    assert data["query"] == "writing"
    assert data["total"] >= 1


def test_summary(client, auth):
    r = client.get("/api/summary", headers=auth)
    assert r.status_code == 200
    data = r.json()
    assert "total_tasks" in data
    assert "completion_rate" in data
    assert "most_skipped" in data
    assert "attention_needed" in data


# ── AI classify ───────────────────────────────────────────────────────────────


def test_ai_classify(client, auth):
    r = client.post(
        "/api/ai/classify",
        json={"text": "Urgent: fix critical bug in production today"},
        headers=auth,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["urgency"] >= 0.7
    assert data["effort"] in ("low", "medium", "high")
    assert data["tag"] in ("general", "work", "social", "later")


# ── History events ────────────────────────────────────────────────────────────


def test_log_event(client, auth):
    task = client.post("/api/tasks", json={"text": "Event task"}, headers=auth).json()
    r = client.post(
        "/api/history/events",
        json={"task_id": task["id"], "event_type": "skipped", "metadata": {"reason": "too tired"}},
        headers=auth,
    )
    assert r.status_code == 201
    assert r.json()["event_type"] == "skipped"


def test_list_events(client, auth):
    r = client.get("/api/history/events", headers=auth)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ── Export / import ───────────────────────────────────────────────────────────


def test_export_import_roundtrip(client, auth):
    client.post("/api/tasks", json={"text": "Export me"}, headers=auth)

    r = client.post("/api/sync/export", json={"passphrase": "supersecret1234"}, headers=auth)
    assert r.status_code == 200
    blob = r.json()
    assert blob["format"] == "circuit-encrypted-export"

    # Register second user and import into their account
    r2 = client.post("/api/auth/register", json={"username": "importer", "password": "import123"})
    auth2 = {"Authorization": f"Bearer {r2.json()['token']}"}

    r = client.post(
        "/api/sync/import",
        json={"passphrase": "supersecret1234", "blob": blob},
        headers=auth2,
    )
    assert r.status_code == 200
    assert r.json()["tasks_created"] >= 1


def test_import_wrong_passphrase(client, auth):
    r_export = client.post("/api/sync/export", json={"passphrase": "correct_pass_1"}, headers=auth)
    blob = r_export.json()
    r = client.post(
        "/api/sync/import",
        json={"passphrase": "wrong_pass", "blob": blob},
        headers=auth,
    )
    assert r.status_code == 400


# ── Delete user data ──────────────────────────────────────────────────────────


def test_delete_user_data(client, auth):
    r = client.delete("/api/user/data", headers=auth)
    assert r.status_code == 204
    tasks = client.get("/api/tasks", headers=auth).json()
    assert tasks == []


# ── Sleep from task ───────────────────────────────────────────────────────────


def _sleep_task_times():
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    ist = ZoneInfo("Asia/Kolkata")
    now = datetime.now(ist)
    wake = now.replace(hour=7, minute=0, second=0, microsecond=0)
    if wake > now:
        wake -= timedelta(days=1)
    bedtime = wake - timedelta(hours=8)
    return int(bedtime.timestamp() * 1000), wake.strftime("%Y-%m-%d")


def test_sleep_from_task_default_quality(client, auth):
    bedtime_ms, wake_date = _sleep_task_times()
    client.post(
        "/api/tasks",
        json={"text": "Sleep", "scheduled_at": bedtime_ms, "duration": 480},
        headers=auth,
    )

    r = client.get("/api/sleep/factor", headers=auth)
    assert r.status_code == 200
    data = r.json()
    assert data["has_sleep_log"] is True
    log = data["sleep_log"]
    assert log["source"] == "task"
    assert log["date"] == wake_date
    assert log["quality"] == 7.0
    assert log["quality_is_default"] is True
    assert log["duration_h"] == 8.0
    assert data["sleep_factor"] < 1.0


def test_sleep_quality_override(client, auth):
    bedtime_ms, _ = _sleep_task_times()
    client.post(
        "/api/tasks",
        json={"text": "Sleep", "scheduled_at": bedtime_ms, "duration": 480},
        headers=auth,
    )
    client.post("/api/sleep", json={"quality": 4, "disturbed": True}, headers=auth)

    r = client.get("/api/sleep/factor", headers=auth)
    log = r.json()["sleep_log"]
    assert log["quality"] == 4.0
    assert log["quality_is_default"] is False
    assert log["disturbed"] is True
    assert log["source"] == "mixed"


def test_delete_sleep_override(client, auth):
    client.post("/api/sleep", json={"quality": 5, "notes": "test night"})
    listed = client.get("/api/sleep/overrides", headers=auth).json()
    assert listed["total"] >= 1
    date = listed["items"][0]["date"]

    r = client.delete(f"/api/sleep/{date}", headers=auth)
    assert r.status_code == 204

    listed = client.get("/api/sleep/overrides", headers=auth).json()
    assert all(item["date"] != date for item in listed["items"])

    r = client.delete(f"/api/sleep/{date}", headers=auth)
    assert r.status_code == 404


# ── Task event timing ───────────────────────────────────────────────────────


def test_complete_task_uses_scheduled_at_for_event(client, auth):
    scheduled_ms = 1_700_000_000_000  # fixed epoch ms for deterministic assertion
    task = client.post(
        "/api/tasks",
        json={"text": "Morning standup", "scheduled_at": scheduled_ms},
        headers=auth,
    ).json()
    client.patch(f"/api/tasks/{task['id']}", json={"completed": True}, headers=auth)
    events = client.get(f"/api/history/events?task_id={task['id']}", headers=auth).json()
    completed = next(e for e in events if e["event_type"] == "completed")
    from datetime import datetime, timezone
    expected = datetime.fromtimestamp(scheduled_ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    assert completed["occurred_at"] == expected


def test_complete_task_updates_completion_rate(client, auth):
    task = client.post(
        "/api/tasks",
        json={"text": "Habit task", "historical_completion_rate": 0.7},
        headers=auth,
    ).json()
    assert task["historical_completion_rate"] == 0.7

    updated = client.patch(
        f"/api/tasks/{task['id']}",
        json={"completed": True},
        headers=auth,
    ).json()
    assert abs(updated["historical_completion_rate"] - 0.79) < 1e-9


def test_energy_timeline_uses_scheduled_at(client, auth):
    scheduled_ms = 1_700_000_000_000
    task = client.post(
        "/api/tasks",
        json={"text": "Deep work block", "scheduled_at": scheduled_ms},
        headers=auth,
    ).json()
    client.patch(f"/api/tasks/{task['id']}", json={"completed": True}, headers=auth)

    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo
    ist = ZoneInfo("Asia/Kolkata")
    target_date = datetime.fromtimestamp(scheduled_ms / 1000, tz=timezone.utc).astimezone(ist).date().isoformat()

    r = client.get(f"/api/energy/timeline?date={target_date}", headers=auth)
    assert r.status_code == 200
    events = r.json()["events"]
    assert any("Deep work block" in e["note"] for e in events)
    expected_time = datetime.fromtimestamp(scheduled_ms / 1000, tz=timezone.utc).astimezone(ist).strftime("%H:%M")
    match = next(e for e in events if "Deep work block" in e["note"])
    assert match["time"] == expected_time

