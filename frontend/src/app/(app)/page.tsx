"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, ApiTask } from "@/lib/api";
import { useCircuitAuth } from "@/lib/use-circuit-auth";
import { useEnergyLevel, energyDescriptor } from "@/lib/use-energy-level";

// ── Helpers ──────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

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

interface ScoredTask extends ApiTask {
  score: number;
  reason: string;
  segs: { k: string; v: number; max: number }[];
}

function scoreTask(task: ApiTask, energy: number, timeAvail: number): ScoredTask {
  const dueIn = dueInDays(task);
  const energyReq = effortToEnergyReq(task.effort);
  const urgency     = dueIn <= 0 ? 1 : Math.max(0, 1 - dueIn / 7);
  const energyMatch = 1 - Math.min(1, Math.abs(energyReq - energy) / 5);
  const timeFit     = timeAvail >= (task.duration ?? 30) ? 1 : Math.max(0, timeAvail / (task.duration ?? 30));
  const momentum    = (task.skipped_count ?? 0) > 0 ? 0 : task.urgency > 0.7 ? 0.5 : 0;
  const segs = [
    { k: "urgency",  v: urgency * 30,      max: 30 },
    { k: "energy",   v: energyMatch * 28,  max: 28 },
    { k: "time",     v: timeFit * 18,      max: 18 },
    { k: "momentum", v: momentum * 12,     max: 12 },
  ];
  const score = segs.reduce((a, s) => a + s.v, 0);
  const top = [...segs].sort((a, b) => b.v / b.max - a.v / a.max)[0];
  const reasons: Record<string, string> = {
    urgency:  dueIn < 0 ? "overdue" : dueIn === 0 ? "due today" : `due in ${dueIn}d`,
    energy:   `matches your energy (${energyReq}/10)`,
    time:     `fits your ${fmtTime(timeAvail)} window`,
    momentum: `high priority`,
  };
  return { ...task, score, reason: reasons[top.k] ?? "", segs };
}

function rankTasks(tasks: ApiTask[], energy: number, timeAvail: number): ScoredTask[] {
  return tasks
    .filter((t) => !t.completed)
    .map((t) => scoreTask(t, energy, timeAvail))
    .sort((a, b) => b.score - a.score);
}

// ── Components ────────────────────────────────────────────────────────────────

function ScoreBreakdown({ segs }: { segs: { k: string; v: number; max: number }[] }) {
  const total = segs.reduce((a, s) => a + s.max, 0);
  const labels: Record<string, string> = { urgency: "urgent", energy: "energy fit", time: "time fit", momentum: "in flight" };
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
              {labels[s.k]} {Math.round((s.v / s.max) * 100)}%
            </span>
          ))}
      </div>
    </div>
  );
}

function TopPickCard({ task, energy, timeAvail }: { task: ScoredTask; energy: number; timeAvail: number }) {
  const type = taskTypeMeta(task);
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
        </div>
        <div className="col gap-2 top-pick-actions" style={{ minWidth: 180, alignItems: "stretch" }}>
          <Link
            href="/tasks"
            className="btn btn-primary"
            style={{ padding: "14px 18px", fontSize: 15, justifyContent: "center" }}
          >
            Start a focus block →
          </Link>
          <button
            className="btn"
            style={{ justifyContent: "center" }}
            onClick={() => {}}
          >
            Snooze 2h
          </button>
          <button
            className="btn"
            style={{ justifyContent: "center" }}
            onClick={() => {}}
          >
            Not now, why?
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskRow({ task, rank }: { task: ScoredTask; rank: number }) {
  const type = taskTypeMeta(task);
  return (
    <Link href="/tasks" className="task" style={{ textDecoration: "none" }}>
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
        {task.urgency > 0.6 && (
          <span className="pill ghost mono" style={{ fontSize: 10 }}>
            {Math.round(task.urgency * 100)}%
          </span>
        )}
        <button
          className="btn-icon"
          onClick={(e) => { e.preventDefault(); }}
          aria-label="Open"
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </Link>
  );
}

function EnergyRail({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  const pct = ((value - 1) / 9) * 100;
  const railRef = useRef<HTMLDivElement>(null);

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!railRef.current) return;
    const rect = railRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    onChange(Math.round(1 + x * 9));
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="energy-rail" ref={railRef} onClick={handleClick}>
        <div className="track" style={{ width: `${pct}%` }} />
        <div className="knob" style={{ left: `${pct}%` }} />
      </div>
      <div className="energy-ticks">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { user } = useCircuitAuth();
  const [energy, setEnergy] = useEnergyLevel();
  const [timeAvail, setTimeAvail] = useState(120);
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [fetching, setFetching] = useState(false);
  const [calendarExpiry, setCalendarExpiry] = useState<{ expires_at_ms: number | null; expires_at_iso: string | null; days_until_expiry: number | null } | null>(null);
  const [nextMeeting, setNextMeeting] = useState<ApiTask | null>(null);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    Promise.all([
      api.listTasks().then((list) => {
        setTasks(list);
        // Find the next upcoming scheduled task and use it as the time window
        const nowMs = Date.now();
        const upcoming = list
          .filter((t) => !t.completed && t.scheduled_at && t.scheduled_at > nowMs)
          .sort((a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0));
        const next = upcoming[0] ?? null;
        setNextMeeting(next);
        if (next?.scheduled_at) {
          const mins = Math.floor((next.scheduled_at - nowMs) / 60_000);
          if (mins > 5 && mins <= 480) setTimeAvail(mins);
        }
      }).catch(() => {}),
      api.getCalendarExpiry().then(setCalendarExpiry).catch(() => {}),
    ]).finally(() => setFetching(false));
  }, [user]);

  if (!user) return null;

  const desc = energyDescriptor(energy);
  const ranked = rankTasks(tasks, energy, timeAvail);
  const top = ranked[0];
  const next = ranked.slice(1, 4);
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
          <span className="pill">
            <span className="dot" style={{ background: "var(--mustard)" }} />
            {fmtTime(timeAvail)} focus left
          </span>
        </div>
      </header>

      {/* Energy + Window card */}
      <div className="card" style={{ padding: 24 }}>
        <div className="row gap-6 home-energy-row">
          <div style={{ flex: 1 }}>
            <div className="label" style={{ marginBottom: 8 }}>Energy</div>
            <div className="row aib gap-3 home-energy-desc" style={{ marginBottom: 4 }}>
              <span className="display tnum home-energy-num" style={{ fontSize: 56, lineHeight: 1 }}>{energy}</span>
              <span className="mono" style={{ color: "var(--ink-3)", fontSize: 14 }}>/10</span>
              <span className="serif" style={{ marginLeft: 12, fontSize: 22, color: "var(--ink-2)" }}>
                {desc.word.toLowerCase()} — {desc.hint}
              </span>
            </div>
            <EnergyRail value={energy} onChange={setEnergy} />
          </div>
          <div className="hairline-v home-window-col" style={{ paddingLeft: 24, minWidth: 220 }}>
            <div className="label" style={{ marginBottom: 8 }}>Window</div>
            <div className="row aib gap-2" style={{ marginBottom: 4 }}>
              <span className="display tnum home-window-num" style={{ fontSize: 40, lineHeight: 1 }}>{fmtTime(timeAvail)}</span>
              <span className="serif" style={{ fontSize: 18, color: "var(--ink-3)" }}>
                {nextMeeting
                  ? <>until <em>{nextMeeting.text.slice(0, 32)}{nextMeeting.text.length > 32 ? "…" : ""}</em></>
                  : "before your next meeting"}
              </span>
            </div>
            {nextMeeting?.scheduled_at && (
              <div className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 10 }}>
                {new Date(nextMeeting.scheduled_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })}
              </div>
            )}
            <div className="row gap-1 duration-row">
              {[30, 60, 90, 120].map((m) => (
                <button
                  key={m}
                  onClick={() => setTimeAvail(m)}
                  className={"btn" + (m === timeAvail ? " btn-primary" : "")}
                  style={{ padding: "6px 12px", fontSize: 13 }}
                >
                  {fmtTime(m)}
                </button>
              ))}
            </div>
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

      {/* Top pick */}
      {fetching && (
        <div className="serif" style={{ fontSize: 16, color: "var(--ink-3)" }}>
          loading your tasks…
        </div>
      )}

      {!fetching && top && (
        <div>
          <div className="row aic gap-3" style={{ marginBottom: 10 }}>
            <span className="label">Suggested next →</span>
            <span className="serif" style={{ color: "var(--ink-3)" }}>
              the highest-leverage thing right now
            </span>
          </div>
          <TopPickCard task={top} energy={energy} timeAvail={timeAvail} />
        </div>
      )}

      {/* After that */}
      {!fetching && next.length > 0 && (
        <div>
          <div className="between" style={{ marginBottom: 10 }}>
            <div className="label">After that</div>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
              showing {next.length} of {ranked.length - 1}
            </span>
          </div>
          <div className="card" style={{ padding: 6 }}>
            {next.map((t, i) => (
              <TaskRow key={t.id} task={t} rank={i + 2} />
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!fetching && ranked.length === 0 && (
        <div className="card col gap-4" style={{ padding: 40, alignItems: "center", textAlign: "center" }}>
          <p className="display" style={{ fontSize: 22, margin: 0 }}>Nothing waiting.</p>
          <p className="serif" style={{ color: "var(--ink-3)", fontSize: 16 }}>
            Add your first task and circuit will rank it for you.
          </p>
          <Link href="/add" className="btn btn-primary">Add a task →</Link>
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
    </div>
  );
}
