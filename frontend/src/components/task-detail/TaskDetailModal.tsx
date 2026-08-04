"use client";

import { useState } from "react";
import { api, ApiTask, TaskPatch } from "@/lib/api";
import { apiTaskToTask } from "@/lib/engine-adapter";
import { scoreTask } from "../../engines/src/scheduling-engine/scoring";
import type { EnergyMode } from "@/lib/use-energy-mode";
import { TaskBehavioralSection } from "./TaskBehavioralSection";
import { TaskBlackoutSection } from "./TaskBlackoutSection";
import { TaskCognitiveSection } from "./TaskCognitiveSection";
import { TaskGroupSection } from "./TaskGroupSection";
import { TaskPrioritySection } from "./TaskPrioritySection";
import { TaskScorePreview } from "./TaskScorePreview";
import { TaskSeriesPanel, type SeriesOptions } from "./TaskSeriesPanel";
import { TaskTimeFocusSection } from "./TaskTimeFocusSection";
import type { MergedTask } from "./types";

export function TaskDetailModal({
  task,
  mode,
  onSave,
  onDelete,
  onDeleteSeries,
  onClose,
}: {
  task: ApiTask;
  mode: EnergyMode;
  onSave: (updated: ApiTask) => void;
  onDelete?: () => Promise<void>;
  onDeleteSeries?: (fromScheduledAt?: number) => Promise<void>;
  onClose: () => void;
}) {
  const [patch, setPatch] = useState<TaskPatch>({});
  const [saving, setSaving] = useState(false);

  const initDto = task.day_time_overrides ?? {};
  const [weekendTime, setWeekendTime] = useState(initDto.SA ?? initDto.SU ?? "");

  function applyWeekendTime(we: string) {
    const dto: Record<string, string> = {};
    if (we) { dto.SA = we; dto.SU = we; }
    setPatch((p) => ({ ...p, day_time_overrides: dto }));
  }

  const [propagating, setPropagating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [propagateMsg, setPropagateMsg] = useState<string | null>(null);
  const [showSeriesPanel, setShowSeriesPanel] = useState(false);
  const [seriesOpts, setSeriesOpts] = useState<SeriesOptions>({
    scope: "selected",
  });
  const [confirmDeleteSeries, setConfirmDeleteSeries] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const seriesTaskId = typeof task.source_task_id === "number"
    ? task.source_task_id
    : typeof task.id === "number"
      ? task.id
      : null;
  const isSeries = Boolean(
    seriesTaskId != null
    && (task.recurrence || task.rrule || task.is_recurring_template || task.is_virtual_occurrence || /^ics:.+:\d{10,}$/.test(task.client_id ?? ""))
  );
  const merged: MergedTask = { ...task, ...patch };

  const scored = scoreTask(apiTaskToTask({ ...task, ...patch } as ApiTask), {
    mode,
    now: Date.now(),
    availableMinutes: 480,
    completedToday: 0,
  });

  function set<K extends keyof TaskPatch>(key: K, value: TaskPatch[K]) {
    setPatch((p) => ({ ...p, [key]: value }));
  }

  async function handleApplyToSeries() {
    if (seriesTaskId == null) return;
    if (Object.keys(patch).length === 0) { onClose(); return; }
    setPropagating(true);
    setSaveError(null);
    setPropagateMsg(null);
    try {
      if (seriesOpts.scope === "selected") {
        const updated = await api.updateTask(task.id, patch);
        onSave(updated);
        onClose();
        return;
      }
      const { updated } = await api.editSeries(seriesTaskId, {
        patch,
        scope: seriesOpts.scope,
        from_scheduled_at: seriesOpts.scope === "future" ? (task.scheduled_at ?? Date.now()) : null,
      });
      setPropagateMsg(`Changes applied to ${updated} series record${updated !== 1 ? "s" : ""}`);
      setPatch({});
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed");
    } finally {
      setPropagating(false);
    }
  }

  async function handleSave() {
    if (Object.keys(patch).length === 0) { onClose(); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.updateTask(task.id, patch);
      onSave(updated);
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkImportDone() {
    setSaving(true);
    setSaveError(null);
    try {
      const payload: TaskPatch = { ...patch, import_review_pending: false };
      const updated = await api.updateTask(task.id, payload);
      onSave(updated);
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const sectionProps = { merged, set };

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200] safe-overlay-pad"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-circuit-surface border border-circuit-border rounded-lg w-full max-w-lg max-h-[calc(100dvh-32px)] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-circuit-border">
          <div>
            <h2 className="font-semibold text-circuit-text">{task.text}</h2>
            <p className="mt-1 text-xs text-circuit-muted capitalize">
              {merged.tag} · {merged.effort} effort · {merged.duration}m
            </p>
          </div>
          <button onClick={onClose} className="text-circuit-muted hover:text-circuit-text ml-4 min-h-11 min-w-11">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-6">
          {task.import_review_pending && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Imported from calendar — review blackout flags, recurrence, and cognitive load, then mark setup done.
            </div>
          )}
          {!task.completed && <TaskScorePreview scored={scored} />}
          <TaskPrioritySection {...sectionProps} />
          <TaskCognitiveSection {...sectionProps} />
          <TaskTimeFocusSection
            {...sectionProps}
            weekendTime={weekendTime}
            onWeekendTimeChange={(value) => {
              setWeekendTime(value);
              applyWeekendTime(value);
            }}
          />
          <TaskBlackoutSection {...sectionProps} />
          <TaskGroupSection {...sectionProps} />
          <TaskBehavioralSection task={task} />
        </div>

        <div className="flex flex-col gap-2 p-5 border-t border-circuit-border">
          {saveError && <p className="text-xs text-red-500">{saveError}</p>}
          {propagateMsg && <p className="text-xs text-circuit-muted">{propagateMsg}</p>}

          {isSeries && showSeriesPanel && (
            <TaskSeriesPanel
              task={task}
              seriesOpts={seriesOpts}
              onSeriesOptsChange={setSeriesOpts}
              propagating={propagating}
              onApply={handleApplyToSeries}
              confirmDeleteSeries={confirmDeleteSeries}
              onConfirmDeleteSeriesChange={setConfirmDeleteSeries}
              onDeleteSeries={onDeleteSeries}
              onSaveError={setSaveError}
            />
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {onDelete && (
              <button
                onClick={async () => {
                  setDeleting(true);
                  setSaveError(null);
                  try {
                    await onDelete();
                    onClose();
                  } catch (e) {
                    setSaveError(e instanceof Error ? e.message : "Delete failed");
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={saving || propagating || deleting}
                className="flex-1 min-h-11 text-sm text-red-400 hover:text-red-300 transition-colors"
                title="Delete"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            )}
            {task.import_review_pending && (
              <button
                onClick={handleMarkImportDone}
                disabled={saving || propagating || deleting}
                className="btn flex-1"
                title="Save changes and remove from After import"
              >
                {saving ? "Saving…" : "Mark setup done"}
              </button>
            )}
            <button onClick={handleSave} disabled={saving || propagating || deleting} className="btn btn-primary flex-1">
              {saving ? "Saving…" : "Save"}
            </button>
            {isSeries && (
              <button
                onClick={() => { setShowSeriesPanel((v) => !v); setPropagateMsg(null); }}
                disabled={saving || propagating || deleting}
                className="flex-1 min-h-11 text-sm text-circuit-muted hover:text-circuit-text transition-colors"
                title="Choose how this recurring edit is applied"
              >
                Edit scope {showSeriesPanel ? "▲" : "▼"}
              </button>
            )}
            <button onClick={onClose} className="flex-1 min-h-11 text-sm text-circuit-muted hover:text-circuit-text transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
