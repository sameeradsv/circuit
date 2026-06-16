from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

_IST = ZoneInfo("Asia/Kolkata")

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps.auth import require_user
from app.models import CircuitTask, User

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

_RRULE_HORIZON_DAYS = 730  # 2 years
_RRULE_MAX = 730


def _rrule_to_recurrence(rrule_str: str) -> Optional[str]:
    """Convert a raw RRULE string to Circuit's internal recurrence pattern."""
    parts: dict[str, str] = {}
    for seg in rrule_str.upper().split(";"):
        if "=" in seg:
            k, v = seg.split("=", 1)
            parts[k] = v

    freq     = parts.get("FREQ", "")
    interval = int(parts.get("INTERVAL", "1"))
    byday    = parts.get("BYDAY", "")

    if freq == "DAILY" and interval == 1:
        return "daily"

    if freq == "WEEKLY":
        day_order = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
        if byday:
            days = {d.strip()[-2:] for d in byday.split(",")}
            days_sorted = [d for d in day_order if d in days]
            if days == {"MO", "TU", "WE", "TH", "FR"}:
                return "weekday"
            if days == {"SA", "SU"}:
                return "weekend"
            return f"weekly:{','.join(days_sorted)}"
        return "weekly:MO"

    if freq == "MONTHLY":
        if byday:
            token = byday.split(",")[0].strip()
            m = re.match(r"^(-?\d+|L)([A-Z]{2})$", token)
            if m:
                n, wd = m.group(1), m.group(2)
                if n == "-1":
                    n = "L"
                return f"monthly:{n}{wd}"
        return "monthly:1"

    return None


def _detect_recurrence(title: str, description: str) -> Optional[str]:
    """Detect recurrence pattern from keywords in the event title/description."""
    text = f"{title} {description}".lower()

    # Nth weekday of month (e.g. "1st Monday", "last Friday")
    _day_codes = {"monday": "MO", "tuesday": "TU", "wednesday": "WE", "thursday": "TH",
                  "friday": "FR", "saturday": "SA", "sunday": "SU"}
    _nth = [
        (r"\b(?:1st|first)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", "1"),
        (r"\b(?:2nd|second)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", "2"),
        (r"\b(?:3rd|third)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", "3"),
        (r"\b(?:4th|fourth)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", "4"),
        (r"\blast\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", "L"),
    ]
    for pattern_re, n in _nth:
        m = re.search(pattern_re, text)
        if m:
            return f"monthly:{n}{_day_codes[m.group(1)]}"

    if any(k in text for k in ("monthly", "every month", "each month")):
        return "monthly:1"

    if any(k in text for k in ("daily", "every day", "each day")):
        return "daily"

    if any(k in text for k in ("weekday", "work day", "working day")):
        return "weekday"

    if "weekend" in text:
        return "weekend"

    # Detect specific days mentioned (supports multi-day: "monday & thursday")
    _day_order = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
    found = [code for name, code in _day_codes.items() if name in text]
    found_sorted = [d for d in _day_order if d in found]
    if found_sorted:
        return f"weekly:{','.join(found_sorted)}"

    if any(k in text for k in ("weekly", "every week", "each week")):
        return "weekly:MO"

    return None


def _parse_rrule_parts(rrule_str: str) -> dict[str, str]:
    parts: dict[str, str] = {}
    for seg in rrule_str.upper().split(";"):
        if "=" in seg:
            k, v = seg.split("=", 1)
            parts[k.strip()] = v.strip()
    return parts


def _with_orig_time(orig: datetime, dt: datetime) -> datetime:
    return dt.replace(
        hour=orig.hour, minute=orig.minute, second=orig.second,
        microsecond=0, tzinfo=timezone.utc,
    )


def _nth_weekday_in_month(
    year: int, month: int, nth: int, weekday: int, orig_start: datetime,
) -> Optional[datetime]:
    """nth 1–4 = 1st..4th weekday of month; -1 = last."""
    if nth == -1:
        if month == 12:
            nm_y, nm_m = year + 1, 1
        else:
            nm_y, nm_m = year, month + 1
        last = datetime(nm_y, nm_m, 1, tzinfo=timezone.utc) - timedelta(days=1)
        d = last
        while d.weekday() != weekday:
            d -= timedelta(days=1)
        return _with_orig_time(orig_start, d)
    count = 0
    d = datetime(year, month, 1, tzinfo=timezone.utc)
    while d.month == month:
        if d.weekday() == weekday:
            count += 1
            if count == nth:
                return _with_orig_time(orig_start, d)
        d += timedelta(days=1)
    return None


def _snap_start_to_cutoff(orig_start: datetime, parts: dict[str, str], cutoff: datetime) -> datetime:
    """Advance a series anchor to the first tick on or after cutoff matching the RRULE."""
    if cutoff <= orig_start:
        return orig_start

    freq = parts.get("FREQ", "")
    interval = max(1, int(parts.get("INTERVAL", "1")))
    day_map = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}

    if freq == "DAILY":
        delta = (cutoff.date() - orig_start.date()).days
        steps = max(0, delta // interval)
        candidate = orig_start + timedelta(days=steps * interval)
        if candidate < cutoff:
            candidate += timedelta(days=interval)
        return candidate

    if freq == "WEEKLY":
        weekly_days: list[int] = []
        if "BYDAY" in parts:
            for token in parts["BYDAY"].split(","):
                token = token.strip()
                if re.match(r"^(-?\d+|L)[A-Z]{2}$", token):
                    continue
                wd = day_map.get(token[-2:], -1)
                if wd >= 0:
                    weekly_days.append(wd)
        if weekly_days:
            return _with_orig_time(
                orig_start,
                cutoff.replace(hour=0, minute=0, second=0, microsecond=0),
            )
        # FREQ=WEEKLY without BYDAY — repeat on DTSTART's weekday (common iCloud export).
        candidate = _with_orig_time(orig_start, cutoff)
        days_ahead = (orig_start.weekday() - candidate.weekday()) % 7
        candidate = candidate + timedelta(days=days_ahead)
        if candidate < cutoff:
            candidate += timedelta(weeks=interval)
        return candidate

    if freq == "MONTHLY":
        monthday = int(parts["BYMONTHDAY"].split(",")[0]) if "BYMONTHDAY" in parts else orig_start.day
        monthly_spec: Optional[tuple[int, int]] = None
        if "BYDAY" in parts:
            token = parts["BYDAY"].split(",")[0].strip()
            m = re.match(r"^(-?\d+|L)([A-Z]{2})$", token)
            if m:
                nth = -1 if m.group(1) in ("L", "-1") else int(m.group(1))
                wd = day_map.get(m.group(2), -1)
                if wd >= 0:
                    monthly_spec = (nth, wd)

        y, m = cutoff.year, cutoff.month
        for _ in range(240):
            if monthly_spec:
                nth, wd = monthly_spec
                candidate = _nth_weekday_in_month(y, m, nth, wd, orig_start)
            else:
                try:
                    candidate = orig_start.replace(year=y, month=m, day=monthday)
                except ValueError:
                    candidate = None
            if candidate and candidate >= cutoff:
                return candidate
            m += interval
            while m > 12:
                m -= 12
                y += 1
        return cutoff

    if freq == "YEARLY":
        y = cutoff.year
        for _ in range(100):
            try:
                candidate = orig_start.replace(year=y)
            except ValueError:
                y += interval
                continue
            if candidate >= cutoff:
                return candidate
            y += interval
        return cutoff

    return cutoff


def _first_future_ms(dtstart_ms: int, rrule_str: str, exdate_set: set) -> Optional[int]:
    """Return the first RRULE occurrence on or after today (IST), preserving the original time-of-day.
    Returns None if the series has no future occurrences."""
    orig_dt = datetime.fromtimestamp(dtstart_ms / 1000, tz=_IST)
    today_ist = datetime.now(_IST).replace(hour=0, minute=0, second=0, microsecond=0)
    today_ms = int(today_ist.astimezone(timezone.utc).timestamp() * 1000)

    # For weekly patterns, precompute expected IST weekdays.
    # _expand_rrule uses UTC-based weekday arithmetic. Because midnight IST = 18:30 UTC
    # of the previous calendar day, a "Monday" candidate in UTC is actually Tuesday in
    # IST. Validating the IST weekday here filters out those off-by-one-day artefacts.
    _day_map = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
    expected_ist_wds: Optional[set] = None
    _parts = _parse_rrule_parts(rrule_str)
    if _parts.get("FREQ") == "WEEKLY" and "BYDAY" in _parts:
        wds = {
            _day_map[t.strip()[-2:]] for t in _parts["BYDAY"].split(",")
            if t.strip()[-2:] in _day_map and not re.match(r"^(-?\d+|L)[A-Z]{2}$", t.strip())
        }
        if wds:
            expected_ist_wds = wds

    candidates = _expand_rrule(dtstart_ms, rrule_str, exdate_set, cutoff_ms=today_ms)
    for raw_ts in candidates:
        raw_dt = datetime.fromtimestamp(raw_ts / 1000, tz=_IST)
        if raw_dt.date() < today_ist.date():
            continue
        if expected_ist_wds is not None and raw_dt.weekday() not in expected_ist_wds:
            continue
        # Apply original time-of-day (IST) so the template reflects the real event time
        corrected = raw_dt.replace(
            hour=orig_dt.hour, minute=orig_dt.minute,
            second=orig_dt.second, microsecond=0,
        )
        return int(corrected.timestamp() * 1000)
    return None


def _make_task(user_id: int, ev: dict, client_id: str) -> CircuitTask:
    importance, urgency = _calname_to_priority(ev.get("cal_name", ""))
    # Priority: emoji circle in title > event color property > keyword default
    effort = (
        _emoji_to_effort(ev.get("summary", ""))
        or _color_to_effort(ev.get("color", ""))
    )
    tag, focus_type = _classify_event(ev.get("summary", ""), ev.get("description", ""))
    rrule = ev.get("rrule")
    recurrence = (
        (_rrule_to_recurrence(rrule) if rrule else None)
        or _detect_recurrence(ev.get("summary", ""), ev.get("description", ""))
    )
    # rrule_dtstart_ms may be pre-set to the original DTSTART by the importer
    # (when scheduled_at has been advanced to the first future occurrence)
    rrule_dtstart = ev.get("rrule_dtstart_ms", ev["scheduled_at"]) if rrule else None
    return CircuitTask(
        user_id=user_id,
        client_id=client_id,
        text=ev["summary"],
        tag=tag,
        scheduled_at=ev["scheduled_at"],
        duration=ev["duration_min"],
        tiny_step=ev["description"],
        location_dependency=ev["location"] or None,
        effort=effort,
        urgency=urgency,
        importance=importance,
        cognitive_load=0.5,
        emotional_resistance=0.5,
        activation_energy=0.5,
        recovery_cost=0.3,
        focus_type=focus_type,
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
        recurrence=recurrence,
        rrule=rrule,
        rrule_dtstart_ms=rrule_dtstart,
        is_recurring_template=bool(rrule),
    )


# ── ICS parsing ───────────────────────────────────────────────────────────────

def _unfold(text: str) -> str:
    return re.sub(r"\r?\n[ \t]", "", text)


def _parse_dt(value: str, is_date_only: bool, tzid: Optional[str] = None) -> Optional[int]:
    value = value.strip()
    try:
        if is_date_only or (len(value) == 8 and value.isdigit()):
            tz = _IST
            if tzid:
                try:
                    tz = ZoneInfo(tzid)
                except (ZoneInfoNotFoundError, KeyError):
                    pass
            d = datetime.strptime(value[:8], "%Y%m%d").replace(hour=0, tzinfo=tz)
        elif value.endswith("Z"):
            d = datetime.strptime(value[:15], "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
        else:
            tz = _IST
            if tzid:
                try:
                    tz = ZoneInfo(tzid)
                except (ZoneInfoNotFoundError, KeyError):
                    pass
            d = datetime.strptime(value[:15], "%Y%m%dT%H%M%S").replace(tzinfo=tz)
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


def _expand_rrule(dtstart_ms: int, rrule_str: str, exdate_set: set[int], cutoff_ms: Optional[int] = None) -> list[int]:
    """Expand RRULE into a list of occurrence timestamps (ms) from cutoff to horizon (now + 2yr).
    Generates only occurrences within [cutoff, horizon] to avoid wasting cycles on ancient events."""
    # orig_start preserves the event's original time-of-day (UTC) for use in candidate placement.
    # start is the iteration anchor and may be advanced to cutoff — but the time-of-day must not
    # change: midnight-IST cutoffs land at 18:30 UTC, which would shift weekly candidates by 5:30h
    # and land them on the wrong IST weekday.
    orig_start = datetime.fromtimestamp(dtstart_ms / 1000, tz=timezone.utc)
    start = orig_start
    now = datetime.now(timezone.utc)
    horizon = now + timedelta(days=_RRULE_HORIZON_DAYS)

    parts = _parse_rrule_parts(rrule_str)

    # If a cutoff is set, skip to the cutoff time instead of starting from ancient DTSTART
    # This is critical: a series from 2020 with a daily recurrence would generate thousands
    # of occurrences between 2020 and now; we only want those from cutoff onward.
    if cutoff_ms:
        cutoff_dt = datetime.fromtimestamp(cutoff_ms / 1000, tz=timezone.utc)
        if cutoff_dt > start:
            start = _snap_start_to_cutoff(orig_start, parts, cutoff_dt)

    freq = parts.get("FREQ", "")
    interval = max(1, int(parts.get("INTERVAL", "1")))
    count_max = int(parts.get("COUNT", "0")) or _RRULE_MAX

    until: Optional[datetime] = None
    if "UNTIL" in parts:
        ts = _parse_dt(parts["UNTIL"], False)
        if ts:
            until = datetime.fromtimestamp(ts / 1000, tz=timezone.utc)

    day_map = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
    byday: list[int] = []
    if "BYDAY" in parts and freq == "WEEKLY":
        for token in parts["BYDAY"].split(","):
            wd = day_map.get(token.strip()[-2:], -1)
            if wd >= 0 and wd not in byday:
                byday.append(wd)
        byday.sort()

    results: list[int] = []
    current = start
    count = 0

    while count < count_max and current <= horizon:
        if until and current > until:
            break

        if freq == "WEEKLY" and byday:
            # Expand all matching weekdays within this anchor week
            week_mon = current - timedelta(days=current.weekday())
            past_horizon = False
            for wd in byday:
                candidate = (week_mon + timedelta(days=wd)).replace(
                    hour=orig_start.hour, minute=orig_start.minute, second=orig_start.second,
                    microsecond=0, tzinfo=timezone.utc,
                )
                if candidate < start:
                    continue
                if until and candidate > until:
                    continue
                if candidate > horizon:
                    past_horizon = True
                    break
                ts_ms = int(candidate.timestamp() * 1000)
                if ts_ms not in exdate_set:
                    results.append(ts_ms)
                count += 1
                if count >= count_max:
                    break
            if past_horizon:
                break
            current += timedelta(weeks=interval)
        else:
            ts_ms = int(current.timestamp() * 1000)
            if ts_ms not in exdate_set:
                results.append(ts_ms)
            count += 1

            if freq == "DAILY":
                current += timedelta(days=interval)
            elif freq == "WEEKLY":
                current += timedelta(weeks=interval)
            elif freq == "MONTHLY":
                m = current.month - 1 + interval
                y = current.year + m // 12
                m = m % 12 + 1
                try:
                    current = current.replace(year=y, month=m)
                except ValueError:
                    break
            elif freq == "YEARLY":
                try:
                    current = current.replace(year=current.year + interval)
                except ValueError:
                    break
            else:
                break

    results.sort()
    return results


def _calname_to_priority(calname: str) -> tuple[float, float]:
    """Map calendar name to (importance, urgency). Detects p1/p2/p3 and high/medium/low patterns."""
    name = calname.lower()
    if any(k in name for k in ("p1", "high", "critical", "urgent", "must", "top")):
        return (0.9, 0.9)
    if any(k in name for k in ("p2", "medium", "important", "should", "moderate", "normal")):
        return (0.7, 0.6)
    if any(k in name for k in ("p3", "low", "minor", "could", "nice", "later", "someday")):
        return (0.4, 0.3)
    return (0.5, 0.5)


_CIRCLE_EFFORT: dict[str, str] = {
    "\U0001F7E2": "low",     # 🟢 green
    "\U0001F7E1": "medium",  # 🟡 yellow
    "\U0001F534": "high",    # 🔴 red
    "\U0001F7E0": "high",    # 🟠 orange
    "\U0001F535": "medium",  # 🔵 blue
    "\U0001F7E3": "medium",  # 🟣 purple
    "\U0001F7E4": "medium",  # 🟤 brown
    "⚪":     "low",     # ⚪ white
    "⚫":     "medium",  # ⚫ black
}


def _emoji_to_effort(text: str) -> Optional[str]:
    """Detect coloured circle emoji anywhere in the event title and map to effort."""
    for char, effort in _CIRCLE_EFFORT.items():
        if char in text:
            return effort
    return None


def _color_to_effort(color: str) -> str:
    """Map iCloud event color name or hex to effort level."""
    color = color.lower().strip()
    if color in {"red", "tomato", "pink", "flamingo", "coral", "crimson"}:
        return "high"
    if color in {"green", "sage", "basil", "teal", "lime", "mint", "emerald"}:
        return "low"
    if color.startswith("#") and len(color) in (7, 4):
        try:
            if len(color) == 4:
                r, g, b = int(color[1] * 2, 16), int(color[2] * 2, 16), int(color[3] * 2, 16)
            else:
                r, g, b = int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)
            if r > g + 50 and r > b + 50 and r > 150:
                return "high"
            if g > r + 30 and g > b and g > 120:
                return "low"
        except ValueError:
            pass
    return "medium"


def _classify_event(title: str, description: str) -> tuple[str, str]:
    """Return (tag, focus_type) by scanning event title and description for keywords."""
    text = f"{title} {description}".lower()

    social = (
        "meet", "meeting", "call", "zoom", "teams", "meet", "sync", "stand-up", "standup",
        "1:1", "one on one", "one-on-one", "interview", "discuss", "discussion",
        "presentation", "demo", "webinar", "workshop", "lunch", "dinner", "coffee",
        "social", "party", "celebration", "catch up", "catchup", "check-in", "checkin",
        "review with", "session with",
    )
    deep = (
        "write", "writing", "code", "coding", "develop", "development", "design",
        "build", "building", "research", "draft", "drafting", "implement", "create",
        "focus", "strategy", "architecture", "analysis", "analyse", "analyze",
        "deep work", "sprint", "feature", "prototype", "brainstorm",
    )
    admin = (
        "email", "emails", "inbox", "admin", "invoice", "invoicing", "expense",
        "expenses", "report", "filing", "paperwork", "respond", "reply",
        "follow up", "follow-up", "followup", "planning", "organise", "organize",
        "schedule", "checklist", "triage", "process",
    )
    personal = (
        "gym", "exercise", "workout", "yoga", "run", "running", "walk", "cycling",
        "doctor", "dentist", "appointment", "errand", "grocery", "groceries",
        "shopping", "bank", "pharmacy", "personal", "health", "medical", "haircut",
        "commute", "travel", "flight", "hotel",
    )

    if any(k in text for k in social):
        return ("social", "shallow")
    if any(k in text for k in deep):
        return ("work", "deep")
    if any(k in text for k in admin):
        return ("work", "admin")
    if any(k in text for k in personal):
        return ("personal", "shallow")
    return ("work", "shallow")


def _extract_series_uid(client_id: str) -> Optional[str]:
    """Extract UID from a recurring client_id like 'ics:{uid}:{ts_ms}'.
    Uses rfind on the last colon so it handles UIDs that contain colons.
    Returns None if the client_id is not a recurring-series entry."""
    if not client_id or not client_id.startswith("ics:"):
        return None
    inner = client_id[4:]  # strip leading "ics:"
    last_colon = inner.rfind(":")
    if last_colon < 0:
        return None
    suffix = inner[last_colon + 1:]
    if not suffix.isdigit() or len(suffix) < 10:
        return None
    return inner[:last_colon]


def _client_id(uid: str, suffix: str = "") -> str:
    key = f"{uid}{suffix}"
    if len(key) <= 90:
        return f"ics:{key}"
    return f"ics:{hashlib.md5(key.encode()).hexdigest()}"


def _process_ics_event(ev: dict) -> Optional[dict]:
    summary = ev.get("SUMMARY", "").strip()
    if not summary:
        return None
    dtstart_ms = _parse_dt(ev.get("DTSTART", ""), ev.get("DTSTART_DATE_ONLY", False), ev.get("DTSTART_TZID"))
    if dtstart_ms is None:
        return None
    duration_min = 60
    if "DTEND" in ev:
        dtend_ms = _parse_dt(ev["DTEND"], ev.get("DTEND_DATE_ONLY", False), ev.get("DTEND_TZID"))
        if dtend_ms and dtend_ms > dtstart_ms:
            duration_min = max(5, (dtend_ms - dtstart_ms) // 60_000)
    elif "DURATION" in ev:
        duration_min = _parse_duration(ev["DURATION"])
    rrule = ev.get("RRULE")
    # Detached instances (RECURRENCE-ID) are one-offs, not series masters — even if RRULE present.
    if ev.get("RECURRENCE_ID"):
        rrule = None
    return {
        "summary":      summary[:500],
        "description":  (ev.get("DESCRIPTION", "").strip() or "")[:500],
        "location":     (ev.get("LOCATION", "").strip()    or "")[:100],
        "scheduled_at": dtstart_ms,
        "duration_min": min(duration_min, 720),
        "rrule":        rrule,
        "exdates":      ev.get("EXDATES", []),
        "uid":          ev.get("UID", ""),
        "cal_name":     ev.get("CAL_NAME", ""),
        "color":        ev.get("COLOR", ev.get("X_APPLE_EVENT_COLOR", "")),
    }


def parse_ics(text: str) -> list[dict]:
    text = _unfold(text)
    events: list[dict] = []
    in_event = False
    current: dict = {}
    cal_name: str = ""
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line == "BEGIN:VEVENT":
            in_event = True; current = {}; continue
        if line == "END:VEVENT":
            if in_event:
                current["CAL_NAME"] = cal_name
                ev = _process_ics_event(current)
                if ev:
                    events.append(ev)
            in_event = False; current = {}; continue
        colon = line.find(":")
        if colon < 0:
            continue
        name_part_raw = line[:colon]        # original case — needed for TZID value
        name_part = name_part_raw.upper()   # uppercase for comparisons
        value = line[colon + 1:]
        name_base = name_part.split(";")[0]
        is_date_only = "VALUE=DATE" in name_part and "DATE-TIME" not in name_part

        # Extract TZID parameter preserving case (e.g. "Asia/Kolkata")
        tzid: Optional[str] = None
        for param in name_part_raw.split(";")[1:]:
            if param.upper().startswith("TZID="):
                tzid = param[5:]
                break

        if not in_event:
            if name_base == "X-WR-CALNAME":
                cal_name = value.strip()
            continue

        if name_base == "DTSTART":
            current["DTSTART"] = value
            current["DTSTART_DATE_ONLY"] = is_date_only
            current["DTSTART_TZID"] = tzid
        elif name_base == "DTEND":
            current["DTEND"] = value
            current["DTEND_DATE_ONLY"] = is_date_only
            current["DTEND_TZID"] = tzid
        elif name_base in ("SUMMARY", "DESCRIPTION", "DURATION", "LOCATION", "UID", "RRULE", "COLOR"):
            current[name_base] = value
        elif name_base == "RECURRENCE-ID":
            current["RECURRENCE_ID"] = value
        elif name_base == "X-APPLE-EVENT-COLOR":
            current["X_APPLE_EVENT_COLOR"] = value
        elif name_base == "EXDATE":
            exdates = current.get("EXDATES", [])
            for v in value.split(","):
                ts = _parse_dt(v.strip(), is_date_only, tzid or current.get("DTSTART_TZID"))
                if ts:
                    exdates.append(ts)
            current["EXDATES"] = exdates
    return events


# ── Import endpoint ───────────────────────────────────────────────────────────

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
    # Only import one-off events scheduled today or later (RRULE series are handled per-occurrence below)
    today_ms = int(datetime.now(_IST).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).timestamp() * 1000)
    events = [ev for ev in events if ev.get("rrule") or ev["scheduled_at"] >= today_ms]
    created = 0
    expires_at: Optional[int] = None

    # Pre-fetch all existing fingerprints in two bulk queries — O(1) lookups
    # instead of one DB query per occurrence.
    existing_cids: set[str] = {
        row[0] for row in
        db.query(CircuitTask.client_id)
        .filter(CircuitTask.user_id == user.id, CircuitTask.client_id.isnot(None))
        .all()
    }
    existing_schedtext: set[tuple] = {
        (row[0], row[1]) for row in
        db.query(CircuitTask.scheduled_at, CircuitTask.text)
        .filter(CircuitTask.user_id == user.id, CircuitTask.scheduled_at.isnot(None))
        .all()
    }

    def _seen(cid: str, ts_ms: int, summary: str) -> bool:
        if cid and cid in existing_cids:
            return True
        return (ts_ms, summary[:500]) in existing_schedtext

    try:
        for ev in events:
            uid = ev["uid"]
            rrule = ev.get("rrule")
            if rrule:
                # Lazy-load: store one template task per series instead of expanding 730 days.
                # scheduled_at is set to the FIRST FUTURE occurrence (on or after today) so
                # the user never sees a backlog of past occurrences on initial import.
                # rrule_dtstart_ms retains the original DTSTART for correct pattern expansion.
                exdate_set = set(ev.get("exdates", []))
                first_future = _first_future_ms(ev["scheduled_at"], rrule, exdate_set)
                if not first_future:
                    continue  # series has no future occurrences; skip

                ev = {
                    **ev,
                    "rrule_dtstart_ms": ev["scheduled_at"],  # preserve original DTSTART
                    "scheduled_at": first_future,            # show at first future occurrence
                }
                cid = _client_id(uid) if uid else ""
                if _seen(cid, ev["scheduled_at"], ev["summary"]):
                    continue
                db.add(_make_task(user.id, ev, client_id=cid))
                existing_cids.add(cid)
                created += 1
                # Template expiry = original dtstart + 730 days (the full intended horizon)
                template_expiry = ev["rrule_dtstart_ms"] + _RRULE_HORIZON_DAYS * 86_400_000
                if expires_at is None or template_expiry > expires_at:
                    expires_at = template_expiry
            else:
                cid = _client_id(uid) if uid else ""
                if _seen(cid, ev["scheduled_at"], ev["summary"]):
                    continue
                db.add(_make_task(user.id, ev, client_id=cid))
                existing_cids.add(cid)
                created += 1
        if created:
            db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(400, f"Database error during import: {str(exc)[:300]}")
    return {"imported": created, "total": len(events), "expires_at": expires_at}


# ── ICS export ────────────────────────────────────────────────────────────────

def _esc(text: str) -> str:
    """RFC 5545 text escaping: backslash, comma, semicolon, newline."""
    return text.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n").replace("\r", "")


def _fold(line: str) -> str:
    """RFC 5545 line folding: max 75 octets per line, continuation lines start with a space."""
    encoded = line.encode("utf-8")
    if len(encoded) <= 75:
        return line
    chunks: list[str] = []
    buf = b""
    for char in line:
        c = char.encode("utf-8")
        if len(buf) + len(c) > (75 if not chunks else 74):
            chunks.append(buf.decode("utf-8"))
            buf = b" " + c
        else:
            buf += c
    if buf:
        chunks.append(buf.decode("utf-8"))
    return "\r\n".join(chunks)


def _recurrence_to_rrule(recurrence: str, ends_at_ms: Optional[int] = None) -> Optional[str]:
    """Convert Circuit's internal recurrence pattern to an RRULE string."""
    until = ""
    if ends_at_ms:
        until_dt = datetime.fromtimestamp(ends_at_ms / 1000, tz=timezone.utc)
        until = f";UNTIL={until_dt.strftime('%Y%m%dT%H%M%SZ')}"

    if recurrence == "daily":
        return f"FREQ=DAILY{until}"
    if recurrence == "weekday":
        return f"FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR{until}"
    if recurrence == "weekend":
        return f"FREQ=WEEKLY;BYDAY=SA,SU{until}"
    if recurrence == "monthly:LWD":
        return f"FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1{until}"
    if recurrence.startswith("weekly:"):
        days = recurrence[7:]          # e.g. "MO,WE,FR"
        return f"FREQ=WEEKLY;BYDAY={days}{until}"
    if recurrence == "weekly":
        return f"FREQ=WEEKLY{until}"
    if recurrence.startswith("monthly:"):
        spec = recurrence[8:]          # e.g. "1MO" or "1"
        if re.match(r"^-?\d+$", spec) or spec == "L":
            # Day-of-month: e.g. "1" → BYMONTHDAY=1
            day = spec if spec != "L" else "-1"
            return f"FREQ=MONTHLY;BYMONTHDAY={day}{until}"
        # Nth weekday: e.g. "1MO", "LFR"
        m = re.match(r"^(L|-?\d+)([A-Z]{2})$", spec)
        if m:
            n = "-1" if m.group(1) == "L" else m.group(1)
            return f"FREQ=MONTHLY;BYDAY={n}{m.group(2)}{until}"
    return None


_IST_OFFSET = "+0530"
_VTIMEZONE = "\r\n".join([
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Kolkata",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0530",
    "TZOFFSETTO:+0530",
    "TZNAME:IST",
    "END:STANDARD",
    "END:VTIMEZONE",
])


def _task_to_vevent(task: CircuitTask) -> str:
    """Convert a CircuitTask to a VEVENT block string."""
    lines: list[str] = ["BEGIN:VEVENT"]

    # UID — stable across re-exports
    lines.append(f"UID:circuit-{task.id}@circuit")

    # Timestamps in IST
    dtstart_ms = task.scheduled_at
    if task.is_recurring_template and task.rrule_dtstart_ms:
        dtstart_ms = task.rrule_dtstart_ms   # use original DTSTART for recurring templates

    start_ist = datetime.fromtimestamp(dtstart_ms / 1000, tz=_IST)
    end_ist   = start_ist + timedelta(minutes=task.duration or 30)
    fmt_ist   = "%Y%m%dT%H%M%S"

    lines.append(f"DTSTART;TZID=Asia/Kolkata:{start_ist.strftime(fmt_ist)}")
    lines.append(f"DTEND;TZID=Asia/Kolkata:{end_ist.strftime(fmt_ist)}")

    # Created / modified (UTC)
    if task.created_at:
        lines.append(f"DTSTAMP:{task.created_at.strftime('%Y%m%dT%H%M%SZ')}")

    # Summary + description
    lines.append(_fold(f"SUMMARY:{_esc(task.text)}"))
    if task.tiny_step:
        lines.append(_fold(f"DESCRIPTION:{_esc(task.tiny_step)}"))

    # Location
    if task.location_dependency:
        lines.append(_fold(f"LOCATION:{_esc(task.location_dependency)}"))

    # Category from tag
    if task.tag and task.tag != "general":
        lines.append(f"CATEGORIES:{_esc(task.tag)}")

    # Status
    if task.completed:
        lines.append("STATUS:COMPLETED")
    else:
        lines.append("STATUS:CONFIRMED")

    # Effort → priority (iCal: 0=undefined, 1=high, 5=medium, 9=low)
    priority_map = {"high": "1", "medium": "5", "low": "9"}
    if task.effort and task.effort in priority_map:
        lines.append(f"PRIORITY:{priority_map[task.effort]}")

    # Recurrence
    rrule: Optional[str] = None
    if task.rrule:
        rrule = task.rrule
    elif task.recurrence:
        rrule = _recurrence_to_rrule(task.recurrence, task.recurrence_ends_at)

    if rrule:
        lines.append(f"RRULE:{rrule}")

    lines.append("END:VEVENT")
    return "\r\n".join(lines)


@router.get("/export")
def export_ics(
    include_completed: bool = False,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """
    Export all scheduled tasks as a standards-compliant .ics file importable
    by iCloud Calendar, Google Calendar, and any RFC 5545-compliant app.

    Recurring templates are exported once with their original DTSTART + RRULE
    so the calendar app regenerates all occurrences. Single tasks use fixed
    DTSTART/DTEND. All times are in Asia/Kolkata (IST).

    ?include_completed=true to include already-completed tasks (default: false).
    """
    q = db.query(CircuitTask).filter(
        CircuitTask.user_id == user.id,
        CircuitTask.scheduled_at.isnot(None),
    )
    if not include_completed:
        q = q.filter(CircuitTask.completed == False)  # noqa: E712
    tasks = q.order_by(CircuitTask.scheduled_at).all()

    header = "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Circuit//Task Export//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Circuit Tasks",
        "X-WR-TIMEZONE:Asia/Kolkata",
    ])

    parts = [header, _VTIMEZONE]
    for task in tasks:
        parts.append(_task_to_vevent(task))
    parts.append("END:VCALENDAR")

    ics_body = "\r\n".join(parts)
    filename = f"circuit-{datetime.now(_IST).strftime('%Y%m%d')}.ics"
    return Response(
        content=ics_body,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Series propagation ────────────────────────────────────────────────────────

from pydantic import BaseModel as _BaseModel


class PropagateSeries(_BaseModel):
    include_classification: bool = True
    include_text: bool = False
    from_scheduled_at: Optional[int] = None  # ms timestamp; if set, only affect occurrences >= this


_CLASSIFICATION_FIELDS = (
    "tag", "focus_type", "effort", "importance", "urgency",
    "consequence_of_delay", "momentum_value", "cognitive_load",
    "emotional_resistance", "activation_energy", "recovery_cost",
    "energy_to_reward_ratio", "deadline_type", "time_sensitivity",
    "preferred_execution_window",
)


@router.post("/propagate-classification/{task_id}")
def propagate_classification(
    task_id: int,
    body: PropagateSeries = PropagateSeries(),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    source = db.query(CircuitTask).filter_by(id=task_id, user_id=user.id).first()
    if not source:
        raise HTTPException(404, "Task not found")

    uid = _extract_series_uid(source.client_id or "")
    if not uid:
        raise HTTPException(400, "Task is not part of a recurring series")

    if not body.include_classification and not body.include_text:
        raise HTTPException(400, "Nothing to propagate — select at least one option")

    pattern = f"ics:{uid}:%"
    q = db.query(CircuitTask).filter(
        CircuitTask.user_id == user.id,
        CircuitTask.client_id.like(pattern),
        CircuitTask.id != source.id,
    )
    if body.from_scheduled_at is not None:
        q = q.filter(CircuitTask.scheduled_at >= body.from_scheduled_at)
    siblings = q.all()

    for sibling in siblings:
        if body.include_classification:
            for field in _CLASSIFICATION_FIELDS:
                setattr(sibling, field, getattr(source, field))
        if body.include_text:
            sibling.text = source.text
            sibling.tiny_step = source.tiny_step

    db.commit()
    return {"updated": len(siblings)}


@router.delete("/series/{task_id}")
def delete_series(
    task_id: int,
    from_scheduled_at: Optional[int] = None,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    source = db.query(CircuitTask).filter_by(id=task_id, user_id=user.id).first()
    if not source:
        raise HTTPException(404, "Task not found")

    uid = _extract_series_uid(source.client_id or "")
    if not uid:
        raise HTTPException(400, "Task is not part of a recurring series")

    pattern = f"ics:{uid}:%"
    q = db.query(CircuitTask).filter(
        CircuitTask.user_id == user.id,
        CircuitTask.client_id.like(pattern),
    )
    if from_scheduled_at is not None:
        q = q.filter(CircuitTask.scheduled_at >= from_scheduled_at)
    tasks = q.all()

    count = len(tasks)
    for t in tasks:
        db.delete(t)
    db.commit()
    return {"deleted": count}


@router.get("/expiry")
def get_calendar_expiry(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Return when the calendar window expires.
    For old-style expanded tasks: max(scheduled_at).
    For RRULE templates: max(rrule_dtstart_ms + 730 days)."""
    candidates: list[int] = []

    # Old-style expanded tasks (non-template ics: entries)
    latest_scheduled = (
        db.query(CircuitTask.scheduled_at)
        .filter(
            CircuitTask.user_id == user.id,
            CircuitTask.client_id.isnot(None),
            CircuitTask.client_id.like("ics:%"),
            CircuitTask.scheduled_at.isnot(None),
            CircuitTask.is_recurring_template.isnot(True),
        )
        .order_by(CircuitTask.scheduled_at.desc())
        .first()
    )
    if latest_scheduled and latest_scheduled[0]:
        candidates.append(latest_scheduled[0])

    # RRULE templates: their horizon is dtstart + 730 days
    latest_template = (
        db.query(CircuitTask.rrule_dtstart_ms)
        .filter(
            CircuitTask.user_id == user.id,
            CircuitTask.is_recurring_template == True,
            CircuitTask.rrule_dtstart_ms.isnot(None),
        )
        .order_by(CircuitTask.rrule_dtstart_ms.desc())
        .first()
    )
    if latest_template and latest_template[0]:
        candidates.append(latest_template[0] + _RRULE_HORIZON_DAYS * 86_400_000)

    if not candidates:
        return {"expires_at_ms": None, "expires_at_iso": None, "days_until_expiry": None}

    expires_ms = max(candidates)
    expires_dt = datetime.fromtimestamp(expires_ms / 1000, tz=timezone.utc)
    now = datetime.now(timezone.utc)
    days_until = max(0, int((expires_ms - int(now.timestamp() * 1000)) / 86_400_000))

    return {
        "expires_at_ms": expires_ms,
        "expires_at_iso": expires_dt.isoformat(),
        "days_until_expiry": days_until,
    }
