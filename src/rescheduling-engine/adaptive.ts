import type { EnergyMode, Task } from '../types';

export function adaptiveReschedule(tasks: Task[], mode: EnergyMode, now = Date.now()): Task[] {
  return tasks.map((task) => {
    if (task.completed) return task;

    const delayMs = Math.min(task.skippedCount, 5) * 30 * 60 * 1000;
    let scheduledAt = now + delayMs;

    if (mode === 'low' && task.effort !== 'low') {
      scheduledAt = now + 2 * 60 * 60 * 1000;
    }
    if (mode === 'deep' && task.focusType !== 'deep') {
      scheduledAt = now + 4 * 60 * 60 * 1000;
    }

    return { ...task, scheduledAt, updatedAt: now };
  });
}
