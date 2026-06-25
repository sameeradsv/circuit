import type { TaskReminderSource } from "./db";

export type ReminderOccurrence = {
  taskId: number;
  userId: number;
  title: string;
  occurrenceAtMs: number;
  remindAt: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function offsets(task: TaskReminderSource): number[] {
  if (!task.notifications_enabled) return [];
  const raw = [
    task.notification_offset_1_mins ?? 10,
    task.notification_offset_2_mins,
  ];
  return [...new Set(raw.filter((value): value is number => value != null && Number.isFinite(value) && value >= 0))];
}

function applyOffsets(task: TaskReminderSource, occurrenceAtMs: number, fromMs: number, toMs: number): ReminderOccurrence[] {
  return offsets(task)
    .map((offsetMins) => ({
      taskId: task.id,
      userId: task.user_id,
      title: task.text,
      occurrenceAtMs,
      remindAt: new Date(occurrenceAtMs - offsetMins * 60_000),
    }))
    .filter((occurrence) => {
      const remindMs = occurrence.remindAt.getTime();
      return remindMs >= fromMs && remindMs <= toMs;
    });
}

function isMatchingPattern(pattern: string, candidate: Date, anchor: Date): boolean {
  const day = candidate.getUTCDay();
  const code = WEEKDAY_CODES[day];
  if (pattern === "daily") return true;
  if (pattern === "weekday") return day >= 1 && day <= 5;
  if (pattern === "weekend") return day === 0 || day === 6;
  if (pattern === "weekly") return day === anchor.getUTCDay();
  if (pattern.startsWith("weekly:")) {
    return pattern.slice("weekly:".length).split(",").includes(code);
  }
  const everyMatch = pattern.match(/^every:(\d+)([dw])$/);
  if (everyMatch) {
    const n = Number(everyMatch[1]);
    const unitMs = everyMatch[2] === "w" ? 7 * DAY_MS : DAY_MS;
    const elapsed = candidate.getTime() - anchor.getTime();
    return elapsed >= 0 && Math.floor(elapsed / unitMs) % n === 0;
  }
  return false;
}

export function expandReminderOccurrences(
  tasks: TaskReminderSource[],
  from: Date,
  to: Date,
): ReminderOccurrence[] {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const occurrences: ReminderOccurrence[] = [];

  for (const task of tasks) {
    if (!task.scheduled_at || task.completed) continue;
    const endMs = task.recurrence_ends_at ?? toMs;
    const effectiveToMs = Math.min(toMs, endMs);
    if (!task.recurrence) {
      if (task.scheduled_at >= fromMs && task.scheduled_at <= effectiveToMs) {
        occurrences.push(...applyOffsets(task, task.scheduled_at, fromMs, toMs));
      }
      continue;
    }

    const anchor = new Date(task.scheduled_at);
    const cursor = new Date(Math.max(task.scheduled_at, fromMs - DAY_MS));
    cursor.setUTCHours(anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds());

    for (let current = cursor.getTime(); current <= effectiveToMs; current += DAY_MS) {
      if (current < task.scheduled_at) continue;
      const candidate = new Date(current);
      if (isMatchingPattern(task.recurrence, candidate, anchor)) {
        occurrences.push(...applyOffsets(task, current, fromMs, toMs));
      }
    }
  }

  return occurrences.sort((a, b) => a.remindAt.getTime() - b.remindAt.getTime());
}
