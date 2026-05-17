import type { EnergyMode, Task } from '../types';
import { buildSchedule } from '../scheduling-engine';

export interface DayForecast {
  likelyCompleted: number;
  focusTask: string | null;
  riskOfOverload: boolean;
}

export function forecastDay(tasks: Task[], mode: EnergyMode): DayForecast {
  const ctx = {
    mode,
    now: Date.now(),
    availableMinutes: 240,
    completedToday: 0,
  };
  const plan = buildSchedule(tasks, ctx);
  const pendingMinutes = tasks
    .filter((t) => !t.completed)
    .reduce((s, t) => s + t.duration, 0);

  const fitCount = plan.ordered.filter((s) => s.score > 20).length;

  return {
    likelyCompleted: Math.min(fitCount, Math.ceil(240 / 30)),
    focusTask: plan.ordered[0]?.task.text ?? null,
    riskOfOverload: pendingMinutes > 360,
  };
}
