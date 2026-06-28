# Architecture & product decisions

Records intentional choices from the 2026 stub cleanup and restore-and-rewire pass. See also [architecture.md](./architecture.md) and [DEFERRED.md](./DEFERRED.md).

---

## Scoring: Tasks owns ranked recommendations (2026-06)

**Decision:** Tasks ranks open tasks via `frontend/src/lib/task-ranking.ts` → `engines/src/scheduling-engine/scoring.ts` (`scoreTask` / `scoreTasks`), not inline simplified formulas. Home is capture-first and does not show suggested-next or after-that recommendations.

**Reason:** User feedback favored fast input on Home and kept ranked decision support on Tasks. Energy mode (`focus_mode`) affects rank consistently with TaskDetailModal preview.

**Implication:** Fit % and rationale live on Tasks. Home task creation auto-fills scoring metrics from the task description using Groq-backed defaults, with overrides available through TaskDetailModal.

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
| `Nav.tsx` | `AppShell.tsx` / `Sidebar.tsx` mobile drawer |
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

See **[DEFERRED.md](./DEFERRED.md)** for the full cross-app inventory (pgvector, auto-sync, Cortex auth, Siri, Tauri, Swiggy/Zomato, partial phases).

| Item | Status |
|------|--------|
| pgvector / semantic search | Deferred — Groq rerank/FTS substitutes |
| Encrypted auto cross-device sync | Export/import only |
| Production Cortex sibling-auth | Known gap ([Conduit](../../conduit/CLAUDE.md)) |
| Siri shortcuts / Capacitor | [DEFERRED.md](./DEFERRED.md) |

---

## Terminal UI: Conduit only (2026-06-17)

**Decision:** Terminal-style hub (diary router, cross-app tools, slash commands, phosphor shell) is **Conduit only**. Circuit, Canopy, and Chef ship **`/chat`** — each app's native Groq agent for personal Q&A within that domain.

**Do not** add terminal timeline views or Conduit-style diary routing to sibling app UIs. Cross-app capture → Conduit diary mode.

---

## Groq-only AI (2026-06-17)

**Decision:** All LLM calls use **Groq** (`GROQ_API_KEY`). No Anthropic/OpenAI fallbacks in Circuit agent, classify, or task-default suggestion paths.

---

## Polish pass: local utterance parser (2026-06-17)

**Decision:** Task capture uses sync `parseUtterance()` (`frontend/src/lib/parse-utterance.ts`) for explicit syntax (`#tag`, duration, priority, schedule text) and sends full-stack additions through `POST /api/ai/suggest-task` for Groq-backed defaults across scheduling, cognitive, priority, energy, reminder, and tiny-step fields. Calendar imports also use `suggest-task` for Circuit planning fields, but preserve ICS-owned time, duration, UID, RRULE, recurrence anchor, and location. **No `POST /api/ai/classify` on Add/Tasks submit**; classify remains a lightweight standalone endpoint.

**Vanilla PWA:** Same parser in `src/ai-assistance/parse-utterance.ts`; `#analytics` and `#energy` render on hash navigation only (no extra startup fetch). Voice mic injected on add form when supported. Full cumulative energy timeline and Groq agent remain full-stack / Conduit only.

**Do not** re-add classify-on-capture. If capture latency becomes a problem, tune or defer `suggest-task` rather than routing through the narrower classify endpoint.

---

## WorkloadBar: zone labels (2026-06-17)

**Decision:** `WorkloadBar` renders vertical tick marks at 50% and 80% of the 8h capacity bar, with threshold labels below: `Light < 4h`, `Moderate 4–6.5h`, `Heavy 6.5–8h`, `Overloaded > 8h`.

**Reason:** The bar alone gave no reference for what "good" looks like — users couldn't tell whether their current load was approaching a problem zone without prior context.

---

## Energy page: human-readable date (2026-06-17)

**Decision:** `/energy` date navigator displays `17 Jun 2026` instead of `2026-06-17`.

**Reason:** ISO strings are machine format; the date picker is a user-facing control.

---

## Analytics: selected-day workload (2026-06-18)

**Decision:** `GET /api/summary` accepts an optional `date=YYYY-MM-DD` query and computes `total_pending_minutes` from task minutes overlapping that IST day. `/analytics` passes the selected date from its date picker.

**Reason:** Capacity planning needs the chosen day's scheduled load, not the entire backlog and not only the current day.

**Implication:** Exact-title `Sleep` tasks are included when their scheduled minutes overlap the selected day. Summary counts, tag breakdowns, stale tasks, and behavioral insights still cover open tasks overall unless explicitly changed.

---

## Calendar: date strip and gesture navigation (2026-06-18)

**Decision:** `/calendar` keeps arrow navigation and adds a date strip on day view only, plus swipe/trackpad navigation. Day view moves by one day, week view by one week, and month view by one month. Scroll navigation is edge-aware so native scrolling still wins inside scrollable grids.

**Reason:** The calendar should support Outlook-like fast movement across dates without hiding the existing explicit controls.

---

## Calendar: overlap detection includes travel buffers (2026-06-18)

**Decision:** `calendar-layout.ts` computes overlap columns from the rendered span: travel buffer before + max(task duration, minimum rendered event height) + travel buffer after.

**Reason:** The visual blocks include travel buffers, so overlap detection must use the same span to avoid collisions on some dates.

**Implication:** Very short events, such as adjacent 5-minute blocks, are treated as overlapping when their painted blocks would otherwise collide.

---

## Energy: duration scaling cap (2026-06-19)

**Decision:** Task-event energy deltas scale cost by `duration_minutes / 60`, clamped from `0.5` to `8.0`. The previous effective 2-hour cap was too low for 6-8 hour commitments.

**Reason:** Long tasks should carry materially higher energy cost than two-hour tasks. The 8-hour cap still prevents a single all-day or malformed duration from dominating the entire day.

---

## Energy: same-day manual override (2026-06-19)

**Decision:** Account manual energy override is date-scoped with `user_state.energy_manual_override_date` in IST. Home, Tasks, and Sidebar use the manual value only when that date is today; otherwise they return to Canopy/Circuit defaults.

**Reason:** Manual energy is a same-day context override, not a persistent preference.

---

## Mobile navigation: hideable vertical drawer (2026-06-18)

**Decision:** Mobile renders the existing `Sidebar` as a slide-in drawer opened by a fixed menu button. `AppShell` no longer renders the bottom `TabBar`.

**Reason:** Vertical navigation stays consistent with desktop and Canopy, avoids bottom-nav layout pressure, and can group lower-frequency owner tools under More.

---

## Task list gestures: directional swipes (2026-06-18)

**Decision:** `SwipeTaskRow` uses swipe-right to complete and swipe-left to skip. Desktop/buttons remain available.

**Reason:** Separate directions are clearer than deeper-swipe-to-skip.

---

## Notifications: per-task browser reminders (2026-06-18)

**Decision:** Scheduled tasks store `notifications_enabled`, `notification_offset_1_mins`, and `notification_offset_2_mins`. The browser scheduler uses those offsets when the global sidebar notification toggle is enabled.

**Reason:** Users need event-specific reminders without adding server-push infrastructure.

**Implication:** Server-push notifications remain out of scope; reminders are local browser notifications scheduled while the app is open and within the 24-hour timer horizon.

---

## Recurrence: virtual future occurrences (2026-06-19)

**Decision:** Recurring commitments have durable definitions in `recurring_tasks`, while `occurrence_overrides` stores only completed, skipped, and rescheduled single instances. Calendar range reads and scheduler availability expand bounded windows on demand.

**Reason:** Materializing one occurrence at a time kept storage small, but made future recurring slots look free to the auto-scheduler.

**Implication:** Do not add background jobs that pre-create unbounded future rows. Use `services/virtual_recurrence.py` for visible calendar windows and planning horizons.

---

## Capture-first home and More nav (2026-06-21)

**Decision:** Home owns quick task capture and `/add` redirects to Home. Analytics, Energy, and Chat are grouped under the Sidebar **More** section.

**Reason:** Feedback showed adding tasks is the most common Home action, while Analytics/Energy/Chat are lower-frequency owner tools.

**Implication:** Task recommendations and ranking live on Tasks. Home capture auto-fills metrics from natural language and the TaskDetailModal remains the override path.

---

## Completion time delay learning (2026-06-21)

**Decision:** Completing a task can include an explicit completion timestamp. Completion events store actual completion time, scheduled time, and delay minutes.

**Reason:** Recurring and frequently delayed tasks need feedback loops based on when work really happens, not only when it was planned.

**Implication:** Recurring and virtual recurring completions create energy-costing `TaskEvent` rows. Energy drain applies a small capped delay penalty, and analytics can suggest a more realistic hour for tasks repeatedly completed late.
