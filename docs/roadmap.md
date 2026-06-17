# Roadmap

## Implemented (full-stack app)

- FastAPI backend with JWT + WebAuthn passkeys
- Task CRUD, recurrence auto-creation, batch-update, ICS calendar import (RRULE snap to next valid occurrence; iCloud `FREQ=WEEKLY` without `BYDAY`)
- Blackouts: on-hold UI, post-blackout behaviors, calendar shading, proactive reschedule on create
- Sleep from **Sleep** calendar task + quality/disturbed overrides + default quality setting
- Cumulative energy timeline with cross-day carry-over (`energy_eod`); task events mapped to scheduled slot on timeline
- Calendar day/week/month with drag-and-drop
- TaskDetailModal (modular `task-detail/` sections)
- TerminalChat batch commands + Circuit native agent (Claude)
- Encrypted export/import
- Cross-app energy hook (Canopy, Chef)
- Analytics — `GET /api/summary` + **WorkloadBar** + **BehavioralInsights** (engine-driven)
- Unified task ranking on Home/Tasks via `lib/task-ranking.ts` → scheduling engine
- Account → vanilla PWA `localStorage` import (`POST /api/tasks/migrate`)
- Home top-pick actions wired (snooze, rationale, focus block → task detail)
- Circuit `/energy` page — per-day task-event timeline (`GET /api/energy/timeline`)

## In progress

- **Phase 6 — AI assistance**: agent chat + classify-on-capture shipped; predictive planning and deeper adaptive suggestions remain

## Implemented (vanilla PWA)

- Offline-first localStorage app with shared TypeScript engines
- Hash routing, dashboard, calendar strip, dimension capture

## Backlog (vanilla + full-stack)

See [BACKLOG.md](./BACKLOG.md) for voice input and Siri Shortcuts feasibility notes.

| Item | Notes |
|------|--------|
| Predictive / adaptive scheduling | Phase 6 — beyond current `analyzeBehavior` insights |
| Voice capture on Add | Browser `SpeechRecognition` → parse/classify pipeline |
| Siri / native shortcuts | Needs Capacitor/Tauri or registered URL scheme |
| In-app energy timeline page | Combined chart today on Canopy → Energy |
| Two-way calendar sync | ICS import/export only |

## Not planned (MVP scope)

- Full external calendar two-way sync (export only today)
- Server-push notifications
- Multi-user collaboration
