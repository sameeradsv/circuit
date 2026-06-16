import { ApiTask } from "./api";

const TASK_CACHE_MS = 30_000;

let _cache: { tasks: ApiTask[]; ts: number } | null = null;

export function getTaskCache(): ApiTask[] | null {
  if (_cache && Date.now() - _cache.ts < TASK_CACHE_MS) return _cache.tasks;
  _cache = null;
  return null;
}

export function setTaskCache(tasks: ApiTask[]): void {
  _cache = { tasks, ts: Date.now() };
}

export function updateTaskInCache(updated: ApiTask): void {
  if (_cache) {
    _cache = {
      tasks: _cache.tasks.map((t) => (t.id === updated.id ? updated : t)),
      ts: _cache.ts,
    };
  }
}

export function invalidateTaskCache(): void {
  _cache = null;
}
