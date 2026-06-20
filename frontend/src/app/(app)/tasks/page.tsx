"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiTask, ApiBlackout } from "@/lib/api";
import { getTaskCache, updateTaskInCache, invalidateTaskCache } from "@/lib/task-cache";
import { useAuth } from "@shared/cortex";
import { useEffectiveEnergy } from "@/lib/use-effective-energy";
import { parseUtterance, taskInputFromUtterance } from "@/lib/parse-utterance";
import { TaskDetailModal } from "@/components/TaskDetailModal";
import { EnergyModeSwitcher } from "@/components/EnergyModeSwitcher";
import { SwipeTaskRow } from "@/components/SwipeTaskRow";
import { useEnergyMode } from "@/lib/use-energy-mode";
import { rankApiTasks } from "@/lib/task-ranking";
import { useVoiceInput } from "@/lib/use-voice-input";
import { suggestSlot, updateDelayPattern, formatSlot, SlotSuggestion } from "@/lib/suggest-slot";
import { BLACKOUT_LABELS } from "@/lib/blackout-utils";

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

function taskTypeMeta(task: ApiTask): { label: string; color: string; cls: string } {
  const tag    = task.tag    ?? "general";
  const effort = task.effort ?? "medium";
  if (tag === "errand" || tag === "shopping" || tag === "travel")
    return { label: "Errand", color: "var(--rose)", cls: "errand" };
  if (tag === "general" && task.location_dependency)
    return { label: "Errand", color: "var(--rose)", cls: "errand" };
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

const DONE_PAGE_SIZE = 20;

function toInputValue(ts: number) {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [mode, setMode]   = useEnergyMode();
  const { value: energy, userState } = useEffectiveEnergy();
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [fetching, setFetching] = useState(false);
  const [doneTasks, setDoneTasks] = useState<ApiTask[]>([]);
  const [doneTotal, setDoneTotal] = useState(0);
  const [donePage, setDonePage] = useState(0);
  const [doneLoading, setDoneLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [detailTask, setDetailTask] = useState<ApiTask | null>(null);
  const [reschedulingTask, setReschedulingTask] = useState<ApiTask | null>(null);
  const [completingTask, setCompletingTask] = useState<ApiTask | null>(null);
  const [completingIds, setCompletingIds] = useState<Set<ApiTask["id"]>>(new Set());
  const [showDone, setShowDone] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [textFilter, setTextFilter] = useState("");
  const [searchIds, setSearchIds] = useState<Set<ApiTask["id"]> | null>(null);
  const [activeBlackouts, setActiveBlackouts] = useState<ApiBlackout[]>([]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  async function loadDonePage(page = 0) {
    setDoneLoading(true);
    try {
      const res = await api.listTasksPage({ completed: true, page: page + 1, limit: DONE_PAGE_SIZE });
      setDoneTasks(res.items);
      setDoneTotal(res.total);
      setDonePage(page);
    } catch {
      /* ignore */
    } finally {
      setDoneLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    const cached = getTaskCache();
    const nowMs = Date.now();
    if (cached) {
      setTasks(cached.filter((t) => !t.completed));
      api.listTasksPage({ completed: true, page: 1, limit: 1 })
        .then((res) => setDoneTotal(res.total))
        .catch(() => {});
      api.listBlackouts().then((blackouts) => {
        setActiveBlackouts(blackouts.filter(b => b.start_date_ms <= nowMs && nowMs <= b.end_date_ms));
      }).catch(() => {});
      return;
    }
    setFetching(true);
    Promise.all([
      api.listTasks({ completed: false }),
      api.listTasksPage({ completed: true, page: 1, limit: 1 }),
      api.listBlackouts(),
    ]).then(([openList, doneMeta, blackouts]) => {
      setTasks(openList);
      setDoneTotal(doneMeta.total);
      setActiveBlackouts(blackouts.filter(b => b.start_date_ms <= nowMs && nowMs <= b.end_date_ms));
    }).catch(() => {}).finally(() => setFetching(false));
  }, [user]);

  useEffect(() => {
    if (!user || !showDone) return;
    loadDonePage(donePage);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, showDone, donePage]);

  useEffect(() => {
    const q = textFilter.trim();
    if (!q) {
      setSearchIds(null);
      return;
    }
    const handle = window.setTimeout(() => {
      api.search(q)
        .then((res) => setSearchIds(new Set(res.tasks.map((t) => t.id))))
        .catch(() => setSearchIds(null));
    }, 300);
    return () => window.clearTimeout(handle);
  }, [textFilter]);

  if (loading || !user) return null;

  const activeTypes = new Set(activeBlackouts.map(b => b.blackout_type));

  function isBlackedOut(task: ApiTask): boolean {
    const flags = task.blackout_skip_flags ?? [];
    return flags.some(f => activeTypes.has(f));
  }

  const timeAvail = userState?.time_available_minutes ?? 480;
  const open = tasks;

  // Score and rank open tasks — blacked-out and import-review tasks are separated
  const needsImportReview = open.filter((t) => t.import_review_pending);
  const onHold = open.filter(isBlackedOut);
  const active = open.filter((t) => !isBlackedOut(t) && !t.import_review_pending);

  const ranked = rankApiTasks(active, { mode, availableMinutes: timeAvail });

  // Apply type + text filters
  const lowerText = textFilter.toLowerCase();
  const filtered = ranked
    .filter((t) => typeFilter === "all" || taskTypeMeta(t).cls === typeFilter)
    .filter((t) => {
      if (!lowerText) return true;
      if (searchIds) return searchIds.has(t.id);
      return t.text.toLowerCase().includes(lowerText) || (t.tiny_step ?? "").toLowerCase().includes(lowerText);
    });

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

  async function handleToggle(t: ApiTask, completedAt?: number) {
    if (t.completed) {
      const updated = await api.updateTask(t.id, { completed: false });
      updateTaskInCache(updated);
      setTasks((prev) => [updated, ...prev.filter((x) => x.id !== updated.id)]);
      setDoneTasks((prev) => prev.filter((x) => x.id !== updated.id));
      setDoneTotal((n) => Math.max(0, n - 1));
      return;
    }
    setCompletingIds((prev) => new Set([...prev, t.id]));
    await new Promise((r) => setTimeout(r, 360));
    const updated = await api.updateTask(t.id, {
      completed: true,
      ...(completedAt != null ? { completion_occurred_at: completedAt } : {}),
    });
    updateTaskInCache(updated);
    setTasks((prev) => prev.filter((x) => x.id !== updated.id));
    setDoneTotal((n) => n + 1);
    if (showDone) {
      if (donePage === 0) {
        setDoneTasks((prev) => [updated, ...prev].slice(0, DONE_PAGE_SIZE));
      } else {
        await loadDonePage(donePage);
      }
    }
    setCompletingIds((prev) => { const s = new Set(prev); s.delete(t.id); return s; });
    setCompletingTask(null);
  }

  async function deleteTask(id: ApiTask["id"], fromDone = false) {
    if (typeof id !== "number") return;
    await api.deleteTask(id);
    invalidateTaskCache();
    setTasks((prev) => prev.filter((t) => t.id !== id));
    if (fromDone) {
      setDoneTasks((prev) => prev.filter((t) => t.id !== id));
      setDoneTotal((n) => Math.max(0, n - 1));
      if (showDone && doneTasks.length <= 1 && donePage > 0) {
        setDonePage((p) => Math.max(0, p - 1));
      } else if (showDone) {
        await loadDonePage(donePage);
      }
    }
  }

  async function deleteSeriesTasks(id: ApiTask["id"], fromScheduledAt?: number) {
    if (typeof id !== "number") return;
    await api.deleteSeries(id, fromScheduledAt);
    invalidateTaskCache();
    const updated = await api.listTasks({ completed: false });
    setTasks(updated);
    if (showDone) await loadDonePage(donePage);
    else {
      const meta = await api.listTasksPage({ completed: true, page: 1, limit: 1 });
      setDoneTotal(meta.total);
    }
  }

  async function skipTask(task: ApiTask) {
    if (typeof task.id !== "number") return;
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
    updateTaskInCache(updated);
    setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function confirmReschedule(task: ApiTask, scheduledAt: number, moveGroup: boolean) {
    if (typeof task.id !== "number") return;
    const now = Date.now();
    const newPattern = updateDelayPattern(task, now);
    const [updated] = await Promise.all([
      api.updateTask(task.id, {
        scheduled_at: scheduledAt,
        skipped_count: (task.skipped_count ?? 0) + 1,
        last_skipped_at: now,
        propagate_group: moveGroup,
        ...(newPattern !== task.delay_pattern ? { delay_pattern: newPattern } : {}),
      }),
      api.logEvent(task.id, "rescheduled", { scheduled_to: scheduledAt, move_group: moveGroup }).catch(() => {}),
    ]);
    updateTaskInCache(updated);
    const fresh = await api.listTasks({ completed: false }).catch(() => null);
    if (fresh) setTasks(fresh);
    else setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    setReschedulingTask(null);
  }

  async function markImportReviewed(t: ApiTask) {
    const updated = await api.updateTask(t.id, { import_review_pending: false });
    updateTaskInCache(updated);
    setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
  }

  async function splitTask(task: ApiTask) {
    if (typeof task.id !== "number") return;
    const [updated, child] = await Promise.all([
      api.updateTask(task.id, { text: `${task.text} (part 1)`, effort: "medium" }),
      api.createTask({ text: `${task.text} (part 2)`, tag: task.tag, effort: "medium", duration: Math.ceil((task.duration ?? 30) / 2), urgency: task.urgency, importance: task.importance, tiny_step: "" }),
    ]);
    api.logEvent(task.id, "split", { child_text: `${task.text} (part 2)` }).catch(() => {});
    invalidateTaskCache();
    setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)).concat(child));
  }

  return (
    <div className="col gap-5 page-cap">
      {/* Header */}
      <header className="between tasks-header" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>All tasks · ranked for you</div>
          <h1 className="display" style={{ fontSize: 36, margin: 0 }}>
            {filtered.length}{ranked.length !== filtered.length ? `/${ranked.length}` : ""} things{" "}
            <span className="serif" style={{ color: "var(--ink-3)", fontSize: 28 }}>
              sorted by what fits <em>right now</em>
            </span>
          </h1>
        </div>
        <div className="row gap-2 aic tasks-toolbar">
          <EnergyModeSwitcher mode={mode} onChange={setMode} />
          <button
            className={"btn" + (showSearch ? " btn-primary" : "")}
            style={{ fontSize: 13 }}
            onClick={() => { setShowSearch((v) => !v); if (showSearch) setTextFilter(""); }}
            title="Search tasks"
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            Search
          </button>
          <QuickAddRow onCreated={(t) => setTasks((prev) => [t, ...prev])} />
        </div>
      </header>

      {/* Text search bar */}
      {showSearch && (
        <div className="row gap-2 aic">
          <input
            autoFocus
            type="text"
            value={textFilter}
            onChange={(e) => setTextFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setShowSearch(false); setTextFilter(""); } }}
            placeholder="Search task names…"
            style={{
              flex: 1, border: "1px solid var(--line)", background: "var(--paper)",
              padding: "8px 12px", borderRadius: 6, fontSize: 14,
              color: "var(--ink)", outline: "none", fontFamily: "var(--font-body)",
            }}
          />
          {textFilter && (
            <button
              onClick={() => setTextFilter("")}
              style={{ fontSize: 12, color: "var(--ink-3)", background: "none", border: "none", cursor: "pointer" }}
            >
              Clear
            </button>
          )}
        </div>
      )}

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
            const label = BLACKOUT_LABELS[b.blackout_type] ?? b.blackout_type;
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
            <SwipeTaskRow key={t.id} onComplete={() => setCompletingTask(t)} onSkip={() => skipTask(t)}>
              <TaskRow
                task={t}
                rank={i + 1}
                isNow
                completing={completingIds.has(t.id)}
                blackedOut={false}
                onToggle={() => setCompletingTask(t)}
                onDelete={() => deleteTask(t.id)}
                onDeleteSeries={() => deleteSeriesTasks(t.id)}
                onSkip={() => skipTask(t)}
                onReschedule={() => setReschedulingTask(t)}
                onDetail={() => setDetailTask(t)}
                onSplit={() => splitTask(t)}
              />
            </SwipeTaskRow>
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
            <SwipeTaskRow key={t.id} onComplete={() => setCompletingTask(t)} onSkip={() => skipTask(t)}>
              <TaskRow
                task={t}
                rank={i + 1 + nowGroup.length}
                completing={completingIds.has(t.id)}
                blackedOut={false}
                onToggle={() => setCompletingTask(t)}
                onDelete={() => deleteTask(t.id)}
                onDeleteSeries={() => deleteSeriesTasks(t.id)}
                onSkip={() => skipTask(t)}
                onReschedule={() => setReschedulingTask(t)}
                onDetail={() => setDetailTask(t)}
                onSplit={() => splitTask(t)}
              />
            </SwipeTaskRow>
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
            <SwipeTaskRow key={t.id} onComplete={() => setCompletingTask(t)} onSkip={() => skipTask(t)}>
              <TaskRow
                task={t}
                rank={i + 1 + nowGroup.length + soonGroup.length}
                completing={completingIds.has(t.id)}
                blackedOut={false}
                onToggle={() => setCompletingTask(t)}
                onDelete={() => deleteTask(t.id)}
                onDeleteSeries={() => deleteSeriesTasks(t.id)}
                onSkip={() => skipTask(t)}
                onReschedule={() => setReschedulingTask(t)}
                onDetail={() => setDetailTask(t)}
                onSplit={() => splitTask(t)}
              />
            </SwipeTaskRow>
          ))}
        </TaskGroup>
      )}

      {/* After import — calendar events needing setup tweaks */}
      {needsImportReview.length > 0 && (
        <ImportReviewSection
          tasks={needsImportReview}
          onDetail={setDetailTask}
          onMarkDone={markImportReviewed}
        />
      )}

      {/* On hold — tasks skipped due to active blackouts */}
      {onHold.length > 0 && <OnHoldSection tasks={onHold} onDetail={setDetailTask} />}

      {!fetching && ranked.length === 0 && needsImportReview.length === 0 && onHold.length === 0 && (
        <div className="card col" style={{ padding: 40, alignItems: "center", gap: 12, textAlign: "center" }}>
          <p className="display" style={{ fontSize: 20, margin: 0 }}>Nothing here yet.</p>
          <p className="serif" style={{ color: "var(--ink-3)", fontSize: 15 }}>
            Capture a task and it'll surface here ranked for your state.
          </p>
        </div>
      )}

      {/* Completed section toggle */}
      {doneTotal > 0 && (
        <div>
          <button
            className="btn"
            onClick={() => {
              setShowDone((v) => {
                const next = !v;
                if (next) setDonePage(0);
                return next;
              });
            }}
            style={{ fontSize: 13 }}
          >
            {showDone ? "Hide" : "Show"} {doneTotal} completed
          </button>
          {showDone && (
            <div className="col gap-3" style={{ marginTop: 10 }}>
              <div className="card" style={{ padding: 6 }}>
                {doneLoading && doneTasks.length === 0 ? (
                  <p className="serif" style={{ padding: 16, margin: 0, color: "var(--ink-3)", fontSize: 14 }}>Loading…</p>
                ) : (
                  doneTasks.map((t) => (
                    <DoneRow key={t.id} task={t} onToggle={() => handleToggle(t)} onDelete={() => deleteTask(t.id, true)} />
                  ))
                )}
              </div>
              {doneTotal > DONE_PAGE_SIZE && (
                <TaskPagination
                  page={donePage}
                  pageSize={DONE_PAGE_SIZE}
                  total={doneTotal}
                  loading={doneLoading}
                  onPageChange={setDonePage}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {reschedulingTask && (
        <RescheduleModal
          task={reschedulingTask}
          allTasks={tasks}
          onConfirm={(at, moveGroup) => confirmReschedule(reschedulingTask, at, moveGroup)}
          onClose={() => setReschedulingTask(null)}
        />
      )}
      {completingTask && (
        <CompleteModal
          task={completingTask}
          onConfirm={(completedAt) => handleToggle(completingTask, completedAt)}
          onClose={() => setCompletingTask(null)}
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

// ── TaskPagination ────────────────────────────────────────────────────────────

function TaskPagination({
  page,
  pageSize,
  total,
  loading,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : page * pageSize + 1;
  const rangeEnd = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="row between aic task-pagination" style={{ fontSize: 13 }}>
      <span className="serif" style={{ color: "var(--ink-3)" }}>
        {rangeStart}–{rangeEnd} of {total}
      </span>
      <div className="row gap-2 aic">
        <button
          className="btn"
          style={{ fontSize: 12 }}
          disabled={page === 0 || loading}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <span className="mono" style={{ color: "var(--ink-3)", fontSize: 12 }}>
          {page + 1} / {pageCount}
        </span>
        <button
          className="btn"
          style={{ fontSize: 12 }}
          disabled={page >= pageCount - 1 || loading}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ── ImportReviewSection ───────────────────────────────────────────────────────

function ImportReviewSection({
  tasks,
  onDetail,
  onMarkDone,
}: {
  tasks: ApiTask[];
  onDetail: (t: ApiTask) => void;
  onMarkDone: (t: ApiTask) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [markingId, setMarkingId] = useState<ApiTask["id"] | null>(null);

  return (
    <section>
      <button
        className="row aic gap-2"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: 10 }}
        onClick={() => setExpanded((v) => !v)}
      >
        <h3 className="display" style={{ margin: 0, fontSize: 22, color: "var(--mustard)" }}>After import</h3>
        <span className="serif" style={{ color: "var(--ink-3)", fontSize: 14 }}>
          {tasks.length} event{tasks.length !== 1 ? "s" : ""} to review
        </span>
        <span style={{ color: "var(--ink-3)", fontSize: 13 }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="card col" style={{ padding: 12, gap: 8 }}>
          <p className="serif" style={{ margin: 0, fontSize: 14, color: "var(--ink-3)" }}>
            Tweak blackout behavior, cognitive load, recurrence, and other settings — then mark setup done.
          </p>
          <div style={{ padding: 0 }}>
            {tasks.map((t) => (
              <div key={t.id} className="task" style={{ opacity: 0.85 }}>
                <div className="rank" style={{ fontSize: 12 }}>↗</div>
                <div style={{ minWidth: 0 }}>
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
                    {t.rrule && <span style={{ color: "var(--ink-3)" }}>· calendar series</span>}
                  </div>
                </div>
                <div className="task-actions">
                  <button className="btn" style={{ fontSize: 12 }} onClick={() => onDetail(t)}>Review</button>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 12 }}
                    disabled={markingId === t.id}
                    onClick={async () => {
                      setMarkingId(t.id);
                      try { await onMarkDone(t); } finally { setMarkingId(null); }
                    }}
                  >
                    {markingId === t.id ? "…" : "Done"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
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
      className={`task task-no-rank${isNow ? " is-now" : ""} ${completing ? "task-completing" : ""}`}
      style={{ cursor: "default", opacity: blackedOut ? 0.35 : undefined }}
      title={blackedOut ? "Skipped during active blackout" : undefined}
    >
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

      <div className="task-actions">
        <div className="task-actions-extra">
          <button
            onClick={onDetail}
            className="task-action-text"
            title="Details"
          >···</button>
          <button
            onClick={onReschedule}
            title="Reschedule"
            className="task-action-text"
          >↷</button>
          <button
            onClick={async () => { setSkipping(true); try { await onSkip(); } finally { setSkipping(false); } }}
            disabled={skipping}
            className="task-action-text"
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
          aria-label="Complete"
        >
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </button>
        <button
          onClick={onDelete}
          className="task-action-delete"
          title="Delete"
          aria-label="Delete"
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
      <div className="task-actions">
        <button onClick={onToggle} className="task-action-delete" style={{ opacity: 1, fontSize: 11 }} title="Undo">undo</button>
        <button onClick={onDelete} className="task-action-delete" title="Delete" aria-label="Delete">✕</button>
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
  const utterance = value.trim() ? parseUtterance(value) : null;
  const preview = utterance?.preview ?? {};
  const hasPreview = utterance ? Object.keys(preview).length > 0 || utterance.chips.length > 0 : false;

  useEffect(() => { if (open) ref.current?.focus(); }, [open]);

  async function submit() {
    if (!utterance?.text.trim()) return;
    setSubmitting(true);
    try {
      const created = await api.createTask({
        ...taskInputFromUtterance(value),
        text: utterance.text,
        ...(utterance.scheduledAt ? { scheduled_at: utterance.scheduledAt } : {}),
        ...(utterance.duration ? { duration: utterance.duration } : {}),
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
    <div className="card quick-add-card" style={{ padding: "12px 16px", minWidth: 300 }}>
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
            disabled={submitting || !utterance?.text.trim()}
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

function CompleteModal({
  task, onConfirm, onClose,
}: {
  task: ApiTask;
  onConfirm: (completedAt?: number) => void;
  onClose: () => void;
}) {
  const [completedAt, setCompletedAt] = useState(Date.now());
  const [useCustomTime, setUseCustomTime] = useState(false);
  const [saving, setSaving] = useState(false);
  const delayMins = task.scheduled_at ? Math.round((completedAt - task.scheduled_at) / 60_000) : 0;

  return (
    <div
      className="modal-scrim"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card col gap-5" style={{ maxWidth: 420, width: "100%", margin: "0 16px" }}>
        <div>
          <h2 className="display" style={{ fontSize: 22, margin: "0 0 6px" }}>Mark done</h2>
          <p style={{ fontSize: 14, color: "var(--ink-2)", margin: 0 }}>{task.text}</p>
        </div>
        <label className="row gap-2 aic" style={{ fontSize: 13, color: "var(--ink-2)" }}>
          <input
            type="checkbox"
            checked={useCustomTime}
            onChange={(e) => setUseCustomTime(e.target.checked)}
          />
          Use a specific completion time
        </label>
        {useCustomTime && (
          <div className="col gap-2">
            <label className="label">Completed at</label>
            <input
              type="datetime-local"
              value={toInputValue(completedAt)}
              onChange={(e) => setCompletedAt(new Date(e.target.value).getTime())}
              className="input-base"
            />
            {task.scheduled_at && (
              <p className="mono" style={{ margin: 0, fontSize: 11, color: "var(--ink-3)" }}>
                {delayMins >= 0 ? `${delayMins}m after scheduled time` : `${Math.abs(delayMins)}m before scheduled time`}
              </p>
            )}
          </div>
        )}
        <div className="row gap-3">
          <button
            onClick={async () => {
              setSaving(true);
              try { await onConfirm(useCustomTime ? completedAt : Date.now()); }
              finally { setSaving(false); }
            }}
            disabled={saving}
            className="btn btn-primary"
            style={{ flex: 1 }}
          >
            {saving ? "Saving..." : "Done"}
          </button>
          <button onClick={onClose} className="btn" style={{ flex: 1 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function RescheduleModal({
  task, allTasks, onConfirm, onClose,
}: {
  task: ApiTask; allTasks: ApiTask[];
  onConfirm: (scheduledAt: number, moveGroup: boolean) => void; onClose: () => void;
}) {
  const suggestion: SlotSuggestion = suggestSlot(task, allTasks);
  const [chosen, setChosen] = useState(suggestion.scheduledAt);
  const [moveGroup, setMoveGroup] = useState(Boolean(task.group_id));
  const [saving, setSaving] = useState(false);
  const groupCount = task.group_id ? allTasks.filter((t) => t.group_id === task.group_id && !t.completed).length : 0;

  return (
    <div
      className="modal-scrim"
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
        {task.group_id && groupCount > 1 && (
          <label className="row gap-2 aic" style={{ fontSize: 13, color: "var(--ink-2)" }}>
            <input
              type="checkbox"
              checked={moveGroup}
              onChange={(e) => setMoveGroup(e.target.checked)}
            />
            Move all {groupCount} tasks in this group
          </label>
        )}
        <div className="row gap-3">
          <button
            onClick={async () => { setSaving(true); try { await onConfirm(chosen, moveGroup); } finally { setSaving(false); } }}
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
