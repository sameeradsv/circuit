import { ReminderRow, TaskReminderSource, sql } from "./db";
import { reminderConfig } from "./env";
import type { PushPayload } from "./payloads";
import { sendToUserDevices } from "./push";
import { expandReminderOccurrences } from "./recurrence";

export type ProcessReminderStats = {
  materialized: number;
  claimed: number;
  sent: number;
  failed: number;
  cancelled: number;
  subscriptionsDisabled: number;
};

function reminderPayload(task: { id: number; text: string }, reminder: ReminderRow): PushPayload {
  return {
    title: `Starting soon: ${task.text}`,
    body: "Tap to open Circuit",
    tag: `circuit-task-${task.id}-${Math.floor(new Date(reminder.remind_at).getTime() / 1000)}`,
    url: "/calendar",
    taskId: task.id,
    scheduledAt: reminder.occurrence_at_ms,
  };
}

export async function materializeUpcomingReminders(now = new Date(), userId?: number): Promise<number> {
  const from = new Date(now.getTime() - 5 * 60_000);
  const to = new Date(now.getTime() + reminderConfig.materializeDays() * 24 * 60 * 60_000);
  const tasks = await sql()`
    select id, user_id, text, scheduled_at, recurrence, recurrence_ends_at, completed,
           notifications_enabled, notification_offset_1_mins, notification_offset_2_mins
    from circuit_tasks
    where completed = false
      and scheduled_at is not null
      and notifications_enabled = true
      and scheduled_at <= ${to.getTime()}
      and (recurrence_ends_at is null or recurrence_ends_at >= ${from.getTime()})
      and (${userId ?? null}::integer is null or user_id = ${userId ?? null})
  ` as TaskReminderSource[];

  const occurrences = expandReminderOccurrences(tasks, from, to);
  let materialized = 0;

  for (const occurrence of occurrences) {
    const rows = await sql()`
      insert into reminders (user_id, task_id, remind_at, occurrence_at_ms, status)
      values (${occurrence.userId}, ${occurrence.taskId}, ${occurrence.remindAt.toISOString()}, ${occurrence.occurrenceAtMs}, 'pending')
      on conflict (user_id, task_id, remind_at)
      do update set
        occurrence_at_ms = excluded.occurrence_at_ms,
        status = case when reminders.status = 'cancelled' then 'pending' else reminders.status end,
        updated_at = now()
      returning id
    `;
    if (rows.length > 0) materialized += 1;
  }

  return materialized;
}

export async function claimDueReminders(limit = reminderConfig.batchSize(), now = new Date()): Promise<ReminderRow[]> {
  return await sql()`
    update reminders
    set status = 'processing', updated_at = now(), locked_at = now()
    where id in (
      select id
      from reminders
      where status in ('pending', 'failed')
        and remind_at <= ${now.toISOString()}
        and attempts < ${reminderConfig.maxAttempts()}
      order by remind_at asc, id asc
      for update skip locked
      limit ${limit}
    )
    returning *
  ` as ReminderRow[];
}

export async function processDueReminders(now = new Date()): Promise<ProcessReminderStats> {
  const stats: ProcessReminderStats = {
    materialized: await materializeUpcomingReminders(now),
    claimed: 0,
    sent: 0,
    failed: 0,
    cancelled: 0,
    subscriptionsDisabled: 0,
  };

  const reminders = await claimDueReminders(reminderConfig.batchSize(), now);
  stats.claimed = reminders.length;

  for (const reminder of reminders) {
    const taskRows = await sql()`
      select id, text, completed
      from circuit_tasks
      where id = ${reminder.task_id}
        and user_id = ${reminder.user_id}
      limit 1
    ` as Array<{ id: number; text: string; completed: boolean }>;
    const task = taskRows[0];

    if (!task || task.completed) {
      await sql()`
        update reminders
        set status = 'cancelled', updated_at = now()
        where id = ${reminder.id}
      `;
      stats.cancelled += 1;
      continue;
    }

    const delivery = await sendToUserDevices(reminder.user_id, reminderPayload(task, reminder));
    stats.subscriptionsDisabled += delivery.disabled;

    if (delivery.delivered > 0) {
      await sql()`
        update reminders
        set status = 'sent',
            sent_at = now(),
            attempts = attempts + 1,
            last_error = ${delivery.errors.join("; ").slice(0, 1000) || null},
            updated_at = now()
        where id = ${reminder.id}
      `;
      stats.sent += 1;
    } else {
      await sql()`
        update reminders
        set status = 'failed',
            attempts = attempts + 1,
            last_error = ${delivery.errors.join("; ").slice(0, 1000) || "No enabled push subscriptions"},
            updated_at = now()
        where id = ${reminder.id}
      `;
      stats.failed += 1;
    }

    console.info("Processed reminder", { reminderId: reminder.id, delivered: delivery.delivered });
  }

  return stats;
}
