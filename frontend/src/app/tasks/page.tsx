"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@shared/cortex";
import { api, ApiTask } from "@/lib/api";
import { suggestSlot, updateDelayPattern, formatSlot, SlotSuggestion } from "@/lib/suggest-slot";

type Filter = "open" | "done" | "all";
type SortKey = "urgency" | "importance" | "created_at";

const TAG_OPTIONS = ["general", "work", "social", "later"] as const;
const EFFORT_OPTIONS = ["low", "medium", "high"] as const;

export default function TasksPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [fetching, setFetching] = useState(false);
  const [filter, setFilter] = useState<Filter>("open");
  const [sort, setSort] = useState<SortKey>("urgency");
  const [showNew, setShowNew] = useState(false);
  const [reschedulingTask, setReschedulingTask] = useState<ApiTask | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    api
      .listTasks()
      .then(setTasks)
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [user]);

  if (loading || !user) return null;

  const filtered = tasks
    .filter((t) =>
      filter === "open" ? !t.completed : filter === "done" ? t.completed : true,
    )
    .sort((a, b) => {
      if (sort === "urgency") return b.urgency - a.urgency;
      if (sort === "importance") return b.importance - a.importance;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  async function toggleComplete(t: ApiTask) {
    const updated = await api.updateTask(t.id, { completed: !t.completed });
    setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function deleteTask(id: number) {
    await api.deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function skipTask(task: ApiTask) {
    const now = Date.now();
    const { scheduledAt } = suggestSlot(task, tasks, now);
    const newPattern = updateDelayPattern(task, now);
    const updated = await api.updateTask(task.id, {
      scheduled_at: scheduledAt,
      skipped_count: (task.skipped_count ?? 0) + 1,
      last_skipped_at: now,
      ...(newPattern !== task.delay_pattern ? { delay_pattern: newPattern } : {}),
    });
    setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function confirmReschedule(task: ApiTask, scheduledAt: number) {
    const now = Date.now();
    const newPattern = updateDelayPattern(task, now);
    const updated = await api.updateTask(task.id, {
      scheduled_at: scheduledAt,
      skipped_count: (task.skipped_count ?? 0) + 1,
      last_skipped_at: now,
      ...(newPattern !== task.delay_pattern ? { delay_pattern: newPattern } : {}),
    });
    setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    setReschedulingTask(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-medium text-circuit-text">Tasks</h1>
        <button
          onClick={() => setShowNew((v) => !v)}
          className="btn-primary"
        >
          {showNew ? "Cancel" : "New task"}
        </button>
      </div>

      {showNew && (
        <NewTaskForm
          onCreated={(t) => {
            setTasks((prev) => [t, ...prev]);
            setShowNew(false);
          }}
        />
      )}

      <div className="flex gap-3 text-sm">
        {(["open", "done", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`capitalize ${
              filter === f
                ? "text-circuit-accent"
                : "text-circuit-muted hover:text-circuit-text"
            }`}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto flex gap-3">
          {(["urgency", "importance", "created_at"] as SortKey[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`capitalize text-xs ${
                sort === s
                  ? "text-circuit-accent"
                  : "text-circuit-muted hover:text-circuit-text"
              }`}
            >
              {s === "created_at" ? "newest" : s}
            </button>
          ))}
        </span>
      </div>

      {fetching && <p className="text-sm text-circuit-muted">Loading…</p>}

      {!fetching && filtered.length === 0 && (
        <p className="text-sm text-circuit-muted">No tasks here.</p>
      )}

      <ul className="space-y-2">
        {filtered.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            allTasks={tasks}
            onToggle={() => toggleComplete(t)}
            onDelete={() => deleteTask(t.id)}
            onSkip={() => skipTask(t)}
            onReschedule={() => setReschedulingTask(t)}
          />
        ))}
      </ul>

      {reschedulingTask && (
        <RescheduleModal
          task={reschedulingTask}
          allTasks={tasks}
          onConfirm={(scheduledAt) => confirmReschedule(reschedulingTask, scheduledAt)}
          onClose={() => setReschedulingTask(null)}
        />
      )}
    </div>
  );
}

function TaskRow({
  task,
  allTasks,
  onToggle,
  onDelete,
  onSkip,
  onReschedule,
}: {
  task: ApiTask;
  allTasks: ApiTask[];
  onToggle: () => void;
  onDelete: () => void;
  onSkip: () => void;
  onReschedule: () => void;
}) {
  const [skipping, setSkipping] = useState(false);

  const scheduledLabel = task.scheduled_at
    ? formatSlot(task.scheduled_at)
    : null;

  async function handleSkip() {
    setSkipping(true);
    try { await onSkip(); } finally { setSkipping(false); }
  }

  return (
    <li className="panel flex items-start gap-3 px-4 py-3">
      <input
        type="checkbox"
        checked={task.completed}
        onChange={onToggle}
        className="mt-1 accent-circuit-accent"
      />
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm ${
            task.completed ? "line-through text-circuit-muted" : "text-circuit-text"
          }`}
        >
          {task.text}
        </p>
        {task.tiny_step && (
          <p className="mt-0.5 text-xs text-circuit-muted">{task.tiny_step}</p>
        )}
        <div className="mt-1 flex flex-wrap gap-2 text-xs text-circuit-muted">
          <span className="capitalize">{task.tag}</span>
          <span>·</span>
          <span className="capitalize">{task.effort}</span>
          <span>·</span>
          <span>{task.duration}m</span>
          {task.urgency >= 0.7 && (
            <>
              <span>·</span>
              <span className="text-circuit-accent">urgent</span>
            </>
          )}
          {task.preferred_execution_window && (
            <>
              <span>·</span>
              <span className="capitalize">{task.preferred_execution_window}</span>
            </>
          )}
          {task.skipped_count > 0 && (
            <>
              <span>·</span>
              <span className="text-amber-400">skipped ×{task.skipped_count}</span>
            </>
          )}
        </div>
        {scheduledLabel && !task.completed && (
          <p className="mt-1 text-xs text-circuit-accent">{scheduledLabel}</p>
        )}
      </div>
      {!task.completed && (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <button
            onClick={onReschedule}
            className="text-xs text-circuit-muted hover:text-circuit-accent transition-colors"
            title="Reschedule with recommendation"
          >
            ↷ reschedule
          </button>
          <button
            onClick={handleSkip}
            disabled={skipping}
            className="text-xs text-circuit-muted hover:text-circuit-text transition-colors"
            title="Skip — auto-suggest next slot"
          >
            {skipping ? "…" : "skip"}
          </button>
        </div>
      )}
      <button
        onClick={onDelete}
        className="text-xs text-circuit-muted hover:text-red-400 transition-colors ml-1"
      >
        ✕
      </button>
    </li>
  );
}

function RescheduleModal({
  task,
  allTasks,
  onConfirm,
  onClose,
}: {
  task: ApiTask;
  allTasks: ApiTask[];
  onConfirm: (scheduledAt: number) => void;
  onClose: () => void;
}) {
  const suggestion: SlotSuggestion = suggestSlot(task, allTasks);
  const [chosen, setChosen] = useState(suggestion.scheduledAt);
  const [saving, setSaving] = useState(false);

  function toInputValue(ts: number): string {
    const d = new Date(ts);
    // datetime-local expects local ISO without the Z
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function handleConfirm() {
    setSaving(true);
    try { await onConfirm(chosen); } finally { setSaving(false); }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-circuit-surface border border-circuit-border rounded-xl p-6 w-full max-w-sm space-y-5 mx-4">
        <div>
          <h2 className="font-semibold text-circuit-text">Reschedule</h2>
          <p className="mt-1 text-sm text-circuit-muted truncate">{task.text}</p>
        </div>

        {/* Suggestion */}
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-circuit-muted">Recommended</p>
          <p className="text-circuit-accent font-medium text-sm">
            {formatSlot(suggestion.scheduledAt)}
          </p>
          <div className="flex flex-wrap gap-1">
            {suggestion.rationale.map((r) => (
              <span
                key={r}
                className="text-xs bg-circuit-bg px-2 py-0.5 rounded-full text-circuit-muted border border-circuit-border"
              >
                {r}
              </span>
            ))}
          </div>
          <button
            onClick={() => setChosen(suggestion.scheduledAt)}
            className="text-xs text-circuit-accent hover:underline"
          >
            Use suggestion
          </button>
        </div>

        {/* Manual picker */}
        <div className="space-y-1">
          <label className="text-xs text-circuit-muted">Choose a different time</label>
          <input
            type="datetime-local"
            value={toInputValue(chosen)}
            onChange={(e) => setChosen(new Date(e.target.value).getTime())}
            className="input-field"
          />
          {chosen !== suggestion.scheduledAt && (
            <p className="text-xs text-circuit-muted">{formatSlot(chosen)}</p>
          )}
        </div>

        {/* Existing schedule info */}
        {task.scheduled_at && (
          <p className="text-xs text-circuit-muted">
            Currently: {formatSlot(task.scheduled_at)}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="btn-primary flex-1"
          >
            {saving ? "Saving…" : "Confirm"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 text-sm text-circuit-muted hover:text-circuit-text transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function NewTaskForm({ onCreated }: { onCreated: (t: ApiTask) => void }) {
  const [text, setText] = useState("");
  const [tinyStep, setTinyStep] = useState("");
  const [tag, setTag] = useState<string>("general");
  const [effort, setEffort] = useState<string>("medium");
  const [urgency, setUrgency] = useState(0.5);
  const [importance, setImportance] = useState(0.5);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createTask({
        text: text.trim(),
        tiny_step: tinyStep.trim(),
        tag,
        effort,
        urgency,
        importance,
      });
      onCreated(created);
      setText("");
      setTinyStep("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="panel space-y-3 p-4">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Task description"
        required
        className="input-field"
      />
      <input
        value={tinyStep}
        onChange={(e) => setTinyStep(e.target.value)}
        placeholder="Tiny first step (optional)"
        className="input-field"
      />
      <div className="flex gap-3">
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          className="input-field w-auto"
        >
          {TAG_OPTIONS.map((o) => (
            <option key={o} value={o} className="bg-circuit-bg capitalize">
              {o}
            </option>
          ))}
        </select>
        <select
          value={effort}
          onChange={(e) => setEffort(e.target.value)}
          className="input-field w-auto"
        >
          {EFFORT_OPTIONS.map((o) => (
            <option key={o} value={o} className="bg-circuit-bg capitalize">
              {o}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1">
          <span className="text-xs text-circuit-muted">
            Urgency {Math.round(urgency * 100)}%
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={urgency}
            onChange={(e) => setUrgency(Number(e.target.value))}
            className="w-full accent-circuit-accent"
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-circuit-muted">
            Importance {Math.round(importance * 100)}%
          </span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={importance}
            onChange={(e) => setImportance(Number(e.target.value))}
            className="w-full accent-circuit-accent"
          />
        </label>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={submitting} className="btn-primary">
        {submitting ? "Adding…" : "Add task"}
      </button>
    </form>
  );
}
