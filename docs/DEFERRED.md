# Deferred & future work

**Last updated:** 2026-06-17  
**Scope:** Circuit, Chef, Canopy, Conduit ecosystem

This file is the **canonical inventory** of work intentionally not shipped yet. Each app repo carries a copy (keep in sync when editing). See also per-app [DECISIONS.md](./DECISIONS.md), [roadmap.md](./roadmap.md), [BACKLOG.md](./BACKLOG.md).

---

## AI policy (decided — not deferred)

| Decision | Detail |
|----------|--------|
| **Groq-only** | All cloud LLM calls use `GROQ_API_KEY`. No Anthropic, OpenAI, Gemini, or Ollama **cloud** backends. |
| **Terminal UI** | Phosphor terminal + diary routing → **Conduit only**. Siblings use `/chat` (native Groq agent). |

---

## Ecosystem — cross-app (deferred)

| Item | Affected apps | Blocker / notes | Where tracked |
|------|---------------|-----------------|---------------|
| **Native pgvector / embeddings** | Canopy, Chef | Groq has no embedding API; needs PostgreSQL + pgvector + embedding model choice (local or third-party). **Substitute shipped:** Groq rerank on keyword pool (Chef `groq_search.py`); tag + FTS search (Canopy). | Canopy `ROADMAP` v0.2, Chef `DECISIONS.md` |
| **Encrypted auto cross-device sync** | All | Manual export/import works; automatic merge + conflict resolution not built. | Canopy `TODO.md` |
| **Production Cortex sibling-auth** | Conduit → Circuit/Canopy/Chef | `conduit_auth_token` must validate on all Render backends sharing one Cortex instance; per-app token exchange not designed. | Conduit `PLAN.md`, `CLAUDE.md` |
| **Siri / iOS Shortcuts** | Circuit, Canopy | Needs URL scheme + Capacitor/Tauri or native wrapper; PWA alone insufficient. | Circuit `BACKLOG.md`, Canopy `TODO.md` |
| **Tauri / Capacitor desktop shell** | Canopy (primary), Circuit | ~1–2 day shell project; not started. | Canopy `TODO.md` |
| **Multi-provider LLM (Conduit)** | Conduit | **Rejected** in favor of Groq-only policy. | Conduit `PLAN.md` |

---

## Circuit — deferred / backlog

| Item | Phase | Status | Notes |
|------|-------|--------|-------|
| **Deeper adaptive / ML scheduling** | Phase 6 | Deferred | `scheduling_insights` + `analyzeBehavior` shipped; no ML training pipeline. |
| **Two-way external calendar sync** | Backlog | **Not planned** | ICS import + export only; no Google/iCloud write-back. |
| **Server-push notifications** | — | **Not planned** | Anti-goal for focus product. |
| **Multi-user task collaboration** | — | **Not planned** | Single-user model. |
| **Siri / native shortcuts** | Backlog | Deferred | See ecosystem table. |
| **Combined cross-app energy chart in Circuit** | — | By design | Lives on **Canopy → Energy**; Circuit `/energy` is task-events only. |

### Circuit — shipped (no longer deferred)

- Voice on Add (`useVoiceInput`)
- `/energy` timeline page
- `scheduling_insights` on `GET /api/summary`
- Calendar **Export .ics** button + `GET /api/calendar/export`
- Groq-only agent (Anthropic removed)

---

## Chef — deferred

| Item | Phase | Status | Notes |
|------|-------|--------|-------|
| **Swiggy / Zomato live APIs** | Integrations | **Blocked** | Documented unavailable 2026-06-17; seed + history restaurants only. | [INTEGRATIONS.md](../../chef/docs/INTEGRATIONS.md) |
| **Spoonacular, Edamam** | Phase 1 / Integrations | Not integrated | Recipe search uses seed + TheMealDB + Groq generation. |
| **Native pgvector recipe search** | Phase 2 | Deferred | Groq semantic rerank on keyword candidates shipped instead. |
| **Full predictive engine** | Phase 3 | Partial | `GET /decision/predict` + expiring-pantry hints shipped; “likely to order tonight” prose engine not full ML. |
| **Dynamic cost intelligence** | Phase 3 | Not started | Restaurant pricing trends, surcharge patterns, ordering windows. |
| **Meal planning** | Phase 3 | Not started | Weekly / expiry-aware / budget / nutrition plans. |
| **Push notifications** | — | Deferred | UI removed; no backend delivery. Anti-goal: notification spam. |
| **Connected services** (Instacart, DoorDash, Apple Health, etc.) | — | Deferred | Revisit when live delivery APIs exist. |
| **Web scraping / aggregators for delivery** | Integrations | Deferred | Superseded by Swiggy/Zomato unavailability decision. |

### Chef — shipped (no longer deferred)

- Grocery swipe, health/stress in Settings, savings badge
- Frequency-based grocery suggestions (90-day buy history)
- Groq recipe rerank on search
- `GET /decision/predict`

---

## Canopy — deferred

| Item | Version | Status | Notes |
|------|---------|--------|-------|
| **pgvector / semantic embeddings** | v0.2 | Deferred | Tag search + Groq synthesis shipped. |
| **Contextual linking** (auto link interactions ↔ people) | v0.2 | Not started | |
| **Full pattern assistance UI** | v0.3 | Partial | `GET /api/ai/patterns` + dashboard cards; no dedicated patterns page. |
| **Local LLM (Ollama) summaries** | v0.4 | Deferred | Groq synthesis on Home shipped; offline local model not wired. |
| **Adaptive tagging** | v0.4 | Not started | |
| **Memory compression** | v0.4 | Not started | |
| **Encrypted auto sync** | Backlog | Deferred | See ecosystem. |
| **Tauri desktop shell** | Backlog | Deferred | |
| **`AUTH_REQUIRED=true` in production** | Ops | Config | Implemented; enable per deploy env. |
| **Voice capture** | Backlog | **Shipped** | `useVoiceInput` on capture page. |

### Canopy — shipped (no longer deferred)

- TagInput autocomplete, TerminalView removed (Conduit-only terminal)
- Tag name search, Groq weekly synthesis, deterministic patterns API

---

## Conduit — deferred

| Item | Status | Notes |
|------|--------|-------|
| **Production sibling-auth unification** | Known issue | See ecosystem. |
| **`get_interactions_for_person` tool** | Optional | Name resolution wrapper around existing read path. |
| **Multi-provider models** | **Rejected** | Groq-only policy. |

### Conduit — shipped (no longer deferred)

- Phase D write tools (`update_task`, `create_person`, `update_meal_entry`)
- Diary `saveSession`, session history UI
- IST diary routing, Phase A–E fixes

---

## Partial phases — what remains

| App | Phase | Shipped | Still open |
|-----|-------|---------|------------|
| **Circuit** | Phase 6 AI | Classify, Groq agent, `scheduling_insights` | Adaptive ML / learned scheduling |
| **Chef** | Phase 2 | Personalization, nutrition, grocery predict, Groq rerank | Native pgvector, live delivery |
| **Chef** | Phase 3 | `predict` endpoint | Dynamic pricing, meal plans, waste-frequency ML |
| **Canopy** | v0.2 | Tags, search, Groq synthesis | Embeddings, contextual linking |
| **Canopy** | v0.3 | Patterns API, dashboard | Dedicated reflection UI, richer synthesis cadence |
| **Canopy** | v0.4 | — | Local LLM, adaptive tagging, compression |

---

## Is anything else left besides these?

**No major roadmap phases remain unlisted above.** Remaining work falls into:

1. **This deferred list** — infra, external APIs, or explicit product rejections.
2. **Ops / config** — e.g. `GROQ_API_KEY` on Render, `AUTH_REQUIRED` on Canopy, shared Cortex URL across apps.
3. **Incremental polish** — see shipped table below; Swiggy/Zomato deep links remain deferred.
4. **Vanilla Circuit PWA** — analytics/energy hash routes + local parser shipped; full-stack Groq agent remains Conduit/full-stack only.

### Polish — shipped (2026-06-17)

| App | Item | Implementation |
|-----|------|----------------|
| **Circuit** | Voice → dimension parser | `parseUtterance()` — sync heuristic on Add + Tasks quick-add; no `POST /classify` on capture |
| **Circuit** | Vanilla PWA parity (partial) | `#analytics` + `#energy` lazy pages, `parseUtterance` in `addTaskFromInput`, voice mic on add form |
| **Canopy** | `/patterns` page | `frontend/src/app/patterns/page.tsx`; Home no longer calls Groq on mount |
| **Canopy** | Synthesis UX | On-demand generate + 7/14/30d range on `/patterns` |
| **Chef** | Decide predict surfacing | History card with mode badge + confidence + savings hint |
| **Conduit** | `get_interactions_for_person` | Read tool: `GET /api/people?q=` → `GET /api/interactions?person_id=` |

### Polish — still open

| App | Item | Notes |
|-----|------|--------|
| **Chef** | Swiggy/Zomato deep links | **Blocked** — [INTEGRATIONS.md](../../chef/docs/INTEGRATIONS.md) |
| **Conduit** | Production sibling-auth | Infra when Cortex instances diverge |
| **Circuit** | Vanilla full Groq agent | By design — use Conduit hub or full-stack `/chat` |

**Not deferred — explicitly rejected:** Circuit push notifications, multi-user tasks, full two-way calendar sync, Chef notification toggles without backend, Conduit non-Groq providers, sibling-app terminal/diary UIs.

---

## How to pick up work

1. Read this file + app `DECISIONS.md`.
2. Do **not** implement Swiggy/Zomato, Anthropic paths, or sibling terminal views without explicit approval.
3. For semantic search, prefer extending Groq rerank/FTS before pgvector unless Postgres+embeddings infra is provisioned.
4. Update **this file** and the copy in sibling repos when deferring or closing an item.
