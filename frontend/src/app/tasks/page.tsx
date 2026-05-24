"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiTask } from "@/lib/api";
import { useCircuitAuth } from "@/lib/use-circuit-auth";
import { useEnergyMode } from "@/lib/use-energy-mode";
import { apiTaskToTask } from "@/lib/engine-adapter";
import { scoreTasks } from "@/engines/src/scheduling-engine/scoring";
import { suggestSlot, updateDelayPattern, formatSlot, SlotSuggestion } from "@/lib/suggest-slot";
import { parseTaskText } from "@/lib/parse-task";
import { TaskDetailModal } from "@/components/TaskDetailModal";
import { EnergyModeSwitcher } from "@/components/EnergyModeSwitcher";

// ── Constants ────────────────────────────────────────────────────────────────

type Filter = "open" | "done" | "all";

const TAG_OPTIONS    = ["general", "work", "social", "later"] as const;
const EFFORT_OPTIONS = ["low", "medium", "high"] as const;
const RECUR_OPTIONS  = [
  { value: "",         label: "No repeat" },
  { value: "daily",    label: "Daily" },
  { value: "weekdays", label: "Weekdays (Mon–Fri)" },
  { value: "weekly",   label: "Weekly" },
  { value: "monthly",  label: "Monthly" },
] as const;
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

const NOW_MS = () => Date.now();
const DAY_MS = 86_400_000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

type DateBucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "unscheduled";

function bucket(task: ApiTask): DateBucket {
  if (!task.scheduled_at) return "unscheduled";
  const tod = startOfDay();
  if (task.scheduled_at < tod) return "overdue";
  if (task.scheduled_at < tod + DAY_MS) return "today";
  if (task.scheduled_at < tod + 2 * DAY_MS) return "tomorrow";
  if (task.scheduled_at < tod + 7 * DAY_MS) return "week";
  return "later";
}

const BUCKET_LABEL: Record<DateBucket, string> = {
  overdue:     "Overdue",
  today:       "Today",
  tomorrow:    "Tomorrow",
  week:        "This week",
  later:       "Later",
  unscheduled: "Unscheduled",
};

const BUCKET_ORDER: DateBucket[] = ["overdue", "today", "tomorrow", "week", "later", "unscheduled"];

function groupTasks(tasks: ApiTask[]): { key: DateBucket; label: string; items: ApiTask[] }[] {
  const map = new Map<DateBucket, ApiTask[]>();
  BUCKET_ORDER.forEach((b) => map.set(b, []));
  tasks.forEach((t) => map.get(bucket(t))!.push(t));
  return BUCKET_ORDER.filter((b) => map.get(b)!.length > 0).map((b) => ({
    key: b,
    label: BUCKET_LABEL[b],
    items: map.get(b)!,
  }));
}

// Date chip: label + colour class
function dateChip(ts: number): { label: string; cls: string } {
  const tod = startOfDay();
  const d = new Date(ts);
  const timeStr = d.toLocaleTimeString("en", {
    hour: "numeric",
    minute: d.getMinutes() ? "2-digit" : undefined,
  });

  if (ts < tod) {
    const label = d.toLocaleDateString("en", { month: "short", day: "numeric" });
    return { label: `Overdue · ${label}`, cls: "text-red-400" };
  }
  if (ts < tod + DAY_MS) {
    return { label: `Today · ${timeStr}`, cls: "text-circuit-accent" };
  }
  if (ts < tod + 2 * DAY_MS) {
    return { label: `Tomorrow · ${timeStr}`, cls: "text-amber-400" };
  }
  const label = d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" });
  return { label, cls: "text-circuit-muted" };
}

// Priority dot from urgency
function priorityDot(urgency: number): { label: string; cls: string } | null {
  if (urgency >= 0.75) return { label: "P1", cls: "bg-red-500" };
  if (urgency >= 0.5)  return { label: "P2", cls: "bg-orange-400" };
  if (urgency >= 0.25) return { label: "P3", cls: "bg-sky-400" };
  return null;
}

function toInputValue(ts: number) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const { user, loading } = useCircuitAuth();
  const router = useRouter();
  const [mode, setMode] = useEnergyMode();
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [fetching, setFetching] = useState(false);
  const [filter, setFilter] = useState<Filter>("open");
  const [showNew, setShowNew] = useState(false);
  const [detailTask, setDetailTask] = useState<ApiTask | null>(null);
  const [reschedulingTask, setReschedulingTask] = useState<ApiTask | null>(null);
  const [completingIds, setCompletingIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    api.listTasks().then(setTasks).catch(() => {}).finally(() => setFetching(false));
  }, [user]);

  if (loading || !user) return null;

  const engineTasks = tasks.map(apiTaskToTask);
  const ctx = { mode, now: NOW_MS(), availableMinutes: 480, completedToday: 0 };
  const scored = scoreTasks(engineTasks, ctx);
  const rankMap = new Map(scored.map((s, i) => [s.task.id, { rank: i + 1, score: s.score, reasons: s.reasons }]));

  const filtered = tasks.filter((t) =>
    filter === "open" ? !t.completed : filter === "done" ? t.completed : true
  );
  const sorted = [...filtered].sort((a, b) => {
    if (filter !== "open") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    const ra = rankMap.get(String(a.id))?.rank ?? 999;
    const rb = rankMap.get(String(b.id))?.rank ?? 999;
    return ra - rb;
  });

  async function handleToggle(t: ApiTask) {
    if (t.completed) {
      const updated = await api.updateTask(t.id, { completed: false });
      setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      return;
    }
    // Animate out, then complete
    setCompletingIds((prev) => new Set([...prev, t.id]));
    await new Promise((r) => setTimeout(r, 360));
    const updated = await api.updateTask(t.id, { completed: true });
    setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    setCompletingIds((prev) => { const s = new Set(prev); s.delete(t.id); return s; });
  }

  async function deleteTask(id: number) {
    await api.deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function skipTask(task: ApiTask) {
    const now = NOW_MS();
    const { scheduledAt } = suggestSlot(task, tasks, now);
    const newPattern = updateDelayPattern(task, now);
    const [updated] = await Promise.all([
      api.updateTask(task.id, {
        scheduled_at: scheduledAt,
        skipped_count: (task.skipped_count ?? 0) + 1,
        last_skipped_at: now,
        ...(newPattern !== task.delay_pattern ? { delay_pattern: newPattern } : {}),
      }),
      api.logEvent(task.id, "skipped", { rescheduled_to: scheduledAt }).catch(() => {}),
    ]);
    setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function confirmReschedule(task: ApiTask, scheduledAt: number) {
    const now = NOW_MS();
    const newPattern = updateDelayPattern(task, now);
    const [updated] = await Promise.all([
      api.updateTask(task.id, {
        scheduled_at: scheduledAt,
        skipped_count: (task.skipped_count ?? 0) + 1,
        last_skipped_at: now,
        ...(newPattern !== task.delay_pattern ? { delay_pattern: newPattern } : {}),
      }),
      api.logEvent(task.id, "rescheduled", { scheduled_to: scheduledAt }).catch(() => {}),
    ]);
    setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    setReschedulingTask(null);
  }

  async function splitTask(task: ApiTask) {
    const [updated, child] = await Promise.all([
      api.updateTask(task.id, { text: `${task.text} (part 1)`, effort: "medium" }),
      api.createTask({ text: `${task.text} (part 2)`, tag: task.tag, effort: "medium", duration: Math.ceil((task.duration ?? 30) / 2), urgency: task.urgency, importance: task.importance, tiny_step: "" }),
    ]);
    api.logEvent(task.id, "split", { child_text: `${task.text} (part 2)` }).catch(() => {});
    setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)).concat(child));
  }

  const groups = filter === "open" ? groupTasks(sorted) : null;

  const sharedRowProps = (t: ApiTask) => ({
    task: t,
    rank: rankMap.get(String(t.id))?.rank,
    score: rankMap.get(String(t.id))?.score,
    completing: completingIds.has(t.id),
    onToggle: () => handleToggle(t),
    onDelete: () => deleteTask(t.id),
    onSkip: () => skipTask(t),
    onReschedule: () => setReschedulingTask(t),
    onDetail: () => setDetailTask(t),
    onSplit: () => splitTask(t),
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-medium text-circuit-text">Tasks</h1>
        <div className="flex items-center gap-3">
          <EnergyModeSwitcher mode={mode} onChange={setMode} />
          <button onClick={() => setShowNew((v) => !v)} className="btn-primary">
            {showNew ? "Cancel" : "+ New task"}
          </button>
        </div>
      </div>

      {showNew && (
        <NewTaskForm
          onCreated={(t) => { setTasks((prev) => [t, ...prev]); setShowNew(false); }}
        />
      )}

      {/* Filters */}
      <div className="flex gap-3 text-sm border-b border-circuit-border pb-3">
        {(["open", "done", "all"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`capitalize pb-0.5 ${
              filter === f
                ? "text-circuit-accent border-b-2 border-circuit-accent"
                : "text-circuit-muted hover:text-circuit-text"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {fetching && <p className="text-sm text-circuit-muted animate-pulse">Loading…</p>}
      {!fetching && sorted.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-circuit-muted text-sm">No tasks yet.</p>
          <p className="text-circuit-muted/60 text-xs mt-1">Hit "+ New task" or use the quick-add below.</p>
        </div>
      )}

      {/* Date-grouped list (open) */}
      {groups && groups.map((g) => (
        <section key={g.key} className="space-y-1">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs font-semibold uppercase tracking-wider ${g.key === "overdue" ? "text-red-400" : "text-circuit-muted"}`}>
              {g.label}
            </span>
            <span className="text-xs text-circuit-muted/60">{g.items.length}</span>
          </div>
          <ul className="space-y-1">
            {g.items.map((t) => (
              <TaskRow key={t.id} {...sharedRowProps(t)} />
            ))}
          </ul>
        </section>
      ))}

      {/* Flat list (done / all) */}
      {!groups && (
        <ul className="space-y-1">
          {sorted.map((t) => (
            <TaskRow key={t.id} {...sharedRowProps(t)} />
          ))}
        </ul>
      )}

      {/* Inline quick-add */}
      {filter === "open" && (
        <QuickAddRow
          onCreated={(t) => setTasks((prev) => [...prev, t])}
        />
      )}

      {/* Modals */}
      {reschedulingTask && (
        <RescheduleModal
          task={reschedulingTask}
          allTasks={tasks}
          onConfirm={(at) => confirmReschedule(reschedulingTask, at)}
          onClose={() => setReschedulingTask(null)}
        />
      )}
      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          mode={mode}
          onSave={(updated) => {
            setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
            setDetailTask(updated);
          }}
          onClose={() => setDetailTask(null)}
        />
      )}
    </div>
  );
}

// ── TaskRow ───────────────────────────────────────────────────────────────────

function TaskRow({
  task, rank, score, completing,
  onToggle, onDelete, onSkip, onReschedule, onDetail, onSplit,
}: {
  task: ApiTask; rank?: number; score?: number; completing: boolean;
  onToggle: () => void; onDelete: () => void;
  onSkip: () => Promise<void>; onReschedule: () => void;
  onDetail: () => void; onSplit: () => void;
}) {
  const [skipping, setSkipping] = useState(false);
  const dot = priorityDot(task.urgency);
  const chip = task.scheduled_at ? dateChip(task.scheduled_at) : null;
  const canSplit = (task.effort === "high" || (task.task_decomposition_potential ?? 0) >= 0.5) && !task.completed;

  return (
    <li className={`panel flex items-center gap-2 px-3 py-2.5 group ${completing ? "task-completing" : ""}`}>
      {/* Priority dot */}
      <div className="w-2 shrink-0 flex justify-center">
        {dot && !task.completed && (
          <span className={`w-2 h-2 rounded-full ${dot.cls}`} title={dot.label} />
        )}
      </div>

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={task.completed}
        onChange={onToggle}
        className="shrink-0 accent-circuit-accent cursor-pointer"
      />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className={`text-sm leading-snug ${task.completed ? "line-through text-circuit-muted" : "text-circuit-text"}`}>
          {!task.completed && rank && (
            <span className="text-xs font-semibold text-circuit-accent mr-1.5">#{rank}</span>
          )}
          {task.text}
          {task.recurrence && (
            <span className="ml-1.5 text-xs text-circuit-muted" title={`Repeats: ${task.recurrence}`}>↻</span>
          )}
        </p>
        {task.tiny_step && (
          <p className="text-xs text-circuit-muted mt-0.5 truncate">{task.tiny_step}</p>
        )}
        {/* Chips row */}
        <div className="flex flex-wrap items-center gap-2 mt-1">
          {chip && !task.completed && (
            <span className={`text-xs ${chip.cls}`}>{chip.label}</span>
          )}
          <span className="text-xs text-circuit-muted/70 capitalize">{task.tag}</span>
          {(task.skipped_count ?? 0) > 0 && (
            <span className="text-xs text-amber-400/80">skipped ×{task.skipped_count}</span>
          )}
        </div>
      </div>

      {/* Score */}
      {score !== undefined && !task.completed && (
        <span className="shrink-0 text-xs text-circuit-muted/60 tabular-nums">{Math.round(score)}</span>
      )}

      {/* Actions */}
      {!task.completed && (
        <div className="shrink-0 flex items-center gap-1.5 text-xs text-circuit-muted opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onDetail}    className="hover:text-circuit-accent transition-colors" title="Details">···</button>
          <button onClick={onReschedule} className="hover:text-circuit-accent transition-colors" title="Reschedule">↷</button>
          <button onClick={async () => { setSkipping(true); try { await onSkip(); } finally { setSkipping(false); } }}
            disabled={skipping} className="hover:text-circuit-text transition-colors">
            {skipping ? "…" : "skip"}
          </button>
          {canSplit && (
            <button onClick={onSplit} className="hover:text-circuit-text transition-colors" title="Split">⌥</button>
          )}
        </div>
      )}
      <button onClick={onDelete} className="shrink-0 text-xs text-circuit-muted/40 hover:text-red-400 transition-colors ml-1">✕</button>
    </li>
  );
}

// ── QuickAddRow ───────────────────────────────────────────────────────────────

function QuickAddRow({ onCreated }: { onCreated: (t: ApiTask) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const { parsed, preview } = value.trim() ? parseTaskText(value) : { parsed: { text: "" }, preview: {} };
  const hasPreview = Object.keys(preview).length > 0;

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  async function submit() {
    if (!parsed.text.trim()) return;
    setSubmitting(true);
    try {
      const created = await api.createTask({
        text: parsed.text,
        tag: parsed.tag ?? "general",
        urgency: parsed.urgency ?? 0.5,
        importance: 0.5,
        tiny_step: "",
        effort: "medium",
        ...(parsed.scheduledAt  ? { scheduled_at: parsed.scheduledAt } : {}),
        ...(parsed.duration     ? { duration: parsed.duration }         : {}),
      });
      onCreated(created);
      setValue("");
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full text-left px-3 py-2 text-sm text-circuit-muted/50 hover:text-circuit-muted border border-dashed border-circuit-border/50 hover:border-circuit-border rounded-xl transition-colors"
      >
        + Add task
      </button>
    );
  }

  return (
    <div className="panel px-3 py-2.5 space-y-2">
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          if (e.key === "Escape") { setOpen(false); setValue(""); }
        }}
        placeholder="Task title — try 'Team sync tomorrow 2pm #work p2 30m'"
        className="w-full bg-transparent text-sm text-circuit-text placeholder:text-circuit-muted/50 outline-none"
      />
      {hasPreview && (
        <div className="flex flex-wrap gap-2 text-xs">
          {preview.date     && <span className="text-circuit-accent bg-circuit-accent/10 px-2 py-0.5 rounded-full">📅 {preview.date}</span>}
          {preview.tag      && <span className="text-circuit-muted bg-circuit-border/40 px-2 py-0.5 rounded-full capitalize">🏷 {preview.tag}</span>}
          {preview.priority && <span className="text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-full">{preview.priority}</span>}
          {preview.duration && <span className="text-circuit-muted bg-circuit-border/40 px-2 py-0.5 rounded-full">⏱ {preview.duration}</span>}
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs text-circuit-muted/40">↵ add · esc cancel</p>
        <button onClick={submit} disabled={submitting || !parsed.text.trim()} className="btn-primary text-xs py-1 px-3">
          {submitting ? "…" : "Add"}
        </button>
      </div>
    </div>
  );
}

// ── RescheduleModal ───────────────────────────────────────────────────────────

function RescheduleModal({ task, allTasks, onConfirm, onClose }: {
  task: ApiTask; allTasks: ApiTask[];
  onConfirm: (scheduledAt: number) => void; onClose: () => void;
}) {
  const suggestion: SlotSuggestion = suggestSlot(task, allTasks);
  const [chosen, setChosen] = useState(suggestion.scheduledAt);
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-circuit-surface border border-circuit-border rounded-xl p-6 w-full max-w-sm space-y-5 mx-4">
        <div>
          <h2 className="font-semibold text-circuit-text">Reschedule</h2>
          <p className="mt-1 text-sm text-circuit-muted truncate">{task.text}</p>
        </div>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-circuit-muted">Suggested</p>
          <p className="text-circuit-accent font-medium text-sm">{formatSlot(suggestion.scheduledAt)}</p>
          <div className="flex flex-wrap gap-1">
            {suggestion.rationale.map((r) => (
              <span key={r} className="text-xs bg-circuit-bg px-2 py-0.5 rounded-full text-circuit-muted border border-circuit-border">{r}</span>
            ))}
          </div>
          <button onClick={() => setChosen(suggestion.scheduledAt)} className="text-xs text-circuit-accent hover:underline">Use suggestion</button>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-circuit-muted">Choose a time</label>
          <input type="datetime-local" value={toInputValue(chosen)}
            onChange={(e) => setChosen(new Date(e.target.value).getTime())}
            className="input-field" />
        </div>
        {task.scheduled_at && (
          <p className="text-xs text-circuit-muted">Currently: {formatSlot(task.scheduled_at)}</p>
        )}
        <div className="flex gap-3">
          <button onClick={async () => { setSaving(true); try { await onConfirm(chosen); } finally { setSaving(false); } }}
            disabled={saving} className="btn-primary flex-1">
            {saving ? "Saving…" : "Confirm"}
          </button>
          <button onClick={onClose} className="flex-1 text-sm text-circuit-muted hover:text-circuit-text transition-colors">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── NewTaskForm ───────────────────────────────────────────────────────────────

function NewTaskForm({ onCreated }: { onCreated: (t: ApiTask) => void }) {
  const [text, setText]           = useState("");
  const [tinyStep, setTinyStep]   = useState("");
  const [tag, setTag]             = useState<string>("general");
  const [effort, setEffort]       = useState<string>("medium");
  const [urgency, setUrgency]     = useState(0.5);
  const [importance, setImportance] = useState(0.5);
  const [duration, setDuration]   = useState<number>(30);
  const [scheduledAt, setScheduledAt] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createTask({
        text: text.trim(),
        tiny_step: tinyStep.trim(),
        tag, effort, urgency, importance, duration,
        ...(scheduledAt ? { scheduled_at: new Date(scheduledAt).getTime() } : {}),
        ...(recurrence  ? { recurrence } : {}),
      });
      onCreated(created);
      setText(""); setTinyStep(""); setScheduledAt(""); setRecurrence("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  }

  const dot = priorityDot(urgency);

  return (
    <form onSubmit={handleSubmit} className="panel space-y-3 p-4">
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Task description" required className="input-field" />
      <input value={tinyStep} onChange={(e) => setTinyStep(e.target.value)} placeholder="Tiny first step (optional)" className="input-field" />

      <div className="flex flex-wrap gap-2">
        <select value={tag} onChange={(e) => setTag(e.target.value)} className="input-field w-auto">
          {TAG_OPTIONS.map((o) => <option key={o} value={o} className="bg-circuit-bg capitalize">{o}</option>)}
        </select>
        <select value={effort} onChange={(e) => setEffort(e.target.value)} className="input-field w-auto">
          {EFFORT_OPTIONS.map((o) => <option key={o} value={o} className="bg-circuit-bg capitalize">{o}</option>)}
        </select>
        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="input-field w-auto">
          {DURATION_OPTIONS.map((m) => <option key={m} value={m} className="bg-circuit-bg">{m >= 60 ? `${m / 60}h` : `${m}m`}</option>)}
        </select>
        <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} className="input-field w-auto">
          {RECUR_OPTIONS.map((o) => <option key={o.value} value={o.value} className="bg-circuit-bg">{o.label}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1">
          <span className="text-xs text-circuit-muted flex items-center gap-1.5">
            Priority
            {dot && <span className={`w-2 h-2 rounded-full inline-block ${dot.cls}`} />}
            <span className="ml-auto">{dot?.label ?? "P4"}</span>
          </span>
          <input type="range" min={0} max={1} step={0.05} value={urgency}
            onChange={(e) => setUrgency(Number(e.target.value))}
            className="w-full accent-circuit-accent" />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-circuit-muted flex justify-between">
            Importance <span>{Math.round(importance * 100)}%</span>
          </span>
          <input type="range" min={0} max={1} step={0.05} value={importance}
            onChange={(e) => setImportance(Number(e.target.value))}
            className="w-full accent-circuit-accent" />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs text-circuit-muted">Schedule for (optional)</span>
        <input type="datetime-local" value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="input-field" />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}
      <button type="submit" disabled={submitting} className="btn-primary">
        {submitting ? "Adding…" : "Add task"}
      </button>
    </form>
  );
}
