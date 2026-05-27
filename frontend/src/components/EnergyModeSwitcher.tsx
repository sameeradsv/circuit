"use client";

import type { EnergyMode } from "@/lib/use-energy-mode";

const MODES: { value: EnergyMode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "deep",   label: "Deep"   },
  { value: "low",    label: "Low"    },
  { value: "social", label: "Social" },
];

export function EnergyModeSwitcher({
  mode,
  onChange,
}: {
  mode: EnergyMode;
  onChange: (m: EnergyMode) => void;
}) {
  return (
    <div className="row gap-1 wrap">
      {MODES.map((m) => (
        <button
          key={m.value}
          onClick={() => onChange(m.value)}
          className="pill"
          style={{
            background:   mode === m.value ? "var(--ink)"  : "transparent",
            color:        mode === m.value ? "var(--paper)" : "var(--ink-2)",
            borderColor:  mode === m.value ? "var(--ink)"  : "var(--line)",
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
