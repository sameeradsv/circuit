import type { Task } from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function clamp01(n: number, field: string, errors: string[]): number {
  if (typeof n !== 'number' || Number.isNaN(n) || n < 0 || n > 1) {
    errors.push(`${field} must be a number between 0 and 1`);
    return Math.min(1, Math.max(0, n || 0));
  }
  return n;
}

export function validateTask(task: Task): ValidationResult {
  const errors: string[] = [];

  if (!task.id || typeof task.id !== 'string') errors.push('id is required');
  if (!task.text || task.text.trim().length < 1) errors.push('text is required');
  if (task.text.length > 500) errors.push('text must be at most 500 characters');

  const tags = ['general', 'work', 'social', 'later'];
  if (!tags.includes(task.tag)) errors.push('invalid tag');

  const efforts = ['low', 'medium', 'high'];
  if (!efforts.includes(task.effort)) errors.push('invalid effort');

  if (task.duration < 1 || task.duration > 480) errors.push('duration must be 1–480 minutes');

  clamp01(task.cognitiveLoad, 'cognitiveLoad', errors);
  clamp01(task.importance, 'importance', errors);
  clamp01(task.urgency, 'urgency', errors);

  return { valid: errors.length === 0, errors };
}

export function validateTasks(tasks: Task[]): ValidationResult {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const task of tasks) {
    const result = validateTask(task);
    errors.push(...result.errors);
    if (ids.has(task.id)) errors.push(`duplicate id: ${task.id}`);
    ids.add(task.id);
  }

  return { valid: errors.length === 0, errors };
}
