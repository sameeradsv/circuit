# Circuit

Adaptive planning PWA — local-first, offline-first task management with scheduling, rescheduling, and behavioral insights.

## Development

```bash
npm install
npm run build    # bundle src/ → app.js
npm run dev      # watch mode
npm run typecheck
npm test
```

## Architecture

Modular TypeScript under `src/`:

- `task-engine` — schema, validation, persistence, filtering
- `scheduling-engine` — scoring, heuristics, workload balancing
- `rescheduling-engine` — skip, adaptive reschedule, overload, splitting
- `behavioral-engine` — completion patterns, procrastination detection
- `recommendation-engine` / `ai-assistance` — explainable suggestions (no external API)
- `analytics-engine` / `calendar-sync` — metrics and future calendar hook
