import type { ScoredTask } from '../types';

/** Drop lowest-priority items when total duration exceeds capacity. */
export function balanceWorkload(scored: ScoredTask[], availableMinutes: number): ScoredTask[] {
  let total = 0;
  const kept: ScoredTask[] = [];

  for (const item of scored) {
    if (total + item.task.duration <= availableMinutes) {
      kept.push(item);
      total += item.task.duration;
    } else if (kept.length === 0 && item.task.duration <= availableMinutes * 1.25) {
      kept.push(item);
      total += item.task.duration;
    }
  }

  return kept.length > 0 ? kept : scored.slice(0, 3);
}
