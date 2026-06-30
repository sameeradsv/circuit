import type { PushPayload } from "./payloads";
import { sendToUserDevices } from "./push";
import { sql } from "./db";

const FIXED_TYPES = new Set(["morning", "afternoon", "evening", "breakfast", "lunch", "dinner"]);

export async function sendFixedReminder(type: string) {
  if (!FIXED_TYPES.has(type)) {
    throw new Error("Reminder type must be morning, afternoon, evening, breakfast, lunch, or dinner");
  }

  const users = await sql()`
    select distinct user_id
    from push_subscriptions
    where enabled = true
  ` as Array<{ user_id: number }>;

  const copy: Record<string, PushPayload[]> = {
    morning: [{
      title: "Morning interaction check-in",
      body: "Capture any important people moments from the morning.",
      tag: "fixed-reminder-morning",
      url: "/",
      reminderType: "morning",
    }],
    afternoon: [{
      title: "Afternoon interaction check-in",
      body: "Add what shifted with people since lunch.",
      tag: "fixed-reminder-afternoon",
      url: "/",
      reminderType: "afternoon",
    }],
    evening: [{
      title: "Evening interaction check-in",
      body: "Close the loop on the people moments from today.",
      tag: "fixed-reminder-evening",
      url: "/",
      reminderType: "evening",
    }],
    breakfast: [{
      title: "Breakfast entry",
      body: "Add breakfast while details are fresh.",
      tag: "fixed-reminder-breakfast",
      url: "/",
      reminderType: "breakfast",
    }],
    lunch: [{
      title: "Lunch entry",
      body: "Log lunch while details are fresh.",
      tag: "fixed-reminder-lunch",
      url: "/",
      reminderType: "lunch",
    }],
    dinner: [{
      title: "Dinner entry",
      body: "Add dinner before the day closes.",
      tag: "fixed-reminder-dinner",
      url: "/",
      reminderType: "dinner",
    }],
  };
  const payload = copy[type][Math.floor(Date.now() / 86_400_000) % copy[type].length];

  let delivered = 0;
  let subscriptionsDisabled = 0;
  for (const user of users) {
    const result = await sendToUserDevices(user.user_id, payload);
    delivered += result.delivered;
    subscriptionsDisabled += result.disabled;
  }

  return { users: users.length, delivered, subscriptionsDisabled };
}
