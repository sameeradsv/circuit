import type { BehavioralInsight, EnergyMode, Task } from '../types';
import { completionRateByTag, recordCompletion } from './completion-patterns';
import { inferPreferredWindows } from './execution-windows';
import { detectProcrastination } from './procrastination';
import { adaptiveRecommendations } from './recommendations';

export * from './completion-patterns';
export * from './execution-windows';
export * from './procrastination';
export * from './recommendations';

export function analyzeBehavior(tasks: Task[], mode: EnergyMode): BehavioralInsight[] {
  const withWindows = inferPreferredWindows(tasks);
  return [
    ...detectProcrastination(withWindows),
    ...adaptiveRecommendations(withWindows, mode),
  ];
}

export { recordCompletion, completionRateByTag };
