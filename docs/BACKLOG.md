# Backlog

## Voice input

**Feasibility:** Medium on the web, higher effort on native shells.

- Browser `SpeechRecognition` (Chrome/Edge) can capture task text locally without sending audio to a server, which fits Circuit’s local-first posture.
- Dimension fields would still need UI or a small parser (“high urgency work task, 45 minutes”) — voice alone does not replace structured dimensions.
- Safari/iOS support is inconsistent; a PWA would need a graceful fallback to typing.
- Recommended path: optional mic button on the task form that fills `#task-input`, then runs the existing conversational parser + dimension form.

## Siri Shortcuts

**Feasibility:** Low for the current PWA-only stack; medium if wrapped or companion native.

- Shortcuts expect an App Intent, URL scheme, or Share extension target — not available to a pure static PWA on the home screen alone.
- Practical options: (1) Shortcuts that open a `circuit://add?text=...` URL if a native wrapper registers the scheme; (2) iOS Share Sheet → paste into Circuit; (3) serverless webhook (conflicts with local-first unless carefully scoped).
- Without a thin native host, users can only “Open Circuit” via a bookmark URL, not reliably pass structured task payloads into dimension fields.
- Recommended path: defer until install surface is defined (Capacitor/Tauri); then expose `AddTaskIntent` mapping to `buildTaskFromInput` defaults.
