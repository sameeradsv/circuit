# Circuit

Adaptive planning PWA — local-first, offline-first task management with scheduling, rescheduling, and behavioral insights.

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

A separate Next.js UI that uses `@shared/cortex` for auth.

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
