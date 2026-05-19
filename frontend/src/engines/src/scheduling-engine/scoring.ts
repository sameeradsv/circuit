import type { EnergyMode, ScheduleContext, ScoredTask, Task } from '../types';

export function scoreTask(task: Task, ctx: ScheduleContext): ScoredTask {
  if (task.completed) {
    return { task, score: -1, reasons: ['completed'] };
  }

  const reasons: string[] = [];
  let score = 0;

  const importanceUrgency = task.importance * 0.4 + task.urgency * 0.35 + task.consequenceOfDelay * 0.25;
  score += importanceUrgency * 40;
  if (importanceUrgency > 0.5) reasons.push('high priority');

  if (task.scheduledAt && task.scheduledAt <= ctx.now) {
    score += 25;
    reasons.push('scheduled for now');
  }

  const energyFit = modeEnergyFit(task, ctx.mode);
  score += energyFit * 20;
  if (energyFit > 0.7) reasons.push(`fits ${ctx.mode} mode`);

  if (task.tinyStep) {
    score += 10;
    reasons.push('has tiny step');
  }

  score += task.momentumValue * 15;
  if (task.momentumValue > 0.5) reasons.push('builds momentum');

  score -= task.cognitiveLoad * 10 * (ctx.mode === 'low' ? 2 : 1);
  score -= task.emotionalResistance * 8;
  score -= task.skippedCount * 3;

  score += task.energyToRewardRatio * 12;

  if (task.duration <= ctx.availableMinutes) {
    score += 5;
  } else {
    score -= 15;
    reasons.push('may exceed available time');
  }

  return { task, score, reasons };
}

function modeEnergyFit(task: Task, mode: EnergyMode): number {
  switch (mode) {
    case 'low':
      return task.effort === 'low' ? 1 : task.effort === 'medium' ? 0.4 : 0.1;
    case 'deep':
      return task.focusType === 'deep' || task.tag === 'work' ? 1 : 0.3;
    case 'social':
      return task.tag !== 'social' ? 0.8 : 0.2;
    default:
      return 0.7;
  }
}

export function scoreTasks(tasks: Task[], ctx: ScheduleContext): ScoredTask[] {
  return tasks
    .filter((t) => !t.completed)
    .map((t) => scoreTask(t, ctx))
    .sort((a, b) => b.score - a.score);
}
