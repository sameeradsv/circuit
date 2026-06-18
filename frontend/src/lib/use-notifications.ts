"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiTask } from "./api";

const STORAGE_KEY = "circuit-notifications";
const TOGGLE_EVENT = "circuit-notif-toggle";
// Only schedule timers within this window. Beyond it, setTimeout delay
// overflows the 32-bit int limit (~24.8 days) and fires immediately.
const SCHEDULE_HORIZON_MS = 24 * 60 * 60 * 1000;

function reminderOffsets(task: ApiTask): number[] {
  if (task.notifications_enabled === false) return [];
  return Array.from(new Set([
    task.notification_offset_1_mins ?? 10,
    task.notification_offset_2_mins,
  ].filter((offset): offset is number => offset != null)));
}

function reminderLeadLabel(offset: number): string {
  if (offset === 0) return "now";
  if (offset < 60) return `${offset}m`;
  if (offset === 60) return "1h";
  if (offset === 1440) return "1d";
  if (offset % 60 === 0) return `${offset / 60}h`;
  return `${offset}m`;
}

/** Called once in AppShell. Schedules browser notifications for upcoming tasks. */
export function useNotificationScheduler(tasks: ApiTask[]) {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    const handler = () => setRev((r) => r + 1);
    window.addEventListener(TOGGLE_EVENT, handler);
    return () => window.removeEventListener(TOGGLE_EVENT, handler);
  }, []);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];

    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (localStorage.getItem(STORAGE_KEY) !== "true") return;

    const now = Date.now();
    for (const task of tasks) {
      if (task.completed || !task.scheduled_at) continue;

      for (const offset of reminderOffsets(task)) {
        const delay = task.scheduled_at - offset * 60_000 - now;
        if (delay < 0) continue;
        if (delay > SCHEDULE_HORIZON_MS) continue;

        const id = setTimeout(() => {
          const time = new Date(task.scheduled_at!).toLocaleTimeString("en-IN", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: "Asia/Kolkata",
          });
          new Notification(`Starting soon: ${task.text}`, {
            body: `${time} · ${task.duration ?? 30}m · reminder ${reminderLeadLabel(offset)}`,
            tag: `circuit-${task.id}-${offset}`,
          });
        }, delay);
        timers.current.push(id);
      }
    }

    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [tasks, rev]);
}

/** Called in Sidebar. Manages the enable/disable toggle and permission request. */
export function useNotificationToggle() {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setPermission(Notification.permission);
    setEnabled(
      Notification.permission === "granted" &&
        localStorage.getItem(STORAGE_KEY) === "true",
    );
  }, []);

  async function enable() {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      setEnabled(true);
      localStorage.setItem(STORAGE_KEY, "true");
      window.dispatchEvent(new Event(TOGGLE_EVENT));
    }
  }

  function disable() {
    setEnabled(false);
    localStorage.setItem(STORAGE_KEY, "false");
    window.dispatchEvent(new Event(TOGGLE_EVENT));
  }

  function toggle() {
    if (!enabled) {
      enable();
    } else {
      disable();
    }
  }

  return { permission, enabled, toggle };
}
