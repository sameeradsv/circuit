import type { Task } from '../types';

type HourBucket = 'morning' | 'afternoon' | 'evening';

function hourBucket(ts: number): HourBucket {
  const h = new Date(ts).getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

const BUCKET_END_HOUR: Record<HourBucket, number> = {
  morning: 12,
  afternoon: 17,
  evening: 24,
};

// Analyze the most recent skip entries to find the time window where this task
// is consistently avoided. Returns "peak-skip:<bucket>" when ≥50% of skips
// in the last 8 happen in the same hour bucket, null otherwise.
export function detectDelayPattern(task: Task): string | null {
  const skips = task.rescheduleLog.filter((e) => e.reason === 'skip').slice(-8);
  if (skips.length < 3) return null;

  const counts: Partial<Record<HourBucket, number>> = {};
  for (const entry of skips) {
    const b = hourBucket(entry.at);
    counts[b] = (counts[b] ?? 0) + 1;
  }

  const dominant = (Object.entries(counts) as [HourBucket, number][])
    .sort((a, b) => b[1] - a[1])[0];

  if (!dominant || dominant[1] < Math.ceil(skips.length * 0.5)) return null;
  return `peak-skip:${dominant[0]}`;
}

// Returns the number of ms to push a task forward to escape its avoidance window.
// Zero if the task has no pattern or the current time is already past it.
export function avoidanceDelayMs(task: Task, now = Date.now()): number {
  if (!task.delayPattern?.startsWith('peak-skip:')) return 0;
  const peakBucket = task.delayPattern.replace('peak-skip:', '') as HourBucket;
  if (hourBucket(now) !== peakBucket) return 0;

  const endHour = BUCKET_END_HOUR[peakBucket];
  const windowEnd = new Date(now).setHours(endHour, 0, 0, 0);
  return Math.max(0, windowEnd - now);
}
