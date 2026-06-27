"use client";

const CAPACITY_MINUTES = 480;

const ZONES = [
  { pct: 0, label: "Light", sub: "< 4h", color: "text-circuit-accent" },
  { pct: 50, label: "Moderate", sub: "4-6.5h", color: "text-amber-300" },
  { pct: 80, label: "Heavy", sub: "6.5-8h", color: "text-amber-400" },
  { pct: 100, label: "Overloaded", sub: "> 8h", color: "text-red-400" },
];

export function WorkloadBar({ pendingMinutes, label = "Today's workload" }: { pendingMinutes: number; label?: string }) {
  const pct = Math.min(110, Math.round((pendingMinutes / CAPACITY_MINUTES) * 100));
  const zone = [...ZONES].reverse().find((z) => pct >= z.pct) ?? ZONES[0];

  const hours = Math.floor(pendingMinutes / 60);
  const mins = pendingMinutes % 60;
  const timeLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  const barColor =
    pct < 50 ? "bg-circuit-accent" : pct < 80 ? "bg-amber-300" : "bg-red-400";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-circuit-muted">
        <span className="min-w-0">{label} - {timeLabel} scheduled</span>
        <span className={zone.color}>{zone.label}</span>
      </div>

      <div className="relative h-2">
        <div className="absolute inset-0 overflow-hidden rounded-full border border-circuit-border bg-circuit-surface">
          <div
            className={`h-full origin-left rounded-full animate-bar-grow ${barColor}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <div className="absolute bottom-0 top-0 left-[50%] w-px bg-circuit-border" />
        <div className="absolute bottom-0 top-0 left-[80%] w-px bg-circuit-border" />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] leading-tight text-circuit-muted/50 sm:grid-cols-4">
        {ZONES.map((z) => (
          <span key={z.label} className="min-w-0">
            {z.label} {z.sub}
          </span>
        ))}
      </div>
    </div>
  );
}
