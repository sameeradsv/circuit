import type { RescheduleEntry, Task } from '../types';

// Supported formats: "daily" | "weekly" | "weekdays" | "every:Nd" | "every:Nw" | "every:Nh"
function parseIntervalMs(recurrence: string): number | null {
  if (recurrence === 'daily') return 24 * 60 * 60 * 1000;
  if (recurrence === 'weekly') return 7 * 24 * 60 * 60 * 1000;
  const m = recurrence.match(/^every:(\d+)(d|w|h)$/);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (m[2] === 'w') return n * 7 * 24 * 60 * 60 * 1000;
  if (m[2] === 'h') return n * 60 * 60 * 1000;
  return n * 24 * 60 * 60 * 1000;
}

function nextWeekday(from: number): number {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function nextOccurrence(task: Task, now = Date.now()): number | null {
  if (!task.recurrence) return null;
  const base = task.scheduledAt ?? now;
  if (task.recurrence === 'weekdays') return nextWeekday(base);
  const intervalMs = parseIntervalMs(task.recurrence);
  return intervalMs !== null ? base + intervalMs : null;
}

// Call after marking a task complete. Returns a reset Task scheduled at next occurrence,
// or the unchanged task if it has no recurrence rule.
export function applyRecurrence(task: Task, now = Date.now()): Task {
  const nextAt = nextOccurrence(task, now);
  if (nextAt === null) return task;

  const entry: RescheduleEntry = {
    at: now,
    from: task.scheduledAt,
    to: nextAt,
    reason: 'recurrence',
  };

  return {
    ...task,
    completed: false,
    scheduledAt: nextAt,
    skippedCount: 0,
    lastSkippedAt: null,
    updatedAt: now,
    rescheduleLog: [...task.rescheduleLog, entry],
  };
}
