import type { ApiTask } from "./api";
import type { EnergyMode, Task } from "../engines/src/types/task";
import { apiTaskToTask } from "./engine-adapter";
import { scoreTask } from "../engines/src/scheduling-engine/scoring";

/** Approximate upper bound for engine scores — used for fit % display. */
export const SCORE_REFERENCE_MAX = 120;

export interface RankedApiTask extends ApiTask {
  score: number;
  reason: string;
  reasons: string[];
  segs: { k: string; v: number; max: number }[];
}

function modeEnergyFit(task: Task, mode: EnergyMode): number {
  switch (mode) {
    case "low":
      return task.effort === "low" ? 1 : task.effort === "medium" ? 0.4 : 0.1;
    case "deep":
      return task.focusType === "deep" || task.tag === "work" ? 1 : 0.3;
    case "social":
      return task.tag !== "social" ? 0.8 : 0.2;
    default:
      return 0.7;
  }
}

function buildSegments(
  task: Task,
  ctx: { mode: EnergyMode; now: number; availableMinutes: number },
): { k: string; v: number; max: number }[] {
  const priority =
    (task.importance * 0.4 + task.urgency * 0.35 + task.consequenceOfDelay * 0.25) * 40 +
    (task.scheduledAt && task.scheduledAt <= ctx.now ? 25 : 0);
  const energy = modeEnergyFit(task, ctx.mode) * 20 + task.energyToRewardRatio * 12;
  const time =
    (task.duration <= ctx.availableMinutes ? 5 : 0) +
    (task.duration <= ctx.availableMinutes ? 10 : 0);
  const momentum =
    task.momentumValue * 15 +
    (task.tinyStep ? 10 : 0) -
    Math.min(
      20,
      task.cognitiveLoad * 6 * (ctx.mode === "low" ? 2 : 1) +
        task.emotionalResistance * 4 +
        task.skippedCount * 2,
    );

  return [
    { k: "urgency", v: Math.max(0, Math.min(65, priority)), max: 65 },
    { k: "energy", v: Math.max(0, Math.min(32, energy)), max: 32 },
    { k: "time", v: Math.max(0, Math.min(15, time)), max: 15 },
    { k: "momentum", v: Math.max(0, Math.min(25, momentum)), max: 25 },
  ];
}

export function rankApiTasks(
  tasks: ApiTask[],
  opts: { mode: EnergyMode; availableMinutes: number; completedToday?: number },
): RankedApiTask[] {
  const now = Date.now();
  const ctx = {
    mode: opts.mode,
    now,
    availableMinutes: opts.availableMinutes,
    completedToday: opts.completedToday ?? 0,
  };

  return tasks
    .filter((t) => !t.completed)
    .map((t) => {
      const engineTask = apiTaskToTask(t);
      const scored = scoreTask(engineTask, ctx);
      const segs = buildSegments(engineTask, ctx);
      const reason =
        scored.reasons[0] ??
        (scored.score > 50 ? "good fit for now" : "on your list");
      return { ...t, score: scored.score, reason, reasons: scored.reasons, segs };
    })
    .sort((a, b) => b.score - a.score);
}

export function fitPercent(task: { score: number }): number {
  return Math.max(
    0,
    Math.min(100, Math.round((task.score / SCORE_REFERENCE_MAX) * 100)),
  );
}
