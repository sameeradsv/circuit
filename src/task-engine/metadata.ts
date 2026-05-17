import type { Task } from '../types';

export function getMetadata<T>(task: Task, key: string): T | undefined {
  return task.metadata[key] as T | undefined;
}

export function setMetadata(task: Task, key: string, value: unknown): Task {
  return {
    ...task,
    metadata: { ...task.metadata, [key]: value },
    updatedAt: Date.now(),
  };
}

export function removeMetadata(task: Task, key: string): Task {
  const { [key]: _, ...rest } = task.metadata;
  return { ...task, metadata: rest, updatedAt: Date.now() };
}

export function listMetadataKeys(task: Task): string[] {
  return Object.keys(task.metadata);
}
