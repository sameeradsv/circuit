import type { ApiTask } from './api';

export interface SlotSuggestion {
  scheduledAt: number;
  rationale: string[];
}

export interface EnergyContext {
  composite: number;  // 0-1 combined energy
  stress: number;     // 0-1 (higher = more stressed)
}

// IST is UTC+5:30
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function nextISTSlot(istHour: number, after: number): number {
  // Returns the next UTC ms timestamp where the IST clock reads istHour:00
  const utcMs = istHour * 3_600_000 - IST_OFFSET_MS; // offset from UTC midnight
  const todayUTCMidnight = after - (after % 86_400_000);
  const todayTarget = todayUTCMidnight + utcMs;
  return todayTarget > after ? todayTarget : todayTarget + 86_400_000;
}

function istHourOf(ms: number): number {
  return Math.floor(((ms + IST_OFFSET_MS) % 86_400_000) / 3_600_000);
}

// 0 = Sun, 1 = Mon … 6 = Sat in IST
function istDayOf(ms: number): number {
  return new Date(ms + IST_OFFSET_MS).getUTCDay();
}

function isISTWeekday(ms: number): boolean {
  const d = istDayOf(ms);
  return d >= 1 && d <= 5;
}

const WORKDAY_END_IST = 19; // 7 pm — after this, wrap to next day
const SOON_MS = 3 * 86_400_000;

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

function findConflict(proposed: number, durationMs: number, others: ApiTask[]): ApiTask | null {
  const proposedEnd = proposed + durationMs;
  for (const other of others) {
    if (!other.scheduled_at) continue;
    const otherEnd = other.scheduled_at + (other.duration ?? 30) * 60 * 1000;
    if (proposed < otherEnd && proposedEnd > other.scheduled_at) return other;
  }
  return null;
}

function clamp01(n: number | null | undefined, fallback = 0): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function deadlineWeight(task: ApiTask, now: number): number {
  const scheduled = task.scheduled_at;
  const type = task.deadline_type ?? 'none';
  const typeWeight =
    type === 'hard' ? 0.18 :
    type === 'soft' ? 0.10 :
    type === 'today' ? 0.12 :
    0;
  if (!scheduled) return typeWeight;
  if (scheduled < now) return typeWeight + 0.14;
  if (scheduled - now <= SOON_MS) return typeWeight + 0.08;
  return typeWeight;
}

export function taskConflictWeight(task: ApiTask, now = Date.now()): number {
  const effortWeight =
    task.effort === 'high' ? 0.08 :
    task.effort === 'medium' ? 0.04 :
    0.01;

  return (
    clamp01(task.importance, 0.5) * 0.28 +
    clamp01(task.urgency, 0.5) * 0.24 +
    clamp01(task.consequence_of_delay, 0.3) * 0.18 +
    clamp01(task.time_sensitivity, 0.5) * 0.10 +
    clamp01(task.momentum_value, 0.5) * 0.06 +
    effortWeight +
    deadlineWeight(task, now)
  );
}

export function findScheduledConflict(
  task: ApiTask,
  scheduledAt: number,
  allTasks: ApiTask[],
): ApiTask | null {
  return findConflict(
    scheduledAt,
    (task.duration ?? 30) * 60_000,
    allTasks.filter((t) => t.id !== task.id && !t.completed && t.scheduled_at != null),
  );
}

export function suggestSlot(
  task: ApiTask,
  allTasks: ApiTask[],
  now = Date.now(),
  energy?: EnergyContext,
): SlotSuggestion {
  const rationale: string[] = [];
  const durationMs = (task.duration ?? 30) * 60_000;
  const others = allTasks.filter((t) => t.id !== task.id && !t.completed && t.scheduled_at != null);
  const focusType = task.focus_type ?? 'shallow';
  const composite = energy?.composite ?? 0.6;
  const stress = energy?.stress ?? 0.3;
  const energyPct = Math.round(composite * 100);

  let candidate: number;
  const win = task.preferred_execution_window as HourBucket | null;

  if (win && win in WINDOW_START_HOUR) {
    // Explicit preferred window always wins
    candidate = nextWindowStart(win, now);
    rationale.push(`preferred ${win} window`);
  } else if (focusType === 'deep' || focusType === 'creative') {
    if (composite < 0.35) {
      // Too drained — defer to tomorrow morning
      candidate = nextISTSlot(9, now + 86_400_000);
      rationale.push(`energy too low (${energyPct}%) — deep work deferred to tomorrow morning`);
    } else {
      candidate = nextISTSlot(9, now);
      const label = composite >= 0.7 ? `energy good (${energyPct}%)` : `energy ok (${energyPct}%)`;
      rationale.push(`deep work → morning slot · ${label}`);
    }
  } else if (focusType === 'admin') {
    candidate = nextISTSlot(14, now);
    rationale.push('admin task → afternoon slot');
  } else {
    // shallow / social — 2h from now, flexible
    candidate = now + 2 * 60 * 60_000;
    if (rationale.length === 0) rationale.push('you usually do this in the afternoon');
  }

  // High stress: add a 30-min buffer before the task
  if (stress > 0.65) {
    candidate += 30 * 60_000;
    rationale.push('30 min buffer added (high stress)');
  }

  // Push past learned avoidance window
  const pattern = task.delay_pattern;
  if (pattern?.startsWith('peak-skip:')) {
    const peakBucket = pattern.slice('peak-skip:'.length) as HourBucket;
    if (hourBucket(candidate) === peakBucket) {
      const end = avoidanceWindowEnd(peakBucket, candidate);
      if (end > candidate) {
        candidate = end;
        rationale.push(`skipped often in the ${peakBucket} — moved past it`);
      }
    }
  }

  // Nudge past conflicting scheduled tasks (up to 8 iterations)
  for (let i = 0; i < 8; i++) {
    const conflict = findConflict(candidate, durationMs, others);
    if (!conflict) break;
    if (taskConflictWeight(task, now) > taskConflictWeight(conflict, now)) {
      rationale.push(`kept slot over lower-priority conflict: ${conflict.text}`);
      break;
    }
    candidate = conflict.scheduled_at! + (conflict.duration ?? 30) * 60_000 + 5 * 60_000;
    if (i === 0) rationale.push('moved past a conflict');
  }

  // Workday wrap: on weekdays, don't suggest past 7 pm — jump to next preferred morning
  if (isISTWeekday(candidate) && istHourOf(candidate) >= WORKDAY_END_IST) {
    const wrapHour = focusType === 'admin' ? 14 : 9;
    candidate = nextISTSlot(wrapHour, candidate);
    rationale.push('busy today after hours — next available morning');
  }

  // Weekend note: weekdays are typically busy, weekends have open calendar
  if (!isISTWeekday(candidate)) {
    rationale.push('weekend — calendar typically free');
  }

  if (candidate <= now) {
    candidate = now + 60 * 60_000;
    if (rationale.length === 0) rationale.push('earliest available slot');
  }

  if (rationale.length === 0) rationale.push('next available slot');

  return { scheduledAt: candidate, rationale };
}

// Lightweight delay-pattern updater — called on each skip.
// Accumulates a "peak-skip:<bucket>" label once the user has skipped 2+ times.
export function updateDelayPattern(task: ApiTask, now: number): string | null {
  const bucket = hourBucket(now);
  const skips = (task.skipped_count ?? 0) + 1; // +1 for the skip we're about to record

  if (skips < 2) return task.delay_pattern ?? null;

  const existing = task.delay_pattern;
  if (existing === `peak-skip:${bucket}`) return existing; // already matches

  // After 3 skips in the same bucket, set the pattern; before that keep existing
  if (skips >= 3) return `peak-skip:${bucket}`;
  return existing ?? null;
}

export function formatSlot(ts: number): string {
  const now = Date.now();
  const diff = ts - now;
  const d = new Date(ts);
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

  if (diff < 60 * 60 * 1000 && diff > 0) {
    return `in ${Math.round(diff / 60000)}m (${time})`;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isToday = d.toDateString() === new Date(now).toDateString();
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const day = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' });
  return `${day} at ${time}`;
}
