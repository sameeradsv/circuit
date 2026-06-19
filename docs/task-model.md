# Task Model

Core record: **`CircuitTask`** (~47 columns). Grouped by concern below.

## Identity & status

- `text`, `tag` (`general` / `work` / `social` / `later`), `completed`, `tiny_step`
- `client_id` — localStorage id or ICS series id (`ics:…`)

## Scheduling

- `scheduled_at` (ms epoch), `duration` (minutes)
- `effort` (`low` / `medium` / `high`), `deadline_type` (`none` / `soft` / `hard`)
- `time_sensitivity`, `preferred_execution_window` (`morning` / `afternoon` / `evening`)
- `recurrence` — user patterns: `daily`, `every:4d`, `every:2w`, `every:4h`, `weekly:MO,WE`, `monthly:1MO`, `monthly:LWD`, …
- `recurrence_ends_at` — optional cutoff (ms); null = indefinite
- `post_blackout_behavior` — `resume` | `catch_up` | `catch_up_once` | `catch_up_immediate` | `catch_up_imm_shift`
- `recurrence_anchor_ms` — for `catch_up_once` / `catch_up_immediate`: preserves pre-blackout anchor (`catch_up_once` also skips too-close anchor slots on completion)
- `rrule`, `rrule_dtstart_ms`, `is_recurring_template` — calendar ICS imports
- `day_time_overrides` — JSON `{"SA": "10:00", "SU": "10:00"}` (morning tasks only)
- `travel_buffer_before_mins`, `travel_buffer_after_mins` — rendered as calendar buffer blocks and included in day/week overlap layout
- `notifications_enabled`, `notification_offset_1_mins`, `notification_offset_2_mins` — per-task browser reminder config; default is enabled with a 10-minute first reminder and no second reminder

## Virtual recurrence

- `recurring_tasks` stores recurring definitions instead of materializing every future slot: source task id, title, start datetime, duration, simple `recurrence` or imported `rrule`, optional end date, and metadata copied from the source task.
- `occurrence_overrides` stores only per-occurrence changes: `completed`, `skipped`, or `rescheduled`, plus modified start/duration when needed.
- Ranged task reads return materialized one-off tasks plus virtual occurrences with stable ids like `r_<recurringTaskId>_<occurrenceStart>`.
- Completing/skipping/rescheduling a virtual occurrence writes an override row; future occurrences remain virtual and bounded to the requested calendar/scheduler window.

## Blackouts

- `blackout_skip_flags` — JSON array: `travelling`, `period`, `sickness`, `leave`, `wfh`; each type requires explicit opt-in (no tag-based auto-apply)
- During blackout: task hidden from active list → **On hold**
- On blackout create: scheduled tasks in range rescheduled via `services/blackout.py`

## Cognitive / energy dimensions

- `cognitive_load`, `emotional_resistance`, `activation_energy`, `recovery_cost`
- `focus_type` (`shallow` / `deep` / `admin` / `creative`)
- `energy_to_reward_ratio`

## Priority / value

- `importance`, `urgency`, `consequence_of_delay`, `momentum_value`
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

Logged on complete/uncomplete/skip/reschedule. Fields: `event_type`, `occurred_at`, `metadata_json`.

- **Energy timeline** (`/api/energy/timeline`): effective time = `scheduled_at` of the linked task when set, else stored `occurred_at`. Logic in `app/task_event_time.py`.
- **Sleep work signals**: always raw `occurred_at` (when you actually worked).
- New completions write `occurred_at` from `task_event_occurred_at()` — scheduled slot preferred.

## Scoring

Deterministic multi-factor score in `scheduling-engine/scoring.ts` — importance, urgency, overdue time, energy mode fit, cognitive penalties, duration fit. Each ranked task carries human-readable `reasons`.
