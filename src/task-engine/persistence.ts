import type { Task } from '../types';
import { normalizeTask } from './schema';
import { validateTasks } from './validation';

const STORAGE_KEY = 'circuit_tasks_v1';
const LEGACY_KEY = 'my_tasks_v2';

export function loadTasks(): Task[] {
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    const tasks = parsed.map((item) => normalizeTask(item as Parameters<typeof normalizeTask>[0]));
    const { valid } = validateTasks(tasks);
    if (!valid) return tasks.filter((t) => t.text.trim().length > 0);
    if (!localStorage.getItem(STORAGE_KEY) && localStorage.getItem(LEGACY_KEY)) {
      saveTasks(tasks);
    }
    return tasks;
  } catch {
    return [];
  }
}

export function saveTasks(tasks: Task[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

export function clearTasks(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_KEY);
}
