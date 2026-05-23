import type { EnergyMode, RescheduleEntry, Task } from '../types';
import { avoidanceDelayMs } from './delay-pattern';

export function adaptiveReschedule(tasks: Task[], mode: EnergyMode, now = Date.now()): Task[] {
  return tasks.map((task) => {
    if (task.completed) return task;

    const skipDelay = Math.min(task.skippedCount, 5) * 30 * 60 * 1000;
    let newScheduledAt = now + skipDelay;

    if (mode === 'low' && task.effort !== 'low') {
      newScheduledAt = now + 2 * 60 * 60 * 1000;
    }
    if (mode === 'deep' && task.focusType !== 'deep') {
      newScheduledAt = now + 4 * 60 * 60 * 1000;
    }

    // Push past the task's learned avoidance window if we're inside it
    const avoidMs = avoidanceDelayMs(task, now);
    if (avoidMs > 0) newScheduledAt = Math.max(newScheduledAt, now + avoidMs);

    if (newScheduledAt === task.scheduledAt) return task;

    const entry: RescheduleEntry = {
      at: now,
      from: task.scheduledAt,
      to: newScheduledAt,
      reason: 'adaptive',
    };

    return {
      ...task,
      scheduledAt: newScheduledAt,
      updatedAt: now,
      rescheduleLog: [...task.rescheduleLog, entry],
    };
  });
}
