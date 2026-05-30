from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, User

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


# ── ICS parser ────────────────────────────────────────────────────────────────

def _unfold(text: str) -> str:
    """Remove ICS line folding (CRLF/LF followed by space or tab)."""
    return re.sub(r"\r?\n[ \t]", "", text)


def _parse_dt(value: str, is_date_only: bool) -> Optional[int]:
    """Return epoch milliseconds from an ICS DTSTART/DTEND value."""
    value = value.strip()
    try:
        if is_date_only or (len(value) == 8 and value.isdigit()):
            d = datetime.strptime(value[:8], "%Y%m%d").replace(hour=9, tzinfo=timezone.utc)
        elif value.endswith("Z"):
            d = datetime.strptime(value[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        else:
            # Local/timezone-annotated — treat as UTC
            d = datetime.strptime(value[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        return int(d.timestamp() * 1000)
    except Exception:
        return None


def _parse_duration(value: str) -> int:
    """Parse a DURATION string (e.g. PT1H30M, P1D) into minutes."""
    total = 0
    m = re.search(r"(\d+)D", value)
    if m:
        total += int(m.group(1)) * 24 * 60
    m = re.search(r"(\d+)H", value)
    if m:
        total += int(m.group(1)) * 60
    m = re.search(r"(\d+)M", value)
    if m:
        total += int(m.group(1))
    return max(total, 15)


def _process_event(ev: dict) -> Optional[dict]:
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
        "summary": summary[:500],
        "description": (ev.get("DESCRIPTION", "").strip() or "")[:500],
        "location": (ev.get("LOCATION", "").strip() or "")[:200],
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
            in_event = True
            current = {}
            continue
        if line == "END:VEVENT":
            if in_event:
                ev = _process_event(current)
                if ev:
                    events.append(ev)
            in_event = False
            current = {}
            continue

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
            current["DTSTART"] = value
            current["DTSTART_DATE_ONLY"] = is_date_only
        elif name_base == "DTEND":
            current["DTEND"] = value
            current["DTEND_DATE_ONLY"] = is_date_only
        elif name_base in ("SUMMARY", "DESCRIPTION", "DURATION", "LOCATION", "UID"):
            current[name_base] = value


    return events


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/import")
async def import_ics(
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if file.filename and not file.filename.lower().endswith(".ics"):
        raise HTTPException(status_code=400, detail="File must be a .ics file")

    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    events = parse_ics(text)
    created = 0

    for ev in events:
        task = CircuitTask(
            user_id=user.id,
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
        db.add(task)
        created += 1

    if created:
        db.commit()

    return {"imported": created, "total": len(events)}
