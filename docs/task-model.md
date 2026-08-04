# Task Model

Core record: **`CircuitTask`** (~47 columns). Grouped by concern below.

## Identity & status

- `text`, `tag` (`general` / `work` / `social` / `later`), `completed`, `tiny_step`
- `client_id` — localStorage id or ICS series id (`ics:…`)

## Scheduling

- `scheduled_at` (ms epoch), `duration` (minutes)
- `effort` (`low` / `medium` / `high`), `deadline_type` (`none` / `soft` / `hard`)
- `time_sensitivity`, `preferred_execution_window` (`morning` / `afternoon` / `evening`)
- `recurrence` — user patterns: `daily`, `weekly`, `every:4d`, `every:2w`, `every:4h`, `weekly:MO,WE`, `monthly:1MO`, `monthly:LWD`, …
- `recurrence_ends_at` — optional cutoff (ms); null = indefinite
- `post_blackout_behavior` - see Post-Blackout Behavior below
- `recurrence_anchor_ms` - for `catch_up_immediate`: preserves the pre-blackout anchor after a one-time immediate resume
- `rrule`, `rrule_dtstart_ms`, `is_recurring_template` — calendar ICS imports
- `day_time_overrides` — JSON `{"SA": "10:00", "SU": "10:00"}` (morning tasks only); weekend occurrences use the override time, then weekday occurrences return to the original recurrence clock stored in `metadata_json.recurrence_time_ref_ms`.
- `travel_buffer_before_mins`, `travel_buffer_after_mins` — rendered as calendar buffer blocks and included in day/week overlap layout
- `notifications_enabled`, `notification_offset_1_mins`, `notification_offset_2_mins` - per-task Web Push reminder config; the backend materializes durable `reminders` rows for enabled scheduled tasks. Default is enabled with a 10-minute first reminder and no second reminder.

### Reschedule conflict handling

- Normal `PATCH /api/tasks/{id}` reschedules update only that task, plus same-`group_id` siblings when `propagate_group` is true.
- Sending `auto_reschedule_conflicts: true` asks the backend to resolve overlapping scheduled tasks after the move. The resolver is deterministic fixed code: it compares `importance`, `urgency`, `consequence_of_delay`, `time_sensitivity`, `momentum_value`, deadline pressure, and effort. The strongest task keeps the contested slot; lower-weight tasks move to suggested slots.
- Suggested slots come from `services/suggest_slot.py`: preferred execution window, focus type, energy/stress defaults, learned skip window, existing conflicts, after-hours wrapping, and an 8-hour daily workload cap are considered before choosing a time.
- Calendar drag/drop, task-list manual reschedule, skip/defer, TerminalChat batch reschedules, blackout resumes, and recurrence-created next tasks use the same resolver. Groq is not called for live conflict arbitration; it remains limited to task classification/default fields.
- Recurring definitions and materialized calendar rows are refreshed after recurrence schedule changes, virtual-occurrence reschedules, blackout resumes, and recurrence-created next tasks so Calendar and iCloud sync read the updated occurrence times instead of stale materialized rows.
- Series edits support selected occurrence, this-and-future, and all-occurrences scopes from TaskDetail. Selected virtual-occurrence edits are limited to fields the override model can preserve today: status plus modified start/duration. Future/all scopes update the recurring definition and refresh materialized occurrences and reminder rows.
- Supported recurrence rules update when a series anchor moves. For example, a `weekly:SA` series moved to Sunday becomes `weekly:SU`; monthly date/nth-weekday rules and matching monthly RRULE selectors are also shifted where possible.

### Post-Blackout Behavior

- Current choices: `resume`, `catch_up_immediate`, `catch_up_imm_shift`.
- Legacy values `catch_up` and `catch_up_once` are accepted as aliases for `resume`.
- `resume`: move to the next valid recurrence slot after the blackout and shift the series from there.
- `catch_up_immediate`: move to the first available date after the blackout, keep the original series.
- `catch_up_imm_shift`: move to the first available date after the blackout and re-anchor the series.
- Post-blackout moves preserve `metadata_json.recurrence_time_ref_ms`; only dates change unless the recurrence is hourly. If a blackout move lands on Saturday/Sunday, `day_time_overrides` can still adjust that weekend occurrence, but weekday moves return to the stored original clock.
- Shifted monthly rules update their date selector where possible, e.g. `monthly:3SA` to `monthly:4sa`, `BYSETPOS=3` to `BYSETPOS=4`.

## Virtual recurrence

- `recurring_tasks` stores recurring definitions instead of materializing every future slot: source task id, title, start datetime, duration, simple `recurrence` or imported `rrule`, optional end date, and metadata copied from the source task.
- `metadata_json.recurrence_time_ref_ms` is copied into the recurring definition and is the canonical clock for non-hourly recurrence expansion. Weekend overrides are display/materialization adjustments only; they do not become the weekday recurrence time.
- `occurrence_overrides` stores only per-occurrence changes: `completed`, `skipped`, or `rescheduled`, plus modified start/duration when needed.
- Ranged task reads return ordinary one-off tasks plus recurring occurrences with stable ids like `r_<recurringTaskId>_<occurrenceStart>`. The current rolling window may come from `materialized_occurrences`; farther ranges are expanded virtually on demand.
- Completing/skipping/rescheduling a virtual occurrence writes an override row; future occurrences remain virtual and bounded to the requested calendar/scheduler window.
- `occurrence_overrides` is applied to both materialized and virtual reads, so completed/skipped/rescheduled instances behave the same regardless of how the occurrence was generated.
- Weekend `day_time_overrides` use `metadata_json.recurrence_time_ref_ms` as the stable weekday clock. Weekend occurrences can render at the override time, then weekday recurrence, materialization, completion, and iCloud mirroring return to the original clock unless the user explicitly reschedules a weekday occurrence.

## Blackouts

- `blackout_skip_flags` — JSON array: `travelling`, `period`, `sickness`, `leave`, `wfh`; each type requires explicit opt-in (no tag-based auto-apply)
- During active blackout: affected tasks are parked in **On hold** instead of being rescheduled immediately
- On blackout disable/remove: parked tasks resume via `services/blackout.py`

## Cognitive / energy dimensions

- `cognitive_load`, `emotional_resistance`, `activation_energy`, `recovery_cost`
- `focus_type` (`shallow` / `deep` / `admin` / `creative`)
- `energy_to_reward_ratio` — shown in the UI as **Feels good after**; high when finishing feels satisfying, relieving, energizing, or worth it.

## AI defaults on task creation

New full-stack task additions call Groq through `POST /api/ai/suggest-task` to infer task parameters from the event name before `POST /api/tasks`. The suggestion covers scheduling/scoring fields such as `duration`, `effort`, `focus_type`, `importance`, `urgency`, cognitive/energy dimensions, `tiny_step`, reminder offsets, dependencies/resources, blackout skip flags, and travel buffers. The prompt includes a calibration rubric for each 0-1 field so Groq distinguishes value, urgency, cost of delay, mental load, startup friction, recovery drain, momentum, and reward instead of collapsing them into generic priority.

Explicit capture syntax still wins: parsed tags, priority markers, duration, and schedule hints are preserved over AI output. The task create endpoint applies the same suggestion service only to omitted fields, so direct API clients that send just `text` still get intelligent defaults while explicit payload values remain authoritative. If Groq returns near-zero values for a dimension that the title-derived fallback detects as meaningful, the backend restores the fallback for that field. The suggestion reasoning is stored in `metadata_json.ai_default_reasoning` when available.

Calendar imports also call the suggestion service inside `routers/calendar.py::_make_task()`. For imported events, the Groq request is title-first: the actual event name is the primary semantic signal, with imported start time, duration, calendar name, description, and location supplied as supporting context. ICS-owned fields remain authoritative: `text`, `scheduled_at`, `duration`, `client_id`, `location_dependency`, `recurrence`, `rrule`, `rrule_dtstart_ms`, and `is_recurring_template`. Groq fills the surrounding Circuit fields (`effort`, tag/focus, cognitive/energy, priority/value, reminders, resources/dependencies, blackout skip flags, travel buffers, and `tiny_step`). Event description, calendar name, color, and AI reasoning are kept in `metadata_json`.

## Priority / value

- `importance`, `urgency`, `consequence_of_delay`, `momentum_value`
- UI aliases: `consequence_of_delay` is **Cost of delay**; `momentum_value` is **Unlocks next steps**.
- `compound_benefit`, `identity_alignment`

## Behavioral (tracked)

- `historical_completion_rate` — EMA toward 100% on each completion (default 0.7); copied to next recurrence
- `skipped_count`, `last_skipped_at` — incremented on skip/defer (frontend)
- `delay_pattern` — learned after repeated skips (`peak-skip:morning|afternoon|evening`)
- `task_decomposition_potential`

## Grouping

- `group_id` — tasks sharing a label shift together when any one is rescheduled

## Sleep (indirect)

A task titled **Sleep** supplies bedtime/wake for the energy system (`scheduled_at` + `duration`). Not a separate model field.

## Sleep overrides (`SleepLog` table)

Optional per-day rows keyed by IST wake-up date: `quality`, `disturbed`, `notes`. Timing normally derived from Sleep task; overrides merged at read time.

## User state (`UserState` table)

- `energy_level` — saved 0-1 manual energy value.
- `energy_manual_override` — true only when the user explicitly overrides today's energy.
- `energy_manual_override_date` — IST `YYYY-MM-DD`; manual override is ignored after this date so the UI returns to Canopy/Circuit defaults daily.
- `stress_level`, `time_available_minutes`, `focus_mode`, `energy_eod`.

## JSON blobs

- `required_resources`, `dependencies`, `metadata_json`

## Task events (`TaskEvent` table)

Logged on complete/uncomplete/skip/reschedule. Fields: `event_type`, `occurred_at`, `metadata_json`. Single-task PATCH logs completion/uncompletion; batch command updates now log completion, uncompletion, skip, and reschedule. Manual skip/reschedule UI actions still call `POST /api/history/events` for richer action metadata. Energy and analytics consume only actual completion/work events; app-handled skip, reschedule, occurrence override, and uncompletion audit events stay in history but do not count as energy drain or analytics signals.
- `GET /api/history/events` returns recent events with task text and an `undoable` flag.
- `POST /api/history/events/{event_id}/undo` selectively reverses completion, uncompletion, skip, and reschedule rows. Skip/reschedule undo uses `metadata_json.from_ms` to restore the previous scheduled slot and reverses skip-count bumps when recorded.

- **Energy timeline** (`/api/energy/timeline`): effective time = `scheduled_at` of the linked task when set, else stored `occurred_at`. Logic in `app/task_event_time.py`.
- **Sleep work signals**: always raw `occurred_at` (when you actually worked).
- Adding or undoing an older completion replays daily energy closes from that IST date through yesterday and updates `UserState.energy_eod`, so today's opening energy changes cumulatively.
- New completions write `occurred_at` from `task_event_occurred_at()` — scheduled slot preferred.

## Scoring

Deterministic multi-factor score in `scheduling-engine/scoring.ts` — importance, urgency, overdue time, energy mode fit, cognitive penalties, duration fit. Each ranked task carries human-readable `reasons`.
