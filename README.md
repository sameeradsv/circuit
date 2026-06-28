# Circuit

Adaptive planning PWA — local-first, offline-first task management with scheduling, rescheduling, and behavioral insights.

## Vision

Circuit is an adaptive planning assistant that understands:
- changing energy levels and cognitive fatigue
- emotional resistance and activation energy
- shifting priorities and interruptions
- recovery needs and behavioral patterns

## Engineering principles

- Local-first, offline-first — no network calls for core functionality
- Explainable scheduling — deterministic, human-readable rationale
- Modular architecture — each engine has a single responsibility
- Strict TypeScript — `"strict": true`, typecheck must pass before any PR

### UX intent

The app should feel calm, adaptive, supportive, and realistic.

## Development

### Vanilla PWA (`src/` → `app.js`)

```bash
npm install
npm run build    # bundle src/ → app.js (esbuild IIFE)
npm run dev      # watch mode
npm run typecheck
npm test
```

### Next.js frontend (`frontend/`)

```bash
cd frontend
npm install
cp .env.local.example .env.local   # set NEXT_PUBLIC_CANOPY_API_URL for cross-app energy
npm run dev      # dev server at localhost:3000
npm run build
```

### Backend deployment (`backend/`)

The FastAPI backend is configured for Vercel Python Functions:

- Vercel project root: `backend`
- Framework preset: Other
- Install command: `pip install -r requirements.txt`
- Entrypoint: `api/index.py`
- Required production env: `DATABASE_URL`, `CORS_ORIGINS`, `CORTEX_AUTH_URL`, `INIT_DB_ON_STARTUP=false`
- Optional env: `GROQ_API_KEY` for `/chat`, `/api/ai/classify`, and Groq-backed task default suggestions; `CIRCUIT_TASK_SUGGEST_MODEL` can override the suggestion model.

For a new database, or before deploying schema changes while startup DB init is disabled:

```bash
cd backend
DATABASE_URL="postgresql://..." python -m app.database
```

## Architecture

### Vanilla PWA

Modular TypeScript under `src/`, bundled to a single IIFE by esbuild. All data in `localStorage`.

- `task-engine` — schema, validation, persistence, filtering
- `scheduling-engine` — scoring, heuristics, workload balancing
- `rescheduling-engine` — skip, adaptive reschedule, overload, splitting
- `behavioral-engine` — completion patterns, procrastination detection
- `recommendation-engine` / `ai-assistance` — explainable suggestions (no external API)
- `analytics-engine` / `calendar-sync` — metrics and future calendar hook

### Next.js frontend

Next.js 15 + Tailwind under `frontend/src/`. Uses `@shared/cortex` (installed from `github:sameeradsv/cortex#master`) for auth context and encrypted export. All pages consume a single `AuthProvider` in the root layout — there is no separate per-page auth hook.

## Recent features

| Feature | Notes |
|---------|-------|
| **Canopy-default energy** | Home/Tasks/Sidebar use Canopy `energy_so_far` by default; optional same-day manual override in Account → Today's context |
| **Calendar navigation + layout** | Day/week/month support arrows and swipe/trackpad navigation; day view has the date strip; day/week overlaps account for travel buffers, virtual recurring slots, and minimum rendered event height; month view scrolls horizontally and vertically |
| **Home focus window** | Read-only countdown to next scheduled event; shows busy/blocked when the current time is inside a calendar task |
| **Groq task defaults** | Home/Tasks quick-add and calendar imports call `POST /api/ai/suggest-task` so new tasks infer effort, focus type, priority, cognitive/energy fields, reminders, and a tiny step from the event name; review opens TaskDetailModal for overrides |
| **Account preferences fix** | Form waits for API load before render; default bedtime and wake time on shared row |
| **Manual datetime picker** | Set exact scheduled date + time when adding or editing a task |
| **Voice input** | Dictate tasks on the Add page and quick-add row (Web Speech API) |
| **Virtual recurrence** | Recurring commitments are stored once in `recurring_tasks`, expanded only for visible/planning windows, customized through `occurrence_overrides`, and support stable weekend time overrides |
| **ICS import** | Upload `.ics` from iCloud or any calendar; recurring series → one template at **next occurrence on or after today** plus a virtual recurrence definition. Calendar start/end time, duration, UID, and RRULE stay authoritative while Groq fills Circuit planning fields around the event. |
| **Hideable mobile nav** | Mobile uses a slide-in vertical sidebar with a menu button instead of bottom tabs |
| **Selected-day analytics load** | Analytics workload can be switched by date and totals scheduled minutes overlapping the selected IST day, including Sleep blocks |
| **Per-task reminders** | Task detail supports two browser notification timings per scheduled task, gated by the global sidebar bell |
| **Biometric sign-in** | Moved from a post-login banner to a persistent toggle in Account → Security |
| **Safe-area insets** | `viewport-fit=cover` + `env(safe-area-inset-*)` on fixed sidenav/drawer; correct 100dvh sizing |

## Conduit integration

Circuit's backend is consumed by **conduit** — the hub app that provides cross-app AI chat and diary routing.

- **Agent reads:** `GET /api/tasks`, `GET /api/summary` — conduit answers "What are my tasks today?"
- **Diary writes:** `POST /api/tasks` — conduit's diary mode creates tasks from freeform entries

Circuit also has an embedded terminal chat at `/chat` (in the nav), powered by Circuit's native Groq agent at `POST /api/agent/chat`. Requires `GROQ_API_KEY` on the backend (see `CIRCUIT_AGENT_MODEL` / `CIRCUIT_AGENT_PROVIDER` env vars). No Conduit dependency for in-app chat.

Auth supports **passkey / biometric sign-in** via WebAuthn. Enable or check status in **Account → Security**. Registration: `POST /api/auth/webauthn/register/begin` → `/register/complete`. Login: `POST /api/auth/webauthn/login/begin` → `/login/complete` (returns JWT).

## Docs

- [Architecture](docs/architecture.md)
- [Decisions](docs/DECISIONS.md)
- [Deferred & future work](docs/DEFERRED.md) — canonical backlog / roadmap
- [Task model](docs/task-model.md)
- [App features](docs/features.md)
