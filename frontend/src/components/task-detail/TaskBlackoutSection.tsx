"use client";

import type { TaskSectionProps } from "./types";

const BLACKOUT_FLAGS = ["travelling", "period", "sickness", "leave", "wfh"] as const;

const BLACKOUT_LABELS: Record<(typeof BLACKOUT_FLAGS)[number], string> = {
  travelling: "Travelling",
  period: "On period",
  sickness: "Sick",
  leave: "On leave",
  wfh: "Working from home",
};

export function TaskBlackoutSection({ merged, set }: TaskSectionProps) {
  return (
    <section className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wider text-circuit-muted">Park this task during</p>
      {BLACKOUT_FLAGS.map((flag) => {
        const flags = merged.blackout_skip_flags ?? [];
        return (
          <label key={flag} className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={flags.includes(flag)}
              onChange={(e) => {
                const current = merged.blackout_skip_flags ?? [];
                const updated = e.target.checked
                  ? [...current, flag]
                  : current.filter((f) => f !== flag);
                set("blackout_skip_flags", updated);
              }}
              className="accent-circuit-accent"
            />
            <span className="text-xs text-circuit-text">{BLACKOUT_LABELS[flag]}</span>
          </label>
        );
      })}
    </section>
  );
}
