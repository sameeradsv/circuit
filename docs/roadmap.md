# Roadmap

## Implemented (full-stack app)

- FastAPI backend with JWT + WebAuthn passkeys
- Task CRUD, recurrence auto-creation, batch-update, ICS calendar import (RRULE snap to next valid occurrence; iCloud `FREQ=WEEKLY` without `BYDAY`)
- Blackouts: on-hold UI, post-blackout behaviors, calendar shading, proactive reschedule on create
- Sleep from **Sleep** calendar task + quality/disturbed overrides + default quality setting
- Cumulative energy timeline with cross-day carry-over (`energy_eod`); task events mapped to scheduled slot on timeline
- Calendar day/week/month with drag-and-drop
- TaskDetailModal (modular `task-detail/` sections)
- TerminalChat batch commands + Circuit native **Groq** agent
- Encrypted export/import
- Cross-app energy hook (Canopy, Chef)
- Analytics — `GET /api/summary` + **WorkloadBar** + **BehavioralInsights** (engine-driven)
- Unified task ranking on Home/Tasks via `lib/task-ranking.ts` → scheduling engine
- Account → vanilla PWA `localStorage` import (`POST /api/tasks/migrate`)
- Home top-pick actions wired (snooze, rationale, focus block → task detail)
- Circuit `/energy` page — per-day task-event timeline (`GET /api/energy/timeline`)

## In progress

- **Phase 6 — AI assistance**: core shipped (`scheduling_insights`, classify, Groq agent). Remainder → [DEFERRED.md](./DEFERRED.md).

## Implemented (vanilla PWA)

- Offline-first localStorage app with shared TypeScript engines
- Hash routing, dashboard, calendar strip, dimension capture

## Backlog (vanilla + full-stack)

See [BACKLOG.md](./BACKLOG.md) (Siri/Shortcuts) and [DEFERRED.md](./DEFERRED.md) (full inventory).

| Item | Notes |
|------|--------|
| Deeper adaptive / ML scheduling | Deferred — deterministic insights shipped |
| Siri / native shortcuts | Needs Capacitor/Tauri — [BACKLOG.md](./BACKLOG.md) |
| Combined cross-app energy chart | Canopy → Energy (by design) |
| Two-way calendar sync | **Not planned** — ICS import/export only |

## Not planned (MVP scope)

- Full external calendar two-way sync (export only today)
- Server-push notifications
- Multi-user collaboration
