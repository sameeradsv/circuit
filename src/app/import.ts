import { createTask, inferEffortFromText, inferTagFromText } from '../task-engine';
import type { Task } from '../types';

export function parseAndClassifyTasks(text: string): Array<{ text: string; tag: Task['tag']; effort: Task['effort'] }> {
  const lines = text.split(/\r?\n/);
  const results: Array<{ text: string; tag: Task['tag']; effort: Task['effort'] }> = [];

  for (let line of lines) {
    line = line.trim();
    if (!line || line.length < 3) continue;

    line = line.replace(/^[-*•◦▪▫]\s*/, '');
    line = line.replace(/^\d+[.)\s]+/, '');
    line = line.replace(/^\[[ x]\]\s*/i, '');
    if (line.length < 3) continue;

    results.push({
      text: line,
      tag: inferTagFromText(line),
      effort: inferEffortFromText(line),
    });
  }

  return results;
}

export function tasksFromImport(text: string): Task[] {
  return parseAndClassifyTasks(text).map((row) =>
    createTask(row.text, { tag: row.tag, effort: row.effort }),
  );
}
