import type { Task } from '../types';
import { getSession } from './auth';

export const BUNDLE_VERSION = 1;

export interface CircuitSyncBundle {
  version: number;
  username: string;
  exportedAt: number;
  tasks: Task[];
}

export function buildSyncBundle(tasks: Task[]): CircuitSyncBundle {
  const session = getSession();
  return {
    version: BUNDLE_VERSION,
    username: session?.isLocal ? 'local' : (session?.username ?? 'unknown'),
    exportedAt: Date.now(),
    tasks,
  };
}

export function parseSyncBundle(raw: string): CircuitSyncBundle {
  const parsed = JSON.parse(raw) as CircuitSyncBundle;
  if (!parsed || parsed.version !== BUNDLE_VERSION || !Array.isArray(parsed.tasks)) {
    throw new Error('Invalid Circuit backup file.');
  }
  return parsed;
}

export function downloadSyncBundle(tasks: Task[]): void {
  const bundle = buildSyncBundle(tasks);
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `circuit-backup-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
