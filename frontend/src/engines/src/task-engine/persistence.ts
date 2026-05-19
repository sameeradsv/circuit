import type { Task } from '../types';
import { normalizeTask } from './schema';
import { validateTasks } from './validation';

const STORAGE_KEY = 'circuit_tasks_v1';
const LEGACY_KEY = 'my_tasks_v2';

let storageSuffix = '';

/** Namespace task storage per signed-in user (empty = local / legacy). */
export function setTaskStorageNamespace(namespace: string): void {
  storageSuffix = namespace;
}

function activeKey(): string {
  return STORAGE_KEY + storageSuffix;
}

export function loadTasks(): Task[] {
  const key = activeKey();
  const raw =
    localStorage.getItem(key) ??
    (storageSuffix === '' ? localStorage.getItem(LEGACY_KEY) : null);
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
  localStorage.setItem(activeKey(), JSON.stringify(tasks));
}

export function clearTasks(): void {
  localStorage.removeItem(activeKey());
  if (storageSuffix === '') {
    localStorage.removeItem(LEGACY_KEY);
  }
}
