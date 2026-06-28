from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.config import settings
from app.models import CalendarSyncLedger, CircuitTask, User
from app.services.virtual_recurrence import (
    expand_virtual_occurrences,
    materialize_occurrences_for_user,
    materialized_occurrences,
)

_IST = ZoneInfo("Asia/Kolkata")
_UID_RE = re.compile(r"^UID:(.+)$", re.MULTILINE)
_DTSTART_RE = re.compile(r"^DTSTART(?:;[^:]*)?:(.+)$", re.MULTILINE)
_MARKER = "Managed by Circuit"
_MISSING_CALENDAR_ERROR = "iCloud calendar 'Circuit' was not found. Please create it manually in Apple Calendar and retry sync."


@dataclass
class DesiredEvent:
    task_id: int
    occurrence_id: Optional[int]
    occurrence_key: str
    uid: str
    title: str
    start_ms: int
    end_ms: int
    completed: bool


@dataclass
class CalendarEvent:
    href: str
    etag: Optional[str]
    uid: Optional[str]
    data: str

    @property
    def app_owned(self) -> bool:
        return _MARKER in self.data


class ICloudCalendarSetupError(RuntimeError):
    pass


def _app_tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.icloud_timezone or "Asia/Kolkata")
    except Exception:
        return _IST


def sync_window_ms(now: Optional[datetime] = None) -> tuple[int, int]:
    tz = _app_tz()
    today = (now or datetime.now(tz)).astimezone(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    end = today + timedelta(days=max(0, settings.icloud_sync_window_days) + 1) - timedelta(milliseconds=1)
    return int(today.timestamp() * 1000), int(end.timestamp() * 1000)


def _dt_from_ms(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def _ical_dt(ms: int) -> str:
    return _dt_from_ms(ms).strftime("%Y%m%dT%H%M%SZ")


def _calendar_query_dt(ms: int) -> str:
    return _ical_dt(ms)


def _escape_ical(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace(",", "\\,")
        .replace(";", "\\;")
    )


def _extract_uid(data: str) -> Optional[str]:
    match = _UID_RE.search(data.replace("\r\n", "\n"))
    return match.group(1).strip() if match else None


def _extract_dtstart_ms(data: str) -> Optional[int]:
    match = _DTSTART_RE.search(data.replace("\r\n", "\n"))
    if not match:
        return None
    value = match.group(1).strip()
    try:
        if value.endswith("Z"):
            dt = datetime.strptime(value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
        elif "T" in value:
            dt = datetime.strptime(value, "%Y%m%dT%H%M%S").replace(tzinfo=_app_tz())
        else:
            dt = datetime.strptime(value, "%Y%m%d").replace(tzinfo=_app_tz())
        return int(dt.timestamp() * 1000)
    except ValueError:
        return None


def _normalize_ics_for_compare(data: str) -> str:
    normalized = data.replace("\r\n", "\n").strip()
    return re.sub(r"^DTSTAMP:.*$", "DTSTAMP:<ignored>", normalized, flags=re.MULTILINE)


def _vevent(event: DesiredEvent) -> str:
    title = f"\u2705 {event.title}" if event.completed else event.title
    app_link = f"{settings.app_base_url.rstrip('/')}/calendar" if settings.app_base_url else "/calendar"
    description = "\n".join([
        _MARKER,
        f"taskId: {event.task_id}",
        f"occurrenceKey: {event.occurrence_key}",
        f"occurrenceId: {event.occurrence_id}" if event.occurrence_id is not None else "occurrenceId: none",
        f"app: {app_link}",
    ])
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Circuit//Circuit iCloud Mirror//EN",
        "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT",
        f"UID:{event.uid}",
        f"DTSTAMP:{now}",
        f"DTSTART:{_ical_dt(event.start_ms)}",
        f"DTEND:{_ical_dt(event.end_ms)}",
        f"SUMMARY:{_escape_ical(title)}",
        f"DESCRIPTION:{_escape_ical(description)}",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ])


def desired_events_for_user(db: Session, user_id: int, from_ms: int, to_ms: int) -> list[DesiredEvent]:
    out: list[DesiredEvent] = []

    concrete = (
        db.query(CircuitTask)
        .filter(
            CircuitTask.user_id == user_id,
            CircuitTask.scheduled_at.isnot(None),
            CircuitTask.recurrence.is_(None),
            CircuitTask.rrule.is_(None),
            or_(
                and_(CircuitTask.scheduled_at >= from_ms, CircuitTask.scheduled_at <= to_ms),
                and_(
                    CircuitTask.scheduled_at < from_ms,
                    CircuitTask.scheduled_at + (CircuitTask.duration * 60_000) > from_ms,
                ),
            ),
        )
        .all()
    )
    for task in concrete:
        start = int(task.scheduled_at or 0)
        key = f"task-{task.id}"
        out.append(DesiredEvent(
            task_id=task.id,
            occurrence_id=None,
            occurrence_key=key,
            uid=f"circuit-{task.id}-{key}",
            title=task.text,
            start_ms=start,
            end_ms=start + (task.duration or 30) * 60_000,
            completed=bool(task.completed),
        ))

    materialized_by_key = {
        (item.get("recurring_task_id"), item.get("occurrence_start_ms")): item
        for item in materialized_occurrences(db, user_id, from_ms, to_ms, completed=False)
    }
    for item in materialized_by_key.values():
        task_id = item.get("source_task_id")
        start = item.get("scheduled_at")
        if not isinstance(task_id, int) or not isinstance(start, int):
            continue
        key = str(item.get("occurrence_key") or item.get("occurrence_start_ms") or start)
        out.append(DesiredEvent(
            task_id=task_id,
            occurrence_id=item.get("materialized_occurrence_id") if isinstance(item.get("materialized_occurrence_id"), int) else None,
            occurrence_key=key,
            uid=f"circuit-{task_id}-{key}",
            title=str(item.get("text") or "Untitled task"),
            start_ms=start,
            end_ms=start + int(item.get("duration") or 30) * 60_000,
            completed=False,
        ))

    completed_virtual = expand_virtual_occurrences(db, user_id, from_ms, to_ms, completed=True)
    for item in completed_virtual:
        task_id = item.get("source_task_id")
        start = item.get("scheduled_at")
        occurrence_start = item.get("occurrence_start_ms")
        if not isinstance(task_id, int) or not isinstance(start, int) or not isinstance(occurrence_start, int):
            continue
        key = str(occurrence_start)
        out.append(DesiredEvent(
            task_id=task_id,
            occurrence_id=None,
            occurrence_key=key,
            uid=f"circuit-{task_id}-{key}",
            title=str(item.get("text") or "Untitled task"),
            start_ms=start,
            end_ms=start + int(item.get("duration") or 30) * 60_000,
            completed=True,
        ))

    deduped = {event.uid: event for event in out}
    return sorted(deduped.values(), key=lambda e: (e.start_ms, e.uid))


class CalDAVClient:
    REQUIRED_ENV = {
        "ICLOUD_APPLE_ID": "icloud_apple_id",
        "ICLOUD_APP_SPECIFIC_PASSWORD": "icloud_app_specific_password",
        "ICLOUD_CALDAV_BASE_URL": "icloud_caldav_base_url",
        "ICLOUD_CALENDAR_NAME": "icloud_calendar_name",
        "CRON_SECRET": "cron_secret",
    }

    def __init__(self) -> None:
        missing = [
            name for name, attr in self.REQUIRED_ENV.items()
            if not getattr(settings, attr, "")
        ]
        if missing:
            raise ICloudCalendarSetupError(f"Missing iCloud CalDAV env vars: {', '.join(missing)}")
        if settings.icloud_calendar_name != "Circuit":
            raise ICloudCalendarSetupError("ICLOUD_CALENDAR_NAME must be exactly 'Circuit'.")
        self.base_url = settings.icloud_caldav_base_url.rstrip("/") + "/"
        self.client = httpx.Client(
            auth=(settings.icloud_apple_id, settings.icloud_app_specific_password),
            timeout=30,
            follow_redirects=True,
        )

    def close(self) -> None:
        self.client.close()

    def _request(self, method: str, url: str, **kwargs) -> httpx.Response:
        response = self.client.request(method, url, **kwargs)
        response.raise_for_status()
        return response

    def _propfind(self, url: str, body: str, *, depth: str = "0") -> ET.Element:
        response = self._request(
            "PROPFIND",
            url,
            headers={"Depth": depth, "Content-Type": "application/xml"},
            content=body,
        )
        return ET.fromstring(response.text)

    def _discover_calendar_home_url(self) -> str:
        ns = {"d": "DAV:", "cal": "urn:ietf:params:xml:ns:caldav"}
        principal_body = """<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop><d:current-user-principal/></d:prop>
</d:propfind>"""
        principal_root: Optional[ET.Element] = None
        last_error: Optional[Exception] = None
        for candidate in (self.base_url, urljoin(self.base_url, ".well-known/caldav")):
            try:
                principal_root = self._propfind(candidate, principal_body, depth="0")
                break
            except Exception as exc:
                last_error = exc
        if principal_root is None:
            if last_error:
                raise last_error
            raise ICloudCalendarSetupError("Unable to discover iCloud CalDAV principal.")

        principal_href = principal_root.findtext(".//d:current-user-principal/d:href", default="", namespaces=ns)
        if not principal_href:
            raise ICloudCalendarSetupError("Unable to discover iCloud CalDAV principal.")

        home_body = """<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop><cal:calendar-home-set/></d:prop>
</d:propfind>"""
        principal_url = urljoin(self.base_url, principal_href)
        home_root = self._propfind(principal_url, home_body, depth="0")
        home_href = home_root.findtext(".//cal:calendar-home-set/d:href", default="", namespaces=ns)
        if not home_href:
            raise ICloudCalendarSetupError("Unable to discover iCloud calendar home.")
        return urljoin(self.base_url, home_href).rstrip("/") + "/"

    def discover_circuit_calendar(self) -> str:
        calendars = self.discover_calendars()
        for item in calendars:
            if item["display_name"] == settings.icloud_calendar_name and item["is_calendar"]:
                return item["url"]
        raise ICloudCalendarSetupError(_MISSING_CALENDAR_ERROR)

    def discover_calendars(self) -> list[dict[str, object]]:
        body = """<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:displayname/><d:resourcetype/></d:prop>
</d:propfind>"""
        calendar_home_url = self._discover_calendar_home_url()
        root = self._propfind(calendar_home_url, body, depth="1")
        ns = {"d": "DAV:", "cal": "urn:ietf:params:xml:ns:caldav"}
        calendars: list[dict[str, object]] = []
        for resp in root.findall("d:response", ns):
            href = resp.findtext("d:href", default="", namespaces=ns)
            display = resp.findtext(".//d:displayname", default="", namespaces=ns)
            resourcetype = resp.find(".//d:resourcetype", ns)
            is_calendar = resourcetype is not None and resourcetype.find("cal:calendar", ns) is not None
            calendars.append({
                "display_name": display,
                "url": urljoin(calendar_home_url, href).rstrip("/") + "/",
                "is_calendar": is_calendar,
            })
        return calendars

    def read_calendar_metadata(self, calendar_url: str) -> dict[str, object]:
        body = """<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:displayname/>
    <d:current-user-privilege-set/>
    <cal:supported-calendar-component-set/>
  </d:prop>
</d:propfind>"""
        response = self._request("PROPFIND", calendar_url, headers={"Depth": "0"}, content=body)
        root = ET.fromstring(response.text)
        ns = {"d": "DAV:", "cal": "urn:ietf:params:xml:ns:caldav"}
        display = root.findtext(".//d:displayname", default="", namespaces=ns)
        privileges = {
            elem.tag.split("}", 1)[-1]
            for elem in root.findall(".//d:current-user-privilege-set/d:privilege/*", ns)
        }
        components = {
            elem.attrib.get("name", "")
            for elem in root.findall(".//cal:supported-calendar-component-set/cal:comp", ns)
        }
        writable = bool({"write", "write-content", "bind"}.intersection(privileges))
        return {
            "display_name": display,
            "privileges": sorted(privileges),
            "supports_vevent": "VEVENT" in components or not components,
            "writable": writable,
        }

    def read_events(self, calendar_url: str, from_ms: int, to_ms: int) -> list[CalendarEvent]:
        body = f"""<?xml version="1.0" encoding="utf-8" ?>
<cal:calendar-query xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><cal:calendar-data/></d:prop>
  <cal:filter>
    <cal:comp-filter name="VCALENDAR">
      <cal:comp-filter name="VEVENT">
        <cal:time-range start="{_calendar_query_dt(from_ms)}" end="{_calendar_query_dt(to_ms)}"/>
      </cal:comp-filter>
    </cal:comp-filter>
  </cal:filter>
</cal:calendar-query>"""
        response = self._request("REPORT", calendar_url, headers={"Depth": "1", "Content-Type": "application/xml"}, content=body)
        root = ET.fromstring(response.text)
        ns = {"d": "DAV:", "cal": "urn:ietf:params:xml:ns:caldav"}
        events: list[CalendarEvent] = []
        for resp in root.findall("d:response", ns):
            href = urljoin(calendar_url, resp.findtext("d:href", default="", namespaces=ns))
            etag = resp.findtext(".//d:getetag", default=None, namespaces=ns)
            data = resp.findtext(".//cal:calendar-data", default="", namespaces=ns)
            events.append(CalendarEvent(href=href, etag=etag, uid=_extract_uid(data), data=data))
        return events

    def put_event(self, calendar_url: str, event: DesiredEvent, href: Optional[str] = None, etag: Optional[str] = None) -> tuple[str, Optional[str]]:
        target = href or urljoin(calendar_url, f"{event.uid}.ics")
        headers = {"Content-Type": "text/calendar; charset=utf-8"}
        if href and etag:
            headers["If-Match"] = etag
        elif not href:
            headers["If-None-Match"] = "*"
        response = self._request("PUT", target, headers=headers, content=_vevent(event).encode("utf-8"))
        return target, response.headers.get("etag")

    def delete_event(self, href: str, etag: Optional[str] = None) -> None:
        headers = {"If-Match": etag} if etag else {}
        self._request("DELETE", href, headers=headers)


def _upsert_ledger(
    db: Session,
    user_id: int,
    event: DesiredEvent,
    href: Optional[str],
    etag: Optional[str],
    status: str,
    error: Optional[str] = None,
) -> CalendarSyncLedger:
    row = (
        db.query(CalendarSyncLedger)
        .filter(
            CalendarSyncLedger.calendar_provider == "icloud",
            CalendarSyncLedger.calendar_event_uid == event.uid,
        )
        .first()
    )
    if row is None:
        row = CalendarSyncLedger(
            user_id=user_id,
            task_id=event.task_id,
            calendar_provider="icloud",
            calendar_event_uid=event.uid,
        )
        db.add(row)
    row.occurrence_id = event.occurrence_id
    row.occurrence_key = event.occurrence_key
    row.calendar_href = href
    row.calendar_etag = etag
    row.occurrence_start_ms = event.start_ms
    row.occurrence_end_ms = event.end_ms
    row.last_calendar_synced_at = datetime.now(timezone.utc).replace(tzinfo=None)
    row.calendar_sync_status = status
    row.calendar_sync_error = error
    row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    return row


def icloud_setup_check() -> dict[str, object]:
    env_vars_present = {
        name: bool(getattr(settings, attr, ""))
        for name, attr in CalDAVClient.REQUIRED_ENV.items()
    }
    result: dict[str, object] = {
        "syncEnabled": bool(settings.icloud_sync_enabled),
        "envVarsPresent": env_vars_present,
        "caldavReachable": False,
        "circuitCalendarFound": False,
        "circuitCalendarWritable": False,
        "errors": [],
    }
    errors: list[str] = []
    missing = [name for name, present in env_vars_present.items() if not present]
    if missing:
        errors.append(f"Missing required environment variables: {', '.join(missing)}")
        result["errors"] = errors
        return result
    if settings.icloud_calendar_name != "Circuit":
        errors.append("ICLOUD_CALENDAR_NAME must be exactly 'Circuit'.")
        result["errors"] = errors
        return result

    client: Optional[CalDAVClient] = None
    try:
        client = CalDAVClient()
        calendars = client.discover_calendars()
        result["caldavReachable"] = True
        circuit = next(
            (
                item for item in calendars
                if item.get("display_name") == settings.icloud_calendar_name and item.get("is_calendar") is True
            ),
            None,
        )
        if circuit is None:
            errors.append(_MISSING_CALENDAR_ERROR)
            result["errors"] = errors
            return result
        result["circuitCalendarFound"] = True
        metadata = client.read_calendar_metadata(str(circuit["url"]))
        result["circuitCalendarWritable"] = bool(metadata.get("writable")) and bool(metadata.get("supports_vevent"))
        if not result["circuitCalendarWritable"]:
            errors.append("iCloud calendar 'Circuit' was found, but write access could not be confirmed.")
    except ICloudCalendarSetupError as exc:
        errors.append(str(exc))
    except httpx.HTTPError as exc:
        errors.append(f"Unable to reach iCloud CalDAV: {exc.__class__.__name__}")
    except ET.ParseError:
        errors.append("iCloud CalDAV returned an unreadable XML response.")
    finally:
        if client:
            client.close()
    result["errors"] = errors
    return result


def sync_icloud_calendar(db: Session, *, now: Optional[datetime] = None) -> dict[str, int | str | None]:
    from_ms, to_ms = sync_window_ms(now)
    stats: dict[str, int | str | None] = {
        "materialized_count": 0,
        "reminders_generated_count": 0,
        "calendar_created_count": 0,
        "updated_count": 0,
        "deleted_count": 0,
        "skipped_count": 0,
        "failed_count": 0,
        "error": None,
    }
    if not settings.icloud_sync_enabled:
        stats["error"] = "iCloud sync is disabled. Set ICLOUD_SYNC_ENABLED=true to enable it."
        return stats
    user_ids = [row[0] for row in db.query(User.id).all()]
    client = CalDAVClient()
    try:
        calendar_url = client.discover_circuit_calendar()
        metadata = client.read_calendar_metadata(calendar_url)
        if not (metadata.get("writable") and metadata.get("supports_vevent")):
            raise ICloudCalendarSetupError("iCloud calendar 'Circuit' was found, but write access could not be confirmed.")
        current_events = client.read_events(calendar_url, from_ms, to_ms)
        current_by_uid = {event.uid: event for event in current_events if event.uid}
        current_by_href = {event.href: event for event in current_events}

        for user_id in user_ids:
            materialized = materialize_occurrences_for_user(db, int(user_id), now=now)
            stats["materialized_count"] = int(stats["materialized_count"]) + int(materialized.get("materialized", 0))
            desired = desired_events_for_user(db, int(user_id), from_ms, to_ms)
            desired_by_uid = {event.uid: event for event in desired}
            ledgers = (
                db.query(CalendarSyncLedger)
                .filter(CalendarSyncLedger.user_id == int(user_id), CalendarSyncLedger.calendar_provider == "icloud")
                .all()
            )
            ledger_by_uid = {row.calendar_event_uid: row for row in ledgers}

            for event in desired:
                ledger = ledger_by_uid.get(event.uid)
                existing = current_by_href.get(ledger.calendar_href) if ledger and ledger.calendar_href else None
                if existing is None:
                    existing = current_by_uid.get(event.uid)
                try:
                    desired_ics = _vevent(event)
                    if existing is None:
                        href, etag = client.put_event(calendar_url, event)
                        _upsert_ledger(db, int(user_id), event, href, etag, "created")
                        stats["calendar_created_count"] = int(stats["calendar_created_count"]) + 1
                    elif _normalize_ics_for_compare(existing.data) != _normalize_ics_for_compare(desired_ics):
                        href, etag = client.put_event(calendar_url, event, href=existing.href, etag=existing.etag)
                        _upsert_ledger(db, int(user_id), event, href, etag or existing.etag, "updated")
                        stats["updated_count"] = int(stats["updated_count"]) + 1
                    else:
                        _upsert_ledger(db, int(user_id), event, existing.href, existing.etag, "synced")
                        stats["skipped_count"] = int(stats["skipped_count"]) + 1
                except Exception as exc:
                    _upsert_ledger(db, int(user_id), event, existing.href if existing else None, existing.etag if existing else None, "failed", str(exc))
                    stats["failed_count"] = int(stats["failed_count"]) + 1

            for cal_event in current_events:
                if not cal_event.uid or cal_event.uid in desired_by_uid:
                    continue
                if not cal_event.app_owned:
                    stats["skipped_count"] = int(stats["skipped_count"]) + 1
                    continue
                event_start = _extract_dtstart_ms(cal_event.data)
                if event_start is None or event_start < from_ms:
                    stats["skipped_count"] = int(stats["skipped_count"]) + 1
                    continue
                try:
                    client.delete_event(cal_event.href, cal_event.etag)
                    ledger = ledger_by_uid.get(cal_event.uid)
                    if ledger:
                        ledger.calendar_sync_status = "deleted"
                        ledger.last_calendar_synced_at = datetime.now(timezone.utc).replace(tzinfo=None)
                        ledger.calendar_sync_error = None
                    stats["deleted_count"] = int(stats["deleted_count"]) + 1
                except Exception as exc:
                    ledger = ledger_by_uid.get(cal_event.uid)
                    if ledger:
                        ledger.calendar_sync_status = "failed"
                        ledger.calendar_sync_error = str(exc)
                    stats["failed_count"] = int(stats["failed_count"]) + 1
        db.flush()
        return stats
    finally:
        client.close()


def cleanup_icloud_calendar(*, confirm: bool = False, now: Optional[datetime] = None, days_ahead: int = 365) -> dict[str, int | bool]:
    start = (now or datetime.now(_IST)).astimezone(_IST)
    from_ms = int(start.timestamp() * 1000)
    to_ms = int((start + timedelta(days=max(1, days_ahead))).timestamp() * 1000)
    client = CalDAVClient()
    try:
        calendar_url = client.discover_circuit_calendar()
        metadata = client.read_calendar_metadata(calendar_url)
        if confirm and not (metadata.get("writable") and metadata.get("supports_vevent")):
            raise ICloudCalendarSetupError("iCloud calendar 'Circuit' was found, but write access could not be confirmed.")
        events = client.read_events(calendar_url, from_ms, to_ms)
        candidates = []
        for event in events:
            event_start = _extract_dtstart_ms(event.data)
            if event.app_owned and event_start is not None and event_start >= from_ms:
                candidates.append(event)
        deleted = 0
        if confirm:
            for event in candidates:
                client.delete_event(event.href, event.etag)
                deleted += 1
        return {
            "preview": not confirm,
            "matched_count": len(candidates),
            "deleted_count": deleted,
            "skipped_count": len(events) - len(candidates),
        }
    finally:
        client.close()
