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
| `sleep.py` | `/api/sleep` | Sleep log CRUD + energy factor computation |
| `settings.py` | `/api/settings` | Per-user key-value settings |
| `user.py` | `/api/user` | User state (energy/stress/focus mode), delete account |
| `energy.py` | `/api/energy` | Task-event drain + sleep factor sync |
| `history.py` | `/api/history` | Task event log |
| `search.py` | `/api/search` | Full-text task search |
| `ai.py` | `/api/ai` | Task classification heuristics |
| `sync.py` | `/api/sync` | AES-256 encrypted export/import |
| `webauthn.py` | `/api/auth/webauthn` | Passkey registration and login |

### Key database models (`backend/app/models.py`)

**`CircuitTask`** — core task record (~47 columns):
- Scheduling: `scheduled_at` (ms epoch), `recurrence` (pattern string), `duration`, `effort`
- Recurrence/calendar: `rrule` (raw RRULE string), `rrule_dtstart_ms`, `is_recurring_template` — calendar imports store one template task per series; next occurrences are generated on completion
- Recurrence control: `recurrence_ends_at` (ms epoch, optional cutoff), `post_blackout_behavior` (`"resume"` | `"catch_up"`)
- Blackouts: `blackout_skip_flags` (JSON array: `["travelling", "period", "sickness", "leave"]`)
- Cognitive: `cognitive_load`, `emotional_resistance`, `activation_energy`, `recovery_cost`
- Priority: `importance`, `urgency`, `consequence_of_delay`, `momentum_value`
- Behavioral: `historical_completion_rate`, `skipped_count`, `delay_pattern`

**`Blackout`** — date ranges when user is unavailable (`blackout_type`: `travelling` / `period` / `sickness` / `leave`)

**`SleepLog`** — daily sleep context keyed by `(user_id, date)` IST wake-up date:
- `bedtime_ms`, `wake_ms` (epoch ms), `quality` (0–10 float), `disturbed` (bool), `notes` (text)
- Used by `GET /api/sleep/factor` and `GET /api/energy/sync` to compute `sleep_factor` (0–1)

**`User`**, **`AuthSession`**, **`WebAuthnCredential`**, **`WebAuthnChallenge`**, **`UserSettings`**, **`UserState`**, **`TaskEvent`**

### Database migration pattern

Schema changes are additive — never destructive. Add a `_migrate_*()` function in `database.py` that uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (Postgres) or inspector-checked `ALTER TABLE` (SQLite), then call it from `on_startup` in `main.py`. Do not use Alembic.

### Frontend (`frontend/src/`)

```
app/(app)/          # Authenticated routes
  page.tsx          # Tasks dashboard (home)
  tasks/page.tsx    # Task list with scoring, On hold section for blacked-out tasks
  calendar/page.tsx # Day / week / month views, ICS import, click-to-edit events
  account/page.tsx  # Preferences, sleep log, blackouts, export/import, passkey
  add/page.tsx
  analytics/page.tsx
  chat/page.tsx     # TerminalChat — command parser + Conduit Q&A fallback
app/(auth)/login/   # Login page
components/
  TaskDetailModal.tsx   # Edit task — priority, cognitive, time, recurrence end date, blackout skip flags, post-blackout behavior
  TerminalChat.tsx      # Command parsing + ActionPreview + Conduit agent fallback
  AppShell.tsx / TabBar.tsx / Sidebar.tsx / Nav.tsx
lib/
  api.ts            # Typed fetch wrapper for all backend endpoints (includes sleep, batchUpdate)
  recurrence.ts     # formatRecurrence(), QUICK_PATTERNS
  use-circuit-auth.ts
  engine-adapter.ts # Converts ApiTask → engine Task type
```

### Recurrence system

**User-created tasks** (`recurrence` field): patterns like `daily`, `weekly:MO,WE,FR`, `monthly:1MO`. On completion, `tasks.py` calls `engines/recurrence.py → next_occurrence()` and auto-creates the next task.

**Calendar imports** (`rrule` field): ICS events with RRULE are stored as a single template task (`is_recurring_template=True`). The template's `scheduled_at` is set to the **first occurrence on or after today** (import date); `rrule_dtstart_ms` retains the original DTSTART for correct future expansion. On completion, `_expand_rrule()` finds the next date and creates the next template.

**RRULE → recurrence mapping** (`_rrule_to_recurrence()` in `calendar.py`): On import, the raw RRULE is also parsed into Circuit's simple `recurrence` pattern (e.g. `FREQ=WEEKLY;BYDAY=MO,WE` → `weekly:MO,WE`). Keyword detection from event titles (`_detect_recurrence()`) is the fallback.

**Recurrence end date**: `recurrence_ends_at` (ms epoch) on a task prevents new occurrences from being created past this date.

### Blackout system

Users mark date ranges in Account → Blackouts. Types: `travelling`, `period`, `sickness`, `leave`.

Tasks carry `blackout_skip_flags` specifying which types cause them to be skipped. `leave` is special: it auto-applies to any task with `tag === "work"` without needing per-task flagging.

**During an active blackout**: blacked-out tasks are **hidden** from the Right now / Soon / Later sections and shown in a collapsed **"On hold"** section at the bottom of the task list.

**Post-blackout behavior** (per task, set in TaskDetailModal):
- `"catch_up"` — next recurrence lands on the first day after the blackout ends; series anchors from that new date
- `"resume"` — advances through recurrence pattern (adding intervals) until an occurrence falls after all blackouts; the series then continues from that occurrence following the original schedule

Backend: `_adjust_for_blackouts()` in `tasks.py` runs after `next_ms` is computed at task completion.

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

Three layers that together describe the user's energy state:

1. **Manual energy** — `UserState.energy_level` (0–1) + `UserState.stress_level`, set in Account → Today's context.

2. **Task-drain** — `GET /api/energy/sync` computes `drain_so_far` / `drain_ahead` from today's task events and scheduled tasks. Each task has a drain cost based on `cognitive_load`, `emotional_resistance`, `activation_energy`, `recovery_cost`, `effort`, and `duration`.

3. **Sleep + work-session factor** — `GET /api/sleep/factor` (also embedded in `/api/energy/sync` as `sleep_factor`) computes a 0–1 multiplier from:
   - **Sleep log** (logged via Account → Sleep & recovery): duration penalty (<7 h), late bedtime penalty (midnight–6 AM), early wake penalty (<6 AM), quality blend (0–10), disturbance penalty
   - **Work signals derived automatically from task events** (no user input needed): yesterday's last task event hour (late-night work penalty), yesterday's work span (>8 h penalty), today's first task event hour (early-start penalty)

`sleep_factor = 1.0` means fully rested; lower values indicate impairment. The frontend can use this alongside `manual_energy` to surface warnings like "you've been flagged as tired — high cognitive-load tasks are deprioritized".

### TerminalChat (`frontend/src/components/TerminalChat.tsx`)

Two-tier message handling:

1. **Command parser** (client-side, no API call needed): Matches action phrases before sending to the agent:
   - `push / move / reschedule / defer / shift / bump` + filter + date → batch-reschedule
   - `complete / finish / done` + filter → batch-complete
   - `prioritize / boost` + filter → batch-urgency boost
   - Filters: high cognitive-load, deep work, work, social, overdue, today, all
   - Dates: tomorrow, next week, Monday–Sunday, end of week, end of day, next month
   - Shows **ActionPreview** panel listing matched tasks and proposed change; requires **Approve / Cancel** before executing via `POST /api/tasks/batch-update`

2. **Conduit agent fallback**: For non-command messages, streams to the external Conduit service at `NEXT_PUBLIC_CONDUIT_API_URL`. Conduit has no Circuit task tools registered; it handles conversational Q&A only.

Quick-command chips in the chat UI provide one-click access to common operations.

### Calendar view (`frontend/src/app/(app)/calendar/page.tsx`)

Day and week views show a full 24-hour grid (midnight to midnight, 64 px/hour) and auto-scroll to 7 AM on open. Month view shows task dots with overflow counts. Clicking any event opens `TaskDetailModal` for inline editing.

### Energy modes

Four modes — `normal | deep | low | social` — shift how the scoring algorithm weights tasks. Mode state lives in `app/modes.ts` (vanilla PWA) and `UserState.focus_mode` (backend).

## Key constraints

- **Strict TypeScript** — `"strict": true` in `frontend/tsconfig.json`. The `.next/types/validator.ts` errors are stale build artifacts; filter them out when checking source errors.
- **Explainability first** — scheduling decisions must be deterministic and produce human-readable rationale.
- **Additive migrations only** — never drop columns or tables; always add `IF NOT EXISTS` / inspector guards.
- **Fail-safe recurrence** — recurrence auto-creation is wrapped in `try/except`; failures must never block task completion.
- **Sleep factor is advisory** — a low `sleep_factor` should surface warnings and de-prioritize demanding tasks, but must never block the user from doing anything.
