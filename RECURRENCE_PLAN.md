# Recurrence & Blackout Implementation Plan

## Current State
- User-created tasks support recurrence patterns (daily, weekly:MO,WE,FR, monthly:1MO, etc.)
- On completion, next occurrence auto-creates
- Calendar events are expanded upfront to 2 years (730 days)

## Goals
1. **Lazy-load calendar occurrences** — store RRULE, generate on-demand
2. **Auto-detect recurrence from calendar titles** — parse keywords to extract pattern
3. **Blackout date ranges with task classification** — skip recurring tasks during blackouts

---

## 1. Lazy-Load Calendar Occurrences

### Schema Changes
- **CircuitTask** gains:
  - `rrule` (str, nullable) — original RRULE from iCalendar (e.g., "FREQ=DAILY;INTERVAL=1")
  - `rrule_dtstart_ms` (int, nullable) — original DTSTART as ms timestamp
  - `is_recurring_template` (bool) — if True, this is a master recurring event, not a single occurrence

### Import Changes (calendar.py)
- Don't expand RRULE — store it as-is
- Set `rrule`, `rrule_dtstart_ms`, `is_recurring_template=True`
- Only create ONE task per RRULE event
- Remove `_expand_rrule()` call from import flow

### Task Completion Changes (tasks.py)
- When completing a task with `rrule` set:
  - Call `next_occurrence()` using RRULE parser (not the simple pattern parser)
  - Create next occurrence task
  - Mark original as completed
  - Both tasks share the same `rrule` and `rrule_dtstart_ms`

### API Changes
- Task list endpoint: if client asks for tasks in range [start, end], generate occurrences on-demand
- Or: generate on app load for "next 7 days"
- Calendar expiry endpoint: find max(rrule_dtstart_ms + 730 days) for any rrule task

---

## 2. Auto-Detect Recurrence from Calendar Titles

### Keywords to Detect
| Pattern | Keywords | Example |
|---------|----------|---------|
| daily | daily, every day, each day | "Daily standup" |
| weekday | weekday, work day | "Weekday gym" |
| weekend | weekend, saturday & sunday | "Weekend errands" |
| specific day | monday, tuesday, ..., sunday | "Monday meeting" |
| weekly | weekly, every week | "Weekly review" |
| monthly | monthly, every month | "Monthly 1-on-1" |
| fortnightly | fortnightly, every 2 weeks | "Fortnightly check-in" |

### Implementation (calendar.py)
- Add `_detect_recurrence(title: str, description: str) -> Optional[str]` function
- Call after `_classify_event()` in import flow
- Populate `recurrence` field for calendar events
- If both recurrence and RRULE exist, recurrence takes priority (user intent)

### Examples
- "Daily standup 9am" → `recurrence="daily"`
- "Monday & Thursday planning" → `recurrence="weekly:MO,TH"`
- "1st Monday review" → `recurrence="monthly:1MO"`
- "Gym on weekends" → `recurrence="weekend"`

---

## 3. Blackout Date Ranges with Task Classification

### Schema Changes
**New table: Blackout**
```
id (int)
user_id (int, FK)
blackout_type (str) — 'travelling', 'period', 'sickness'
start_date_ms (int)
end_date_ms (int)
created_at (datetime)
```

**CircuitTask gains:**
```
blackout_skip_flags (str, JSON) — list of blackout types to skip
  e.g., ["period", "sickness"]  // skip this task when on period or sick
  null = never skip due to blackouts
```

### API Changes

**POST /api/blackouts** — create/update blackout
```json
{
  "blackout_type": "travelling",
  "start_date": "2026-06-20",
  "end_date": "2026-06-27"
}
```

**GET /api/blackouts** — list active/upcoming blackouts

**PATCH /api/tasks/{id}** — add blackout skip classification
```json
{
  "blackout_skip_flags": ["travelling", "sickness"]
}
```

### Task List Logic
When generating tasks for display:
1. Check active blackouts for date range
2. If task has matching blackout_skip_flag, skip it
3. Or: show it grayed-out with reason "skipped during travelling"

### UI Changes
- Account page: "Blackouts" section to manage travelling/period/sickness dates
- Task detail modal: checkboxes for "Skip when travelling", "Skip when on period", "Skip when sick"
- Task list: grayed tasks with tooltip "Skipped during [blackout type]"

---

## Implementation Order
1. Add Blackout table + API endpoints
2. Add blackout_skip_flags to CircuitTask + UI
3. Modify task list to filter based on blackouts
4. Modify calendar import to detect recurrence + store RRULE
5. Modify task completion to handle RRULE expansion
6. Remove old `_expand_rrule()` call from import

---

## Notes
- User's task "exercise when on period" → task has `blackout_skip_flags=["period"]`
- User's task "cleaning when travelling/sick" → task has `blackout_skip_flags=["travelling", "sickness"]`
- On calendar import, detect that "Daily standup" is daily, store `recurrence="daily"`
- When user completes "Daily standup 2026-06-15", auto-create "Daily standup 2026-06-16"
- If "Daily standup" has `blackout_skip_flags=["travelling"]` and user is travelling 2026-06-16, it's grayed out
