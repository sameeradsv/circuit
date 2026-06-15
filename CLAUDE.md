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
| `tasks.py` | `/api/tasks` | Task CRUD, recurrence auto-creation on completion, energy sync |
| `calendar.py` | `/api/calendar` | ICS import (lazy-load RRULE), series propagation, expiry |
| `blackouts.py` | `/api/blackouts` | Blackout date-range CRUD |
| `settings.py` | `/api/settings` | Per-user key-value settings |
| `user.py` | `/api/user` | User state (energy/stress), delete account |
| `energy.py` | `/api/energy` | Cortex energy sync |
| `history.py` | `/api/history` | Task event log |
| `search.py` | `/api/search` | Full-text task search |
| `ai.py` | `/api/ai` | Task classification heuristics |
| `sync.py` | `/api/sync` | AES-256 encrypted export/import |
| `webauthn.py` | `/api/auth/webauthn` | Passkey registration and login |

### Key database models (`backend/app/models.py`)

**`CircuitTask`** — core task record (~45 columns):
- Scheduling: `scheduled_at` (ms epoch), `recurrence` (pattern string), `duration`, `effort`
- Recurrence/calendar: `rrule` (raw RRULE string), `rrule_dtstart_ms`, `is_recurring_template` — calendar imports store one template task per series; next occurrences are generated on completion
- Blackouts: `blackout_skip_flags` (JSON array: `["travelling", "period", "sickness"]`)
- Cognitive: `cognitive_load`, `emotional_resistance`, `activation_energy`, `recovery_cost`
- Priority: `importance`, `urgency`, `consequence_of_delay`, `momentum_value`
- Behavioral: `historical_completion_rate`, `skipped_count`, `delay_pattern`

**`Blackout`** — date ranges when user is unavailable (`blackout_type`: travelling / period / sickness)

**`User`**, **`AuthSession`**, **`WebAuthnCredential`**, **`WebAuthnChallenge`**, **`UserSettings`**, **`UserState`**, **`TaskEvent`**

### Database migration pattern

Schema changes are additive — never destructive. Add a `_migrate_*()` function in `database.py` that uses `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (Postgres) or inspector-checked `ALTER TABLE` (SQLite), then call it from `on_startup` in `main.py`. Do not use Alembic.

### Frontend (`frontend/src/`)

```
app/(app)/          # Authenticated routes
  page.tsx          # Tasks dashboard
  tasks/page.tsx
  calendar/page.tsx # Day / week / month views, ICS import
  account/page.tsx  # Preferences, blackouts, export/import, passkey
  add/page.tsx
  analytics/page.tsx
  chat/page.tsx
app/(auth)/login/   # Login page
components/
  TaskDetailModal.tsx   # Edit task — priority, cognitive, time, blackout skip flags
  AppShell.tsx / TabBar.tsx / Sidebar.tsx / Nav.tsx
lib/
  api.ts            # Typed fetch wrapper for all backend endpoints
  recurrence.ts     # formatRecurrence(), QUICK_PATTERNS
  use-circuit-auth.ts
  engine-adapter.ts # Converts ApiTask → engine Task type
```

### Recurrence system

**User-created tasks** (`recurrence` field): patterns like `daily`, `weekly:MO,WE,FR`, `monthly:1MO`. On completion, `tasks.py` calls `engines/recurrence.py → next_occurrence()` and auto-creates the next task.

**Calendar imports** (`rrule` field): ICS events with RRULE are stored as a single template task (`is_recurring_template=True`) instead of being expanded to 730 individual occurrences. On completion, `_expand_rrule()` finds the next date and creates the next template. `_detect_recurrence()` in `calendar.py` also parses keywords from event titles (daily, weekday, weekend, specific day names, nth-weekday-of-month, monthly, weekly) and sets the `recurrence` field.

### Blackout system

Users mark date ranges as travelling / period / sickness in Account → Blackouts. Tasks carry a `blackout_skip_flags` list specifying which blackout types should cause them to be skipped. The frontend reads active blackouts from `GET /api/blackouts` and grays out matching tasks.

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

### Energy sync (`GET /api/tasks/sync/energy`)

Returns `drain_so_far` and `drain_ahead` (0–1 floats). Completed tasks are attributed to their `scheduled_at` day, not `updated_at` — marking an old event done today does not inflate today's energy cost. Floating tasks (no `scheduled_at`) are attributed to their completion day.

### Calendar view (`frontend/src/app/(app)/calendar/page.tsx`)

Day and week views show a full 24-hour grid (midnight to midnight, 64 px/hour) and auto-scroll to 7 AM on open. Month view shows task dots with overflow counts.

### Energy modes

Four modes — `normal | deep | low | social` — shift how the scoring algorithm weights tasks. Mode state lives in `app/modes.ts` (vanilla PWA) and `UserState.focus_mode` (backend).

## Key constraints

- **Strict TypeScript** — `"strict": true` in `frontend/tsconfig.json`; run `npx tsc --noEmit --skipLibCheck` (exclude `.next/`) before PRs.
- **Explainability first** — scheduling decisions must be deterministic and produce human-readable rationale.
- **Additive migrations only** — never drop columns or tables; always add `IF NOT EXISTS` / inspector guards.
- **Fail-safe recurrence** — recurrence auto-creation is wrapped in `try/except`; failures must never block task completion.
