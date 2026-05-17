import type { Task } from '../types';

function hourBucket(ts: number): string {
  const h = new Date(ts).getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

export function inferPreferredWindows(tasks: Task[]): Task[] {
  const completed = tasks.filter((t) => t.completed);
  const buckets: Record<string, number> = {};

  for (const task of completed) {
    const bucket = hourBucket(task.updatedAt);
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
  }

  const best = Object.entries(buckets).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return tasks.map((t) =>
    t.completed ? t : { ...t, preferredExecutionWindow: t.preferredExecutionWindow ?? best },
  );
}

export function isInPreferredWindow(task: Task, now = Date.now()): boolean {
  if (!task.preferredExecutionWindow) return true;
  return hourBucket(now) === task.preferredExecutionWindow;
}
