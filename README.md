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
| **Canopy-default energy** | Home/Tasks/Sidebar use Canopy `energy_so_far` by default; optional manual override in Account → Today's context |
| **Calendar navigation + layout** | Day/week/month support arrows, date strip, and swipe/trackpad navigation; day/week overlaps account for travel buffers; month view scrolls horizontally and vertically |
| **Home focus window** | Read-only countdown to next scheduled event (no manual duration override) |
| **Account preferences fix** | Form waits for API load before render; default bedtime and wake time on shared row |
| **Manual datetime picker** | Set exact scheduled date + time when adding or editing a task |
| **Voice input** | Dictate tasks on the Add page and quick-add row (Web Speech API) |
| **ICS import** | Upload `.ics` from iCloud or any calendar; recurring series → one template at **next occurrence on or after today** (re-import to refresh after importer updates) |
| **Hideable mobile nav** | Mobile uses a slide-in vertical sidebar with a menu button instead of bottom tabs |
| **Selected-day analytics load** | Analytics workload can be switched by date; Sleep blocks are excluded from load but still block the calendar |
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
- [Deferred & future work](docs/DEFERRED.md) — canonical ecosystem backlog
- [Task model](docs/task-model.md)
- [App features](docs/features.md)
- [Backlog](docs/BACKLOG.md)
- [Roadmap](docs/roadmap.md)
