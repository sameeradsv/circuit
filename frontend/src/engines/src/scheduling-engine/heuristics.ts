import type { ScheduleContext, SchedulePlan, ScoredTask, Task } from '../types';
import { scoreTasks } from './scoring';
import { resolveConflicts } from './conflicts';
import { balanceWorkload } from './workload';
import { reduceFragmentation } from './fragmentation';

export function buildSchedule(tasks: Task[], ctx: ScheduleContext): SchedulePlan {
  const scored = scoreTasks(tasks, ctx);
  const resolved = resolveConflicts(scored);
  const balanced = balanceWorkload(resolved, ctx.availableMinutes);
  const ordered = reduceFragmentation(balanced);

  const workloadMinutes = ordered.reduce((sum, s) => sum + s.task.duration, 0);
  const top = ordered[0];
  const explanation = top
    ? `Start with "${top.task.text}" — ${top.reasons.join(', ') || 'best fit for now'}`
    : 'No pending tasks to schedule';

  return { ordered, explanation, workloadMinutes };
}

export function suggestNextTask(tasks: Task[], ctx: ScheduleContext): ScoredTask | null {
  const plan = buildSchedule(tasks, ctx);
  return plan.ordered[0] ?? null;
}
