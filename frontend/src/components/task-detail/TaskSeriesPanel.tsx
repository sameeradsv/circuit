"use client";

import { useState } from "react";
import type { ApiTask } from "@/lib/api";

export interface SeriesOptions {
  classification: boolean;
  name: boolean;
  forwardOnly: boolean;
}

interface TaskSeriesPanelProps {
  task: ApiTask;
  seriesOpts: SeriesOptions;
  onSeriesOptsChange: (opts: SeriesOptions) => void;
  propagating: boolean;
  onApply: () => void;
  confirmDeleteSeries: boolean;
  onConfirmDeleteSeriesChange: (confirm: boolean) => void;
  onDeleteSeries?: (fromScheduledAt?: number) => Promise<void>;
  onSaveError: (message: string) => void;
}

export function TaskSeriesPanel({
  task,
  seriesOpts,
  onSeriesOptsChange,
  propagating,
  onApply,
  confirmDeleteSeries,
  onConfirmDeleteSeriesChange,
  onDeleteSeries,
  onSaveError,
}: TaskSeriesPanelProps) {
  const [deletingSeries, setDeletingSeries] = useState(false);

  async function handleDelete(fromScheduledAt?: number) {
    if (!onDeleteSeries) return;
    setDeletingSeries(true);
    try {
      await onDeleteSeries(fromScheduledAt);
    } catch (e) {
      onSaveError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingSeries(false);
    }
  }

  return (
    <div className="panel p-3 space-y-2" style={{ marginBottom: 4 }}>
      <p className="text-xs font-medium text-circuit-muted uppercase tracking-wider">Apply to all occurrences</p>

      <label className="flex items-center gap-2 text-xs text-circuit-text cursor-pointer select-none">
        <input
          type="checkbox"
          checked={seriesOpts.classification}
          onChange={(e) => onSeriesOptsChange({ ...seriesOpts, classification: e.target.checked })}
          className="accent-circuit-accent"
        />
        Classification — mode, effort, priority, cognitive load
      </label>

      <label className="flex items-center gap-2 text-xs text-circuit-text cursor-pointer select-none">
        <input
          type="checkbox"
          checked={seriesOpts.name}
          onChange={(e) => onSeriesOptsChange({ ...seriesOpts, name: e.target.checked })}
          className="accent-circuit-accent"
        />
        Name — rename all occurrences to match this one
      </label>

      <label
        className="flex items-center gap-2 text-xs text-circuit-text cursor-pointer select-none"
        style={{ marginTop: 4, paddingTop: 4, borderTop: "1px solid var(--circuit-border)" }}
      >
        <input
          type="checkbox"
          checked={seriesOpts.forwardOnly}
          onChange={(e) => onSeriesOptsChange({ ...seriesOpts, forwardOnly: e.target.checked })}
          className="accent-circuit-accent"
        />
        From this occurrence onward only
      </label>

      <button
        onClick={onApply}
        disabled={propagating || (!seriesOpts.classification && !seriesOpts.name)}
        className="btn btn-primary w-full text-xs mt-1"
      >
        {propagating ? "Applying…" : "Apply to series"}
      </button>

      {onDeleteSeries && (
        <div style={{ borderTop: "1px solid var(--circuit-border)", paddingTop: 8, marginTop: 4 }}>
          {confirmDeleteSeries ? (
            <div className="flex flex-col gap-1">
              <div className="flex gap-2">
                <button
                  onClick={async () => { await handleDelete(task.scheduled_at ?? undefined); }}
                  disabled={deletingSeries}
                  className="flex-1 text-xs font-medium transition-colors"
                  style={{ background: "none", border: "1px solid var(--terra)", borderRadius: 6, padding: "4px 8px", cursor: "pointer", color: "var(--terra)" }}
                >
                  {deletingSeries ? "Deleting…" : "From here onward"}
                </button>
                <button
                  onClick={async () => { await handleDelete(); }}
                  disabled={deletingSeries}
                  className="flex-1 text-xs font-medium transition-colors"
                  style={{ background: "none", border: "1px solid var(--terra)", borderRadius: 6, padding: "4px 8px", cursor: "pointer", color: "var(--terra)" }}
                >
                  {deletingSeries ? "Deleting…" : "All occurrences"}
                </button>
              </div>
              <button
                onClick={() => onConfirmDeleteSeriesChange(false)}
                className="text-xs text-circuit-muted hover:text-circuit-text transition-colors"
                style={{ background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => onConfirmDeleteSeriesChange(true)}
              className="w-full text-xs text-circuit-muted hover:text-red-500 transition-colors"
              style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: "2px 0" }}
            >
              Delete series…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
