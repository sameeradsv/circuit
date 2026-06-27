"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiTask, TaskIn } from "@/lib/api";
import { TaskDetailModal } from "@/components/TaskDetailModal";
import { useEnergyMode } from "@/lib/use-energy-mode";
import { useAuth } from "@shared/cortex";
import { energyDescriptor } from "@/lib/use-energy-level";
import { energySourceLabel, useEffectiveEnergy } from "@/lib/use-effective-energy";
import { parseUtterance, taskInputFromUtterance, taskInputWithAiDefaults } from "@/lib/parse-utterance";
import { useVoiceInput } from "@/lib/use-voice-input";
import { fitPercent } from "@/lib/task-ranking";

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

const SEG_LABELS: Record<string, string> = {
  urgency: "urgent",
  energy: "energy fit",
  time: "time fit",
  momentum: "in flight",
};

function dueInDays(task: ApiTask): number {
  if (!task.scheduled_at) return 14;
  return Math.round((task.scheduled_at - Date.now()) / DAY_MS);
}

function fmtDue(task: ApiTask): string {
  const d = dueInDays(task);
  if (d < 0)  return `${Math.abs(d)}d overdue`;
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d < 7)   return `${d}d`;
  if (!task.scheduled_at) return "no date";
  return new Date(task.scheduled_at).toLocaleDateString("en-IN", { month: "short", day: "numeric", timeZone: "Asia/Kolkata" });
}

function fmtTime(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function pickNextScheduledTask(list: ApiTask[]): ApiTask | null {
  const nowMs = Date.now();
  return list
    .filter((t) => !t.completed && t.scheduled_at && t.scheduled_at > nowMs)
    .sort((a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0))[0] ?? null;
}

function pickCurrentScheduledTask(list: ApiTask[]): ApiTask | null {
  const nowMs = Date.now();
  return list
    .filter((t) => {
      if (t.completed || !t.scheduled_at) return false;
      return t.scheduled_at <= nowMs && nowMs < t.scheduled_at + (t.duration ?? 30) * 60_000;
    })
    .sort((a, b) => {
      const aEnd = (a.scheduled_at ?? 0) + (a.duration ?? 30) * 60_000;
      const bEnd = (b.scheduled_at ?? 0) + (b.duration ?? 30) * 60_000;
      return aEnd - bEnd;
    })[0] ?? null;
}

function minutesUntil(ms: number): number {
  return Math.max(0, Math.floor((ms - Date.now()) / 60_000));
}

function effortToEnergyReq(effort: string | null | undefined): number {
  if (effort === "high") return 8;
  if (effort === "low")  return 2;
  return 5;
}

function taskTypeMeta(task: ApiTask): { label: string; color: string; cls: string } {
  const tag = task.tag ?? "general";
  const effort = task.effort ?? "medium";
  if (tag === "work" && effort === "high") return { label: "Creative",  color: "var(--terra)",   cls: "creative" };
  if (tag === "work")                      return { label: "Deep work", color: "var(--sage)",    cls: "deep" };
  if (tag === "social")                    return { label: "Comms",     color: "var(--mustard)", cls: "comms" };
  if (effort === "low")                    return { label: "Admin",     color: "var(--ink-3)",   cls: "admin" };
  return                                          { label: "Task",      color: "var(--sage)",    cls: "deep" };
}

type ScoredTask = ApiTask & { score: number; segs: { k: string; v: number; max: number }[]; reason?: string };

function segDetail(task: ScoredTask, k: string): string {
  const dueIn = dueInDays(task);
  const energyReq = effortToEnergyReq(task.effort);
  if (k === "urgency") return dueIn < 0 ? "overdue" : dueIn === 0 ? "due today" : `due in ${dueIn}d`;
  if (k === "energy") return `needs ~${energyReq}/10 energy`;
  if (k === "time") return `needs ${fmtTime(task.duration ?? 30)}`;
  if (k === "momentum") return task.urgency > 0.7 ? "high urgency flag" : "building momentum";
  return "";
}

function buildRationale(task: ScoredTask): string {
  return [...task.segs]
    .filter((s) => s.v > 0)
    .sort((a, b) => b.v / b.max - a.v / a.max)
    .map((s) => `${SEG_LABELS[s.k] ?? s.k} ${Math.round((s.v / s.max) * 100)}% (${segDetail(task, s.k)})`)
    .join(" · ");
}


// ── Components ────────────────────────────────────────────────────────────────

function ScoreBreakdown({ segs }: { segs: { k: string; v: number; max: number }[] }) {
  const total = segs.reduce((a, s) => a + s.max, 0);
  const colors: Record<string, string> = { urgency: "var(--terra)", energy: "var(--sage)", time: "var(--mustard)", momentum: "var(--rose)" };
  return (
    <div>
      <div className="score-bar" style={{ marginBottom: 8 }}>
        {segs.map((s) => (
          <span key={s.k} className={`seg-${s.k}`} style={{ width: `${(s.v / total) * 100}%` }} />
        ))}
      </div>
      <div className="row gap-3 wrap" style={{ fontSize: 11 }}>
        {segs
          .filter((s) => s.v / s.max > 0.35)
          .map((s) => (
            <span key={s.k} className="mono dim">
              <span className="dot" style={{ background: colors[s.k], marginRight: 4 }} />
              {SEG_LABELS[s.k]} {Math.round((s.v / s.max) * 100)}%
            </span>
          ))}
      </div>
    </div>
  );
}

function TopPickCard({
  task,
  onSnooze,
  onOpenTask,
}: {
  task: ScoredTask;
  onSnooze: () => Promise<void>;
  onOpenTask: () => void;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const [snoozing, setSnoozing] = useState(false);
  const type = taskTypeMeta(task);

  async function handleSnooze() {
    setSnoozing(true);
    try {
      await onSnooze();
      setShowWhy(false);
    } finally {
      setSnoozing(false);
    }
  }

  return (
    <div className="card" style={{ padding: 28, borderColor: "var(--ink)", boxShadow: "6px 6px 0 var(--ink)" }}>
      <div className="row gap-6 top-pick-row">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row gap-2 aic" style={{ marginBottom: 12 }}>
            <span className={`type-dot type-${type.cls}`} />
            <span className="tiny" style={{ color: "var(--ink-2)" }}>{type.label}</span>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
              · {fmtDue(task)} · {fmtTime(task.duration ?? 30)}
            </span>
          </div>
          <h2 className="display" style={{ fontSize: 32, margin: "0 0 8px" }}>{task.text}</h2>
          {task.tiny_step && (
            <p className="serif" style={{ fontSize: 16, color: "var(--ink-2)", margin: "0 0 16px", maxWidth: 480 }}>
              {task.tiny_step}
            </p>
          )}
          <ScoreBreakdown segs={task.segs} />
          {showWhy && (
            <p className="serif" style={{ fontSize: 15, color: "var(--ink-2)", margin: "12px 0 0", maxWidth: 480 }}>
              {buildRationale(task)}
            </p>
          )}
        </div>
        <div className="col gap-2 top-pick-actions" style={{ minWidth: 180, alignItems: "stretch" }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: "14px 18px", fontSize: 15, justifyContent: "center" }}
            onClick={onOpenTask}
          >
            Start a focus block →
          </button>
          <button
            className="btn"
            style={{ justifyContent: "center" }}
            disabled={snoozing}
            onClick={handleSnooze}
          >
            {snoozing ? "Snoozing…" : "Snooze 2h"}
          </button>
          <button
            className="btn"
            style={{ justifyContent: "center" }}
            onClick={() => setShowWhy((v) => !v)}
          >
            {showWhy ? "Hide rationale" : "Not now, why?"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task, rank, onOpen }: { task: ScoredTask; rank: number; onOpen: () => void }) {
  const type = taskTypeMeta(task);
  return (
    <div
      className="task"
      style={{ cursor: "pointer" }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="rank">{String(rank).padStart(2, "0")}</div>
      <div>
        <div className="row aic gap-2">
          <span className={`type-dot type-${type.cls}`} />
          <span className="title">{task.text}</span>
        </div>
        <div className="meta">
          <span><b>{fmtDue(task)}</b></span>
          <span>· {fmtTime(task.duration ?? 30)}</span>
          {task.reason && <span style={{ color: "var(--terra)" }}>· {task.reason}</span>}
        </div>
      </div>
      <div className="row gap-2 aic">
        <span
          className="pill ghost mono"
          style={{ fontSize: 10, cursor: "help" }}
          title={buildRationale(task)}
          onClick={(e) => e.stopPropagation()}
        >
          {fitPercent(task)}%
        </span>
        <span className="btn-icon" aria-hidden style={{ opacity: 0.45 }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </span>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

function HomeQuickCapture({ onCreated }: { onCreated: (task: ApiTask, review: boolean) => void }) {
  const [text, setText] = useState("");
  const [reviewAfterAdd, setReviewAfterAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceInput();
  const utterance = text.trim() ? parseUtterance(text) : null;
  const chips = utterance
    ? [
        ...(utterance.preview.date ? [{ k: "date", v: utterance.preview.date }] : []),
        ...(utterance.preview.tag ? [{ k: "tag", v: utterance.preview.tag }] : []),
        ...(utterance.preview.duration ? [{ k: "time", v: utterance.preview.duration }] : []),
        ...(utterance.preview.priority ? [{ k: "priority", v: utterance.preview.priority }] : []),
        ...utterance.chips,
        { k: "effort", v: utterance.effort ?? "medium" },
        { k: "payoff", v: `${Math.round((utterance.energy_to_reward_ratio ?? 0.6) * 100)}%` },
      ]
    : [];

  async function submit() {
    if (!utterance?.text.trim()) return;
    setSubmitting(true);
    try {
      let payload: TaskIn = taskInputFromUtterance(text);
      try {
        const suggested = await api.suggestTaskDefaults(utterance.text);
        payload = taskInputWithAiDefaults(text, suggested);
      } catch {}
      const created = await api.createTask(payload);
      onCreated(created, reviewAfterAdd);
      setText("");
      setReviewAfterAdd(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card home-capture" style={{ padding: 20 }}>
      <div className="between" style={{ marginBottom: 10 }}>
        <div>
          <div className="label">Add task</div>
          <p className="serif" style={{ margin: "2px 0 0", color: "var(--ink-3)", fontSize: 16 }}>
            write it naturally; metrics are filled in for you
          </p>
        </div>
        <label className="row gap-2 aic" style={{ fontSize: 13, color: "var(--ink-2)" }}>
          <input
            type="checkbox"
            checked={reviewAfterAdd}
            onChange={(e) => setReviewAfterAdd(e.target.checked)}
          />
          Review suggested values
        </label>
      </div>
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        rows={2}
        placeholder="walk after lunch because it is healthy, 20m"
        className="input-base"
        style={{ resize: "vertical", fontFamily: "var(--font-display)", fontSize: 18 }}
      />
      {chips.length > 0 && (
        <div className="row gap-2 wrap" style={{ marginTop: 10 }}>
          {chips.slice(0, 8).map((chip, i) => (
            <span key={`${chip.k}-${i}`} className="parse-chip"><span className="k">{chip.k}</span>{chip.v}</span>
          ))}
        </div>
      )}
      <div className="between" style={{ marginTop: 12 }}>
        <div className="row gap-2 aic">
          {voice.supported && (
            <button
              type="button"
              className="btn-icon"
              onClick={() => voice.listening ? voice.stop() : voice.start((spoken) => {
                setText((prev) => prev ? `${prev} ${spoken}` : spoken);
                inputRef.current?.focus();
              })}
              title={voice.listening ? "Stop listening" : "Voice input"}
              style={{ color: voice.listening ? "var(--terra)" : "var(--ink-3)" }}
            >
              {voice.listening ? "■" : "◉"}
            </button>
          )}
          {voice.listening && <span className="mono" style={{ fontSize: 11, color: "var(--terra)" }}>listening...</span>}
          {voice.error && <span className="mono" style={{ fontSize: 11, color: "var(--terra)" }}>{voice.error}</span>}
        </div>
        <button
          className="btn btn-primary"
          disabled={submitting || !utterance?.text.trim()}
          onClick={submit}
        >
          {submitting ? "Thinking..." : "Add task"}
        </button>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const [mode] = useEnergyMode();
  const { value: energy, source, loading: energyLoading, userState } = useEffectiveEnergy();
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [fetching, setFetching] = useState(false);
  const [detailTask, setDetailTask] = useState<ApiTask | null>(null);
  const [calendarExpiry, setCalendarExpiry] = useState<{ expires_at_ms: number | null; expires_at_iso: string | null; days_until_expiry: number | null } | null>(null);
  const [nextMeeting, setNextMeeting] = useState<ApiTask | null>(null);
  const [currentMeeting, setCurrentMeeting] = useState<ApiTask | null>(null);
  const [timeAvail, setTimeAvail] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    Promise.all([
      api.listTasks().then((list) => {
        setTasks(list);
        setNextMeeting(pickNextScheduledTask(list));
        setCurrentMeeting(pickCurrentScheduledTask(list));
      }).catch(() => {}),
      api.getCalendarExpiry().then(setCalendarExpiry).catch(() => {}),
    ]).finally(() => setFetching(false));
  }, [user]);

  async function refreshTasks() {
    const list = await api.listTasks();
    setTasks(list);
    setNextMeeting(pickNextScheduledTask(list));
    setCurrentMeeting(pickCurrentScheduledTask(list));
  }

  function seriesDeleteId(task: ApiTask): ApiTask["id"] {
    return typeof task.id === "number" ? task.id : task.source_task_id ?? task.id;
  }

  async function deleteSeriesTasks(task: ApiTask, fromScheduledAt?: number) {
    const id = seriesDeleteId(task);
    if (typeof id !== "number") return;
    await api.deleteSeries(id, fromScheduledAt);
    await refreshTasks();
  }

  useEffect(() => {
    const tick = () => {
      setCurrentMeeting(pickCurrentScheduledTask(tasks));
      setNextMeeting(pickNextScheduledTask(tasks));
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [tasks]);

  useEffect(() => {
    if (currentMeeting?.scheduled_at) {
      setTimeAvail(0);
      return;
    }
    if (!nextMeeting?.scheduled_at) {
      setTimeAvail(null);
      return;
    }
    const tick = () => setTimeAvail(minutesUntil(nextMeeting.scheduled_at!));
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, [currentMeeting, nextMeeting]);

  if (!user) return null;

  const desc = energyDescriptor(energy);
  const openTasks = tasks.filter((t) => !t.completed);
  const top = openTasks[0] as ScoredTask;
  const next: ScoredTask[] = [];
  const ranked: ScoredTask[] = [];
  async function snoozeTask(_task: ApiTask) {}
  const completedToday = tasks.filter((t) => {
    if (!t.completed) return false;
    const sod = new Date(); sod.setHours(0, 0, 0, 0);
    return new Date(t.updated_at).getTime() > sod.getTime();
  }).length;

  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-IN", { weekday: "long", month: "long", day: "numeric", timeZone: "Asia/Kolkata" });
  const timeLabel = now.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning," : hour < 17 ? "Good afternoon," : "Good evening,";

  return (
    <div className="col gap-6 page-cap">
      {/* Header */}
      <header className="between home-header" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>
            {dateLabel} · {timeLabel}
          </div>
          <h1 className="display" style={{ fontSize: 40, margin: 0 }}>
            {greeting} {user.username}.{" "}
            <span className="serif" style={{ color: "var(--ink-3)", fontSize: 32 }}>
              feeling{" "}
              <span style={{ color: "var(--terra)" }}>
                {desc.word.toLowerCase()}
              </span>
              ?
            </span>
          </h1>
        </div>
        <div className="row gap-2 aic header-pills" style={{ flexShrink: 0, marginTop: 4 }}>
          {completedToday > 0 && (
            <span className="pill">
              <span className="dot" style={{ background: "var(--sage)" }} />
              {completedToday} done today
            </span>
          )}
          {timeAvail !== null && (
            <span className="pill">
              <span className="dot" style={{ background: "var(--mustard)" }} />
              {currentMeeting ? "busy now" : `${fmtTime(timeAvail)} until next event`}
            </span>
          )}
        </div>
      </header>

      {/* Energy + Window card */}
      <div className="card" style={{ padding: 24 }}>
        <div className="row gap-6 home-energy-row">
          <div style={{ flex: 1 }}>
            <div className="label" style={{ marginBottom: 8 }}>Energy</div>
            <div className="row aib gap-3 home-energy-desc" style={{ marginBottom: 4 }}>
              <span className="display tnum home-energy-num" style={{ fontSize: 56, lineHeight: 1 }}>
                {energyLoading ? "—" : energy}
              </span>
              <span className="mono" style={{ color: "var(--ink-3)", fontSize: 14 }}>/10</span>
              <span className="serif" style={{ marginLeft: 12, fontSize: 22, color: "var(--ink-2)" }}>
                {energyLoading ? "syncing…" : `${desc.word.toLowerCase()} — ${desc.hint}`}
              </span>
            </div>
            <div className="energy-rail" style={{ pointerEvents: "none", marginTop: 10 }}>
              <div className="track" style={{ width: `${((energy - 1) / 9) * 100}%` }} />
              <div className="knob" style={{ left: `${((energy - 1) / 9) * 100}%` }} />
            </div>
            {!energyLoading && (
              <p className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 8 }}>
                from {energySourceLabel(source)}
                {source !== "manual" && (
                  <> · <Link href="/account" className="dim" style={{ textDecoration: "underline" }}>override in settings</Link></>
                )}
              </p>
            )}
          </div>
          <div className="hairline-v home-window-col" style={{ paddingLeft: 24, minWidth: 220 }}>
            <div className="label" style={{ marginBottom: 8 }}>Window</div>
            <div className="row aib gap-2" style={{ marginBottom: 4 }}>
              <span className="display tnum home-window-num" style={{ fontSize: 40, lineHeight: 1 }}>
                {currentMeeting ? "Busy" : timeAvail !== null ? fmtTime(timeAvail) : "—"}
              </span>
              <span className="serif" style={{ fontSize: 18, color: "var(--ink-3)" }}>
                {currentMeeting
                  ? <>blocked by <em>{currentMeeting.text.slice(0, 32)}{currentMeeting.text.length > 32 ? "…" : ""}</em></>
                  : nextMeeting
                  ? <>until <em>{nextMeeting.text.slice(0, 32)}{nextMeeting.text.length > 32 ? "…" : ""}</em></>
                  : "no upcoming events on calendar"}
              </span>
            </div>
            {(currentMeeting?.scheduled_at || nextMeeting?.scheduled_at) && (
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                {currentMeeting?.scheduled_at
                  ? `${new Date(currentMeeting.scheduled_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}-${new Date(currentMeeting.scheduled_at + (currentMeeting.duration ?? 30) * 60_000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}`
                  : new Date(nextMeeting!.scheduled_at!).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Calendar expiry alert */}
      {calendarExpiry?.expires_at_ms && calendarExpiry.days_until_expiry !== null && (() => {
        const urgent = calendarExpiry.days_until_expiry <= 30;
        const fg     = urgent ? "white"              : "rgba(0,0,0,0.85)";
        const fgMid  = urgent ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.55)";
        const fgSub  = urgent ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.5)";
        return (
          <div className="card" style={{
            padding: 16,
            background: urgent ? "var(--terra)" : "var(--mustard)",
            borderColor: "transparent",
          }}>
            <div className="row aic gap-3">
              <div style={{ flex: 1 }}>
                <div className="label" style={{ color: fgMid, marginBottom: 2 }}>Calendar import expires</div>
                <div style={{ fontSize: 16, fontWeight: 500, color: fg }}>
                  {calendarExpiry.days_until_expiry === 0 ? "Today!" : `in ${calendarExpiry.days_until_expiry} day${calendarExpiry.days_until_expiry !== 1 ? 's' : ''}`}
                </div>
                <div style={{ fontSize: 12, color: fgSub, marginTop: 2 }}>
                  Re-import your .ics file to extend the 2-year window
                </div>
              </div>
              <Link
                href="/calendar"
                className="btn"
                style={{ background: "rgba(0,0,0,0.15)", color: fg, border: "1px solid rgba(0,0,0,0.15)", whiteSpace: "nowrap", flexShrink: 0 }}
              >
                Go to calendar
              </Link>
            </div>
          </div>
        );
      })()}

      <HomeQuickCapture
        onCreated={(created, review) => {
          setTasks((prev) => [created, ...prev]);
          if (review) setDetailTask(created);
        }}
      />

      {/* Loading */}
      {fetching && (
        <div className="serif" style={{ fontSize: 16, color: "var(--ink-3)" }}>
          loading your tasks…
        </div>
      )}

      {false && (
        <div>
          <div className="row aic gap-3" style={{ marginBottom: 10 }}>
            <span className="label">Suggested next →</span>
            <span className="serif" style={{ color: "var(--ink-3)" }}>
              the highest-leverage thing right now
            </span>
          </div>
          <TopPickCard
            task={top}
            onSnooze={() => snoozeTask(top)}
            onOpenTask={() => setDetailTask(top)}
          />
        </div>
      )}

      {/* After that */}
      {false && (
        <div>
          <div className="between" style={{ marginBottom: 10 }}>
            <div className="label">After that</div>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
              showing {next.length} of {ranked.length - 1}
            </span>
          </div>
          <div className="card" style={{ padding: 6 }}>
            {next.map((t, i) => (
              <TaskRow key={t.id} task={t} rank={i + 2} onOpen={() => setDetailTask(t)} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!fetching && openTasks.length === 0 && (
        <div className="card col gap-4" style={{ padding: 40, alignItems: "center", textAlign: "center" }}>
          <p className="display" style={{ fontSize: 22, margin: 0 }}>Nothing waiting.</p>
          <p className="serif" style={{ color: "var(--ink-3)", fontSize: 16 }}>
            Add your first task above and circuit will fill in the metrics for you.
          </p>
        </div>
      )}

      {/* Quick links */}
      <div className="row gap-3 wrap" style={{ marginTop: 4 }}>
        <Link href="/tasks"     className="card" style={{ flex: 1, minWidth: 120, cursor: "pointer", textDecoration: "none" }}>
          <p className="display" style={{ fontSize: 15, margin: "0 0 2px" }}>Tasks</p>
          <p className="tiny muted">full ranked list</p>
        </Link>
        <Link href="/calendar"  className="card" style={{ flex: 1, minWidth: 120, cursor: "pointer", textDecoration: "none" }}>
          <p className="display" style={{ fontSize: 15, margin: "0 0 2px" }}>Calendar</p>
          <p className="tiny muted">month view</p>
        </Link>
        <Link href="/analytics" className="card" style={{ flex: 1, minWidth: 120, cursor: "pointer", textDecoration: "none" }}>
          <p className="display" style={{ fontSize: 15, margin: "0 0 2px" }}>Analytics</p>
          <p className="tiny muted">patterns & stats</p>
        </Link>
      </div>

      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          mode={mode}
          onSave={(updated) => {
            setTasks((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
            setDetailTask(updated);
          }}
          onDeleteSeries={async (fromScheduledAt) => {
            await deleteSeriesTasks(detailTask, fromScheduledAt);
            setDetailTask(null);
          }}
          onClose={() => setDetailTask(null)}
        />
      )}
    </div>
  );
}
