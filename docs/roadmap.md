# Roadmap

## Implemented (full-stack app)

- FastAPI backend with JWT + WebAuthn passkeys
- Task CRUD, recurrence auto-creation, batch-update, ICS calendar import
- Blackouts: on-hold UI, post-blackout behaviors, calendar shading, proactive reschedule on create
- Sleep from **Sleep** calendar task + quality/disturbed overrides + default quality setting
- Cumulative energy timeline with cross-day carry-over (`energy_eod`)
- Calendar day/week/month with drag-and-drop
- TaskDetailModal (modular `task-detail/` sections)
- TerminalChat batch commands + Circuit native agent (Claude)
- Encrypted export/import
- Cross-app energy hook (Canopy, Chef)

## Implemented (vanilla PWA)

- Offline-first localStorage app with shared TypeScript engines
- Hash routing, dashboard, calendar strip, dimension capture

## In progress

- **Phase 6 — AI assistance**: agent chat shipped; predictive planning and deeper adaptive suggestions remain
- Analytics page — basic stats; richer behavioral insights planned

## Backlog

See [BACKLOG.md](./BACKLOG.md) for voice input and Siri Shortcuts feasibility notes.

## Not planned (MVP scope)

- Full external calendar two-way sync (export only today)
- Server-push notifications
- Multi-user collaboration
