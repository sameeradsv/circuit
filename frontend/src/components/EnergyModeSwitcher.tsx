"use client";

import type { EnergyMode } from "@/lib/use-energy-mode";

const MODES: { value: EnergyMode; label: string; desc: string }[] = [
  { value: "normal", label: "Normal", desc: "Balanced scoring" },
  { value: "deep",   label: "Deep",   desc: "Prioritise focus work" },
  { value: "low",    label: "Low",    desc: "Easy tasks only" },
  { value: "social", label: "Social", desc: "People & comms first" },
];

export function EnergyModeSwitcher({
  mode,
  onChange,
}: {
  mode: EnergyMode;
  onChange: (m: EnergyMode) => void;
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-circuit-surface border border-circuit-border p-1">
      {MODES.map((m) => {
        const active = mode === m.value;
        return (
          <button
            key={m.value}
            onClick={() => onChange(m.value)}
            title={m.desc}
            className={[
              "rounded px-3 py-1 text-xs font-medium transition-all duration-200",
              active
                ? "bg-circuit-accent text-circuit-bg animate-pulse-glow"
                : "text-circuit-muted hover:text-circuit-text",
            ].join(" ")}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
