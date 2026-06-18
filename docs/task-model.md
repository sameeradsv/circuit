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

## JSON blobs

- `required_resources`, `dependencies`, `metadata_json`

## Task events (`TaskEvent` table)

Logged on complete/uncomplete/skip/reschedule. Fields: `event_type`, `occurred_at`, `metadata_json`.

- **Energy timeline** (`/api/energy/timeline`): effective time = `scheduled_at` of the linked task when set, else stored `occurred_at`. Logic in `app/task_event_time.py`.
- **Sleep work signals**: always raw `occurred_at` (when you actually worked).
- New completions write `occurred_at` from `task_event_occurred_at()` — scheduled slot preferred.

## Scoring

Deterministic multi-factor score in `scheduling-engine/scoring.ts` — importance, urgency, overdue time, energy mode fit, cognitive penalties, duration fit. Each ranked task carries human-readable `reasons`.
