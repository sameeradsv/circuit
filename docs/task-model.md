# Task Model

Core record: **`CircuitTask`** (~47 columns). Grouped by concern below.

## Identity & status

- `text`, `tag` (`general` / `work` / `social` / `later`), `completed`, `tiny_step`
- `client_id` — localStorage id or ICS series id (`ics:…`)

## Scheduling

- `scheduled_at` (ms epoch), `duration` (minutes)
- `effort` (`low` / `medium` / `high`), `deadline_type` (`none` / `soft` / `hard`)
- `time_sensitivity`, `preferred_execution_window` (`morning` / `afternoon` / `evening`)
- `recurrence` — user patterns: `daily`, `weekly:MO,WE`, `monthly:1MO`, `monthly:LWD`, …
- `recurrence_ends_at` — optional cutoff (ms); null = indefinite
- `post_blackout_behavior` — `resume` | `catch_up` | `catch_up_once`
- `recurrence_anchor_ms` — for `catch_up_once`: preserves pre-blackout anchor
- `rrule`, `rrule_dtstart_ms`, `is_recurring_template` — calendar ICS imports
- `day_time_overrides` — JSON `{"SA": "10:00", "SU": "10:00"}` (morning tasks only)
- `travel_buffer_before_mins`, `travel_buffer_after_mins`

## Blackouts

- `blackout_skip_flags` — JSON array: `travelling`, `period`, `sickness`, `leave`, `wfh`
- `leave` auto-applies to `tag=work` without explicit flagging
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

- `historical_completion_rate`, `skipped_count`, `last_skipped_at`
- `delay_pattern`, `task_decomposition_potential`

## Grouping

- `group_id` — tasks sharing a label shift together when any one is rescheduled

## Sleep (indirect)

A task titled **Sleep** supplies bedtime/wake for the energy system (`scheduled_at` + `duration`). Not a separate model field.

## Sleep overrides (`SleepLog` table)

Optional per-day rows keyed by IST wake-up date: `quality`, `disturbed`, `notes`. Timing normally derived from Sleep task; overrides merged at read time.

## JSON blobs

- `required_resources`, `dependencies`, `metadata_json`

## Scoring

Deterministic multi-factor score in `scheduling-engine/scoring.ts` — importance, urgency, overdue time, energy mode fit, cognitive penalties, duration fit. Each ranked task carries human-readable `reasons`.
