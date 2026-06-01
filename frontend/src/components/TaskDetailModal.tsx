"use client";

import { useState } from 'react';
import { api, ApiTask, TaskPatch } from '@/lib/api';
import { apiTaskToTask } from '@/lib/engine-adapter';
import { scoreTask } from '../engines/src/scheduling-engine/scoring';
import type { EnergyMode } from '@/lib/use-energy-mode';

function Slider({
  label, value, onChange,
}: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-44 shrink-0 text-xs text-circuit-muted">{label}</span>
      <input
        type="range" min={0} max={1} step={0.05} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-circuit-accent"
      />
      <span className="w-8 text-right text-xs text-circuit-text">{Math.round(value * 100)}%</span>
    </label>
  );
}

function Select({
  label, value, options, onChange,
}: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-44 shrink-0 text-xs text-circuit-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field flex-1 py-1 text-xs"
      >
        {options.map((o) => <option key={o} value={o} className="bg-circuit-bg capitalize">{o || 'any'}</option>)}
      </select>
    </label>
  );
}

function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TaskDetailModal({
  task,
  mode,
  onSave,
  onClose,
}: {
  task: ApiTask;
  mode: EnergyMode;
  onSave: (updated: ApiTask) => void;
  onClose: () => void;
}) {
  const [patch, setPatch] = useState<TaskPatch>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const merged = { ...task, ...patch };

  // Live score preview
  const engineTask = apiTaskToTask({ ...task, ...patch } as ApiTask);
  const scored = scoreTask(engineTask, { mode, now: Date.now(), availableMinutes: 480, completedToday: 0 });

  function set<K extends keyof TaskPatch>(key: K, value: TaskPatch[K]) {
    setPatch((p) => ({ ...p, [key]: value }));
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
      setSaveError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-circuit-surface border border-circuit-border rounded-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-circuit-border">
          <div>
            <h2 className="font-semibold text-circuit-text">{task.text}</h2>
            <p className="mt-1 text-xs text-circuit-muted capitalize">{merged.tag} · {merged.effort} effort · {merged.duration}m</p>
          </div>
          <button onClick={onClose} className="text-circuit-muted hover:text-circuit-text ml-4">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-6">
          {/* Score preview */}
          {!task.completed && (
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
                    <span key={r} className="text-xs bg-circuit-bg px-2 py-0.5 rounded-full text-circuit-muted border border-circuit-border">{r}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Priority */}
          <section className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-circuit-muted">Priority</p>
            <Slider label="Importance" value={merged.importance ?? 0.5} onChange={(v) => set('importance', v)} />
            <Slider label="Urgency" value={merged.urgency ?? 0.5} onChange={(v) => set('urgency', v)} />
            <Slider label="Consequence of delay" value={merged.consequence_of_delay ?? 0.3} onChange={(v) => set('consequence_of_delay', v)} />
            <Slider label="Momentum value" value={merged.momentum_value ?? 0.5} onChange={(v) => set('momentum_value', v)} />
          </section>

          {/* Cognitive */}
          <section className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-circuit-muted">Cognitive load</p>
            <Slider label="Cognitive load" value={merged.cognitive_load ?? 0.5} onChange={(v) => set('cognitive_load', v)} />
            <Slider label="Emotional resistance" value={merged.emotional_resistance ?? 0.5} onChange={(v) => set('emotional_resistance', v)} />
            <Slider label="Activation energy" value={merged.activation_energy ?? 0.5} onChange={(v) => set('activation_energy', v)} />
            <Slider label="Recovery cost" value={merged.recovery_cost ?? 0.3} onChange={(v) => set('recovery_cost', v)} />
            <Slider label="Energy → reward ratio" value={merged.energy_to_reward_ratio ?? 0.5} onChange={(v) => set('energy_to_reward_ratio', v)} />
          </section>

          {/* Time & focus */}
          <section className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wider text-circuit-muted">Time & focus</p>
            <label className="flex items-center gap-3">
              <span className="w-44 shrink-0 text-xs text-circuit-muted">Scheduled for</span>
              <input
                type="datetime-local"
                value={merged.scheduled_at ? toDatetimeLocal(merged.scheduled_at) : ''}
                onChange={(e) => set('scheduled_at', e.target.value ? new Date(e.target.value).getTime() : null as unknown as number)}
                className="input-field flex-1 py-1 text-xs"
              />
            </label>
            <label className="flex items-center gap-3">
              <span className="w-44 shrink-0 text-xs text-circuit-muted">Duration (minutes)</span>
              <input
                type="number" min={5} max={480} step={5}
                value={merged.duration ?? 30}
                onChange={(e) => set('duration', Number(e.target.value))}
                className="input-field flex-1 py-1 text-xs"
              />
            </label>
            <Select label="Effort" value={merged.effort ?? 'medium'} options={['low', 'medium', 'high']} onChange={(v) => set('effort', v as ApiTask['effort'])} />
            <Select label="Focus type" value={merged.focus_type ?? 'shallow'} options={['shallow', 'deep', 'admin', 'creative']} onChange={(v) => set('focus_type', v)} />
            <Select label="Deadline" value={merged.deadline_type ?? 'none'} options={['none', 'soft', 'hard']} onChange={(v) => set('deadline_type', v as ApiTask['deadline_type'])} />
            <label className="flex items-center gap-3">
              <span className="w-44 shrink-0 text-xs text-circuit-muted">Recurrence</span>
              <input
                type="text"
                value={merged.recurrence ?? ''}
                placeholder="daily, weekly, monthly…"
                onChange={(e) => set('recurrence', e.target.value || null as unknown as string)}
                className="input-field flex-1 py-1 text-xs"
              />
            </label>
            <Select
              label="Preferred window"
              value={merged.preferred_execution_window ?? ''}
              options={['', 'morning', 'afternoon', 'evening']}
              onChange={(v) => set('preferred_execution_window', v || null as unknown as string)}
            />
          </section>

          {/* Behavioural (read-only) */}
          <section className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-circuit-muted">Behavioural data</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {[
                ['Skipped', task.skipped_count],
                ['Completion rate', `${Math.round((task.historical_completion_rate ?? 0.7) * 100)}%`],
                ['Avoidance pattern', task.delay_pattern ?? '—'],
              ].map(([k, v]) => (
                <div key={String(k)} className="panel px-3 py-2">
                  <p className="text-circuit-muted">{k}</p>
                  <p className="mt-0.5 font-medium text-circuit-text">{String(v)}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 p-5 border-t border-circuit-border">
          {saveError && (
            <p className="text-xs text-red-500">{saveError}</p>
          )}
          <div className="flex gap-3">
            <button onClick={handleSave} disabled={saving} className="btn-primary flex-1">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button onClick={onClose} className="flex-1 text-sm text-circuit-muted hover:text-circuit-text transition-colors">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
