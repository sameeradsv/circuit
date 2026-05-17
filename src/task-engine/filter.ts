import type { EnergyMode, Task } from '../types';

export type TaskFilter = 'all' | 'pending' | 'completed' | 'today' | 'scheduled';

export function filterTasks(
  tasks: Task[],
  filter: TaskFilter,
  mode: EnergyMode = 'normal',
): Task[] {
  let result = [...tasks];

  switch (filter) {
    case 'pending':
      result = result.filter((t) => !t.completed);
      break;
    case 'completed':
      result = result.filter((t) => t.completed);
      break;
    case 'today': {
      const today = startOfDay(Date.now());
      result = result.filter(
        (t) =>
          !t.completed &&
          (startOfDay(t.createdAt) === today || t.tag === 'work' || t.scheduledAt !== null),
      );
      break;
    }
    case 'scheduled':
      result = result.filter((t) => !t.completed && t.scheduledAt !== null);
      break;
    default:
      break;
  }

  return applyModeFilter(result, mode);
}

export function applyModeFilter(tasks: Task[], mode: EnergyMode): Task[] {
  switch (mode) {
    case 'low':
      return tasks.filter((t) => !t.completed && (t.tinyStep.length > 0 || t.effort === 'low'));
    case 'deep':
      return tasks.filter((t) => !t.completed && (t.tag === 'work' || t.focusType === 'deep'));
    case 'social':
      return tasks.filter((t) => t.tag !== 'social' && !t.completed);
    default:
      return tasks;
  }
}

export function groupTasksByTag(tasks: Task[]): Record<string, Task[]> {
  return tasks.reduce<Record<string, Task[]>>((groups, task) => {
    const key = task.tag;
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
    return groups;
  }, {});
}

export function groupTasksByEffort(tasks: Task[]): Record<string, Task[]> {
  return tasks.reduce<Record<string, Task[]>>((groups, task) => {
    const key = task.effort;
    if (!groups[key]) groups[key] = [];
    groups[key].push(task);
    return groups;
  }, {});
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
