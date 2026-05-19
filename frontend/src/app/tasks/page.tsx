"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@shared/cortex";
import { api, ApiTask } from "@/lib/api";

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
            onToggle={() => toggleComplete(t)}
            onDelete={() => deleteTask(t.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function TaskRow({
  task,
  onToggle,
  onDelete,
}: {
  task: ApiTask;
  onToggle: () => void;
  onDelete: () => void;
}) {
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
        </div>
      </div>
      <button
        onClick={onDelete}
        className="text-xs text-circuit-muted hover:text-red-400"
      >
        ✕
      </button>
    </li>
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
