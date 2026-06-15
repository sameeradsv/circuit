"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiTask, ApiBlackout } from "@/lib/api";
import { useCircuitAuth } from "@/lib/use-circuit-auth";
import { useEnergyLevel } from "@/lib/use-energy-level";
import { parseTaskText } from "@/lib/parse-task";
import { TaskDetailModal } from "@/components/TaskDetailModal";
import { useEnergyMode } from "@/lib/use-energy-mode";
import { apiTaskToTask } from "@/lib/engine-adapter";
import { scoreTasks } from "@/engines/src/scheduling-engine/scoring";
import { useVoiceInput } from "@/lib/use-voice-input";
import { suggestSlot, updateDelayPattern, formatSlot, SlotSuggestion } from "@/lib/suggest-slot";

// ── Helpers ───────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dueInDays(task: ApiTask): number {
  if (!task.scheduled_at) return 14;
  return Math.round((task.scheduled_at - Date.now()) / DAY_MS);
}

function fmtDue(task: ApiTask): string {
  const d = dueInDays(task);
  if (d < 0)   return `${Math.abs(d)}d overdue`;
  if (d === 0)  return "today";
  if (d === 1)  return "tomorrow";
  if (d < 7)    return `${d}d`;
  if (!task.scheduled_at) return "no date";
  return new Date(task.scheduled_at).toLocaleDateString("en-IN", { month: "short", day: "numeric", timeZone: "Asia/Kolkata" });
}

function fmtTime(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function effortToEnergyReq(effort: string | null | undefined): number {
  if (effort === "high") return 8;
  if (effort === "low")  return 2;
  return 5;
}

function taskTypeMeta(task: ApiTask): { label: string; color: string; cls: string } {
  const tag    = task.tag    ?? "general";
  const effort = task.effort ?? "medium";
  if (tag === "work" && effort === "high") return { label: "Creative",  color: "var(--terra)",   cls: "creative" };
  if (tag === "work")                      return { label: "Deep work", color: "var(--sage)",    cls: "deep"     };
  if (tag === "social")                    return { label: "Comms",     color: "var(--mustard)", cls: "comms"    };
  if (effort === "low")                    return { label: "Admin",     color: "var(--ink-3)",   cls: "admin"    };
  return                                          { label: "Task",      color: "var(--sage)",    cls: "deep"     };
}

const TYPE_FILTERS = [
  { value: "all",      label: "All",      color: null },
  { value: "creative", label: "Creative", color: "var(--terra)"   },
  { value: "deep",     label: "Deep",     color: "var(--sage)"    },
  { value: "comms",    label: "Comms",    color: "var(--mustard)" },
  { value: "admin",    label: "Admin",    color: "var(--ink-3)"   },
  { value: "errand",   label: "Errand",   color: "var(--rose)"    },
];

interface ScoredTask extends ApiTask {
  score: number;
  reason: string;
}

function scoreForRank(task: ApiTask, energy: number, timeAvail: number): { score: number; reason: string } {
  const dueIn      = dueInDays(task);
  const energyReq  = effortToEnergyReq(task.effort);
  const urgency    = dueIn <= 0 ? 1 : Math.max(0, 1 - dueIn / 7);
  const energyMatch= 1 - Math.min(1, Math.abs(energyReq - energy) / 5);
  const timeFit    = timeAvail >= (task.duration ?? 30) ? 1 : Math.max(0, timeAvail / (task.duration ?? 30));
  const segs = [
    { k: "urgency", v: urgency * 30,      max: 30 },
    { k: "energy",  v: energyMatch * 28,  max: 28 },
    { k: "time",    v: timeFit * 18,      max: 18 },
  ];
  const score = segs.reduce((a, s) => a + s.v, 0);
  const top = [...segs].sort((a, b) => b.v / b.max - a.v / a.max)[0];
  const reasons: Record<string, string> = {
    urgency: dueIn < 0 ? "overdue" : dueIn === 0 ? "due today" : `due in ${dueIn}d`,
    energy:  `matches your energy (${energyReq}/10)`,
    time:    `fits your ${fmtTime(timeAvail)} window`,
  };
  return { score, reason: reasons[top.k] ?? "" };
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
  const [mode, setMode]   = useEnergyMode();
  const [energy]          = useEnergyLevel();
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [fetching, setFetching] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [detailTask, setDetailTask] = useState<ApiTask | null>(null);
  const [reschedulingTask, setReschedulingTask] = useState<ApiTask | null>(null);
  const [completingIds, setCompletingIds] = useState<Set<number>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [activeBlackouts, setActiveBlackouts] = useState<ApiBlackout[]>([]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    const nowMs = Date.now();
    Promise.all([
      api.listTasks(),
      api.listBlackouts(),
    ]).then(([taskList, blackouts]) => {
      setTasks(taskList);
      setActiveBlackouts(blackouts.filter(b => b.start_date_ms <= nowMs && nowMs <= b.end_date_ms));
    }).catch(() => {}).finally(() => setFetching(false));
  }, [user]);

  if (loading || !user) return null;

  const activeTypes = new Set(activeBlackouts.map(b => b.blackout_type));

  function isBlackedOut(task: ApiTask): boolean {
    const flags = task.blackout_skip_flags ?? [];
    if (flags.some(f => activeTypes.has(f))) return true;
    if (activeTypes.has("leave") && task.tag === "work") return true;
    return false;
  }

  const timeAvail = 120;
  const open = tasks.filter((t) => !t.completed);
  const done = tasks.filter((t) => t.completed);

  // Score and rank open tasks — blacked-out tasks are separated into "On hold"
  const onHold = open.filter(isBlackedOut);
  const active = open.filter((t) => !isBlackedOut(t));

  const ranked = [...active]
    .map((t) => { const { score, reason } = scoreForRank(t, energy, timeAvail); return { ...t, score, reason }; })
    .sort((a, b) => b.score - a.score);

  // Apply type filter
  const filtered = typeFilter === "all"
    ? ranked
    : ranked.filter((t) => taskTypeMeta(t).cls === typeFilter);

  // Tasks with a specific future time > 2h away should never appear in "Right now"
  // or "Soon" regardless of score — surface them in "Later" sorted by time.
  const nowMs = Date.now();
  const NEAR_MS = 2 * 60 * 60 * 1000; // 2 hours
  const flexible       = filtered.filter((t) => !t.scheduled_at || t.scheduled_at <= nowMs + NEAR_MS);
  const futureScheduled = filtered
    .filter((t) => t.scheduled_at && t.scheduled_at > nowMs + NEAR_MS)
    .sort((a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0));

  const nowGroup   = flexible.slice(0, 2);
  const soonGroup  = flexible.slice(2, 6);
  const laterGroup = [...flexible.slice(6), ...futureScheduled];

  async function handleToggle(t: ApiTask) {
    if (t.completed) {
      const updated = await api.updateTask(t.id, { completed: false });
      setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
      return;
    }
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

  async function deleteSeriesTasks(id: number, fromScheduledAt?: number) {
    await api.deleteSeries(id, fromScheduledAt);
    // Re-fetch rather than filter since we don't know all sibling ids client-side
    const updated = await api.listTasks();
    setTasks(updated);
  }

  async function skipTask(task: ApiTask) {
    const now = Date.now();
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
    const now = Date.now();
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

  return (
    <div className="col gap-5 page-cap">
      {/* Header */}
      <header className="between" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>All tasks · ranked for you</div>
          <h1 className="display" style={{ fontSize: 36, margin: 0 }}>
            {ranked.length} things{" "}
            <span className="serif" style={{ color: "var(--ink-3)", fontSize: 28 }}>
              sorted by what fits <em>right now</em>
            </span>
          </h1>
        </div>
        <div className="row gap-2 aic">
          <button className="btn" style={{ fontSize: 13 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M7 12h10M11 18h2"/></svg>
            Filter
          </button>
          <button className="btn" style={{ fontSize: 13 }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            Re-rank
          </button>
          <QuickAddRow onCreated={(t) => setTasks((prev) => [t, ...prev])} />
        </div>
      </header>

      {/* Type filter pills */}
      <div className="row gap-2 wrap">
        {TYPE_FILTERS.map((f) => {
          const count = f.value === "all" ? ranked.length : active.filter((t) => taskTypeMeta(t).cls === f.value).length;
          return (
            <button
              key={f.value}
              className="pill"
              onClick={() => setTypeFilter(f.value)}
              style={{
                background:  typeFilter === f.value ? "var(--ink)"   : "transparent",
                color:       typeFilter === f.value ? "var(--paper)" : "var(--ink)",
                borderColor: typeFilter === f.value ? "var(--ink)"   : "var(--line)",
              }}
            >
              {f.color && <span className="dot" style={{ background: f.color }} />}
              {f.label} ({count})
            </button>
          );
        })}
      </div>

      {activeBlackouts.length > 0 && (
        <div style={{ padding: "8px 14px", background: "var(--paper-2)", borderRadius: 6, fontSize: 13, color: "var(--ink-2)", border: "1px solid var(--line)" }}>
          {activeBlackouts.map(b => {
            const label = b.blackout_type === "leave" ? "On leave"
              : b.blackout_type === "period" ? "On period"
              : b.blackout_type === "sickness" ? "Sick"
              : "Travelling";
            const until = new Date(b.end_date_ms).toLocaleDateString("en-IN", { month: "short", day: "numeric", timeZone: "Asia/Kolkata" });
            return <span key={b.id} style={{ marginRight: 12 }}>{label} until {until}</span>;
          })}
          {onHold.length > 0 && (
            <span style={{ color: "var(--ink-3)" }}>· {onHold.length} task{onHold.length !== 1 ? "s" : ""} on hold</span>
          )}
        </div>
      )}

      {fetching && (
        <p className="serif" style={{ color: "var(--ink-3)", fontSize: 15 }}>Loading…</p>
      )}

      {/* Right now */}
      {nowGroup.length > 0 && (
        <TaskGroup
          title="Right now"
          subtitle={`with your energy at ${energy} and ${fmtTime(timeAvail)} free`}
          tone="terra"
        >
          {nowGroup.map((t, i) => (
            <TaskRow
              key={t.id}
              task={t}
              rank={i + 1}
              isNow
              completing={completingIds.has(t.id)}
              blackedOut={false}
              onToggle={() => handleToggle(t)}
              onDelete={() => deleteTask(t.id)}
              onDeleteSeries={() => deleteSeriesTasks(t.id)}
              onSkip={() => skipTask(t)}
              onReschedule={() => setReschedulingTask(t)}
              onDetail={() => setDetailTask(t)}
              onSplit={() => splitTask(t)}
            />
          ))}
        </TaskGroup>
      )}

      {/* Soon */}
      {soonGroup.length > 0 && (
        <TaskGroup
          title="Soon"
          subtitle="when your state shifts a little"
          tone="sage"
        >
          {soonGroup.map((t, i) => (
            <TaskRow
              key={t.id}
              task={t}
              rank={i + 1 + nowGroup.length}
              completing={completingIds.has(t.id)}
              blackedOut={false}
              onToggle={() => handleToggle(t)}
              onDelete={() => deleteTask(t.id)}
              onDeleteSeries={() => deleteSeriesTasks(t.id)}
              onSkip={() => skipTask(t)}
              onReschedule={() => setReschedulingTask(t)}
              onDetail={() => setDetailTask(t)}
              onSplit={() => splitTask(t)}
            />
          ))}
        </TaskGroup>
      )}

      {/* Later */}
      {laterGroup.length > 0 && (
        <TaskGroup
          title="Later"
          subtitle="parked until conditions match"
          tone="muted"
        >
          {laterGroup.map((t, i) => (
            <TaskRow
              key={t.id}
              task={t}
              rank={i + 1 + nowGroup.length + soonGroup.length}
              completing={completingIds.has(t.id)}
              blackedOut={false}
              onToggle={() => handleToggle(t)}
              onDelete={() => deleteTask(t.id)}
              onDeleteSeries={() => deleteSeriesTasks(t.id)}
              onSkip={() => skipTask(t)}
              onReschedule={() => setReschedulingTask(t)}
              onDetail={() => setDetailTask(t)}
              onSplit={() => splitTask(t)}
            />
          ))}
        </TaskGroup>
      )}

      {/* On hold — tasks skipped due to active blackouts */}
      {onHold.length > 0 && <OnHoldSection tasks={onHold} onDetail={setDetailTask} />}

      {!fetching && ranked.length === 0 && (
        <div className="card col" style={{ padding: 40, alignItems: "center", gap: 12, textAlign: "center" }}>
          <p className="display" style={{ fontSize: 20, margin: 0 }}>Nothing here yet.</p>
          <p className="serif" style={{ color: "var(--ink-3)", fontSize: 15 }}>
            Capture a task and it'll surface here ranked for your state.
          </p>
        </div>
      )}

      {/* Completed section toggle */}
      {done.length > 0 && (
        <div>
          <button
            className="btn"
            onClick={() => setShowDone((v) => !v)}
            style={{ fontSize: 13 }}
          >
            {showDone ? "Hide" : "Show"} {done.length} completed
          </button>
          {showDone && (
            <div className="card" style={{ padding: 6, marginTop: 10 }}>
              {done.map((t) => (
                <DoneRow key={t.id} task={t} onToggle={() => handleToggle(t)} onDelete={() => deleteTask(t.id)} />
              ))}
            </div>
          )}
        </div>
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
          onDeleteSeries={async (fromScheduledAt) => {
            await deleteSeriesTasks(detailTask.id, fromScheduledAt);
            setDetailTask(null);
          }}
          onClose={() => setDetailTask(null)}
        />
      )}
    </div>
  );
}

// ── OnHoldSection ─────────────────────────────────────────────────────────────

function OnHoldSection({ tasks, onDetail }: { tasks: ApiTask[]; onDetail: (t: ApiTask) => void }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section>
      <button
        className="row aic gap-2"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}
        onClick={() => setExpanded((v) => !v)}
      >
        <h3 className="display" style={{ margin: 0, fontSize: 22, color: "var(--ink-3)" }}>On hold</h3>
        <span className="serif" style={{ color: "var(--ink-3)", fontSize: 14 }}>
          {tasks.length} task{tasks.length !== 1 ? "s" : ""} skipped during blackout
        </span>
        <span style={{ color: "var(--ink-3)", fontSize: 13 }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="card" style={{ padding: 6 }}>
          {tasks.map((t) => (
            <div key={t.id} className="task" style={{ opacity: 0.5, cursor: "default" }}>
              <div className="rank" style={{ fontSize: 12 }}>–</div>
              <div>
                <div className="row aic gap-2">
                  <span className={`type-dot type-${taskTypeMeta(t).cls}`} />
                  <span className="title" style={{ cursor: "pointer" }} onClick={() => onDetail(t)}>{t.text}</span>
                  {t.recurrence && (
                    <span style={{ fontSize: 11, color: "var(--ink-3)" }} title={`Repeats: ${t.recurrence}`}>↻</span>
                  )}
                </div>
                <div className="meta">
                  <span><b>{fmtDue(t)}</b></span>
                  <span>· {fmtTime(t.duration ?? 30)}</span>
                  <span style={{ color: "var(--ink-3)" }}>· on hold</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── TaskGroup ─────────────────────────────────────────────────────────────────

function TaskGroup({
  title,
  subtitle,
  tone,
  children,
}: {
  title: string;
  subtitle: string;
  tone: "terra" | "sage" | "muted";
  children: React.ReactNode;
}) {
  const color =
    tone === "terra" ? "var(--terra)"
    : tone === "sage" ? "var(--sage)"
    : "var(--ink-3)";

  return (
    <section>
      <div className="row aib gap-3" style={{ marginBottom: 10 }}>
        <h3 className="display" style={{ margin: 0, fontSize: 22, color }}>
          {title}
        </h3>
        <span className="serif" style={{ color: "var(--ink-3)", fontSize: 14 }}>
          {subtitle}
        </span>
      </div>
      <div className="card" style={{ padding: 6 }}>{children}</div>
    </section>
  );
}

// ── TaskRow ───────────────────────────────────────────────────────────────────

function TaskRow({
  task, rank, isNow = false, completing, blackedOut = false,
  onToggle, onDelete, onDeleteSeries, onSkip, onReschedule, onDetail, onSplit,
}: {
  task: ApiTask & { score?: number; reason?: string };
  rank: number;
  isNow?: boolean;
  completing: boolean;
  blackedOut?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onDeleteSeries: () => void;
  onSkip: () => Promise<void>;
  onReschedule: () => void;
  onDetail: () => void;
  onSplit: () => void;
}) {
  const [skipping, setSkipping] = useState(false);
  const type = taskTypeMeta(task);
  const canSplit = (task.effort === "high" || (task.task_decomposition_potential ?? 0) >= 0.5);
  const isSeries = /^ics:.+:\d{10,}$/.test(task.client_id ?? "");

  return (
    <div
      className={`task${isNow ? " is-now" : ""} ${completing ? "task-completing" : ""}`}
      style={{ cursor: "default", opacity: blackedOut ? 0.35 : undefined }}
      title={blackedOut ? "Skipped during active blackout" : undefined}
    >
      <div className="rank">{String(rank).padStart(2, "0")}</div>

      <div>
        <div className="row aic gap-2">
          <span className={`type-dot type-${type.cls}`} />
          <span className="title" style={{ cursor: "pointer" }} onClick={onDetail}>
            {task.text}
          </span>
          {task.recurrence && (
            <span style={{ fontSize: 11, color: "var(--ink-3)" }} title={`Repeats: ${task.recurrence}`}>↻</span>
          )}
        </div>
        <div className="meta">
          <span><b>{fmtDue(task)}</b></span>
          <span>· {fmtTime(task.duration ?? 30)}</span>
          {task.reason && <span style={{ color: "var(--terra)" }}>· {task.reason}</span>}
          {task.skipped_count > 0 && <span>· skipped ×{task.skipped_count}</span>}
          {task.tiny_step && (
            <span style={{ color: "var(--ink-2)" }}>· {task.tiny_step}</span>
          )}
        </div>
      </div>

      <div className="row gap-2 aic">
        <div className="row gap-1 aic" style={{ opacity: 0 }} onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")} onMouseLeave={(e) => (e.currentTarget.style.opacity = "0")}>
          <button
            onClick={onDetail}
            style={{ fontSize: 13, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
            title="Details"
          >···</button>
          <button
            onClick={onReschedule}
            style={{ fontSize: 13, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
            title="Reschedule"
          >↷</button>
          <button
            onClick={async () => { setSkipping(true); try { await onSkip(); } finally { setSkipping(false); } }}
            disabled={skipping}
            style={{ fontSize: 12, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
          >
            {skipping ? "…" : "skip"}
          </button>
          {canSplit && (
            <button
              onClick={onSplit}
              style={{ fontSize: 12, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
              title="Split"
            >⌥</button>
          )}
          {isSeries && (
            <button
              onClick={onDeleteSeries}
              style={{ fontSize: 11, color: "var(--terra)", background: "none", border: "none", cursor: "pointer", padding: "2px 4px" }}
              title="Delete all occurrences in this series"
            >del series</button>
          )}
        </div>
        <button
          onClick={onToggle}
          className="btn-icon"
          title="Complete"
          style={{ width: 28, height: 28 }}
        >
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          style={{ fontSize: 12, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer", opacity: 0.5 }}
          title="Delete"
        >✕</button>
      </div>
    </div>
  );
}

// ── DoneRow ───────────────────────────────────────────────────────────────────

function DoneRow({ task, onToggle, onDelete }: { task: ApiTask; onToggle: () => void; onDelete: () => void; }) {
  return (
    <div className="task" style={{ opacity: 0.5 }}>
      <div className="rank" style={{ fontSize: 14 }}>✓</div>
      <div>
        <span className="title" style={{ textDecoration: "line-through", fontSize: 14 }}>{task.text}</span>
      </div>
      <div className="row gap-2 aic">
        <button onClick={onToggle} style={{ fontSize: 11, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer" }}>undo</button>
        <button onClick={onDelete} style={{ fontSize: 11, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer" }}>✕</button>
      </div>
    </div>
  );
}

// ── QuickAddRow ───────────────────────────────────────────────────────────────

function QuickAddRow({ onCreated }: { onCreated: (t: ApiTask) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const voice = useVoiceInput();
  const { parsed, preview } = value.trim() ? parseTaskText(value) : { parsed: { text: "" }, preview: {} };
  const hasPreview = Object.keys(preview).length > 0;

  useEffect(() => { if (open) ref.current?.focus(); }, [open]);

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
        ...(parsed.scheduledAt ? { scheduled_at: parsed.scheduledAt } : {}),
        ...(parsed.duration    ? { duration: parsed.duration }         : {}),
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
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        + New task
      </button>
    );
  }

  return (
    <div className="card" style={{ padding: "12px 16px", minWidth: 300 }}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void submit(); }
          if (e.key === "Escape") { setOpen(false); setValue(""); }
        }}
        placeholder="Task — try 'sync tomorrow 2pm #work 30m'"
        style={{
          width: "100%", border: "none", background: "transparent",
          fontSize: 14, color: "var(--ink)", outline: "none",
          fontFamily: "var(--font-body)",
        }}
      />
      {hasPreview && (
        <div className="row gap-2 wrap" style={{ marginTop: 8 }}>
          {(preview as Record<string,string>).date     && <span className="parse-chip"><span className="k">date</span>{(preview as Record<string,string>).date}</span>}
          {(preview as Record<string,string>).tag      && <span className="parse-chip"><span className="k">tag</span>{(preview as Record<string,string>).tag}</span>}
          {(preview as Record<string,string>).priority && <span className="parse-chip"><span className="k">p</span>{(preview as Record<string,string>).priority}</span>}
          {(preview as Record<string,string>).duration && <span className="parse-chip"><span className="k">time</span>{(preview as Record<string,string>).duration}</span>}
        </div>
      )}
      <div className="between" style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid var(--line)" }}>
        <div className="row gap-2 aic">
          <span className="tiny muted">↵ add · esc cancel</span>
          {voice.listening && <span className="mono" style={{ fontSize: 10, color: "var(--terra)" }}>listening…</span>}
          {voice.error && <span className="mono" style={{ fontSize: 10, color: "var(--terra)" }}>{voice.error}</span>}
        </div>
        <div className="row gap-2 aic">
          {voice.supported && (
            <button
              type="button"
              onClick={() => voice.listening ? voice.stop() : voice.start((t) => { setValue(t); ref.current?.focus(); })}
              title={voice.listening ? "Stop" : "Voice input"}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", color: voice.listening ? "var(--terra)" : "var(--ink-3)" }}
            >
              {voice.listening
                ? <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                : <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              }
            </button>
          )}
          <button
            onClick={submit}
            disabled={submitting || !parsed.text.trim()}
            className="btn btn-primary"
            style={{ padding: "6px 14px", fontSize: 13 }}
          >
            {submitting ? "…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── RescheduleModal ───────────────────────────────────────────────────────────

function RescheduleModal({
  task, allTasks, onConfirm, onClose,
}: {
  task: ApiTask; allTasks: ApiTask[];
  onConfirm: (scheduledAt: number) => void; onClose: () => void;
}) {
  const suggestion: SlotSuggestion = suggestSlot(task, allTasks);
  const [chosen, setChosen] = useState(suggestion.scheduledAt);
  const [saving, setSaving] = useState(false);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card col gap-5" style={{ maxWidth: 380, width: "100%", margin: "0 16px" }}>
        <div>
          <h2 className="display" style={{ fontSize: 22, margin: "0 0 6px" }}>Reschedule</h2>
          <p style={{ fontSize: 14, color: "var(--ink-2)", margin: 0 }}>{task.text}</p>
        </div>
        <div className="col gap-2">
          <div className="label">Suggested</div>
          <p style={{ color: "var(--terra)", fontWeight: 500, margin: 0 }}>{formatSlot(suggestion.scheduledAt)}</p>
          <div className="row gap-1 wrap">
            {suggestion.rationale.map((r) => (
              <span key={r} className="parse-chip">{r}</span>
            ))}
          </div>
          <button onClick={() => setChosen(suggestion.scheduledAt)} style={{ fontSize: 12, color: "var(--terra)", background: "none", border: "none", cursor: "pointer", alignSelf: "flex-start", padding: 0 }}>
            Use suggestion
          </button>
        </div>
        <div className="col gap-2">
          <label className="label">Choose a time</label>
          <input
            type="datetime-local"
            value={toInputValue(chosen)}
            onChange={(e) => setChosen(new Date(e.target.value).getTime())}
            className="input-base"
          />
        </div>
        <div className="row gap-3">
          <button
            onClick={async () => { setSaving(true); try { await onConfirm(chosen); } finally { setSaving(false); } }}
            disabled={saving}
            className="btn btn-primary"
            style={{ flex: 1 }}
          >
            {saving ? "Saving…" : "Confirm"}
          </button>
          <button onClick={onClose} className="btn" style={{ flex: 1 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
