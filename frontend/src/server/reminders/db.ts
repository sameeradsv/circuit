import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { reminderConfig } from "./env";

let client: NeonQueryFunction<false, false> | null = null;

export function sql() {
  if (!client) {
    client = neon(reminderConfig.databaseUrl());
  }
  return client;
}

export type PushSubscriptionRow = {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_name: string | null;
  platform: string | null;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
};

export type ReminderRow = {
  id: number;
  user_id: number;
  task_id: number;
  remind_at: Date | string;
  status: "pending" | "processing" | "sent" | "failed" | "cancelled";
  sent_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  attempts: number;
  last_error: string | null;
  occurrence_at_ms: number | null;
};

export type TaskReminderSource = {
  id: number;
  user_id: number;
  text: string;
  scheduled_at: number | null;
  recurrence: string | null;
  recurrence_ends_at: number | null;
  completed: boolean;
  notifications_enabled: boolean;
  notification_offset_1_mins: number | null;
  notification_offset_2_mins: number | null;
};
