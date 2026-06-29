"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

const STORAGE_KEY = "circuit-notifications";
const SW_FILE = "sw.js";

function appBasePath(): string {
  if (typeof window === "undefined") return "";

  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (manifest?.href) {
    try {
      const url = new URL(manifest.href);
      const path = url.pathname.replace(/\/manifest(?:\.webmanifest)?$/, "");
      if (url.origin === window.location.origin && path !== "/") return path.replace(/\/$/, "");
    } catch {
      // Fall back to the pathname heuristic below.
    }
  }

  return window.location.pathname.startsWith("/circuit") ? "/circuit" : "";
}

function serviceWorkerPath(): string {
  return `${appBasePath()}/${SW_FILE}`.replace(/\/{2,}/g, "/");
}

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
  try {
    return await navigator.serviceWorker.register(serviceWorkerPath());
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `Unable to register notification service worker: ${err.message}`
        : "Unable to register notification service worker",
    );
  }
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
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const canPush =
      typeof window !== "undefined" &&
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      window.isSecureContext;
    setSupported(canPush);
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError("Notifications require HTTPS or localhost");
    }
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
    setStatus("Requesting permission...");
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        setStatus(result === "denied" ? "Notifications are blocked in browser settings" : null);
        return;
      }
      setStatus("Registering this device...");
      const existing = await getExistingSubscription();
      if (existing) {
        await api.subscribeNotifications(subscriptionToPayload(existing));
      } else {
        await subscribeCurrentDevice();
      }
      localStorage.setItem(STORAGE_KEY, "true");
      setEnabled(true);
      setStatus("Task reminders are on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to enable notifications");
      setStatus(null);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!supported || busy) return;
    setBusy(true);
    setError(null);
    setStatus("Turning notifications off...");
    try {
      const existing = await getExistingSubscription();
      if (existing) {
        await api.unsubscribeNotifications(existing.endpoint).catch(() => undefined);
        await existing.unsubscribe().catch(() => false);
      }
      localStorage.setItem(STORAGE_KEY, "false");
      setEnabled(false);
      setStatus("Task reminders are off");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to disable notifications");
      setStatus(null);
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

  return { permission, enabled, supported, busy, error, status, toggle };
}
