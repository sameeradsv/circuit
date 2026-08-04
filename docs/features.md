# App features

Circuit ships as two apps sharing the same TypeScript scheduling engines:

1. **Vanilla PWA** (repo root `src/`) — offline-first, `localStorage`
2. **Full-stack app** (`frontend/` + `backend/`) — Next.js + FastAPI, PostgreSQL/SQLite

This document describes the **full-stack** product (primary development surface).

## Navigation

Authenticated routes under `frontend/src/app/(app)/`:

| Page | Route | Purpose |
|------|-------|---------|
| Home | `/` | Capture-first dashboard with ranked top picks, task capture with auto-filled metrics, Canopy energy (read-only), focus window |
| Tasks | `/tasks` | Ranked list, type filters, direct done/skip/reschedule actions, **server search** (`GET /api/search`), energy mode switcher, **On hold** during blackouts |
| Calendar | `/calendar` | Day / week / month views, day-view date strip, swipe/trackpad navigation, drag-and-drop, blackout shading, ICS import |
| Add | `/add` | Redirects to Home; quick capture now lives on `/` |
| Account | `/account` | Preferences, sleep overrides, blackouts, energy manual override, encrypted export/import, **vanilla PWA localStorage import**, passkey |
| More | nav section | Hides lower-frequency pages: Analytics, Energy, Chat |
| Analytics | `/analytics` | Summary stats, selected-day **WorkloadBar**, **BehavioralInsights**, attention/stale task lists |
| Energy | `/energy` | Per-day task-event balance (`GET /api/energy/timeline`); combined cross-app chart on Canopy → Energy |
| Chat | `/chat` | TerminalChat — batch commands (no API) + Circuit native **Groq** agent |

Auth: `/login` — username/passcode or WebAuthn passkey.

## Task capture & editing

- Structured dimensions: priority, cognitive load, effort, duration, scheduling, recurrence
- **Home capture** — natural-language capture with Groq-backed task defaults; `/add` redirects to Home
- **AI task defaults** — `POST /api/ai/suggest-task` infers duration, effort, focus type, cognitive/priority/energy fields, reminders, schedule hints, and a tiny step from the actual event/task name. The Groq prompt defines each metric (`cost of delay`, mental load, activation energy, recovery cost, momentum, reward) so values are calibrated instead of generic. Explicit user hints such as `#work`, `30m`, or a parsed date/time override the suggestion. `POST /api/tasks` also fills any omitted fields as a server-side safety net.
- **Calendar import defaults** — imported `.ics` events also use Groq-backed defaults for Circuit planning/scoring fields. The request sends the event title plus start time, duration, calendar name, description, and location so names like `Sleep` or `Renew Codex subscription` drive the parameters. Calendar-owned facts (`scheduled_at`, duration, UID, RRULE, recurrence start, location) remain authoritative.
- **Review suggested values** — Home and Tasks quick-add can open the new task directly in `TaskDetailModal` so generated parameters can be overridden before the user continues.
- **Tasks search** — debounced `GET /api/search` when the search box is active
- **TaskDetailModal** (`components/task-detail/`) — sectioned editor with hover tooltips on every field
- **Global history + undo** - the floating History control appears on every authenticated page and lists recent task events with selective Undo for completions, uncompletions, skips, and reschedules.
- **Per-task reminders** — scheduled tasks can enable/disable browser notifications and choose two reminder timings in Time & focus; the global sidebar bell still controls browser permission/overall enablement. Scheduled tasks with no reminders auto-complete when their time block ends, then appear in History for correction if needed.
- **TerminalChat** — natural-language batch reschedule/complete/prioritize with approval preview
- **Smart reschedules** — manual reschedules, blackout resumes, and recurrence-created next tasks can ask the backend to move conflicting events. Circuit compares importance, urgency, consequence of delay, time sensitivity, momentum, deadline pressure, and effort; the highest-weight task keeps the contested slot while lower-weight conflicts move to deterministic suggested slots that avoid overlaps and overloaded days. This is fixed backend logic, not a Groq call, so schedule changes stay explainable.

## Calendar

### Recurring edits and passive blocks

- Recurring edits can be saved for only the selected occurrence, this and future occurrences, or the whole series.
- Supported recurrence rules update when a whole series is intentionally shifted; for example, `weekly:SA` becomes `weekly:SU` after a Saturday series moves to Sunday.
- Recurring exact-title `Work` and `Sleep` blocks are hidden from Tasks ranking while remaining visible on Calendar and available to energy, sleep, and analytics logic.

- **Virtual recurring slots** are generated only for the visible range; completed, skipped, and rescheduled instances are stored as overrides so future availability stays accurate without unlimited task rows
- **Materialized recurring slots** are refreshed after recurrence edits, virtual occurrence reschedules, blackout resumes, and recurrence-created next tasks, keeping Calendar and iCloud mirrors aligned with weekend overrides and conflict moves.
- **Day / week / month** views with 24-hour grid (day/week)
- **Overlapping events** in day/week use side-by-side columns; travel buffers and minimum rendered event height are included in overlap detection so painted blocks do not collide
- **Day-view date strip + gestures** let users switch across dates/weeks/months with clicks, horizontal swipes, or trackpad/wheel motion in addition to arrow buttons
- **Month view** scrolls vertically when the grid exceeds viewport height, horizontally when narrow, and moves to the next/previous month when scrolling past the vertical edge
- **Drag-and-drop** to reschedule; recurring tasks ask *this occurrence* vs *shift series*. Drops that collide with another event can move the lower-weight event to a better slot using the same backend conflict resolver used by task-list reschedules and chat batch moves.
- **Blackout shading** — unavailable date ranges tinted on all views
- **ICS import/export** — recurring events stored as one RRULE template per series; `scheduled_at` = first occurrence on or after today (original DTSTART kept in `rrule_dtstart_ms`). Supports iCloud-style `FREQ=WEEKLY` without `BYDAY`, explicit `BYDAY`, monthly patterns, and detached `RECURRENCE-ID` instances as one-offs. Imported events are marked review-pending so Groq-filled values can be checked. Re-import to refresh dates after importer fixes.
- Travel buffers shown as hatched blocks before/after tasks

## Mobile navigation

- Mobile uses the same vertical `Sidebar` as a hideable drawer opened by a fixed menu button.
- The former bottom tab bar is not rendered in `AppShell`; tapping the backdrop or a nav link closes the drawer.

## Blackouts

Set date ranges in **Account → Blackouts** (`travelling`, `period`, `sickness`, `leave`, `wfh`).

- Tasks opt in via **Park this task during** flags in the task editor (all types including `leave` require an explicit checkbox)
- During an active blackout: affected tasks move to **On hold** on the task list
- **On disable/remove**: parked tasks resume per each task's post-blackout behavior (`resume` / `catch_up_immediate` / `catch_up_imm_shift`; legacy `catch_up` and `catch_up_once` map to `resume`)
- `resume` moves the series to the next valid recurrence slot after the blackout; immediate modes move to the first available date while preserving the original task time
- Calendar days in range are visually shaded

## Sleep & energy

- **Sleep timing** from a calendar/task event titled **Sleep** (`scheduled_at` = bedtime, `duration` = length)
- Sleep tasks block calendar time and count toward Analytics selected-day scheduled minutes.
- **Account → Sleep & recovery**: optional quality / disturbed / notes overrides
- **Default sleep quality** (0–10, default 7) and **default bedtime / wake time** (paired row) in Preferences
- Override history: toggle **Show sleep overrides** with pagination; **Edit** or **Delete** per row
- Energy baseline: `sleep_factor × 0.70 + energy_eod × 0.30` + cumulative task-event deltas through the day
- **Effective energy for task ranking (Home, Tasks, Sidebar):** Canopy total (`energy_so_far`) by default via `NEXT_PUBLIC_CANOPY_API_URL`; optional **manual override** in Account → Today's context applies only for the IST day it was set. No energy slider on Home.
- **Task-event duration scaling:** energy cost uses `duration_minutes / 60`, clamped from 0.5× to 8.0×, so long 6–8h tasks have proportionally larger impact than short tasks.
- **Time window for ranking:** `UserState.time_available_minutes` (Account) on Tasks.
- **Energy mode:** `UserState.focus_mode` synced via `use-energy-mode.ts`; switchable on Tasks header.
- **Task ranking:** Home and Tasks use shared `lib/task-ranking.ts` → engine `scoreTasks` (energy mode + available minutes aware). Home limits ranked picks to unscheduled tasks or tasks due within the next 3 days so suggestions stay actionable.
- **Circuit task energy on the timeline** is anchored to each completed task's **scheduled time** (when the work was planned), not when you tapped complete. Only actual completion/work events affect energy and analytics. App-handled skips, reschedules, occurrence overrides, and uncompletion audit events remain in history but do not drain energy or appear as analytics signals. Optional completion time stores actual completion metadata and delay minutes; delayed completions apply a small capped extra drain and feed scheduling insights. No-reminder scheduled tasks auto-complete at their scheduled end time and therefore drain energy without waiting for a manual Tasks-page action.
- **Historical energy replay**: adding or undoing an older completion recomputes `energy_eod` forward from that IST date through yesterday, so today's opening energy reflects the changed past event.

## Account and sync

- JWT auth + optional WebAuthn passkey
- AES-256 encrypted export/import of tasks and settings
- Per-user settings key-value store (`default_energy_mode`, `default_sleep_quality`, working hours, etc.)

## PWA

The vanilla root app includes `manifest.webmanifest`, service worker, and esbuild bundle. The Next.js frontend supports standalone/PWA build modes separately.
