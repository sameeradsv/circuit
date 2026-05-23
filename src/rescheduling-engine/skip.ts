import type { RescheduleEntry, Task } from '../types';
import { detectDelayPattern } from './delay-pattern';

export function skipTask(task: Task, now = Date.now()): Task {
  const newScheduledAt = now + 60 * 60 * 1000;
  const entry: RescheduleEntry = {
    at: now,
    from: task.scheduledAt,
    to: newScheduledAt,
    reason: 'skip',
  };

  const updated: Task = {
    ...task,
    skippedCount: task.skippedCount + 1,
    lastSkippedAt: now,
    scheduledAt: newScheduledAt,
    updatedAt: now,
    rescheduleLog: [...task.rescheduleLog, entry],
  };

  // Re-evaluate delay pattern after each skip so it stays current
  const pattern = detectDelayPattern(updated);
  return pattern !== null ? { ...updated, delayPattern: pattern } : updated;
}
