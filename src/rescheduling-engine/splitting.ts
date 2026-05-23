import type { RescheduleEntry, Task } from '../types';
import { createTask } from '../task-engine/schema';

export function splitTask(task: Task, now = Date.now()): { parent: Task; child: Task | null } {
  if (task.taskDecompositionPotential < 0.5 || task.effort !== 'high') {
    return { parent: task, child: null };
  }

  const half = Math.ceil(task.duration / 2);
  const child = createTask(`${task.text} (part 2)`, {
    tag: task.tag,
    effort: 'medium',
    duration: task.duration - half,
    dependencies: [task.id],
    importance: task.importance * 0.8,
  });

  const entry: RescheduleEntry = {
    at: now,
    from: task.scheduledAt,
    to: task.scheduledAt,
    reason: 'split',
  };

  const parent: Task = {
    ...task,
    duration: half,
    tinyStep: task.tinyStep || `First ${half} min only`,
    updatedAt: now,
    rescheduleLog: [...task.rescheduleLog, entry],
  };

  return { parent, child };
}
