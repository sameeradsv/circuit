# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Vanilla PWA (root)

```bash
npm install           # Install dependencies
npm run dev           # Watch mode (rebuilds on save)
npm run build         # Bundle src/ → app.js (esbuild IIFE)
npm run typecheck     # TypeScript strict-mode check (no emit)
npm run test:unit     # Jest unit tests only
npm run test:e2e      # Playwright e2e tests only
npm test              # build + unit tests
npm run test:all      # build + unit + e2e
```

Running a single test file:
```bash
npx jest tests/unit/engines.test.ts
```

### Next.js frontend (`frontend/`)

```bash
cd frontend
npm install
npm run dev      # dev server at localhost:3000
npm run build
npm run start
```

TypeScript check (exclude stale `.next/` artifacts):
```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep "error TS" | grep -v "validator.ts"
```

### Python backend (`backend/`)

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload   # API at localhost:8000
```

Database: SQLite in `backend/data/circuit.db` (dev) or PostgreSQL via `DATABASE_URL` env var (prod).

## Architecture

Circuit has two separate apps that share the same TypeScript engine layer:

1. **Vanilla PWA** (root `src/`) — pure TypeScript, esbuild IIFE bundle, data in `localStorage`. No backend required.
2. **Next.js frontend** (`frontend/`) + **FastAPI backend** (`backend/`) — full-stack version with server-side persistence, multi-device sync, and calendar import.

### Backend stack

- **Framework:** FastAPI (Python)
- **ORM:** SQLAlchemy 2.0 with declarative models
- **Database:** SQLite (dev) / PostgreSQL (prod)
- **Auth:** JWT sessions + WebAuthn passkey / biometric sign-in
- **Migrations:** additive `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` functions called on startup in `app/main.py` → `app/database.py`

### Backend routers (`backend/app/routers/`)

| Router | Prefix | Purpose |
|--------|--------|---------|
| `auth.py` | `/api/auth` | Register, login, JWT, WebAuthn begin/complete |
| `tasks.py` | `/api/tasks` | Task CRUD, recurrence auto-creation on completion, blackout-aware next-occurrence, batch-update |
| `calendar.py` | `/api/calendar` | ICS import (lazy-load RRULE, first-future-occurrence), series propagation, expiry |
| `blackouts.py` | `/api/blackouts` | Blackout date-range CRUD |
| `sleep.py` | `/api/sleep` | Sleep overrides + factor; timing from **Sleep** calendar task |
| `settings.py` | `/api/settings` | Per-user key-value settings |
| `user.py` | `/api/user` | User state (energy/stress/focus mode), delete account |
| `energy.py` | `/api/energy` | Cumulative energy timeline (signed deltas, running balance, cross-day carry-over) + real-time sync |
| `history.py` | `/api/history` | Task event log |
| `search.py` | `/api/search` | Full-text task search |
| `ai.py` | `/api/ai` | Task classification heuristics |
| `agent.py` | `/api/agent` | Circuit-native Claude agent with task/energy tools |
| `sync.py` | `/api/sync` | AES-256 encrypted export/import |
| `webauthn.py` | `/api/auth/webauthn` | Passkey registration and login |

### Key database models (`backend/app/models.py`)

**`CircuitTask`** — core task record (~47 columns):
- Scheduling: `scheduled_at` (ms epoch), `recurrence` (pattern string), `duration`, `effort`
- Recurrence/calendar: `rrule` (raw RRULE string), `rrule_dtstart_ms`, `is_recurring_template` — calendar imports store one template task per series; next occurrences are generated on completion
- Recurrence control: `recurrence_ends_at` (ms epoch, optional cutoff; null = indefinite), `post_blackout_behavior` (`"resume"` | `"catch_up"` | `"catch_up_once"` | `"catch_up_immediate"`), `recurrence_anchor_ms` (ms epoch, nullable — set on anchor-preserving catch-up modes to preserve the pre-blackout series anchor)
- Blackouts: `blackout_skip_flags` (JSON array of types that cause this task to be skipped)
- Cognitive: `cognitive_load`, `emotional_resistance`, `activation_energy`, `recovery_cost`
- Priority: `importance`, `urgency`, `consequence_of_delay`, `momentum_value`
- Behavioral: `historical_completion_rate`, `skipped_count`, `delay_pattern`
- Grouping: `group_id` (String, nullable, indexed) — tasks sharing the same label shift together when any one is rescheduled
- Weekend override: `day_time_overrides` (JSON `{"SA": "10:00", "SU": "10:00"}`) — overrides recurrence time on Sat/Sun, but **only for morning tasks** (original `scheduled_at` hour < 12); afternoon/evening tasks are never shifted
- Travel: `travel_buffer_before_mins`, `travel_buffer_after_mins` (Integer, nullable) — travel/transit time blocked before/after; shown as hatched buffer zones in calendar

**`Blackout`** — date ranges when user is unavailable (`blackout_type`: `travelling` / `period` / `sickness` / `leave` / `wfh`)

**`SleepLog`** — optional daily overrides keyed by `(user_id, date)` IST wake-up date:
- `quality`, `disturbed`, `notes` — user overrides from Account → Sleep & recovery
- `bedtime_ms` / `wake_ms` — optional manual override (legacy); normally derived from a **Sleep** task (`scheduled_at` + `duration`)
- Default quality from `UserSettings.default_sleep_quality` (7/10) when not overridden
- `GET /api/sleep/overrides` — paginated list of saved override rows

**`UserState`** — `energy_level` (manual 0–1 slider), `stress_level`, `focus_mode`, `energy_eod` (nullable float — closing energy balance of the previous day, used for cross-day carry-over in `_start_energy()`).

**`User`**, **`AuthSession`**, **`WebAuthnCredential`**, **`WebAuthnChallenge`**, **`UserSettings`**, **`TaskEvent`**

### Database migration pattern

Schema changes are additive — never destructive. Add a `_migrate_*()` function in `database.py` that uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (Postgres) or inspector-checked `ALTER TABLE` (SQLite), then call it from `on_startup` in `main.py`. Do not use Alembic.

Current migrations in startup order: `_migrate_sqlite`, `_migrate_postgres`, `_migrate_webauthn_tables`, `_migrate_blackout_and_rrule`, `_migrate_recurrence_extra`, `_migrate_sleep_log`, `_migrate_energy_eod` (adds `user_state.energy_eod`), `_migrate_task_groups` (adds `group_id`, `day_time_overrides`, `travel_buffer_before_mins`, `travel_buffer_after_mins`), `_migrate_recurrence_anchor` (adds `circuit_tasks.recurrence_anchor_ms`).

### Frontend (`frontend/src/`)

```
app/(app)/          # Authenticated routes
  page.tsx          # Tasks dashboard (home)
  tasks/page.tsx    # Task list with scoring, On hold section for blacked-out tasks
  calendar/page.tsx # Day / week / month views, drag-and-drop reschedule, blackout shading, ICS import
  account/page.tsx  # Preferences, sleep overrides, blackouts, export/import, passkey
  add/page.tsx
  analytics/page.tsx
  chat/page.tsx     # TerminalChat — command parser + native Circuit agent (Claude) + client-side help
app/(auth)/login/   # Login page
components/
  TaskDetailModal.tsx   # Re-export from task-detail/
  task-detail/          # Modal sections: priority, cognitive, time/recurrence, blackouts, series panel
  calendar/BlackoutLayers.tsx  # Calendar blackout tint overlays
  TerminalChat.tsx      # Command parsing + ActionPreview + client-side recurrence/blackout help + Circuit native agent fallback
  AppShell.tsx / TabBar.tsx / Sidebar.tsx / Nav.tsx
lib/
  api.ts                  # Typed fetch wrapper for all backend endpoints (includes sleep, batchUpdate)
  recurrence.ts           # formatRecurrence(), QUICK_PATTERNS
  use-circuit-auth.ts
  engine-adapter.ts       # Converts ApiTask → engine Task type
  use-combined-energy.ts  # Cross-app energy hook. Fetches Circuit /api/energy/sync, Canopy /api/sync/energy, Chef /sync/energy.
                          # Returns composite (weighted blend) + per-source breakdown + startEnergy (sleep-derived opening balance).
                          # Circuit energy = running_energy (start_energy + today's task deltas); falls back to manual_energy×0.7 + energy_so_far×0.3.
  use-energy-level.ts     # Manual energy slider (1–10 localStorage, mapped to 0–1)
  use-energy-mode.ts      # Energy mode (normal/deep/low/social) localStorage
```

### Recurrence system

**User-created tasks** (`recurrence` field): patterns like `daily`, `weekly:MO,WE,FR`, `monthly:1MO`. On completion, `tasks.py` calls `engines/recurrence.py → next_occurrence()` and auto-creates the next task.

Supported recurrence patterns:
- `daily` — every day
- `every:4d`, `every:2w`, `every:4h` — every N days / N weeks / N hours (e.g. `every:4d` = every 4 days)
- `weekday` — Mon–Fri
- `weekend` — Sat & Sun
- `monday` … `sunday` — every specific weekday
- `weekly:MO,WE,FR` — specific days (comma-separated two-letter codes)
- `monthly:15` — 15th of each month
- `monthly:1MO` — 1st Monday; `monthly:3FR` — 3rd Friday; `monthly:LFR` — last Friday
- `monthly:LWD` — last working day (last Mon–Fri) of the month; exports as `FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1`

**Calendar imports** (`rrule` field): ICS events with RRULE are stored as a single template task (`is_recurring_template=True`). The template's `scheduled_at` is set to the **first occurrence on or after today** (import date); `rrule_dtstart_ms` retains the original DTSTART for correct future expansion. On completion, `_expand_rrule()` finds the next date and creates the next template.

RRULE cutoff snapping (`_snap_start_to_cutoff` in `calendar.py`): when advancing from an old DTSTART, the expander aligns to the **pattern** (e.g. `FREQ=WEEKLY` without `BYDAY` repeats on DTSTART's weekday — common iCloud export). Without this, everything incorrectly landed on import day.

Detached instances with `RECURRENCE-ID` import as **one-offs** (not series masters), even if the VEVENT also carries an RRULE line.

One-off future events use their ICS `DTSTART` directly. Past one-offs are skipped. **Re-import** is required to fix tasks imported before the snap fix; there is no DB migration.

IST timezone note: `_first_future_ms()` validates the IST weekday of each candidate against explicit `BYDAY` before accepting it, guarding against UTC/IST date-boundary mismatches in the expander.

**RRULE → recurrence mapping** (`_rrule_to_recurrence()` in `calendar.py`): On import, the raw RRULE is also parsed into Circuit's simple `recurrence` pattern (e.g. `FREQ=WEEKLY;BYDAY=MO,WE` → `weekly:MO,WE`). Keyword detection from event titles (`_detect_recurrence()`) is the fallback.

**Recurrence end date**: `recurrence_ends_at` (ms epoch) prevents new occurrences from being created past this date. Null = indefinite.

### Blackout system

Users mark date ranges in Account → Blackouts. Types: `travelling`, `period`, `sickness`, `leave`, `wfh`.

Tasks carry `blackout_skip_flags` specifying which types cause them to be skipped. `leave` is special: it auto-applies to any task with `tag === "work"` without needing per-task flagging. All other types (including `wfh`) require explicit per-task opt-in via the skip flags.

**During an active blackout**: blacked-out tasks are **hidden** from the Right now / Soon / Later sections and shown in a collapsed **"On hold"** section at the bottom of the task list.

**Calendar**: blackout date ranges render as tinted day backgrounds (day/week/month views) via `lib/blackout-utils.ts`.

**On blackout create**: `POST /api/blackouts` calls `services/blackout.py → reschedule_tasks_for_blackout()` — affected open tasks scheduled inside the range are moved per each task's `post_blackout_behavior`. Response includes `tasks_rescheduled` count.

**Post-blackout behavior** (per task, set in TaskDetailModal → task-detail sections):
- `"resume"` — skips ahead through the recurrence pattern until an occurrence falls after all blackouts; the series continues from that occurrence on the original schedule (no catch-up)
- `"catch_up"` — moves to the **next valid recurrence slot** after the blackout and anchors the **entire series** from that new date
- `"catch_up_once"` — next valid slot once, then resumes the original schedule via `recurrence_anchor_ms`; anchor-based occurrences within **2 days** of the catch-up date are skipped
- `"catch_up_immediate"` — moves to the **first day after the blackout ends**, preserves the original series anchor, and does **not** skip the next anchor slot (even if close)

Backend: `services/blackout.py → adjust_for_blackouts()` runs after `next_ms` is computed at task completion (and on blackout create). `catch_up` / `catch_up_once` use the next pattern slot; `catch_up_immediate` uses the day after blackout. One-off tasks on `resume` move to the first day after the blackout ends.

### Scheduling algorithm (`src/scheduling-engine/scoring.ts`)

Tasks are ranked by a deterministic multi-factor score (no ML, no external API):
- Importance + urgency: up to 40 pts
- Overdue scheduled time: +25 pts
- Energy mode fit: mode-aware bonus/penalty
- Tiny-step presence: +10 pts
- Momentum value: +15 pts
- Cognitive load / emotional resistance / skip count: penalties
- Energy-to-reward ratio: +12 pts
- Duration fit: ±5–15 pts

Each `ScoredTask` carries an `explanation` string so the UI can show *why* a task was ranked where it was.

### Energy system

Energy is modelled as a **running balance** (0–1) that accumulates through the day and carries over across days — not as isolated per-event snapshots.

**Three layers:**

1. **Manual energy** — `UserState.energy_level` (0–1) + `UserState.stress_level`, set in Account → Today's context.

2. **Cumulative task-event balance** — `GET /api/energy/timeline` returns a day's events each with:
   - `delta` — signed energy change (positive = restores, negative = drains)
   - `running_energy` — cumulative balance after this event (0–1)
   - `start_energy` / `end_energy` — opening and closing balance for the day
   
   Task deltas: completing a high `energy_to_reward_ratio` task can be net-positive; skipping costs willpower (−0.05 to −0.20); uncompleting costs recovery (−0.05 to −0.25); heavy cognitive-load completions drain even if "done".

   **Event time on the timeline** uses the task's **scheduled slot** (`scheduled_at`) when present, not wall-clock completion time (`app/task_event_time.py`). New `TaskEvent` rows are written the same way; the timeline read path also maps existing rows via `effective_event_time()` so historical data aligns without migration. Unscheduled tasks and explicit `POST /api/history/events` `occurred_at` still use actual/log time. **Sleep work signals** (`sleep.py → _get_work_signals`) intentionally keep raw `TaskEvent.occurred_at` (actual work hours matter for late-night penalties).

   `GET /api/energy/sync` also returns `start_energy` and `running_energy` (real-time balance for Circuit's task events only), plus legacy `drain_so_far` / `drain_ahead` for backward compat.

3. **Sleep + work-session factor** — timing from the **Sleep** calendar task; quality/disturbed overrides optional on Account. `GET /api/sleep/factor` (also embedded in `/api/energy/sync` as `sleep_factor`) computes a 0–1 multiplier from:
 - **Sleep task** (or manual times): duration, late bedtime, early wake
 - **Override quality** (default 7/10 from settings unless overridden)
 - **Disturbed sleep** penalty when flagged
 - **Work signals** derived automatically from task events (no user input needed): yesterday's last task event hour (late-night work penalty), yesterday's work span (>8 h penalty), today's first task event hour (early-start penalty)

**Cross-day carry-over:**

`start_energy = sleep_factor × 0.70 + energy_eod × 0.30`

- `energy_eod` (stored in `UserState.energy_eod`, nullable float) = closing balance of the previous day.
- Written automatically when yesterday's timeline is fetched (the energy page does this on load).
- Sleep is the primary restorer: perfect sleep (factor 1.0) after a bad day (eod 0.3) → start at ~79%.
- Consistently draining weeks lower eod, compounding into lower starts even with adequate sleep.

`sleep_factor = 1.0` means fully rested; lower values indicate impairment. The frontend can use this alongside `manual_energy` to surface warnings like "you've been flagged as tired — high cognitive-load tasks are deprioritized".

### TerminalChat (`frontend/src/components/TerminalChat.tsx`)

Three-tier message handling:

1. **Command parser** (client-side, no API call needed): Matches action phrases before sending to the agent:
   - `push / move / reschedule / defer / shift / bump` + filter + date → batch-reschedule
   - `complete / finish / done` + filter → batch-complete
   - `prioritize / boost` + filter → batch-urgency boost
   - Filters: high cognitive-load, deep work, work, social, overdue, today, all
   - Dates: tomorrow, next week, Monday–Sunday, end of week, end of day, next month
   - Shows **ActionPreview** panel listing matched tasks and proposed change; requires **Approve / Cancel** before executing via `POST /api/tasks/batch-update`

2. **Client-side recurrence/blackout help**: Messages mentioning recurrence/repeat/patterns/blackout/catch-up are answered client-side with the full format reference — avoids an API round-trip.

3. **Circuit native agent** (`POST /api/agent/chat`): For all other messages, streams to Circuit's backend agent (`backend/app/routers/agent.py`). **Default provider: Groq** (`GROQ_API_KEY`, model `llama-3.3-70b-versatile` via `CIRCUIT_AGENT_MODEL`) with tool calling — same stack as Conduit. Falls back to Claude (`claude-haiku-4-5-20251001`) when only `ANTHROPIC_API_KEY` is set. Override with `CIRCUIT_AGENT_PROVIDER=groq|anthropic`. Tools available:
   - `get_today_summary` — today's tasks: completed, pending, overdue, time blocked, by-tag breakdown
   - `get_tasks` — filtered task list (focus_type, tag, min_cognitive_load, days_ahead)
   - `get_energy_context` — current energy_level, stress_level, focus_mode from UserState
   - Agent knows all recurrence patterns from its system prompt; no tool needed for format questions
   - Requires `GROQ_API_KEY` or `ANTHROPIC_API_KEY` on the backend; returns an error if neither is set

Quick-command chips: "How busy is today?", "What are my deep work tasks this week?", plus batch-move commands that trigger the command parser.

### Calendar view (`frontend/src/app/(app)/calendar/page.tsx`)

Day and week views show a full 24-hour grid (midnight to midnight, 64 px/hour) and auto-scroll to 7 AM on open. Month view shows task chips with overflow counts. All views support **drag-and-drop** reschedule (recurring tasks prompt occurrence vs series). Blackout ranges appear as tinted backgrounds. Clicking any event opens `TaskDetailModal` for inline editing.

Tasks with `travel_buffer_before_mins` / `travel_buffer_after_mins` render hatched gray blocks before/after the task block in day and week views, indicating blocked transit time.

### Energy modes

Four modes — `normal | deep | low | social` — shift how the scoring algorithm weights tasks. Mode state lives in `app/modes.ts` (vanilla PWA) and `UserState.focus_mode` (backend).

## Key constraints

- **Strict TypeScript** — `"strict": true` in `frontend/tsconfig.json`. The `.next/types/validator.ts` errors are stale build artifacts; filter them out when checking source errors.
- **Explainability first** — scheduling decisions must be deterministic and produce human-readable rationale.
- **Additive migrations only** — never drop columns or tables; always add `IF NOT EXISTS` / inspector guards.
- **Fail-safe recurrence** — recurrence auto-creation is wrapped in `try/except`; failures must never block task completion.
- **Sleep factor is advisory** — a low `sleep_factor` should surface warnings and de-prioritize demanding tasks, but must never block the user from doing anything.
