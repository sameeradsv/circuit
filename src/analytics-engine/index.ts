import type { Task } from '../types';
import { completionRateByTag } from '../behavioral-engine';

export interface TaskAnalytics {
  total: number;
  pending: number;
  completed: number;
  completionRate: number;
  byTag: Record<string, number>;
  totalPendingMinutes: number;
  avgSkipCount: number;
}

export function computeAnalytics(tasks: Task[]): TaskAnalytics {
  const pending = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) => t.completed);

  return {
    total: tasks.length,
    pending: pending.length,
    completed: completed.length,
    completionRate: tasks.length ? completed.length / tasks.length : 0,
    byTag: completionRateByTag(tasks),
    totalPendingMinutes: pending.reduce((s, t) => s + t.duration, 0),
    avgSkipCount:
      pending.length === 0
        ? 0
        : pending.reduce((s, t) => s + t.skippedCount, 0) / pending.length,
  };
}
