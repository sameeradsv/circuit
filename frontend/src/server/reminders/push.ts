import webpush, { WebPushError } from "web-push";
import { PushSubscriptionRow, sql } from "./db";
import { reminderConfig } from "./env";
import type { PushPayload } from "./payloads";

let configured = false;

function configureWebPush() {
  if (configured) return;
  webpush.setVapidDetails(
    reminderConfig.vapidSubject(),
    reminderConfig.vapidPublicKey(),
    reminderConfig.vapidPrivateKey(),
  );
  configured = true;
}

export function isInvalidSubscriptionError(error: unknown): boolean {
  const statusCode = (error as WebPushError | undefined)?.statusCode;
  return statusCode === 404 || statusCode === 410;
}

export async function disableSubscription(subscriptionId: number, reason: string) {
  await sql()`
    update push_subscriptions
    set enabled = false, updated_at = now()
    where id = ${subscriptionId}
  `;
  console.warn("Disabled invalid push subscription", { subscriptionId, reason });
}

export async function sendWebPush(subscription: PushSubscriptionRow, payload: PushPayload): Promise<void> {
  configureWebPush();
  await webpush.sendNotification(
    {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.p256dh,
        auth: subscription.auth,
      },
    },
    JSON.stringify(payload),
    { TTL: 3600 },
  );
}

export async function sendToUserDevices(userId: number, payload: PushPayload) {
  const subscriptions = await sql()`
    select *
    from push_subscriptions
    where user_id = ${userId}
      and enabled = true
    order by updated_at desc
  ` as PushSubscriptionRow[];

  let delivered = 0;
  let disabled = 0;
  const errors: string[] = [];

  for (const subscription of subscriptions) {
    try {
      await sendWebPush(subscription, payload);
      delivered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown push delivery error";
      if (isInvalidSubscriptionError(error)) {
        await disableSubscription(subscription.id, message);
        disabled += 1;
      } else {
        errors.push(message);
      }
    }
  }

  return {
    subscriptions: subscriptions.length,
    delivered,
    disabled,
    errors,
  };
}
