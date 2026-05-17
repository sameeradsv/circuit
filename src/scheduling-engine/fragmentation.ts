import type { ScoredTask } from '../types';

/** Group similar focus types to reduce context switching. */
export function reduceFragmentation(scored: ScoredTask[]): ScoredTask[] {
  if (scored.length <= 1) return scored;

  const groups = new Map<string, ScoredTask[]>();
  for (const item of scored) {
    const key = item.task.focusType;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  const result: ScoredTask[] = [];
  const sortedGroups = [...groups.entries()].sort(
    (a, b) => (b[1][0]?.score ?? 0) - (a[1][0]?.score ?? 0),
  );

  for (const [, items] of sortedGroups) {
    items.sort((a, b) => b.score - a.score);
    result.push(...items);
  }

  return result;
}
