import type { EnergyMode, RescheduleResult, Task } from '../types';
import { adaptiveReschedule } from './adaptive';
import { reduceOverload } from './overload';
import { preserveMomentum } from './momentum';
import { skipTask } from './skip';
import { splitTask } from './splitting';
import { applyRecurrence } from './recurrence';

export * from './skip';
export * from './adaptive';
export * from './overload';
export * from './splitting';
export * from './momentum';
export * from './recurrence';
export * from './delay-pattern';
export * from './suggest-slot';

export function rescheduleAll(tasks: Task[], mode: EnergyMode, now = Date.now()): RescheduleResult {
  const changes: string[] = [];
  let next = preserveMomentum(tasks);
  next = adaptiveReschedule(next, mode, now);
  const { tasks: balanced, deferred } = reduceOverload(next, now);
  if (deferred.length) changes.push(`Deferred ${deferred.length} task(s) to reduce overload`);
  return { tasks: balanced, changes };
}

export function handleSkip(tasks: Task[], taskId: string, now = Date.now()): RescheduleResult {
  const changes: string[] = [];
  const next = tasks.map((t) => {
    if (t.id !== taskId) return t;
    const skipped = skipTask(t, tasks, now);
    changes.push(`Skipped "${t.text}" — rescheduled to suggested slot`);
    return skipped;
  });
  return { tasks: next, changes };
}

export function handleSplit(tasks: Task[], taskId: string, now = Date.now()): RescheduleResult {
  const changes: string[] = [];
  const idx = tasks.findIndex((t) => t.id === taskId);
  if (idx === -1) return { tasks, changes };

  const { parent, child } = splitTask(tasks[idx]!, now);
  const next = [...tasks];
  next[idx] = parent;
  if (child) {
    next.push(child);
    changes.push(`Split "${parent.text}" into two parts`);
  }
  return { tasks: next, changes };
}

// Mark a task complete. If it has a recurrence rule, the task is reset and
// rescheduled at the next occurrence rather than left in a completed state.
export function handleComplete(tasks: Task[], taskId: string, now = Date.now()): RescheduleResult {
  const changes: string[] = [];
  const next = tasks.map((t) => {
    if (t.id !== taskId) return t;
    const completed: Task = { ...t, completed: true, updatedAt: now };
    if (t.recurrence) {
      const recurred = applyRecurrence(completed, now);
      changes.push(`"${t.text}" completed — next occurrence scheduled`);
      return recurred;
    }
    return completed;
  });
  return { tasks: next, changes };
}
