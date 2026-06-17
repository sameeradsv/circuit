import { ApiTask } from "@/lib/api";

export interface TaskLayoutSlot {
  column: number;
  totalColumns: number;
}

function taskEndMs(task: ApiTask): number {
  return task.scheduled_at! + (task.duration ?? 30) * 60_000;
}

function eventsOverlap(a: ApiTask, b: ApiTask): boolean {
  const aStart = a.scheduled_at!;
  const aEnd = taskEndMs(a);
  const bStart = b.scheduled_at!;
  const bEnd = taskEndMs(b);
  return aStart < bEnd && bStart < aEnd;
}

function columnFits(task: ApiTask, col: ApiTask[]): boolean {
  return !col.some((t) => eventsOverlap(task, t));
}

/** Group tasks that transitively overlap in time. */
function buildClusters(tasks: ApiTask[]): ApiTask[][] {
  const sorted = [...tasks].sort(
    (a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0) || taskEndMs(b) - taskEndMs(a),
  );
  const clusters: ApiTask[][] = [];
  const used = new Set<number>();

  for (const task of sorted) {
    if (used.has(task.id)) continue;
    const cluster: ApiTask[] = [task];
    used.add(task.id);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const t of sorted) {
        if (used.has(t.id)) continue;
        if (cluster.some((c) => eventsOverlap(c, t))) {
          cluster.push(t);
          used.add(t.id);
          expanded = true;
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

/** Side-by-side column layout for overlapping scheduled tasks (day/week views). */
export function layoutOverlappingTasks(tasks: ApiTask[]): Map<number, TaskLayoutSlot> {
  const result = new Map<number, TaskLayoutSlot>();
  for (const cluster of buildClusters(tasks)) {
    const sorted = [...cluster].sort(
      (a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0) || taskEndMs(b) - taskEndMs(a),
    );
    const columns: ApiTask[][] = [];
    for (const task of sorted) {
      let col = 0;
      while (col < columns.length && !columnFits(task, columns[col])) col++;
      if (col === columns.length) columns.push([]);
      columns[col].push(task);
    }
    const totalColumns = Math.max(1, columns.length);
    for (let c = 0; c < columns.length; c++) {
      for (const task of columns[c]) {
        result.set(task.id, { column: c, totalColumns });
      }
    }
  }
  return result;
}
