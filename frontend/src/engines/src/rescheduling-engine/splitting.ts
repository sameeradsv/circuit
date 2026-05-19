import type { Task } from '../types';
import { createTask } from '../task-engine/schema';

export function splitTask(task: Task): { parent: Task; child: Task | null } {
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

  const parent: Task = {
    ...task,
    duration: half,
    tinyStep: task.tinyStep || `First ${half} min only`,
    updatedAt: Date.now(),
  };

  return { parent, child };
}
