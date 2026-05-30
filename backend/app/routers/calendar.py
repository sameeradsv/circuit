from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, User

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

# ── Google OAuth config ───────────────────────────────────────────────────────

GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI  = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/calendar/google/callback")
FRONTEND_URL         = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
STATE_SECRET         = os.getenv("STATE_SECRET", "circuit-state-secret-change-me")

GOOGLE_AUTH_URL   = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL  = "https://oauth2.googleapis.com/token"
GOOGLE_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
CALENDAR_SCOPE    = "https://www.googleapis.com/auth/calendar.readonly"

# ── State token (HMAC, 10-minute TTL) ────────────────────────────────────────

def _make_state(user_id: int) -> str:
    payload = f"{user_id}:{int(time.time())}"
    sig = hmac.new(STATE_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:20]
    raw = f"{payload}:{sig}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _parse_state(state: str) -> int:
    try:
        padded = state + "=" * (-len(state) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode()).decode()
        uid_str, ts_str, sig = decoded.rsplit(":", 2)
        payload = f"{uid_str}:{ts_str}"
        expected = hmac.new(STATE_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()[:20]
        if not hmac.compare_digest(sig, expected):
            raise ValueError("bad sig")
        if int(time.time()) - int(ts_str) > 600:
            raise ValueError("expired")
        return int(uid_str)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "Invalid or expired state")


# ── Google event parser ───────────────────────────────────────────────────────

def _parse_google_event(ev: dict) -> Optional[dict]:
    summary = (ev.get("summary") or "").strip()
    if not summary or ev.get("status") == "cancelled":
        return None

    start = ev.get("start", {})
    end   = ev.get("end",   {})

    if "dateTime" in start:
        try:
            dt = datetime.fromisoformat(start["dateTime"].replace("Z", "+00:00"))
            start_ms = int(dt.timestamp() * 1000)
        except (ValueError, TypeError):
            return None
    elif "date" in start:
        try:
            dt = datetime.strptime(start["date"], "%Y-%m-%d").replace(hour=9, tzinfo=timezone.utc)
            start_ms = int(dt.timestamp() * 1000)
        except (ValueError, TypeError):
            return None
    else:
        return None

    duration_min = 60
    if "dateTime" in end:
        try:
            end_dt = datetime.fromisoformat(end["dateTime"].replace("Z", "+00:00"))
            end_ms = int(end_dt.timestamp() * 1000)
            duration_min = max(5, (end_ms - start_ms) // 60_000)
        except (ValueError, TypeError):
            pass
    elif "date" in end:
        duration_min = 480  # all-day → 8h

    return {
        "summary":     summary[:500],
        "description": (ev.get("description") or "")[:500],
        "location":    (ev.get("location")    or "")[:200],
        "scheduled_at": start_ms,
        "duration_min": min(duration_min, 720),
    }


def _make_task(user_id: int, ev: dict, client_id: str) -> CircuitTask:
    return CircuitTask(
        user_id=user_id,
        client_id=client_id,
        text=ev["summary"],
        tag="general",
        scheduled_at=ev["scheduled_at"],
        duration=ev["duration_min"],
        tiny_step=ev["description"],
        location_dependency=ev["location"] or None,
        effort="medium",
        urgency=0.5,
        importance=0.5,
        cognitive_load=0.5,
        emotional_resistance=0.5,
        activation_energy=0.5,
        recovery_cost=0.3,
        focus_type="shallow",
        deadline_type="none",
        time_sensitivity=0.5,
        consequence_of_delay=0.3,
        momentum_value=0.5,
        compound_benefit=0.3,
        identity_alignment=0.3,
        historical_completion_rate=0.7,
        energy_to_reward_ratio=0.5,
        task_decomposition_potential=0.3,
        skipped_count=0,
        required_resources=json.dumps([]),
        dependencies=json.dumps([]),
        metadata_json=json.dumps({}),
    )


# ── Google OAuth endpoints ────────────────────────────────────────────────────

@router.get("/google/auth")
def google_auth(user: User = Depends(require_user)):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(501, "Google Calendar not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET")
    state = _make_state(user.id)
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope":         CALENDAR_SCOPE,
        "access_type":   "offline",
        "prompt":        "consent",
        "state":         state,
    }
    return {"url": f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"}


@router.get("/google/callback")
def google_callback(
    code:  str = Query(default=""),
    state: str = Query(default=""),
    error: str = Query(default=""),
    db: Session = Depends(get_db),
):
    dest = f"{FRONTEND_URL}/calendar"

    if error:
        return RedirectResponse(f"{dest}?google_error={urllib.parse.quote(error)}")

    user_id = _parse_state(state)
    user = db.get(User, user_id)
    if not user:
        return RedirectResponse(f"{dest}?google_error=user_not_found")

    # Exchange auth code → access token
    with httpx.Client() as client:
        token_resp = client.post(GOOGLE_TOKEN_URL, data={
            "code":          code,
            "client_id":     GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri":  GOOGLE_REDIRECT_URI,
            "grant_type":    "authorization_code",
        })
    if not token_resp.is_success:
        return RedirectResponse(f"{dest}?google_error=token_exchange_failed")

    access_token = token_resp.json().get("access_token", "")
    if not access_token:
        return RedirectResponse(f"{dest}?google_error=no_access_token")

    # Fetch events: 30 days ago → 180 days ahead
    now = datetime.now(timezone.utc)
    with httpx.Client() as client:
        events_resp = client.get(GOOGLE_EVENTS_URL, params={
            "timeMin":       (now - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "timeMax":       (now + timedelta(days=180)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "singleEvents":  "true",
            "orderBy":       "startTime",
            "maxResults":    500,
        }, headers={"Authorization": f"Bearer {access_token}"})
    if not events_resp.is_success:
        return RedirectResponse(f"{dest}?google_error=fetch_failed")

    items = events_resp.json().get("items", [])
    created = 0

    for ev in items:
        parsed = _parse_google_event(ev)
        if not parsed:
            continue
        cid = f"google:{ev.get('id', '')}"
        if db.query(CircuitTask).filter_by(user_id=user.id, client_id=cid).first():
            continue  # already imported
        db.add(_make_task(user.id, parsed, cid))
        created += 1

    if created:
        db.commit()

    return RedirectResponse(f"{dest}?google_import={created}")


# ── ICS file import ───────────────────────────────────────────────────────────

def _unfold(text: str) -> str:
    return re.sub(r"\r?\n[ \t]", "", text)


def _parse_dt(value: str, is_date_only: bool) -> Optional[int]:
    value = value.strip()
    try:
        if is_date_only or (len(value) == 8 and value.isdigit()):
            d = datetime.strptime(value[:8], "%Y%m%d").replace(hour=9, tzinfo=timezone.utc)
        elif value.endswith("Z"):
            d = datetime.strptime(value[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        else:
            d = datetime.strptime(value[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        return int(d.timestamp() * 1000)
    except Exception:
        return None


def _parse_duration(value: str) -> int:
    total = 0
    for pattern, mult in [("(\\d+)D", 1440), ("(\\d+)H", 60), ("(\\d+)M", 1)]:
        m = re.search(pattern, value)
        if m:
            total += int(m.group(1)) * mult
    return max(total, 15)


def _process_ics_event(ev: dict) -> Optional[dict]:
    summary = ev.get("SUMMARY", "").strip()
    if not summary:
        return None
    dtstart_ms = _parse_dt(ev.get("DTSTART", ""), ev.get("DTSTART_DATE_ONLY", False))
    if dtstart_ms is None:
        return None
    duration_min = 60
    if "DTEND" in ev:
        dtend_ms = _parse_dt(ev["DTEND"], ev.get("DTEND_DATE_ONLY", False))
        if dtend_ms and dtend_ms > dtstart_ms:
            duration_min = max(5, (dtend_ms - dtstart_ms) // 60_000)
    elif "DURATION" in ev:
        duration_min = _parse_duration(ev["DURATION"])
    return {
        "summary":      summary[:500],
        "description":  (ev.get("DESCRIPTION", "").strip() or "")[:500],
        "location":     (ev.get("LOCATION", "").strip()    or "")[:200],
        "scheduled_at": dtstart_ms,
        "duration_min": min(duration_min, 720),
    }


def parse_ics(text: str) -> list[dict]:
    text = _unfold(text)
    events: list[dict] = []
    in_event = False
    current: dict = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line == "BEGIN:VEVENT":
            in_event = True; current = {}; continue
        if line == "END:VEVENT":
            if in_event:
                ev = _process_ics_event(current)
                if ev:
                    events.append(ev)
            in_event = False; current = {}; continue
        if not in_event:
            continue
        colon = line.find(":")
        if colon < 0:
            continue
        name_part = line[:colon].upper()
        value = line[colon + 1:]
        name_base = name_part.split(";")[0]
        is_date_only = "VALUE=DATE" in name_part and "DATE-TIME" not in name_part
        if name_base == "DTSTART":
            current["DTSTART"] = value; current["DTSTART_DATE_ONLY"] = is_date_only
        elif name_base == "DTEND":
            current["DTEND"] = value; current["DTEND_DATE_ONLY"] = is_date_only
        elif name_base in ("SUMMARY", "DESCRIPTION", "DURATION", "LOCATION", "UID"):
            current[name_base] = value
    return events


@router.post("/import")
async def import_ics(
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if file.filename and not file.filename.lower().endswith(".ics"):
        raise HTTPException(400, "File must be a .ics file")
    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    events = parse_ics(text)
    created = 0
    for ev in events:
        db.add(_make_task(user.id, ev, client_id=""))
        created += 1
    if created:
        db.commit()
    return {"imported": created, "total": len(events)}
