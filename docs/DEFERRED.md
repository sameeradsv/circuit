# Deferred & future work

**Last updated:** 2026-06-30
**Scope:** Circuit, Chef, Canopy, Conduit ecosystem

This file is the canonical inventory of work intentionally not shipped yet. Each app repo carries a copy; keep them in sync when editing. See also per-app [DECISIONS.md](./DECISIONS.md).

---

## BLOCKED - external dependency unavailable

These items need third-party APIs, platform access, native shells, or infra that is not available or not supported today. Do not implement without explicit approval and the dependency in place.

| Item | Affected apps | Why blocked |
|------|---------------|-------------|
| **Swiggy / Zomato live APIs** | Chef | No public partner API; seed + history restaurants only. See Chef `INTEGRATIONS.md`. |
| **Swiggy/Zomato deep links / delivery scraping** | Chef | Same - no stable integration surface. |
| **Spoonacular, Edamam** | Chef | Paid/third-party recipe APIs not provisioned. |
| **Native pgvector / embeddings** | Canopy, Chef | Groq has no embedding API; needs PostgreSQL + pgvector + embedding model. Substitute shipped: Groq rerank (Chef), tag + FTS (Canopy). |
| **Ollama / local LLM** | Canopy | Offline model runtime not wired; Groq synthesis shipped instead. |
| **Siri / iOS Shortcuts** | Circuit, Canopy | Needs URL scheme + Capacitor/Tauri or native wrapper. |
| **Tauri / Capacitor desktop shell** | Canopy, Circuit | Shell project not started. |
| **Connected services** | Chef | No real Instacart, DoorDash, Apple Health, OpenTable, or similar integrations to link against. |
| **Platform live pricing / surcharges** | Chef | Requires aggregator APIs for dynamic restaurant/delivery cost. |
| **Encrypted auto cross-device sync** | All | Background merge + conflict UI; manual encrypted export/import shipped per app. |
| **Production Cortex sibling-auth across divergent instances** | Conduit -> siblings | Token exchange is not designed when Cortex URLs differ. Substitute shipped: `/wakeup` auth probe with Bearer token. |
| **Circuit ML scheduling pipeline** | Circuit | No training data pipeline; heuristic adaptive learning shipped instead. |

---

## AI policy (decided - not deferred)

| Decision | Detail |
|----------|--------|
| **Groq-only** | All cloud LLM calls use `GROQ_API_KEY`. No Anthropic, OpenAI, Gemini, or Ollama cloud backends. |
| **Terminal UI** | Phosphor terminal + diary routing belongs in Conduit only. Siblings use `/chat` with native Groq agents. |
| **Multi-provider LLM in Conduit** | Rejected in favor of the Groq-only policy. |

---

## Ecosystem - deferred (not blocked)

| Item | Affected apps | Notes |
|------|---------------|-------|
| **Two-way external calendar sync** | Circuit | ICS import + export only; no Google/iCloud write-back. Not planned. |
| **Server-push notifications** | Chef | Anti-goal for Chef today. Circuit task reminders shipped as durable Web Push; see [notifications.md](./notifications.md). |
| **Multi-user task collaboration** | Circuit | Single-user model. Not planned. |
| **Combined cross-app energy chart in Circuit** | Circuit | By design - lives on Canopy Energy. |
| **Vanilla Circuit full Groq agent** | Circuit | By design - use Conduit hub or full-stack `/chat`. |
| **Ops / config** | All | `GROQ_API_KEY` on the backend host, shared Cortex URL across apps. |

---

## Circuit - deferred / backlog

| Item | Status | Notes |
|------|--------|-------|
| **Deeper adaptive / ML scheduling** | Deferred | `delay_pattern`, `preferred_execution_window`, and `GET /api/tasks/{id}/suggest-slot` shipped; no ML pipeline. |
| **Siri / native shortcuts** | BLOCKED | See external dependency table above. |

### Circuit - shipped

- Voice on Add, `/energy` timeline, scheduling insights, calendar export, Groq-only agent.
- `parseUtterance()` on Add/Tasks; vanilla `#analytics` / `#energy`.
- Adaptive learning: `delay_pattern` on skip, `preferred_execution_window` on complete.
- Durable Web Push task reminders: per-task reminder offsets materialized into bounded `reminders` rows and delivered by cron.
- `GET /api/tasks/{id}/suggest-slot`: server-side deterministic slot suggestion.
- Sync import LWW: last-write-wins on `client_id` when `client_updated_at` is newer.

---

## Chef - deferred

| Item | Status | Notes |
|------|--------|-------|
| **Swiggy / Zomato** | BLOCKED | See Chef `INTEGRATIONS.md`. |
| **Spoonacular, Edamam** | BLOCKED | Paid/third-party APIs not provisioned. |
| **Native pgvector** | BLOCKED | Groq rerank shipped. |
| **Dynamic platform cost intelligence** | BLOCKED | Logged-meal cost trends shipped. |
| **Push notifications** | Deferred | Anti-goal today. |
| **Connected services** | BLOCKED | No real integration surface yet. |
| **Web scraping / aggregators** | BLOCKED | Avoid brittle scraping unless explicitly approved. |

### Chef - shipped

- Grocery swipe, health/stress, savings badge, frequency grocery suggestions, Groq rerank, `GET /decision/predict`.
- Decide predict card on History.
- `GET /decision/cost-insights`: 30-day logged spend trends.
- `GET /plan/week`: 7-day deterministic meal plan from seed recipes.
- `POST /sync/export` + `/sync/import`: AES-GCM encrypted backup.

---

## Canopy - deferred

| Item | Status | Notes |
|------|--------|-------|
| **pgvector / semantic embeddings** | BLOCKED | Requires provisioned embeddings and pgvector. |
| **Local LLM (Ollama)** | BLOCKED | Runtime not wired. |
| **Adaptive tagging (ML)** | Deferred | Heuristic capture suggestions shipped. |
| **Memory compression** | Deferred | |
| **Encrypted auto sync** | BLOCKED | Manual export exists. |
| **Tauri desktop shell** | BLOCKED | |
| **Richer synthesis cadence / reflection UI** | Deferred | `/patterns` page shipped. |

### Canopy - shipped

- TagInput, tag search, Groq synthesis, patterns API, voice capture.
- `/patterns` page: on-demand synthesis + 7/14/30d range.
- `GET /api/ai/capture-suggestions`: heuristic participant + tag chips on Capture.

---

## Conduit - deferred

| Item | Status | Notes |
|------|--------|-------|
| **Production sibling-auth unification** | BLOCKED when Cortex diverges | Wakeup auth probe shipped. |
| **Multi-provider models** | Rejected | Groq-only. |

### Conduit - shipped

- Phase D write tools, diary `saveSession`, IST routing.
- `get_interactions_for_person` read tool.
- `/wakeup` auth probe: when signed in, pings each sibling's auth endpoint and reports `auth_ok`.

---

## Partial phases - summary

| App | Still open (non-blocked) | Blocked |
|-----|---------------------------|---------|
| **Circuit** | Deeper ML scheduling | Siri/native shortcuts |
| **Chef** | Push notifications deferred | Delivery APIs, platform pricing, pgvector |
| **Canopy** | Memory compression, richer reflection UX | Embeddings, Ollama, Tauri, auto-sync |
| **Conduit** | - | Cross-Cortex token exchange |

---

## How to pick up work

1. Read this file + app `DECISIONS.md`.
2. Do not implement BLOCKED items without dependency + explicit approval.
3. For semantic search, extend Groq rerank/FTS before pgvector unless Postgres+embeddings is provisioned.
4. Update this file and sibling copies when deferring or closing an item.

**Explicitly rejected (not deferred):** multi-user tasks, full two-way calendar sync, Chef notification toggles without backend, Conduit non-Groq providers, sibling-app terminal/diary UIs.
