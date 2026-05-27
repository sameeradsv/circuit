# Tests

```
tests/
├── unit/    # Jest — core logic
└── e2e/     # Playwright — full app flows
```

```bash
npm run test:unit          # unit only
npm run test:e2e           # e2e only (requires npx playwright install first)
npm run test:all           # build + unit + e2e
```

Playwright expects the app on `http://localhost:8080` (auto-started via `python3 -m http.server 8080`).
