import type { ApiBlackout } from "@/lib/api";

export const BLACKOUT_LABELS: Record<string, string> = {
  travelling: "Travelling",
  period: "On period",
  sickness: "Sick",
  leave: "On leave",
  wfh: "Working from home",
};

/** Subtle tint per blackout type for calendar shading. */
export const BLACKOUT_TINT: Record<string, string> = {
  travelling: "rgba(120, 113, 108, 0.12)",
  period: "rgba(180, 100, 120, 0.10)",
  sickness: "rgba(200, 120, 80, 0.12)",
  leave: "rgba(80, 100, 180, 0.12)",
  wfh: "rgba(60, 140, 100, 0.10)",
};

export function dayStartMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dayEndMs(d: Date): number {
  return dayStartMs(d) + 86_399_999;
}

/** Blackouts that overlap a calendar day (local midnight boundaries). */
export function blackoutsOnDay(day: Date, blackouts: ApiBlackout[]): ApiBlackout[] {
  const start = dayStartMs(day);
  const end = dayEndMs(day);
  return blackouts.filter((b) => b.start_date_ms <= end && b.end_date_ms >= start);
}

export function blackoutTintForDay(day: Date, blackouts: ApiBlackout[]): string | undefined {
  const hits = blackoutsOnDay(day, blackouts);
  if (hits.length === 0) return undefined;
  // Blend: use the most recent overlapping blackout's tint
  const primary = hits[hits.length - 1].blackout_type;
  return BLACKOUT_TINT[primary] ?? "rgba(120, 113, 108, 0.10)";
}

export function blackoutLabelForDay(day: Date, blackouts: ApiBlackout[]): string {
  const hits = blackoutsOnDay(day, blackouts);
  if (hits.length === 0) return "";
  return hits.map((b) => BLACKOUT_LABELS[b.blackout_type] ?? b.blackout_type).join(", ");
}
