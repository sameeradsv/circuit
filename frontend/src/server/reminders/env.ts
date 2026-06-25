export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export const reminderConfig = {
  databaseUrl: () => requiredEnv("DATABASE_URL"),
  vapidPublicKey: () => requiredEnv("VAPID_PUBLIC_KEY"),
  vapidPrivateKey: () => requiredEnv("VAPID_PRIVATE_KEY"),
  vapidSubject: () => process.env.VAPID_SUBJECT || "mailto:ops@example.com",
  cronSecret: () => requiredEnv("REMINDER_CRON_SECRET"),
  batchSize: () => Number(process.env.REMINDER_BATCH_SIZE || "100"),
  materializeDays: () => Number(process.env.REMINDER_MATERIALIZE_DAYS || "14"),
  maxAttempts: () => Number(process.env.REMINDER_MAX_ATTEMPTS || "5"),
};
