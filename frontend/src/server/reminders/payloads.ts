export type PushKeys = {
  p256dh: string;
  auth: string;
};

export type SubscribeDevicePayload = {
  endpoint: string;
  keys: PushKeys;
  device_name?: string | null;
  platform?: string | null;
};

export type UnsubscribeDevicePayload = {
  endpoint: string;
};

export type PushPayload = {
  title: string;
  body?: string;
  tag?: string;
  url?: string;
  taskId?: number;
  scheduledAt?: number | null;
  reminderType?: string;
};

export function parseSubscribePayload(input: unknown): SubscribeDevicePayload {
  if (!input || typeof input !== "object") {
    throw new Error("Invalid subscription payload");
  }
  const body = input as Partial<SubscribeDevicePayload>;
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    throw new Error("endpoint, keys.p256dh, and keys.auth are required");
  }
  return {
    endpoint: body.endpoint,
    keys: {
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    },
    device_name: body.device_name || null,
    platform: body.platform || null,
  };
}

export function parseUnsubscribePayload(input: unknown): UnsubscribeDevicePayload {
  if (!input || typeof input !== "object" || typeof (input as UnsubscribeDevicePayload).endpoint !== "string") {
    throw new Error("endpoint is required");
  }
  return { endpoint: (input as UnsubscribeDevicePayload).endpoint };
}
