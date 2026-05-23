import type { RescheduleEntry, Task } from '../types';

const MAX_DAILY_MINUTES = 360;

export function reduceOverload(tasks: Task[], now = Date.now()): { tasks: Task[]; deferred: string[] } {
  const pending = tasks.filter((t) => !t.completed);
  let total = pending.reduce((s, t) => s + t.duration, 0);
  const deferred: string[] = [];

  if (total <= MAX_DAILY_MINUTES) return { tasks, deferred };

  const sorted = [...pending].sort(
    (a, b) => a.importance + a.urgency - (b.importance + b.urgency),
  );

  const updated = tasks.map((t) => ({ ...t }));
  for (const low of sorted) {
    if (total <= MAX_DAILY_MINUTES) break;
    const idx = updated.findIndex((t) => t.id === low.id);
    if (idx === -1) continue;
    const task = updated[idx]!;
    if (task.scheduledAt && task.scheduledAt > now) continue;
    const newScheduledAt = now + 24 * 60 * 60 * 1000;
    const entry: RescheduleEntry = {
      at: now,
      from: task.scheduledAt,
      to: newScheduledAt,
      reason: 'overload',
    };
    updated[idx] = {
      ...task,
      scheduledAt: newScheduledAt,
      tag: task.tag === 'work' ? 'later' : task.tag,
      updatedAt: now,
      rescheduleLog: [...task.rescheduleLog, entry],
    };
    deferred.push(task.text);
    total -= task.duration;
  }

  return { tasks: updated, deferred };
}
