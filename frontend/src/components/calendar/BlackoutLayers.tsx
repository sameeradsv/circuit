"use client";

import type { CSSProperties } from "react";
import type { ApiBlackout } from "@/lib/api";
import { blackoutLabelForDay, blackoutTintForDay } from "@/lib/blackout-utils";

/** Full-height column overlay for day/week calendar grids. */
export function BlackoutDayOverlay({
  day,
  blackouts,
}: {
  day: Date;
  blackouts: ApiBlackout[];
}) {
  const tint = blackoutTintForDay(day, blackouts);
  if (!tint) return null;
  const label = blackoutLabelForDay(day, blackouts);
  return (
    <div
      title={label ? `Blackout: ${label}` : undefined}
      style={{
        position: "absolute",
        inset: 0,
        background: tint,
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}

/** Small badge for month cells. */
export function BlackoutMonthBadge({
  day,
  blackouts,
}: {
  day: Date;
  blackouts: ApiBlackout[];
}) {
  const label = blackoutLabelForDay(day, blackouts);
  if (!label) return null;
  return (
    <span
      title={`Blackout: ${label}`}
      style={{
        fontSize: 9,
        fontFamily: "var(--font-mono)",
        color: "var(--ink-3)",
        opacity: 0.85,
        letterSpacing: "0.04em",
      }}
    >
      ▪ {label.split(",")[0]}
    </span>
  );
}

export function blackoutCellStyle(day: Date, blackouts: ApiBlackout[]): CSSProperties | undefined {
  const tint = blackoutTintForDay(day, blackouts);
  if (!tint) return undefined;
  return { background: `linear-gradient(${tint}, ${tint}), var(--paper)` };
}
