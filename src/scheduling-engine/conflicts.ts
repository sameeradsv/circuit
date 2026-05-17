import type { ScoredTask } from '../types';

/** Prefer higher-scored tasks when time windows overlap. */
export function resolveConflicts(scored: ScoredTask[]): ScoredTask[] {
  const byWindow = new Map<string, ScoredTask>();

  for (const item of scored) {
    const window = item.task.preferredExecutionWindow ?? 'any';
    const existing = byWindow.get(window);
    if (!existing || item.score > existing.score) {
      byWindow.set(window, item);
    }
  }

  const winners = new Set([...byWindow.values()].map((s) => s.task.id));
  const resolved: ScoredTask[] = [];
  const seen = new Set<string>();

  for (const item of scored) {
    if (seen.has(item.task.id)) continue;
    const window = item.task.preferredExecutionWindow ?? 'any';
    const winner = byWindow.get(window);
    if (winner && winner.task.id !== item.task.id && item.task.scheduledAt && winner.task.scheduledAt) {
      const overlap =
        Math.abs(item.task.scheduledAt - winner.task.scheduledAt) < 30 * 60 * 1000;
      if (overlap && item.score < winner.score) continue;
    }
    resolved.push(item);
    seen.add(item.task.id);
  }

  return resolved.length > 0 ? resolved : scored;
}
