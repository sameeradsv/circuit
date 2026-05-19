import type { BehavioralInsight, EnergyMode, Task } from '../types';
import { isInPreferredWindow } from './execution-windows';

export function adaptiveRecommendations(
  tasks: Task[],
  mode: EnergyMode,
): BehavioralInsight[] {
  const insights: BehavioralInsight[] = [];
  const pending = tasks.filter((t) => !t.completed);

  for (const task of pending) {
    if (!isInPreferredWindow(task) && task.preferredExecutionWindow) {
      insights.push({
        type: 'window',
        message: `"${task.text}" is usually done in the ${task.preferredExecutionWindow}`,
        taskId: task.id,
      });
    }
  }

  if (mode === 'low') {
    const easy = pending.find((t) => t.effort === 'low' || t.tinyStep);
    if (easy) {
      insights.push({
        type: 'recommendation',
        message: `Low energy: start with "${easy.text}"`,
        taskId: easy.id,
      });
    }
  }

  if (mode === 'deep') {
    const deep = pending.find((t) => t.focusType === 'deep');
    if (deep) {
      insights.push({
        type: 'recommendation',
        message: `Deep work block: focus on "${deep.text}"`,
        taskId: deep.id,
      });
    }
  }

  return insights.slice(0, 3);
}
