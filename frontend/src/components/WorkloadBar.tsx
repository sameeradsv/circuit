"use client";

const CAPACITY_MINUTES = 480;

const ZONES = [
  { pct: 0,   label: "Light",     sub: "< 4h",      color: "text-circuit-accent" },
  { pct: 50,  label: "Moderate",  sub: "4–6.5h",    color: "text-amber-300" },
  { pct: 80,  label: "Heavy",     sub: "6.5–8h",    color: "text-amber-400" },
  { pct: 100, label: "Overloaded",sub: "> 8h",       color: "text-red-400" },
];

export function WorkloadBar({ pendingMinutes }: { pendingMinutes: number }) {
  const pct = Math.min(110, Math.round((pendingMinutes / CAPACITY_MINUTES) * 100));
  const zone = [...ZONES].reverse().find((z) => pct >= z.pct) ?? ZONES[0];

  const hours = Math.floor(pendingMinutes / 60);
  const mins = pendingMinutes % 60;
  const timeLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const barColor =
    pct < 50 ? "bg-circuit-accent" : pct < 80 ? "bg-amber-300" : "bg-red-400";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-circuit-muted">
        <span>Today's workload — {timeLabel} scheduled</span>
        <span className={zone.color}>{zone.label}</span>
      </div>

      {/* Bar + tick marks */}
      <div className="relative h-2">
        <div className="absolute inset-0 rounded-full bg-circuit-surface border border-circuit-border overflow-hidden">
          <div
            className={`h-full rounded-full origin-left animate-bar-grow ${barColor}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        {/* Zone ticks at 50% and 80% */}
        <div className="absolute top-0 bottom-0 left-[50%] w-px bg-circuit-border" />
        <div className="absolute top-0 bottom-0 left-[80%] w-px bg-circuit-border" />
      </div>

      {/* Zone threshold labels */}
      <div className="relative h-4 text-[10px]">
        <span className="absolute left-0 text-circuit-muted/50">Light &lt; 4h</span>
        <span className="absolute left-[50%] -translate-x-1/2 text-circuit-muted/50">Moderate 4–6.5h</span>
        <span className="absolute left-[80%] -translate-x-1/2 text-circuit-muted/50">Heavy 6.5–8h</span>
        <span className="absolute right-0 text-circuit-muted/50">Overloaded</span>
      </div>
    </div>
  );
}
