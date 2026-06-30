import type { BehavioralInsight, Task } from '../types';

const STALE_MS = 3 * 24 * 60 * 60 * 1000;

export function detectProcrastination(tasks: Task[], now = Date.now()): BehavioralInsight[] {
  const insights: BehavioralInsight[] = [];

  for (const task of tasks) {
    if (task.completed) continue;
    const age = now - task.createdAt;
    const stale = age > STALE_MS && !task.completed;

    if (stale) {
      insights.push({
        type: 'procrastination',
        message: `"${task.text}" has been open for ${Math.floor(age / 86400000)} days — try a tiny step`,
        taskId: task.id,
      });
    }
  }

  return insights;
}
