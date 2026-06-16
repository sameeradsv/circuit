"use client";

export function TaskScorePreview({ scored }: { scored: { score: number; reasons: string[] } }) {
  return (
    <div className="panel p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-circuit-muted">Schedule score</span>
        <span className="text-sm font-semibold text-circuit-accent">{Math.round(scored.score)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-circuit-bg overflow-hidden">
        <div
          className="h-full bg-circuit-accent rounded-full transition-all"
          style={{ width: `${Math.max(0, Math.min(100, scored.score))}%` }}
        />
      </div>
      {scored.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {scored.reasons.map((r) => (
            <span key={r} className="text-xs bg-circuit-bg px-2 py-0.5 rounded-full text-circuit-muted border border-circuit-border">
              {r}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
