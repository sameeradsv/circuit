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

Next.js 15 + Tailwind under `frontend/src/`. Uses `@shared/cortex` (installed from `github:sameeradsv/cortex`) for auth context and encrypted export.

## Conduit integration

Circuit's backend is consumed by **conduit** — the hub app that provides cross-app AI chat and diary routing.

- **Agent reads:** `GET /api/tasks`, `GET /api/summary` — conduit answers "What are my tasks today?"
- **Diary writes:** `POST /api/tasks` — conduit's diary mode creates tasks from freeform entries

Circuit also has an embedded terminal chat at `/chat` (in the nav), powered by conduit's backend with the `scope=circuit` tool set. Set `NEXT_PUBLIC_CONDUIT_API_URL` in `frontend/.env.local` to point to the conduit backend (default: `http://localhost:8000`).

Auth supports **passkey / biometric sign-in** via WebAuthn (`usePasskey` hook, `PasskeyBanner` post-login prompt). Registration challenge: `POST /api/auth/webauthn/register/begin` → `/register/complete`. Login: `POST /api/auth/webauthn/login/begin` → `/login/complete` (returns JWT).

## Docs

- [Architecture](docs/architecture.md)
- [Task model](docs/task-model.md)
- [App features](docs/features.md)
- [Backlog](docs/BACKLOG.md)
- [Roadmap](docs/roadmap.md)
