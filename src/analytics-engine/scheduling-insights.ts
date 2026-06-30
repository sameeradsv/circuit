import type { Task } from "../types";

export interface SchedulingInsight {
  type: string;
  message: string;
}

/** Port of backend `scheduling_insights.py` — pure Task[] input, no DB. */
export function computeSchedulingInsights(tasks: Task[], nowMs = Date.now()): SchedulingInsight[] {
  const open = tasks.filter((t) => !t.completed);
  if (open.length === 0) return [];

  const insights: SchedulingInsight[] = [];
  const pendingMins = open.reduce((s, t) => s + (t.duration ?? 0), 0);

  if (pendingMins > 480) {
    insights.push({
      type: "prediction",
      message: `Backlog is ~${Math.floor(pendingMins / 60)}h of scheduled work — defer or shorten low-priority tasks to avoid overload.`,
    });
  }

  const overdue = open.filter((t) => t.scheduledAt && t.scheduledAt < nowMs);
  if (overdue.length >= 3) {
    insights.push({
      type: "prediction",
      message: `${overdue.length} tasks are past their scheduled slot — batch-reschedule or complete the smallest first.`,
    });
  }

  const heavy = open.filter((t) => (t.cognitiveLoad ?? 0) >= 0.7);
  if (heavy.length >= 2 && pendingMins > 240) {
    insights.push({
      type: "prediction",
      message: `${heavy.length} high cognitive-load tasks open — pair with a low-energy block before deep work.`,
    });
  }

  const weekAgo = nowMs - 7 * 86_400_000;
  const recentDone = tasks.filter((t) => t.completed && t.updatedAt >= weekAgo).length;
  if (recentDone < 3 && open.length > 8) {
    insights.push({
      type: "prediction",
      message: "Completion pace is slow this week — protect one 25-minute focus block today.",
    });
  } else if (recentDone >= 10 && pendingMins < 180) {
    insights.push({
      type: "prediction",
      message: "Strong completion week — good window to schedule one ambitious task.",
    });
  }

  return insights.slice(0, 5);
}
