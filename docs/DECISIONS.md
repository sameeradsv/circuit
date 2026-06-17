# Architecture & product decisions

Records intentional choices from the 2026 stub cleanup and restore-and-rewire pass. See also [architecture.md](./architecture.md), [roadmap.md](./roadmap.md).

---

## Scoring: unified engine on Home and Tasks (2026-06)

**Decision:** Home and Tasks rank open tasks via `frontend/src/lib/task-ranking.ts` → `engines/src/scheduling-engine/scoring.ts` (`scoreTask` / `scoreTasks`), not inline simplified formulas.

**Reason:** Single explainable scoring path; energy mode (`focus_mode`) affects rank consistently with TaskDetailModal preview.

**Implication:** Fit % on Home uses `SCORE_REFERENCE_MAX` (~120) from the engine scale, not the legacy 88-point inline model.

---

## Analytics: WorkloadBar + BehavioralInsights restored (2026-06)

**Decision:** `/analytics` shows server summary (`GET /api/summary`) plus client-side `WorkloadBar` (pending minutes) and `BehavioralInsights` (`analyzeBehavior` on open tasks).

**Reason:** These were removed prematurely during dead-code cleanup; vanilla PWA already had equivalent logic in `src/app/dashboard.ts`.

**Do not remove** `WorkloadBar.tsx` / `BehavioralInsights.tsx` without replacing on Analytics.

---

## Vanilla PWA → full-stack migration (2026-06)

**Decision:** Account exposes **Import from browser (vanilla PWA)** when `circuit_tasks_v1*` keys exist in `localStorage`. Uses `POST /api/tasks/migrate` (dedupe by `client_id`).

**Reason:** One-time path for users moving from root PWA to Next.js + backend without manual encrypted export.

---

## Removed frontend (superseded — do not restore)

| Removed | Superseded by |
|---------|----------------|
| `Nav.tsx` | `AppShell.tsx` / `Sidebar.tsx` / `TabBar.tsx` |
| `ThemeSwitcher.tsx` | Palette handled in Account / layout |
| `use-circuit-auth.ts` | `@shared/cortex` auth |
| `useEnergyLevel()` hook (slider) | `use-effective-energy.ts` (Canopy default + Account override) |
| Duplicate client `GET /api/tasks/sync/energy` | `GET /api/energy/sync` only |

---

## Removed backend (duplicate)

| Removed | Kept |
|---------|------|
| `GET /api/tasks/sync/energy` | `GET /api/energy/sync` |

Cross-app consumers (Canopy Energy, Chef Decide) must keep using `/api/energy/sync`.

---

## Auth debug endpoint gated (2026-06)

**Decision:** `GET /api/auth/debug` only when `CIRCUIT_AUTH_DEBUG=true`.

---

## Not in scope (unchanged)

- Server-push notifications
- Full external calendar two-way sync (ICS import + export only)
- Multi-user collaboration on tasks

---

## Circuit energy timeline page (2026-06)

**Decision:** `/energy` shows per-day task-event balance from `GET /api/energy/timeline`. Combined cross-app chart remains on **Canopy → Energy** (client-side merge with Circuit `start_energy`).

---

## Deferred ecosystem work (2026-06)

| Item | Status |
|------|--------|
| pgvector / semantic search | Not started |
| Encrypted auto cross-device sync | Export/import only |
| Conduit multi-provider models | Groq-only MVP |
| Production Cortex sibling-auth unification | Known gap ([Conduit CLAUDE.md](../../conduit/CLAUDE.md)) |
| Siri shortcuts / Capacitor | Circuit BACKLOG |

---

## Terminal UI: Conduit only (2026-06-17)

**Decision:** Terminal-style hub (diary router, cross-app tools, slash commands, phosphor shell) is **Conduit only**. Circuit, Canopy, and Chef ship **`/chat`** — each app's native Groq agent for personal Q&A within that domain.

**Do not** add terminal timeline views or Conduit-style diary routing to sibling app UIs. Cross-app capture → Conduit diary mode.
