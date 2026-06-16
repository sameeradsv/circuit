"""Recurrence pattern engine for user tasks (not calendar imports).

Supported patterns:
- daily: next day
- weekly:MO,WE,FR: specific weekdays (MO=Mon, TU=Tue, WE=Wed, TH=Thu, FR=Fri, SA=Sat, SU=Sun)
- weekend: Saturday and Sunday
- weekday: Monday through Friday
- monday/tuesday/.../sunday: specific day of week
- monthly:1: 1st of month
- monthly:15: 15th of month
- monthly:1MO: 1st Monday of month
- monthly:3FR: 3rd Friday of month (use L for last, e.g., LMO = last Monday)
"""

from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

_IST = ZoneInfo("Asia/Kolkata")


def next_occurrence(pattern: str, from_dt: datetime) -> Optional[datetime]:
    """Generate the next occurrence after from_dt based on the pattern."""
    if not pattern or not pattern.strip():
        return None

    pattern = pattern.strip().lower()

    if pattern == "daily":
        return from_dt + timedelta(days=1)

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
    current = dt.replace(day=1) + timedelta(days=1)  # Move to next month
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
