import type { EnergyMode, RescheduleResult, Task } from '../types';
import { adaptiveReschedule } from './adaptive';
import { reduceOverload } from './overload';
import { preserveMomentum } from './momentum';
import { skipTask } from './skip';
import { splitTask } from './splitting';

export * from './skip';
export * from './adaptive';
export * from './overload';
export * from './splitting';
export * from './momentum';

export function rescheduleAll(tasks: Task[], mode: EnergyMode): RescheduleResult {
  const changes: string[] = [];
  let next = preserveMomentum(tasks);
  next = adaptiveReschedule(next, mode);
  const { tasks: balanced, deferred } = reduceOverload(next);
  if (deferred.length) changes.push(`Deferred ${deferred.length} task(s) to reduce overload`);
  return { tasks: balanced, changes };
}

export function handleSkip(tasks: Task[], taskId: string): RescheduleResult {
  const changes: string[] = [];
  const next = tasks.map((t) => {
    if (t.id !== taskId) return t;
    const skipped = skipTask(t);
    changes.push(`Skipped "${t.text}" — rescheduled +1h`);
    return skipped;
  });
  return { tasks: next, changes };
}

export function handleSplit(tasks: Task[], taskId: string): RescheduleResult {
  const changes: string[] = [];
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return { tasks, changes };

  const { parent, child } = splitTask(tasks[idx]!);
  const next = [...tasks];
  next[idx] = parent;
  if (child) {
    next.push(child);
    changes.push(`Split "${parent.text}" into two parts`);
  }
  return { tasks: next, changes };
}
