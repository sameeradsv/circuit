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

The frontend uses `@shared/cortex` (installed from `github:sameeradsv/cortex`) for auth context and encrypted export. It requires `transpilePackages: ["@shared/cortex"]` in `frontend/next.config.ts`.

Auth supports **WebAuthn passkey / biometric sign-in** in addition to username + passcode. Backend endpoints: `POST /api/auth/webauthn/register/begin|complete` (requires Bearer token) and `POST /api/auth/webauthn/login/begin|complete` (public). Frontend: `src/lib/usePasskey.ts` hook + `PasskeyBanner` post-login prompt. Credentials stored in `webauthn_credentials` table; challenges in `webauthn_challenges` (2-min TTL, deleted on use).

## Architecture

Circuit is a **local-first, offline-first PWA** — pure TypeScript, no framework, no backend. All data lives in `localStorage`. The bundle is a single IIFE (`app.js`) produced by esbuild. `index.html` + `style.css` + `sw.js` (service worker) complete the app.

### Layer map

```
src/
├── types/                  # Central domain types (Task, ScoredTask, EnergyMode, etc.)
├── task-engine/            # CRUD: schema, validation, persistence (localStorage), filter
├── scheduling-engine/      # Scoring algorithm → ordered ScoredTask[], workload, conflicts
├── rescheduling-engine/    # Skip, adaptive reschedule, overload deferral, task splitting
├── behavioral-engine/      # Completion patterns, execution windows, procrastination detection
├── ai-assistance/          # Conversational parsing, human-readable explanations, predictions
├── analytics-engine/       # Metrics aggregation
├── calendar-sync/          # ICS import/export
└── app/                    # UI layer — rendering, modals, event wiring, state
    ├── main.ts             # App bootstrap, event binding, top-level state
    ├── render.ts           # Task list rendering, detail modals
    ├── dashboard.ts        # Stats & dashboard widgets
    ├── task-input.ts       # Task creation & natural-language parsing
    ├── calendar.ts         # Calendar widget
    └── modes.ts            # Energy mode switching (normal / deep / low / social)
```

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

### Task model

The `Task` type (defined in `src/types/`) has ~40 dimensions across seven groups: **time**, **cognitive/energy** (cognitiveLoad, emotionalResistance, activationEnergy), **context**, **priority/value**, **behavioral** (historicalCompletionRate, delayPattern), **metadata** (tags, tinyStep, effort), and **UI state** (skippedCount). See `docs/task-model.md` for the full breakdown.

### Energy modes

The app operates in one of four modes — `normal | deep | low | social` — which shifts how the scoring algorithm weights tasks and what the UI surfaces. Mode state is held in `app/modes.ts` and read by the scheduling engine at score time.

## Key constraints

- **No external runtime dependencies** — no React, no npm packages at runtime; esbuild only bundles TypeScript source.
- **Strict TypeScript** — `"strict": true` in tsconfig; `npm run typecheck` must pass before any PR.
- **Explainability first** — scheduling decisions must be deterministic and produce human-readable rationale; avoid opaque heuristics.
- **Local-first** — never add network calls for core functionality; all persistence goes through `src/task-engine/persistence.ts`.
