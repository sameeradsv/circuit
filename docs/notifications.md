# Notifications Architecture

Circuit uses Web Push for reminders so notifications can arrive on every installed PWA device even when the app is closed. Browser timers are not part of the delivery path.

## Circuit task reminders

```mermaid
flowchart LR
  Task["Task or recurrence rule"] --> Materializer["Reminder materializer"]
  Materializer --> Reminder["reminders rows"]
  Device["Installed PWA device"] --> Sub["push_subscriptions rows"]
  Cron["cron-job.org every minute"] --> Processor["POST /api/cron/materialize-occurrences\nor POST /api/notifications/process"]
  Processor --> Reminder
  Processor --> Sub
  Processor --> Push["Web Push service"]
  Push --> SW["/sw.js service worker"]
```

Tasks and recurrence rules decide what should be reminded. `reminders` rows decide when the reminder is eligible for delivery. `push_subscriptions` rows decide where it is delivered.

Scheduled tasks with no reminders are treated as time-blocked work that happened unless corrected later: when the shared cron sees the task's scheduled block has ended, it marks the task complete and writes a normal `completed` history event with `reason: auto_no_reminder`. This completion participates in the energy timeline immediately. If the task did not actually happen, undo or edit it from History.

The backend materializes reminders only for a bounded upcoming window (`REMINDER_MATERIALIZE_DAYS`, default 7). Recurring tasks still remain recurrence definitions; Circuit does not generate infinite task rows.

Delivered task reminder copy is intentionally minimal:

- Notification title: the task text.
- Notification body: scheduled IST time plus compact planning signals, for example `11:30 AM IST · imp 80% · urg 70% · delay 60% · drain 40%`.
- `load NN%` is appended only for high cognitive-load tasks.

Circuit does not call Groq while processing due reminders. The parameters are the saved task fields, including AI-filled defaults when a task was originally created or imported.

## Data model

`push_subscriptions`

- `id`
- `user_id`
- `endpoint`
- `p256dh`
- `auth`
- `device_name`
- `platform`
- `enabled`
- `created_at`
- `updated_at`

`reminders`

- `id`
- `user_id`
- `task_id`
- `remind_at`
- `status`: `pending`, `processing`, `sent`, `failed`, `cancelled`
- `sent_at`
- `created_at`
- `updated_at`
- `attempts`
- `last_error`
- `occurrence_at_ms`

The extra operational columns support retries, logging, and virtual recurring occurrence reminders.

## API

- `GET /api/notifications/vapid-public-key`
- `POST /api/notifications/subscribe`
- `POST /api/notifications/unsubscribe`
- `POST /api/notifications/process`
- `POST /api/cron/materialize-occurrences`
- `POST /api/cron/sync-icloud-calendar`

`/api/notifications/process` is the reminder-only processor and requires:

```http
Authorization: Bearer ${REMINDER_CRON_SECRET}
```

The shared backend cron endpoints use `CRON_SECRET`. They now materialize upcoming reminder rows, auto-complete due no-reminder tasks, and process due reminder deliveries as part of their normal response, returning counts such as `reminders_generated_count`, `auto_completed_count`, `claimed`, `sent`, `failed`, and `cancelled`.

## Service worker scope

The notification service worker must be served from the same base path as the installed PWA. Root deployments register `/sw.js`; subpath deployments such as `/circuit` register `/circuit/sw.js` and use the same base path for notification icons and click targets. Keep the manifest URL, service worker file, and installed app scope aligned.

## Vercel setup

Set these environment variables for the backend deployment:

```bash
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
REMINDER_CRON_SECRET=...
REMINDER_MATERIALIZE_DAYS=7
REMINDER_BATCH_SIZE=100
REMINDER_MAX_ATTEMPTS=3
```

Generate VAPID keys with a Web Push key generator, for example `npx web-push generate-vapid-keys`, then copy the public and private keys into Vercel.

Configure cron-job.org to call every minute:

```text
POST https://<api-host>/api/cron/materialize-occurrences
Authorization: Bearer <CRON_SECRET>
```

If an existing every-minute job already calls `POST /api/cron/sync-icloud-calendar`, that job also processes due reminders. A separate `POST /api/notifications/process` job is only needed when reminders should run independently from the shared Circuit cron job.

## Canopy and Chef lightweight reminders

For fixed daily reminders, use the same Web Push subscription table and service worker, but skip the `reminders` table. cron-job.org should call one endpoint at fixed times:

```text
Canopy:
11:00 POST /api/reminders/fixed?type=morning
17:00 POST /api/reminders/fixed?type=afternoon
22:00 POST /api/reminders/fixed?type=evening

Chef:
11:00 POST /api/reminders/fixed?type=breakfast
15:00 POST /api/reminders/fixed?type=lunch
22:00 POST /api/reminders/fixed?type=dinner
```

Or use one parameterized Vercel route:

```ts
export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.REMINDER_CRON_SECRET}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "morning";
  const messages = {
    morning: ["Capture any important people moments from the morning."],
    afternoon: ["Add what shifted with people since lunch."],
    evening: ["Close the loop on the people moments from today."],
    breakfast: ["Add breakfast while details are fresh."],
    lunch: ["Log lunch while details are fresh."],
    dinner: ["Add dinner before the day closes."],
  }[type] ?? ["Time for a quick check-in."];
  const dayIndex = Math.floor(Date.now() / 86_400_000) % messages.length;
  const message = messages[dayIndex];

  const subscriptions = await db.pushSubscription.findMany({ where: { enabled: true } });
  await Promise.all(subscriptions.map((sub) => sendWebPush(sub, {
    title: "Reminder",
    body: message,
    tag: `daily-${type}`,
    url: "/",
  })));

  return Response.json({ sent: subscriptions.length });
}
```

The important difference: Circuit has task-derived dynamic reminder rows; Canopy and Chef can operate from cron time alone.
