import type { Task } from '../types';

export function preserveMomentum(tasks: Task[]): Task[] {
  const recent = tasks
    .filter((t) => t.completed && t.updatedAt > Date.now() - 2 * 60 * 60 * 1000)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (recent.length === 0) return tasks;

  const lastTag = recent[0]!.tag;
  return tasks.map((t) => {
    if (t.completed || t.tag !== lastTag) return t;
    return {
      ...t,
      momentumValue: Math.min(1, t.momentumValue + 0.15),
      updatedAt: Date.now(),
    };
  });
}
