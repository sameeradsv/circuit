# iCloud Calendar Sync

Circuit is the source of truth. iCloud Calendar is a one-way visual mirror only.

Circuit does not use Apple Reminders, does not use iOS Shortcuts, and does not create recurring iCalendar events. Recurring Circuit tasks are expanded into separate one-off `VEVENT` records.

## Apple Setup

1. Create the dedicated iCloud calendar manually:
   - Open Apple Calendar.
   - Create a new iCloud calendar.
   - Name it exactly `Circuit`.
2. Enable an Apple app-specific password:
   - The Apple ID must have two-factor authentication enabled.
   - Open Apple Account settings.
   - Generate an app-specific password.
   - Use this password only for Circuit CalDAV sync.
3. Configure the backend environment.

Required:

```bash
ICLOUD_APPLE_ID=you@example.com
ICLOUD_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx
ICLOUD_CALDAV_BASE_URL=https://caldav.icloud.com
ICLOUD_CALENDAR_NAME=Circuit
CRON_SECRET=<long random token>
```

Optional:

```bash
APP_BASE_URL=https://<your-app>
ICLOUD_SYNC_ENABLED=false
ICLOUD_SYNC_WINDOW_DAYS=7
ICLOUD_TIMEZONE=Asia/Kolkata
```

`ICLOUD_APP_SPECIFIC_PASSWORD` is only read by backend cron/service code. Never log it, expose it to the frontend, or reuse it for anything except CalDAV sync.

`Circuit` must already exist. The sync job discovers calendars through CalDAV and fails with a setup error if it cannot find a calendar with that exact display name. It never creates calendars and never modifies events outside that calendar.

If the calendar is missing, sync returns:

```text
iCloud calendar 'Circuit' was not found. Please create it manually in Apple Calendar and retry sync.
```

Use `https://caldav.icloud.com` as the base URL. Circuit performs CalDAV principal and calendar-home discovery from there before listing calendars; do not paste a specific calendar collection URL.

## Setup Check

Run a non-destructive setup check:

```bash
curl "https://<api-host>/api/admin/icloud-calendar/setup-check" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Response shape:

```json
{
  "syncEnabled": false,
  "envVarsPresent": {
    "ICLOUD_APPLE_ID": true,
    "ICLOUD_APP_SPECIFIC_PASSWORD": true,
    "ICLOUD_CALDAV_BASE_URL": true,
    "ICLOUD_CALENDAR_NAME": true,
    "CRON_SECRET": true
  },
  "caldavReachable": true,
  "circuitCalendarFound": true,
  "circuitCalendarWritable": true,
  "errors": []
}
```

Setup-check validates env presence, connects to CalDAV, discovers calendars, finds `Circuit`, and reads calendar metadata to infer write access when CalDAV reports privileges. It does not create, update, or delete calendar objects.

## Cron Endpoints

Cron endpoints require:

```http
Authorization: Bearer <CRON_SECRET>
```

### `POST /api/cron/materialize-occurrences`

Expands recurrence definitions into the rolling materialized window:

```text
materializationEnd = max(endOfCurrentMonth, today + 7 days)
```

It also generates reminder rows for the next 7 days. Future generated occurrence rows outside the current recurrence state are pruned only when they are pending generated rows. Completed, skipped, edited, and past recurring occurrence history is preserved in `occurrence_overrides`.

### `POST /api/cron/sync-icloud-calendar`

Runs materialization, validates iCloud setup, discovers the `Circuit` iCloud calendar, reads current events for today through `ICLOUD_SYNC_WINDOW_DAYS`, diffs against Circuit occurrences, then creates, updates, or deletes mirror events. Set `ICLOUD_SYNC_ENABLED=true` to allow calendar writes.

Each event is a one-off `VEVENT` with no `RRULE`. The UID is deterministic:

```text
circuit-<taskId>-<occurrenceKey>
```

The description contains `Managed by Circuit`, `taskId`, `occurrenceKey`, optional `occurrenceId`, and an app link. If `APP_BASE_URL` is configured, the link points to that app host. Completed events may be prefixed with a completed marker.

## Security

- Never log the Apple ID app-specific password.
- Never expose iCloud credentials to frontend code.
- Only backend cron/service code accesses CalDAV credentials.
- Cron/admin routes require `Authorization: Bearer <CRON_SECRET>`.
- Sync only touches the manually discovered `Circuit` calendar.
- Sync only deletes app-owned events marked `Managed by Circuit`.

## Deletion Safety

Calendar deletion only happens when all of these are true:

- The event is inside the manually discovered `Circuit` calendar.
- The event description contains `Managed by Circuit`.
- The event is in the current sync window.
- The event has a parseable `DTSTART` inside the current/future window.
- The event no longer exists in Circuit's desired occurrence set.

Past events are not queried or deleted by the sync job. Manual events in the `Circuit` calendar that do not contain `Managed by Circuit` are skipped.

## Ledger

`calendar_sync_ledger` stores:

- `task_id`
- `occurrence_id` or `occurrence_key`
- `calendar_provider`
- `calendar_event_uid`
- `calendar_href`
- `calendar_etag`
- occurrence start/end
- last sync time
- sync status/error

Sync matches by stored `calendar_href` first. If the href is missing, it recovers by reading the calendar and matching the deterministic UID.

## Emergency Cleanup

The safest cleanup is to delete the `Circuit` calendar manually from Apple Calendar. Because Circuit never writes outside that calendar, deleting it removes the mirror without touching Circuit task data.

For app-side cleanup, preview future app-owned events first:

```bash
curl -X POST "https://<api-host>/api/cron/cleanup-icloud-calendar" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Then confirm deletion:

```bash
curl -X POST "https://<api-host>/api/cron/cleanup-icloud-calendar?confirm=true" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

This endpoint still only touches events in the manually discovered `Circuit` calendar that contain `Managed by Circuit` and have a future/current-window `DTSTART`.
