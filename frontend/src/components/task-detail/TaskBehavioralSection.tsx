"use client";

import type { ApiTask } from "@/lib/api";

export function TaskBehavioralSection({ task }: { task: ApiTask }) {
  const rows: [string, string | number][] = [
    ["Skipped", task.skipped_count],
    ["Completion rate", `${Math.round((task.historical_completion_rate ?? 0.7) * 100)}%`],
    ["Avoidance pattern", task.delay_pattern ?? "—"],
  ];

  return (
    <section className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-circuit-muted">Behavioural data</p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="panel px-3 py-2">
            <p className="text-circuit-muted">{k}</p>
            <p className="mt-0.5 font-medium text-circuit-text">{String(v)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
