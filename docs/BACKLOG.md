# Backlog

See **[DEFERRED.md](./DEFERRED.md)** for the full deferred inventory.

## Voice input — shipped (full-stack)

**Status:** Shipped — `parseUtterance()` sets tag, urgency, effort, cognitive_load, duration, and schedule from speech or typed NL on Add and Tasks quick-add.

Optional future: richer phrase patterns only; keep sync (no API on capture).

## Siri Shortcuts — deferred

**Feasibility:** Low for the current PWA-only stack; medium if wrapped or companion native.

- Shortcuts expect an App Intent, URL scheme, or Share extension target — not available to a pure static PWA on the home screen alone.
- Practical options: (1) Shortcuts that open a `circuit://add?text=...` URL if a native wrapper registers the scheme; (2) iOS Share Sheet → paste into Circuit; (3) serverless webhook (conflicts with local-first unless carefully scoped).
- Recommended path: defer until install surface is defined (Capacitor/Tauri); then expose `AddTaskIntent` mapping to `buildTaskFromInput` defaults.
