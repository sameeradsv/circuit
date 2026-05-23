import type { Task } from '../types';

export interface SlotSuggestion {
  scheduledAt: number;
  rationale: string[];
}

type HourBucket = 'morning' | 'afternoon' | 'evening';

const WINDOW_START_HOUR: Record<HourBucket, number> = {
  morning: 9,
  afternoon: 13,
  evening: 18,
};

const BUCKET_END_HOUR: Record<HourBucket, number> = {
  morning: 12,
  afternoon: 17,
  evening: 24,
};

function hourBucket(ts: number): HourBucket {
  const h = new Date(ts).getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function nextWindowStart(window: HourBucket, now: number): number {
  const d = new Date(now);
  d.setHours(WINDOW_START_HOUR[window], 0, 0, 0);
  const today = d.getTime();
  return today > now ? today : today + 24 * 60 * 60 * 1000;
}

function avoidanceWindowEnd(bucket: HourBucket, near: number): number {
  const d = new Date(near);
  d.setHours(BUCKET_END_HOUR[bucket], 0, 0, 0);
  return d.getTime();
}

function findConflict(proposed: number, durationMs: number, others: Task[]): Task | null {
  const proposedEnd = proposed + durationMs;
  for (const other of others) {
    if (!other.scheduledAt) continue;
    const otherEnd = other.scheduledAt + other.duration * 60 * 1000;
    if (proposed < otherEnd && proposedEnd > other.scheduledAt) return other;
  }
  return null;
}

export function suggestSlot(
  task: Task,
  allTasks: Task[],
  now = Date.now(),
): SlotSuggestion {
  const rationale: string[] = [];
  const durationMs = task.duration * 60 * 1000;
  const others = allTasks.filter((t) => t.id !== task.id && !t.completed && t.scheduledAt != null);

  // Start from preferred execution window or fall back to 2h from now
  let candidate: number;
  const win = task.preferredExecutionWindow as HourBucket | null;
  if (win && win in WINDOW_START_HOUR) {
    candidate = nextWindowStart(win, now);
    rationale.push(`you usually do this in the ${win}`);
  } else {
    candidate = now + 2 * 60 * 60 * 1000;
  }

  // Push past the learned avoidance window if we'd land inside it
  const pattern = task.delayPattern;
  if (pattern?.startsWith('peak-skip:')) {
    const peakBucket = pattern.slice('peak-skip:'.length) as HourBucket;
    if (hourBucket(candidate) === peakBucket) {
      const end = avoidanceWindowEnd(peakBucket, candidate);
      if (end > candidate) {
        candidate = end;
        rationale.push(`skipped often in the ${peakBucket} — moving past it`);
      }
    }
  }

  // Nudge past conflicting scheduled tasks (up to 5 iterations)
  for (let i = 0; i < 5; i++) {
    const conflict = findConflict(candidate, durationMs, others);
    if (!conflict) break;
    candidate = conflict.scheduledAt! + conflict.duration * 60 * 1000 + 5 * 60 * 1000;
    if (i === 0) rationale.push('moved past a conflict');
  }

  // Never suggest a time in the past
  if (candidate <= now) {
    candidate = now + 60 * 60 * 1000;
    if (rationale.length === 0) rationale.push('earliest available slot');
  }

  if (rationale.length === 0) rationale.push('next available slot');

  return { scheduledAt: candidate, rationale };
}
