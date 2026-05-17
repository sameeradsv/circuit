import type { EnergyMode, ScheduleContext, Task } from '../types';
import { analyzeBehavior } from '../behavioral-engine';
import { buildSchedule } from '../scheduling-engine';
export interface Recommendation {
  headline: string;
  detail: string;
  taskId?: string;
}

export function getRecommendations(tasks: Task[], mode: EnergyMode): Recommendation[] {
  const ctx: ScheduleContext = {
    mode,
    now: Date.now(),
    availableMinutes: 240,
    completedToday: tasks.filter(
      (t) => t.completed && t.updatedAt > startOfDay(Date.now()),
    ).length,
  };

  const plan = buildSchedule(tasks, ctx);
  const behavioral = analyzeBehavior(tasks, mode);
  const recs: Recommendation[] = [];

  if (plan.ordered[0]) {
    recs.push({
      headline: plan.explanation,
      detail: plan.ordered
        .slice(0, 3)
        .map((s) => s.task.text)
        .join(' → '),
      taskId: plan.ordered[0].task.id,
    });
  }

  for (const insight of behavioral) {
    recs.push({ headline: insight.message, detail: insight.type, taskId: insight.taskId });
  }

  return recs.slice(0, 4);
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
