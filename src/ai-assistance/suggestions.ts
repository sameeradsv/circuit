import type { EnergyMode, Task } from '../types';
import { getRecommendations } from '../recommendation-engine';

export function getAdaptiveSuggestions(tasks: Task[], mode: EnergyMode): string[] {
  return getRecommendations(tasks, mode).map((r) => r.headline);
}
