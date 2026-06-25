import type { PushPayload } from "./payloads";
import { sendToUserDevices } from "./push";
import { sql } from "./db";

const FIXED_TYPES = new Set(["morning", "afternoon", "evening"]);

export async function sendFixedReminder(type: string) {
  if (!FIXED_TYPES.has(type)) {
    throw new Error("Reminder type must be morning, afternoon, or evening");
  }

  const users = await sql()`
    select distinct user_id
    from push_subscriptions
    where enabled = true
  ` as Array<{ user_id: number }>;

  const copy: Record<string, PushPayload> = {
    morning: {
      title: "Morning check-in",
      body: "A gentle nudge to set your intention.",
      tag: "fixed-reminder-morning",
      url: "/",
      reminderType: "morning",
    },
    afternoon: {
      title: "Afternoon reset",
      body: "Pause, review, and choose the next useful step.",
      tag: "fixed-reminder-afternoon",
      url: "/",
      reminderType: "afternoon",
    },
    evening: {
      title: "Evening reflection",
      body: "Close the loop while the day is still warm.",
      tag: "fixed-reminder-evening",
      url: "/",
      reminderType: "evening",
    },
  };

  let delivered = 0;
  let subscriptionsDisabled = 0;
  for (const user of users) {
    const result = await sendToUserDevices(user.user_id, copy[type]);
    delivered += result.delivered;
    subscriptionsDisabled += result.disabled;
  }

  return { users: users.length, delivered, subscriptionsDisabled };
}
