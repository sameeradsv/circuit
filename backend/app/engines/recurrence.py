"""Recurrence pattern engine for user tasks (not calendar imports).

Supported patterns:
- daily: next day
- every:Nd: every N days (e.g. every:4d)
- every:Nw: every N weeks (e.g. every:2w)
- every:Nh: every N hours (e.g. every:4h)
- weekly: every week on the same weekday as the current occurrence
- weekly:MO,WE,FR: specific weekdays (MO=Mon, TU=Tue, WE=Wed, TH=Thu, FR=Fri, SA=Sat, SU=Sun)
- weekend: Saturday and Sunday
- weekday: Monday through Friday
- monday/tuesday/.../sunday: specific day of week
- monthly:1: 1st of month
- monthly:15: 15th of month
- monthly:1MO: 1st Monday of month
- monthly:3FR: 3rd Friday of month (use L for last, e.g., LMO = last Monday)
"""

import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

_IST = ZoneInfo("Asia/Kolkata")
_INTERVAL_RE = re.compile(r"^every:(\d+)([dwh])$")


def is_hourly_recurrence(pattern: str | None) -> bool:
    """True for every:Nh — next slot advances by hours, not wall-clock realignment."""
    if not pattern:
        return False
    m = _INTERVAL_RE.match(pattern.strip().lower())
    return bool(m and m.group(2) == "h")


def _with_wall_time(time_ref: datetime, dt: datetime) -> datetime:
    return dt.replace(
        hour=time_ref.hour,
        minute=time_ref.minute,
        second=time_ref.second,
        microsecond=0,
    )


def _weekly_day_set(days_str: str) -> set[int]:
    day_map = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
    out: set[int] = set()
    for token in days_str.split(","):
        wd = day_map.get(token.strip()[-2:].upper(), -1)
        if wd >= 0:
            out.add(wd)
    return out


def _next_weekdays_on_or_after(
    after_dt: datetime,
    weekdays: set[int],
    time_ref: datetime,
) -> Optional[datetime]:
    """Earliest matching weekday on or after after_dt (same clock time as time_ref)."""
    if not weekdays:
        return None
    day_start = after_dt.replace(hour=0, minute=0, second=0, microsecond=0)
    best: Optional[datetime] = None
    for off in range(8):
        cand = _with_wall_time(time_ref, day_start + timedelta(days=off))
        if cand >= after_dt and cand.weekday() in weekdays:
            if best is None or cand < best:
                best = cand
    return best


def next_occurrence_strictly_after(
    pattern: str,
    after_dt: datetime,
    anchor_dt: datetime,
) -> Optional[datetime]:
    """First pattern tick strictly after after_dt, walking forward from anchor_dt."""
    cur = anchor_dt
    for _ in range(400):
        nxt = next_occurrence(pattern, cur)
        if not nxt:
            return None
        if nxt > after_dt:
            return nxt
        cur = nxt
    return None


def first_catch_up_slot_after(
    pattern: str,
    after_dt: datetime,
    anchor_dt: datetime,
) -> Optional[datetime]:
    """Next suitable recurrence slot on or after after_dt (not merely the day after blackout)."""
    pattern = pattern.strip().lower()

    if pattern.startswith("weekly:"):
        return _next_weekdays_on_or_after(
            after_dt, _weekly_day_set(pattern[7:]), anchor_dt,
        )

    if pattern == "weekend":
        return _next_weekdays_on_or_after(after_dt, {5, 6}, anchor_dt)

    if pattern == "weekday":
        return _next_weekdays_on_or_after(after_dt, {0, 1, 2, 3, 4}, anchor_dt)

    day_names = {
        "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
        "friday": 4, "saturday": 5, "sunday": 6,
    }
    if pattern in day_names:
        return _next_weekdays_on_or_after(after_dt, {day_names[pattern]}, anchor_dt)

    m = _INTERVAL_RE.match(pattern)
    if m and m.group(2) == "w":
        return _next_weekdays_on_or_after(after_dt, {anchor_dt.weekday()}, anchor_dt)

    return next_occurrence_strictly_after(pattern, after_dt, anchor_dt)


# Min gap after a catch_up_once slot before the next anchor-based occurrence is kept.
_CATCH_UP_MIN_GAP_DAYS = 2


def skip_occurrences_too_close_after_catchup(
    pattern: str | None,
    next_ms: int,
    catch_up_ms: int,
    anchor_ms: int,
    *,
    min_gap_days: int = _CATCH_UP_MIN_GAP_DAYS,
) -> int:
    """Skip anchor-based occurrences that land too soon after a catch-up completion."""
    if not pattern or not pattern.strip():
        return next_ms

    min_gap = timedelta(days=min_gap_days)
    anchor_dt = datetime.fromtimestamp(anchor_ms / 1000, tz=_IST)
    catch_up_dt = datetime.fromtimestamp(catch_up_ms / 1000, tz=_IST)
    current = datetime.fromtimestamp(next_ms / 1000, tz=_IST)

    for _ in range(30):
        if current - catch_up_dt >= min_gap:
            return int(current.timestamp() * 1000)
        nxt = next_occurrence_strictly_after(pattern, current, anchor_dt)
        if not nxt:
            break
        current = nxt

    return int(current.timestamp() * 1000)


def next_occurrence(pattern: str, from_dt: datetime) -> Optional[datetime]:
    """Generate the next occurrence after from_dt based on the pattern."""
    if not pattern or not pattern.strip():
        return None

    pattern = pattern.strip().lower()

    if pattern == "daily":
        return from_dt + timedelta(days=1)

    interval_next = _next_interval(pattern, from_dt)
    if interval_next is not None:
        return interval_next

    if pattern == "weekly":
        return from_dt + timedelta(weeks=1)

    if pattern == "weekend":
        return _next_weekend(from_dt)

    if pattern == "weekday":
        return _next_weekday(from_dt)

    if pattern in ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]:
        return _next_day_of_week(pattern, from_dt)

    if pattern.startswith("weekly:"):
        days_str = pattern[7:].upper()  # e.g., "MO,WE,FR"
        return _next_weekly(days_str, from_dt)

    if pattern.startswith("monthly:"):
        spec = pattern[8:].upper()  # e.g., "1" or "3FR" or "LMO" or "LWD"
        return _next_monthly(spec, from_dt)

    return None


def _next_interval(pattern: str, dt: datetime) -> Optional[datetime]:
    m = _INTERVAL_RE.match(pattern)
    if not m:
        return None
    n = int(m.group(1))
    if n < 1:
        return None
    if m.group(2) == "w":
        return dt + timedelta(weeks=n)
    if m.group(2) == "h":
        return dt + timedelta(hours=n)
    return dt + timedelta(days=n)


def _next_weekend(dt: datetime) -> datetime:
    """Next Saturday or Sunday; prefer Saturday if today is weekday."""
    days_until_sat = (5 - dt.weekday()) % 7
    if days_until_sat == 0 and dt.weekday() >= 5:
        return dt + timedelta(days=1)  # If today is Sat/Sun, next occurrence is tomorrow
    return dt + timedelta(days=days_until_sat if days_until_sat > 0 else 1)


def _next_weekday(dt: datetime) -> datetime:
    """Next Monday-Friday."""
    current = dt + timedelta(days=1)
    while current.weekday() >= 5:  # Skip Sat(5) and Sun(6)
        current += timedelta(days=1)
    return current


def _next_day_of_week(day_name: str, dt: datetime) -> datetime:
    """Next occurrence of a specific weekday."""
    day_map = {
        "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
        "friday": 4, "saturday": 5, "sunday": 6,
    }
    target_wd = day_map.get(day_name)
    if target_wd is None:
        return None

    current = dt + timedelta(days=1)
    while current.weekday() != target_wd:
        current += timedelta(days=1)
    return current


def _next_weekly(days_str: str, dt: datetime) -> Optional[datetime]:
    """Next occurrence of weekly pattern like 'MO,WE,FR'."""
    day_map = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
    target_wds = set()
    for token in days_str.split(","):
        token = token.strip()
        if token in day_map:
            target_wds.add(day_map[token])
    if not target_wds:
        return None

    current = dt + timedelta(days=1)
    while current.weekday() not in target_wds:
        current += timedelta(days=1)
    return current


def _next_monthly(spec: str, dt: datetime) -> Optional[datetime]:
    """Next occurrence of monthly pattern like '1', '15', '1MO', '3FR', 'LMO', 'LWD'."""
    day_map = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}

    # Last working day (last Mon-Fri) of the month
    if spec == "LWD":
        return _last_working_day_of_month(dt)

    # Try parsing as just a day of month (1-31)
    if spec.isdigit():
        day_of_month = int(spec)
        return _next_date_of_month(day_of_month, dt)

    # Try parsing as "Nth weekday" or "LWD" (last specific weekday)
    if len(spec) >= 3:
        num_str = spec[:-2]
        wd_str = spec[-2:].upper()

        if wd_str not in day_map:
            return None

        target_wd = day_map[wd_str]

        if num_str == "L":
            return _last_weekday_of_month(target_wd, dt)
        elif num_str.isdigit():
            n = int(num_str)
            return _nth_weekday_of_month(n, target_wd, dt)

    return None


def _next_date_of_month(day: int, dt: datetime) -> datetime:
    """Next occurrence of a specific day of month (1-31)."""
    current = (dt.replace(day=1) + timedelta(days=32)).replace(day=1)
    # Clamp day to valid range for the month
    try:
        return current.replace(day=min(day, 28))  # Use 28 to avoid month-end issues
    except ValueError:
        # If the target day doesn't exist (e.g., Feb 30), use last day of month
        return (current.replace(day=1) + timedelta(days=32)).replace(day=1) - timedelta(days=1)


def _nth_weekday_of_month(n: int, target_wd: int, dt: datetime) -> Optional[datetime]:
    """Nth occurrence of a weekday in a month (1-indexed, e.g., 1=first, 3=third)."""
    if n < 1 or n > 5:
        return None

    # Start from the first day of next month
    current = dt.replace(day=1) + timedelta(days=32)
    current = current.replace(day=1)

    count = 0
    while count < n:
        if current.weekday() == target_wd:
            count += 1
            if count == n:
                return current
        current += timedelta(days=1)

    return None


def _last_working_day_of_month(dt: datetime) -> datetime:
    """Last weekday (Mon-Fri) of next month."""
    # First day of next month
    first_next = (dt.replace(day=1) + timedelta(days=32)).replace(day=1)
    # Last day of next month
    last_day = (first_next + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    # Walk backwards until we hit a weekday
    while last_day.weekday() >= 5:
        last_day -= timedelta(days=1)
    return last_day


def _last_weekday_of_month(target_wd: int, dt: datetime) -> datetime:
    """Last occurrence of a weekday in a month."""
    # Start from first day of next month
    current = dt.replace(day=1) + timedelta(days=32)
    current = current.replace(day=1)

    # Go to last day of current month
    last_day = (current + timedelta(days=32)).replace(day=1) - timedelta(days=1)

    # Walk backwards to find the target weekday
    while last_day.weekday() != target_wd:
        last_day -= timedelta(days=1)

    return last_day
