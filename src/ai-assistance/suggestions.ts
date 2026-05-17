import type { EnergyMode, Task } from '../types';
import { getRecommendations } from '../recommendation-engine';
import { callAI } from './call-ai';

export function getAdaptiveSuggestions(tasks: Task[], mode: EnergyMode): string[] {
  return getRecommendations(tasks, mode).map((r) => r.headline);
}

export async function getAISuggestions(tasks: Task[], mode: EnergyMode): Promise<string[]> {
  const pending = tasks
    .filter((t) => !t.completed)
    .slice(0, 20)
    .map((t) => t.text)
    .join(', ');
  const done = tasks
    .filter((t) => t.completed)
    .slice(-10)
    .map((t) => t.text)
    .join(', ');

  const prompt = `You are a calm productivity assistant. Suggest 2-3 short tasks the user might have overlooked or should do next.
Return a JSON array of strings only, no markdown, no explanation.

Energy mode: ${mode}
Pending tasks: ${pending || 'none'}
Recently completed: ${done || 'none'}

Return exactly: ["suggestion 1", "suggestion 2"]`;

  const raw = await callAI(prompt, true);
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((s): s is string => typeof s === 'string').slice(0, 3);
}
