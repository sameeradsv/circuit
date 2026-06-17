# App features

Circuit ships as two apps sharing the same TypeScript scheduling engines:

1. **Vanilla PWA** (repo root `src/`) — offline-first, `localStorage`
2. **Full-stack app** (`frontend/` + `backend/`) — Next.js + FastAPI, PostgreSQL/SQLite

This document describes the **full-stack** product (primary development surface).

## Navigation

Authenticated routes under `frontend/src/app/(app)/`:

| Page | Route | Purpose |
|------|-------|---------|
| Home | `/` | Ranked open tasks — Canopy energy (read-only), focus window, snooze/why/detail on top pick |
| Tasks | `/tasks` | Full list, type filters, **server search** (`GET /api/search`), energy mode switcher, **On hold** during blackouts |
| Calendar | `/calendar` | Day / week / month views, drag-and-drop, blackout shading, ICS import |
| Add | `/add` | Quick capture — regex parse + `POST /api/ai/classify` enrichment on submit |
| Account | `/account` | Preferences, sleep overrides, blackouts, energy manual override, encrypted export/import, **vanilla PWA localStorage import**, passkey |
| Analytics | `/analytics` | Summary stats, **WorkloadBar**, **BehavioralInsights**, attention/stale/skipped lists |
| Energy | `/energy` | Per-day task-event balance (`GET /api/energy/timeline`); combined cross-app chart on Canopy → Energy |
| Chat | `/chat` | TerminalChat — batch commands (no API) + Circuit agent (Groq default, Anthropic fallback) |

Auth: `/login` — username/passcode or WebAuthn passkey.

## Task capture & editing

- Structured dimensions: priority, cognitive load, effort, duration, scheduling, recurrence
- **Add page** — natural-language capture; backend `POST /api/ai/classify` enriches tag/urgency/effort when available (falls back to regex parse)
- **Tasks search** — debounced `GET /api/search` when the search box is active
- **TaskDetailModal** (`components/task-detail/`) — sectioned editor with hover tooltips on every field
- **TerminalChat** — natural-language batch reschedule/complete/prioritize with approval preview

## Calendar

- **Day / week / month** views with 24-hour grid (day/week)
- **Overlapping events** in day/week use side-by-side columns so labels stay visible
- **Month view** scrolls vertically when the grid exceeds viewport height
- **Drag-and-drop** to reschedule; recurring tasks ask *this occurrence* vs *shift series*
- **Blackout shading** — unavailable date ranges tinted on all views
- **ICS import/export** — recurring events stored as one RRULE template per series; `scheduled_at` = first occurrence on or after today (original DTSTART kept in `rrule_dtstart_ms`). Supports iCloud-style `FREQ=WEEKLY` without `BYDAY`, explicit `BYDAY`, monthly patterns, and detached `RECURRENCE-ID` instances as one-offs. Re-import to refresh dates after importer fixes.
- Travel buffers shown as hatched blocks before/after tasks

## Blackouts

Set date ranges in **Account → Blackouts** (`travelling`, `period`, `sickness`, `leave`, `wfh`).

- Tasks opt in via **Skip this task when** flags in the task editor (all types including `leave` require an explicit checkbox)
- During an active blackout: affected tasks move to **On hold** on the task list
- **On create**: affected scheduled tasks are automatically moved per each task's post-blackout behavior (`resume` / `catch_up` / `catch_up_once` / `catch_up_immediate` / `catch_up_imm_shift`). See task edit modal for slot vs immediate catch-up and series-anchor differences.
- Calendar days in range are visually shaded

## Sleep & energy

- **Sleep timing** from a calendar/task event titled **Sleep** (`scheduled_at` = bedtime, `duration` = length)
- **Account → Sleep & recovery**: optional quality / disturbed / notes overrides
- **Default sleep quality** (0–10, default 7) and **default bedtime / wake time** (paired row) in Preferences
- Override history: toggle **Show sleep overrides** with pagination; **Edit** or **Delete** per row
- Energy baseline: `sleep_factor × 0.70 + energy_eod × 0.30` + cumulative task-event deltas through the day
- **Effective energy for task ranking (Home, Tasks, Sidebar):** Canopy total (`energy_so_far`) by default via `NEXT_PUBLIC_CANOPY_API_URL`; optional **manual override** in Account → Today's context. No energy slider on Home.
- **Time window for ranking:** `UserState.time_available_minutes` (Account) on Tasks; Home uses calendar window with same setting as fallback.
- **Energy mode:** `UserState.focus_mode` synced via `use-energy-mode.ts`; switchable on Tasks header.
- **Task ranking:** Home and Tasks use shared `lib/task-ranking.ts` → engine `scoreTasks` (energy mode + available minutes aware).
- **Circuit task energy on the timeline** is anchored to each task's **scheduled time** (when the work was planned), not when you tapped complete — matches Canopy (`occurred_at`) and Chef (meal `timestamp`). Cross-app chart lives on **Canopy → Energy** when sibling apps are configured.

## Account and sync

- JWT auth + optional WebAuthn passkey
- AES-256 encrypted export/import of tasks and settings
- Per-user settings key-value store (`default_energy_mode`, `default_sleep_quality`, working hours, etc.)

## PWA

The vanilla root app includes `manifest.webmanifest`, service worker, and esbuild bundle. The Next.js frontend supports standalone/PWA build modes separately.
