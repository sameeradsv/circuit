# App features

Circuit ships as two apps sharing the same TypeScript scheduling engines:

1. **Vanilla PWA** (repo root `src/`) — offline-first, `localStorage`
2. **Full-stack app** (`frontend/` + `backend/`) — Next.js + FastAPI, PostgreSQL/SQLite

This document describes the **full-stack** product (primary development surface).

## Navigation

Authenticated routes under `frontend/src/app/(app)/`:

| Page | Route | Purpose |
|------|-------|---------|
| Home | `/` | Task dashboard — ranked open tasks, energy context |
| Tasks | `/tasks` | Full list, filters, **On hold** section during blackouts |
| Calendar | `/calendar` | Day / week / month views, drag-and-drop, blackout shading, ICS import |
| Add | `/add` | Quick task capture |
| Account | `/account` | Preferences, sleep overrides, blackouts, export/import, passkey |
| Analytics | `/analytics` | Completion and workload stats |
| Chat | `/chat` | TerminalChat — batch commands + Circuit agent |
| Energy | (via Canopy cross-app hook) | Cumulative energy timeline |

Auth: `/login` — username/passcode or WebAuthn passkey.

## Task capture & editing

- Structured dimensions: priority, cognitive load, effort, duration, scheduling, recurrence
- **TaskDetailModal** (`components/task-detail/`) — sectioned editor with hover tooltips on every field
- **TerminalChat** — natural-language batch reschedule/complete/prioritize with approval preview

## Calendar

- **Day / week / month** views with 24-hour grid (day/week)
- **Drag-and-drop** to reschedule; recurring tasks ask *this occurrence* vs *shift series*
- **Blackout shading** — unavailable date ranges tinted on all views
- **ICS import/export** — recurring events stored as RRULE templates
- Travel buffers shown as hatched blocks before/after tasks

## Blackouts

Set date ranges in **Account → Blackouts** (`travelling`, `period`, `sickness`, `leave`, `wfh`).

- Tasks opt in via **Skip this task when** flags in the task editor (`leave` auto-applies to `tag=work`)
- During an active blackout: affected tasks move to **On hold** on the task list
- **On create**: affected scheduled tasks are automatically moved per each task's post-blackout behavior (`resume` / `catch_up` / `catch_up_once`)
- Calendar days in range are visually shaded

## Sleep & energy

- **Sleep timing** from a calendar/task event titled **Sleep** (`scheduled_at` = bedtime, `duration` = length)
- **Account → Sleep & recovery**: optional quality / disturbed / notes overrides
- **Default sleep quality** (0–10, default 7) in Preferences
- Override history: toggle **Show sleep overrides** with pagination
- Energy baseline: `sleep_factor × 0.70 + energy_eod × 0.30` + cumulative task-event deltas through the day

## Account and sync

- JWT auth + optional WebAuthn passkey
- AES-256 encrypted export/import of tasks and settings
- Per-user settings key-value store (`default_energy_mode`, `default_sleep_quality`, working hours, etc.)

## PWA

The vanilla root app includes `manifest.webmanifest`, service worker, and esbuild bundle. The Next.js frontend supports standalone/PWA build modes separately.
