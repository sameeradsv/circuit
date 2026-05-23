"use client";

import type { BehavioralInsight } from '../engines/src/types/task';

const ICON: Record<BehavioralInsight['type'], string> = {
  window: '◷',
  procrastination: '⚠',
  completion: '✓',
  recommendation: '→',
};

export function BehavioralInsights({ insights }: { insights: BehavioralInsight[] }) {
  if (insights.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wider text-circuit-muted">Insights</p>
      <ul className="space-y-1">
        {insights.map((ins, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-circuit-muted">
            <span className="mt-0.5 shrink-0 text-circuit-accent">{ICON[ins.type]}</span>
            <span>{ins.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
