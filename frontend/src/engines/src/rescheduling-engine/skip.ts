import type { Task } from '../types';

export function skipTask(task: Task, now = Date.now()): Task {
  return {
    ...task,
    skippedCount: task.skippedCount + 1,
    lastSkippedAt: now,
    scheduledAt: now + 60 * 60 * 1000,
    updatedAt: now,
  };
}
