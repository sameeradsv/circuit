# Circuit Architecture

## Runtime

Static PWA: `index.html`, bundled `app.js` (esbuild from `src/main.ts`), `style.css`, service worker.

## App layer (`src/app/`)

| Module | Role |
|--------|------|
| `navigation.ts` | Hash routing, page visibility |
| `dashboard.ts` | Home workload, forecast, schedule |
| `calendar.ts` | Day / week strip view |
| `task-input.ts` | Presets + form → task |
| `dimensions.ts` | Shared dimension editor |
| `auth.ts` | Local accounts, session, storage namespace |
| `sync-bundle.ts` | JSON backup export/import |
| `render.ts` | Task list + detail modal |
| `import.ts` | Text task import |

## Engines (`src/*-engine/`)

- **task-engine** — schema, validation, persistence (namespaced per user)
- **scheduling-engine** — scoring, conflicts, workload
- **rescheduling-engine** — skip, split, overload, adaptive moves
- **behavioral-engine** — completion patterns, recommendations
- **analytics-engine** — aggregates for dashboard
- **recommendation-engine** — suggestions
- **ai-assistance** — conversational capture, explanations
- **calendar-sync** — ICS import/export

## Data

- Tasks: `localStorage` key `circuit_tasks_v1` or `circuit_tasks_v1_<username>`
- Accounts: `circuit_auth_users_v1` (salt + pass hash only)
- Session: `localStorage` `circuit_session_v1`

## Docs

Product docs live in `docs/` (this folder). See [README](./README.md).
