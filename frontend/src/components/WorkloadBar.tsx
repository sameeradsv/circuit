"use client";

const CAPACITY_MINUTES = 480;

export function WorkloadBar({ pendingMinutes }: { pendingMinutes: number }) {
  const pct = Math.min(100, Math.round((pendingMinutes / CAPACITY_MINUTES) * 100));
  const label =
    pct < 50 ? "Light" : pct < 80 ? "Moderate" : pct < 100 ? "Heavy" : "Overloaded";
  const color =
    pct < 50 ? "bg-circuit-accent" : pct < 80 ? "bg-amber-400" : "bg-red-400";

  const hours = Math.floor(pendingMinutes / 60);
  const mins = pendingMinutes % 60;
  const timeLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-circuit-muted">
        <span>Today's workload — {timeLabel} scheduled</span>
        <span className={pct >= 100 ? "text-red-400" : ""}>{label}</span>
      </div>
      <div className="h-2 w-full rounded-full bg-circuit-surface border border-circuit-border overflow-hidden">
        <div
          className={`h-full rounded-full origin-left animate-bar-grow ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
