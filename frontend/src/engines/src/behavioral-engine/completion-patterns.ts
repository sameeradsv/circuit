import type { Task } from '../types';

export function recordCompletion(task: Task, completedAt = Date.now()): Task {
  const rate = task.historicalCompletionRate;
  const updated = rate * 0.7 + 0.3;
  return {
    ...task,
    completed: true,
    historicalCompletionRate: Math.min(1, updated),
    updatedAt: completedAt,
  };
}

export function completionRateByTag(tasks: Task[]): Record<string, number> {
  const stats: Record<string, { done: number; total: number }> = {};

  for (const task of tasks) {
    if (!stats[task.tag]) stats[task.tag] = { done: 0, total: 0 };
    stats[task.tag]!.total += 1;
    if (task.completed) stats[task.tag]!.done += 1;
  }

  return Object.fromEntries(
    Object.entries(stats).map(([tag, { done, total }]) => [
      tag,
      total === 0 ? 0 : done / total,
    ]),
  );
}
