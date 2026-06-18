# Circuit Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Vanilla PWA (src/)          Next.js frontend (frontend/)   │
│  esbuild IIFE → app.js       App Router, React 19, Tailwind │
│  localStorage tasks          api.ts → FastAPI backend       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  FastAPI backend    │
                    │  SQLAlchemy 2.0     │
                    │  SQLite / Postgres  │
                    └─────────────────────┘
```

Both apps share **TypeScript engines** under `src/*-engine/` (scoring, recurrence, rescheduling, behavioral).

## Backend (`backend/app/`)

| Layer | Role |
|-------|------|
| `routers/` | HTTP endpoints — tasks, calendar, blackouts, sleep, energy, auth, agent, sync |
| `models.py` | ORM: `CircuitTask`, `Blackout`, `SleepLog`, `UserState`, `TaskEvent`, … |
| `services/blackout.py` | Blackout overlap checks, `adjust_for_blackouts`, proactive reschedule on blackout create |
| `services/export_crypto.py` | Encrypted backup blobs |
| `engines/recurrence.py` | Pattern → next occurrence (shared logic with frontend) |
| `routers/calendar.py` | ICS parse/import/export, `_expand_rrule`, `_snap_start_to_cutoff`, `_first_future_ms` |
| `task_event_time.py` | Map task events to scheduled slot for energy timeline (write + read) |
| `database.py` | Additive migrations on startup (no Alembic) |

Key routers: see `CLAUDE.md` router table.

## Frontend (`frontend/src/`)

| Area | Role |
|------|------|
| `app/(app)/` | Authenticated pages — tasks, calendar, account, chat |
| `components/task-detail/` | TaskDetailModal sections (priority, cognitive, time, blackouts, series) |
| `components/calendar/` | Blackout calendar overlays |
| `components/` | `AppShell`, `Sidebar`, `WorkloadBar`, `BehavioralInsights`, `EnergyModeSwitcher`, `TerminalChat`, `SwipeTaskRow`, `task-detail/*`, `calendar/BlackoutLayers` |
| `lib/task-ranking.ts` | Shared Home/Tasks ranking → engine `scoreTasks` |
| `lib/vanilla-migrate.ts` | Detect/import `localStorage` `circuit_tasks_v1*` → `POST /api/tasks/migrate` |
| `lib/api.ts` | Typed fetch - `migrateTasks`, date-aware `getSummary`, search, classify, energy, tasks |
| `lib/engine-adapter.ts` | `ApiTask` → engine `Task` |
| `lib/blackout-utils.ts` | Calendar blackout overlap + tint colors |
| `lib/calendar-layout.ts` | Side-by-side columns for overlapping day/week events, including travel-buffer spans |
| `lib/use-effective-energy.ts` | Canopy-default effective energy; Account manual override |
| `lib/use-combined-energy.ts` | Per-app sync fetch + composite blend (Add page) |
| `lib/task-cache.ts` | 30s in-memory task list cache |

## Engines (`src/` — shared)

| Engine | Role |
|--------|------|
| **scheduling-engine** | Multi-factor task scoring, explainable reasons |
| **rescheduling-engine** | Skip, adaptive moves, overload reduction |
| **task-engine** | Schema, validation (vanilla PWA persistence) |
| **behavioral-engine** | Completion patterns |
| **calendar-sync** | ICS parsing (vanilla); backend has parallel import in `calendar.py` |

## Data

**Full-stack**: PostgreSQL (prod) or SQLite (`backend/data/circuit.db` dev). All user data keyed by `user_id`.

**Vanilla PWA**: `localStorage` `circuit_tasks_v1[_username]`, account hashes in `circuit_auth_users_v1`.

## Cross-app energy

| App | Sync endpoint | Timeline endpoint | Event time source |
|-----|---------------|-------------------|-------------------|
| Circuit | `GET /api/energy/sync` | `GET /api/energy/timeline` | Task `scheduled_at` (fallback: `TaskEvent.occurred_at`) |
| Canopy | `GET /api/sync/energy` | `GET /api/sync/energy/timeline` | Interaction `occurred_at` |
| Chef | `GET /sync/energy` | `GET /energy/timeline` | Meal `timestamp` |

**Circuit UI energy (Home, Tasks, Sidebar):** `use-effective-energy.ts` — **Canopy `energy_so_far` by default**; Account **Override with manual energy level** (`user_state.energy_manual_override`) switches to saved `energy_level`. Set `NEXT_PUBLIC_CANOPY_API_URL` (+ shared Cortex JWT) in `frontend/.env.local`.

**Add page slot suggest:** `use-combined-energy.ts` blends Circuit + Canopy + Chef for composite hints.

**Canopy Energy page** (`canopy/frontend/src/app/energy/page.tsx`) renders the merged chart when `NEXT_PUBLIC_CIRCUIT_API_URL` / `CHEF_API_URL` are set; it authenticates sibling calls with Canopy's Cortex JWT (`canopy_auth_token`), not per-app tokens from other origins.

Sleep **work signals** in Circuit (`sleep.py`) still use raw task-event completion timestamps — separate from energy timeline placement.

## Docs

Product reference: `CLAUDE.md` (agent/developer guide). Decisions: [DECISIONS.md](./DECISIONS.md). User-facing feature list: [features.md](./features.md). Task fields: [task-model.md](./task-model.md).
