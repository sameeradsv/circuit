import { ApiTask } from "@/lib/api";

export interface TaskLayoutSlot {
  column: number;
  totalColumns: number;
}

const HOUR_HEIGHT_PX = 64;
const MIN_RENDERED_HEIGHT_PX = 24;
const MIN_RENDERED_MINUTES = (MIN_RENDERED_HEIGHT_PX / HOUR_HEIGHT_PX) * 60;

function renderedStartMs(task: ApiTask): number {
  return task.scheduled_at! - (task.travel_buffer_before_mins ?? 0) * 60_000;
}

function renderedEndMs(task: ApiTask): number {
  const visibleDuration = Math.max(task.duration ?? 30, MIN_RENDERED_MINUTES);
  return task.scheduled_at! + (visibleDuration + (task.travel_buffer_after_mins ?? 0)) * 60_000;
}

function eventsOverlap(a: ApiTask, b: ApiTask): boolean {
  const aStart = renderedStartMs(a);
  const aEnd = renderedEndMs(a);
  const bStart = renderedStartMs(b);
  const bEnd = renderedEndMs(b);
  return aStart < bEnd && bStart < aEnd;
}

function columnFits(task: ApiTask, col: ApiTask[]): boolean {
  return !col.some((t) => eventsOverlap(task, t));
}

/** Group tasks that transitively overlap in time. */
function buildClusters(tasks: ApiTask[]): ApiTask[][] {
  const sorted = [...tasks].sort(
    (a, b) => renderedStartMs(a) - renderedStartMs(b) || renderedEndMs(b) - renderedEndMs(a),
  );
  const clusters: ApiTask[][] = [];
  const used = new Set<ApiTask["id"]>();

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
export function layoutOverlappingTasks(tasks: ApiTask[]): Map<ApiTask["id"], TaskLayoutSlot> {
  const result = new Map<ApiTask["id"], TaskLayoutSlot>();
  for (const cluster of buildClusters(tasks)) {
    const sorted = [...cluster].sort(
      (a, b) => renderedStartMs(a) - renderedStartMs(b) || renderedEndMs(b) - renderedEndMs(a),
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
