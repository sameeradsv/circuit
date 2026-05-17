# App features

## Navigation

Four main pages (bottom nav + hash routes):

| Page | Route | Purpose |
|------|-------|---------|
| Home | `#` / `#home` | Dashboard: stats, workload, forecast, today's plan |
| Add | `#add` | Capture tasks, presets, dimensions, sync tools |
| Tasks | `#tasks` | Full list with filters and list/group views |
| Day | `#calendar` | Week strip + day view for scheduled tasks |

## Task capture

- **Presets:** Chores, Work, Social, Ad hoc, Meetup — prefilled dimensions, fully editable.
- **Dimensions:** Time, cognitive, context, priority, and behavioral fields per [task model](./task-model.md).

## Account and sync

- **Sign in / create account:** Username + passcode (PBKDF2-hashed locally). Per-user task storage namespace.
- **Continue on this device only:** Keeps legacy local storage without an account.
- **Cross-device:** On device A, **Export account backup** (JSON). On device B, sign in with the same username/passcode, then **Import account backup**.
- **Sign out:** Returns to the sign-in screen; tasks remain in that user's namespace on the device.

Server-side sync is not required for the backup flow; a future sync API can use the same bundle format.

## PWA

- `manifest.webmanifest` and `icons/icon.svg` (circuit trace branding).
- Service worker: `sw.js`.
