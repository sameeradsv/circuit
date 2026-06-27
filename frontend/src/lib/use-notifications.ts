"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

const STORAGE_KEY = "circuit-notifications";
const SW_PATH = "/sw.js";

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer.slice(
    outputArray.byteOffset,
    outputArray.byteOffset + outputArray.byteLength,
  ) as ArrayBuffer;
}

function subscriptionToPayload(sub: PushSubscription) {
  const json = sub.toJSON();
  const keys = json.keys;
  if (!json.endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error("Browser did not return a complete push subscription");
  }
  return {
    endpoint: json.endpoint,
    keys: {
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
    device_name: navigator.userAgent.includes("Mobile") ? "Mobile PWA" : "Desktop browser",
    platform: navigator.platform || "web",
  };
}

async function getRegistration() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers are not supported in this browser");
  }
  return navigator.serviceWorker.register(SW_PATH);
}

async function getExistingSubscription() {
  const registration = await getRegistration();
  return registration.pushManager.getSubscription();
}

async function subscribeCurrentDevice() {
  const registration = await getRegistration();
  const { public_key } = await api.getVapidPublicKey();
  if (!public_key) {
    throw new Error("Push notifications are not configured");
  }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToArrayBuffer(public_key),
  });
  await api.subscribeNotifications(subscriptionToPayload(subscription));
  return subscription;
}

export function useNotificationToggle() {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canPush =
      typeof window !== "undefined" &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window;
    setSupported(canPush);
    if (!canPush) return;
    setPermission(Notification.permission);
    getExistingSubscription()
      .then((sub) => {
        const on = Notification.permission === "granted" && !!sub && localStorage.getItem(STORAGE_KEY) === "true";
        setEnabled(on);
      })
      .catch(() => setEnabled(false));
  }, []);

  async function enable() {
    if (!supported || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;
      const existing = await getExistingSubscription();
      if (existing) {
        await api.subscribeNotifications(subscriptionToPayload(existing));
      } else {
        await subscribeCurrentDevice();
      }
      localStorage.setItem(STORAGE_KEY, "true");
      setEnabled(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to enable notifications");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!supported || busy) return;
    setBusy(true);
    setError(null);
    try {
      const existing = await getExistingSubscription();
      if (existing) {
        await api.unsubscribeNotifications(existing.endpoint).catch(() => undefined);
        await existing.unsubscribe().catch(() => false);
      }
      localStorage.setItem(STORAGE_KEY, "false");
      setEnabled(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to disable notifications");
    } finally {
      setBusy(false);
    }
  }

  function toggle() {
    if (!enabled) {
      void enable();
    } else {
      void disable();
    }
  }

  return { permission, enabled, supported, busy, error, toggle };
}
