"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiTask } from "@/lib/api";
import { useCircuitAuth } from "@/lib/use-circuit-auth";
import { TaskDetailModal } from "@/components/TaskDetailModal";
import { useEnergyMode } from "@/lib/use-energy-mode";

// ── Constants & helpers ───────────────────────────────────────────────────────

const HOUR_H        = 64;   // px per hour
const START_H       = 0;    // midnight
const END_H         = 24;   // midnight (full 24 h)
const LABEL_W       = 52;   // px for time label gutter
const TOTAL_H       = (END_H - START_H) * HOUR_H;
const HOURS         = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);
const SCROLL_TO_7AM = 7 * HOUR_H;  // default scroll position on open

function fmtHour(h: number): string {
  if (h === 0)  return "12am";
  if (h === 12) return "12pm";
  return h > 12 ? `${h - 12}pm` : `${h}am`;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() - s.getDay());
  return s;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

function taskTypeCls(task: ApiTask): string {
  const tag    = task.tag    ?? "general";
  const effort = task.effort ?? "medium";
  if (tag === "social")                    return "comms";
  if (tag === "work" && effort === "high") return "creative";
  if (tag === "work")                      return "deep";
  if (effort === "low")                    return "admin";
  return "deep";
}

const TYPE_COLOR: Record<string, string> = {
  creative: "var(--terra)",
  deep:     "var(--sage)",
  comms:    "var(--mustard)",
  admin:    "var(--ink-3)",
  errand:   "var(--rose)",
};

function taskAccent(t: ApiTask): string {
  return TYPE_COLOR[taskTypeCls(t)] ?? "var(--sage)";
}

function taskTop(scheduledAt: number): number {
  const d = new Date(scheduledAt);
  return ((d.getHours() - START_H) * 60 + d.getMinutes()) / 60 * HOUR_H;
}

function taskHeight(durationMin: number): number {
  return Math.max(24, durationMin / 60 * HOUR_H - 2);
}

function inRange(scheduledAt: number): boolean {
  const h = new Date(scheduledAt).getHours();
  return h >= START_H && h < END_H;
}

const DAY_SHORT   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL    = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

type CalView = "day" | "week" | "month";

// ── Hour grid (shared) ────────────────────────────────────────────────────────

function HourLines() {
  return (
    <>
      {HOURS.map((h) => (
        <div
          key={h}
          style={{
            position: "absolute",
            top: (h - START_H) * HOUR_H,
            left: 0, right: 0,
            borderTop: `1px solid var(--line)`,
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
}

// ── Task block ────────────────────────────────────────────────────────────────

function TaskBlock({ task, compact = false, onClick }: { task: ApiTask; compact?: boolean; onClick?: () => void }) {
  const top    = taskTop(task.scheduled_at!);
  const height = taskHeight(task.duration ?? 30);
  return (
    <div
      title={`${task.text} · ${fmtTime(task.scheduled_at!)} · ${task.duration ?? 30}m`}
      onClick={onClick}
      style={{
        position: "absolute",
        top,
        left: compact ? 2 : 4,
        right: compact ? 2 : 4,
        height,
        background: "var(--paper)",
        borderLeft: `3px solid ${taskAccent(task)}`,
        borderRadius: "0 4px 4px 0",
        padding: compact ? "2px 4px" : "3px 8px",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        zIndex: 1,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      <span style={{
        fontSize: compact ? 11 : 12,
        fontWeight: 500,
        lineHeight: 1.3,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        color: "var(--ink)",
      }}>
        {task.text}
      </span>
      {height > 38 && (
        <span style={{ fontSize: compact ? 9 : 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginTop: 1 }}>
          {fmtTime(task.scheduled_at!)} · {task.duration ?? 30}m
        </span>
      )}
    </div>
  );
}

// ── Day view ──────────────────────────────────────────────────────────────────

function DayView({ date, tasks, today, onTaskClick }: { date: Date; tasks: ApiTask[]; today: Date; onTaskClick: (t: ApiTask) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_7AM; }, []);

  const start = startOfDay(date).getTime();
  const end   = start + 86_400_000;

  const dayTasks = tasks
    .filter((t) => t.scheduled_at && t.scheduled_at >= start && t.scheduled_at < end)
    .sort((a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0));

  const visible    = dayTasks.filter((t) => inRange(t.scheduled_at!));
  const outOfRange = dayTasks.filter((t) => !inRange(t.scheduled_at!));
  const unscheduled = tasks.filter((t) => !t.scheduled_at && !t.completed);

  const isToday = date.toDateString() === today.toDateString();
  const nowMins = isToday ? (today.getHours() - START_H) * 60 + today.getMinutes() : -1;

  return (
    <div className="col gap-4">
      {/* Scrollable hour grid */}
      <div ref={scrollRef} className="cal-scroll-grid" style={{ border: "1px solid var(--line)", borderRadius: 8 }}>
        <div style={{ position: "relative", height: TOTAL_H, minWidth: 0 }}>
          {/* Hour labels */}
          {HOURS.map((h) => (
            <div key={h} style={{ position: "absolute", top: (h - START_H) * HOUR_H, left: 0, width: LABEL_W, display: "flex", alignItems: "flex-start", paddingTop: 3, paddingRight: 8, justifyContent: "flex-end" }}>
              <span style={{ fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)", lineHeight: 1 }}>
                {fmtHour(h)}
              </span>
            </div>
          ))}

          {/* Grid lines */}
          <div style={{ position: "absolute", top: 0, bottom: 0, left: LABEL_W, right: 0 }}>
            <HourLines />

            {/* Current time indicator */}
            {nowMins >= 0 && nowMins < (END_H - START_H) * 60 && (
              <div style={{ position: "absolute", top: nowMins / 60 * HOUR_H, left: 0, right: 0, zIndex: 5, display: "flex", alignItems: "center" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--terra)", flexShrink: 0, marginLeft: -4 }} />
                <div style={{ flex: 1, height: 2, background: "var(--terra)" }} />
              </div>
            )}

            {/* Task blocks */}
            {visible.map((t) => <TaskBlock key={t.id} task={t} onClick={() => onTaskClick(t)} />)}
          </div>
        </div>
      </div>

      {/* Out-of-range events */}
      {outOfRange.length > 0 && (
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Outside displayed hours</div>
          <div className="card" style={{ padding: 6 }}>
            {outOfRange.map((t) => (
              <div key={t.id} className="task" style={{ cursor: "default", opacity: 0.7 }}>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)", minWidth: 56 }}>{fmtTime(t.scheduled_at!)}</span>
                <span style={{ flex: 1, fontSize: 13 }}>{t.text}</span>
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>{t.duration ?? 30}m</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unscheduled */}
      {unscheduled.length > 0 && (
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Unscheduled</div>
          <div className="card" style={{ padding: 6 }}>
            {unscheduled.map((t) => (
              <div key={t.id} className="task" style={{ cursor: "default", opacity: 0.6 }}>
                <span className={`type-dot type-${taskTypeCls(t)}`} />
                <span style={{ flex: 1, fontSize: 13 }}>{t.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Week view ─────────────────────────────────────────────────────────────────

function WeekView({ weekStart, tasks, today, onTaskClick }: { weekStart: Date; tasks: ApiTask[]; today: Date; onTaskClick: (t: ApiTask) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_7AM; }, []);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const todayIdx = days.findIndex((d) => d.toDateString() === today.toDateString());
  const nowMins  = (today.getHours() - START_H) * 60 + today.getMinutes();

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: `${LABEL_W}px repeat(7, 1fr)`, borderBottom: "1px solid var(--line)", background: "var(--paper-2)" }}>
        <div />
        {days.map((d, i) => {
          const isToday = i === todayIdx;
          return (
            <div key={i} style={{ padding: "8px 6px", textAlign: "center", background: isToday ? "var(--ink)" : undefined, borderLeft: "1px solid var(--line)" }}>
              <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: isToday ? "var(--paper-2)" : "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                {DAY_SHORT[d.getDay()]}
              </div>
              <div style={{ fontSize: 18, fontWeight: 600, color: isToday ? "var(--paper)" : "var(--ink)", lineHeight: 1.2 }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Scrollable grid */}
      <div ref={scrollRef} className="cal-scroll-grid">
        <div style={{ display: "grid", gridTemplateColumns: `${LABEL_W}px repeat(7, 1fr)`, height: TOTAL_H }}>
          {/* Time labels column */}
          <div style={{ position: "relative", borderRight: "1px solid var(--line)" }}>
            {HOURS.map((h) => (
              <div key={h} style={{ position: "absolute", top: (h - START_H) * HOUR_H, right: 8, fontSize: 10, color: "var(--ink-3)", fontFamily: "var(--font-mono)", lineHeight: 1, paddingTop: 3 }}>
                {fmtHour(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day, di) => {
            const start    = startOfDay(day).getTime();
            const end      = start + 86_400_000;
            const isToday  = di === todayIdx;
            const dayTasks = tasks
              .filter((t) => t.scheduled_at && t.scheduled_at >= start && t.scheduled_at < end && inRange(t.scheduled_at))
              .sort((a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0));

            return (
              <div key={di} style={{ position: "relative", height: TOTAL_H, borderLeft: "1px solid var(--line)", background: isToday ? "rgba(0,0,0,0.02)" : undefined }}>
                <HourLines />

                {/* Current time bar */}
                {isToday && nowMins >= 0 && nowMins < (END_H - START_H) * 60 && (
                  <div style={{ position: "absolute", top: nowMins / 60 * HOUR_H, left: 0, right: 0, height: 2, background: "var(--terra)", zIndex: 5 }} />
                )}

                {dayTasks.map((t) => <TaskBlock key={t.id} task={t} compact onClick={() => onTaskClick(t)} />)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Month view ────────────────────────────────────────────────────────────────

function MonthView({ year, month, tasks, today }: { year: number; month: number; tasks: ApiTask[]; today: Date }) {
  const dim        = daysInMonth(year, month);
  const startWd    = new Date(year, month, 1).getDay();
  const totalCells = Math.ceil((dim + startWd) / 7) * 7;

  const tasksByDay: Record<number, ApiTask[]> = {};
  tasks.forEach((t) => {
    if (!t.scheduled_at) return;
    const d = new Date(t.scheduled_at);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    (tasksByDay[d.getDate()] ??= []).push(t);
  });

  return (
    <div className="cal-grid">
      {DAY_SHORT.map((d) => (
        <div key={d} style={{ background: "var(--paper-2)", padding: "8px 10px", fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 500, color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {d}
        </div>
      ))}
      {Array.from({ length: totalCells }).map((_, i) => {
        const dayNum   = i - startWd + 1;
        const inMonth  = dayNum >= 1 && dayNum <= dim;
        const isToday  = inMonth && dayNum === today.getDate() && year === today.getFullYear() && month === today.getMonth();
        const dayTasks = inMonth ? (tasksByDay[dayNum] ?? []) : [];
        const overflow = dayTasks.length > 3;

        return (
          <div key={i} className={"cal-cell" + (!inMonth ? " is-other" : "") + (isToday ? " is-today" : "")}>
            <div className="between" style={{ marginBottom: 4 }}>
              <span className="cal-num">{inMonth ? String(dayNum).padStart(2, "0") : ""}</span>
              <div className="row gap-2 aic">
                {isToday && <span className="tiny" style={{ color: "var(--terra)" }}>TODAY</span>}
                {inMonth && dayTasks.length > 0 && (
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600, background: "var(--ink)", color: "var(--paper)", borderRadius: 99, padding: "1px 5px", lineHeight: 1.4 }}>
                    {dayTasks.length}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {dayTasks.slice(0, 3).map((t) => (
                <div key={t.id} className={`cal-task ${taskTypeCls(t)}`} title={`${fmtTime(t.scheduled_at!)} · ${t.text}`}>
                  <span style={{ fontSize: 9, opacity: 0.7, marginRight: 3 }}>{fmtTime(t.scheduled_at!)}</span>
                  {t.text}
                </div>
              ))}
              {overflow && <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>+{dayTasks.length - 3} more</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { user, loading } = useCircuitAuth();
  const router = useRouter();
  const [tasks, setTasks]   = useState<ApiTask[]>([]);
  const [fetching, setFetching] = useState(false);
  const [view, setView]     = useState<CalView>("month");
  const today = useMemo(() => startOfDay(new Date()), []);
  const [focusDate, setFocusDate] = useState<Date>(() => startOfDay(new Date()));
  const [energyMode] = useEnergyMode();
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<ApiTask | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    api.listTasks().then(setTasks).catch(() => {}).finally(() => setFetching(false));
  }, [user]);

  if (loading || !user) return null;

  async function handleImport(file: File) {
    setImporting(true);
    setImportMsg(null);
    try {
      const result = await api.importCalendar(file);
      let msg = `Imported ${result.imported} event${result.imported !== 1 ? "s" : ""}`;
      if (result.expires_at) {
        const expiry = new Date(result.expires_at).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
        msg += `. Recurring events run until ${expiry} — re-import to extend.`;
        localStorage.setItem("circuit-ics-expires", String(result.expires_at));
      }
      setImportMsg(msg);
      const updated = await api.listTasks();
      setTasks(updated);
    } catch (e) {
      setImportMsg(`Import failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setImporting(false);
    }
  }

  function navigate(delta: -1 | 1) {
    setFocusDate((d) => {
      const next = new Date(d);
      if (view === "day")        next.setDate(d.getDate() + delta);
      else if (view === "week")  next.setDate(d.getDate() + delta * 7);
      else { next.setDate(1); next.setMonth(d.getMonth() + delta); }
      return next;
    });
  }

  function goToday() { setFocusDate(startOfDay(new Date())); }

  const year    = focusDate.getFullYear();
  const month   = focusDate.getMonth();
  const wkStart = startOfWeek(focusDate);
  const wkEnd   = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 6);

  const headerLabel =
    view === "day"
      ? `${DAY_FULL[focusDate.getDay()]}, ${MONTH_NAMES[month]} ${focusDate.getDate()}, ${year}`
      : view === "week"
      ? wkStart.getMonth() === wkEnd.getMonth()
        ? `${MONTH_NAMES[wkStart.getMonth()]} ${wkStart.getDate()}–${wkEnd.getDate()}, ${year}`
        : `${MONTH_NAMES[wkStart.getMonth()]} ${wkStart.getDate()} – ${MONTH_NAMES[wkEnd.getMonth()]} ${wkEnd.getDate()}, ${year}`
      : `${MONTH_NAMES[month]} ${year}`;

  const isAtToday =
    view === "day"   ? focusDate.toDateString() === today.toDateString()
    : view === "week" ? startOfWeek(focusDate).getTime() === startOfWeek(today).getTime()
    : year === today.getFullYear() && month === today.getMonth();

  const scheduledCount   = tasks.filter((t) => t.scheduled_at && !t.completed).length;
  const unscheduledCount = tasks.filter((t) => !t.scheduled_at && !t.completed).length;

  return (
    <div className="col gap-5">
      {/* Header */}
      <header className="between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Calendar</div>
          <h1 className="display" style={{ fontSize: 30, margin: 0 }}>{headerLabel}</h1>
          <div className="row gap-3" style={{ marginTop: 4 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>{scheduledCount} scheduled</span>
            {unscheduledCount > 0 && (
              <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>· {unscheduledCount} unscheduled</span>
            )}
          </div>
        </div>

        <div className="row gap-3 aic" style={{ flexWrap: "wrap" }}>
          {/* View switcher */}
          <div className="row gap-1" style={{ background: "var(--paper-2)", borderRadius: 8, padding: 3 }}>
            {(["day", "week", "month"] as CalView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="btn"
                style={{ padding: "4px 12px", fontSize: 12, background: view === v ? "var(--ink)" : "transparent", color: view === v ? "var(--paper)" : "var(--ink-2)", border: "none", borderRadius: 6, textTransform: "capitalize" }}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Nav */}
          <div className="row gap-1 aic">
            <button className="btn-icon" onClick={() => navigate(-1)} title="Previous">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            {!isAtToday && (
              <button className="btn" onClick={goToday} style={{ padding: "4px 12px", fontSize: 12 }}>Today</button>
            )}
            <button className="btn-icon" onClick={() => navigate(1)} title="Next">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>

          {/* ICS import */}
          <input
            ref={fileRef}
            type="file"
            accept=".ics"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleImport(f); e.target.value = ""; } }}
          />
          <button
            className="btn"
            style={{ fontSize: 12 }}
            disabled={importing}
            onClick={() => fileRef.current?.click()}
            title="Import .ics file"
          >
            {importing ? "Importing…" : "Import .ics"}
          </button>
        </div>
      </header>

      {/* Import feedback */}
      {importMsg && (
        <div style={{ padding: "8px 14px", background: "var(--paper-2)", borderRadius: 6, fontSize: 13, color: "var(--ink-2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{importMsg}</span>
          <button onClick={() => setImportMsg(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: 14 }}>✕</button>
        </div>
      )}
      {importError && (
        <div style={{ padding: "8px 14px", background: "var(--paper-2)", borderRadius: 6, fontSize: 13, color: "var(--terra)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>{importError}</span>
          <button onClick={() => setImportError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: 14 }}>✕</button>
        </div>
      )}

      {fetching && <p className="serif" style={{ color: "var(--ink-3)" }}>Loading…</p>}

      {/* View content */}
      {view === "day"   && <DayView   date={focusDate} tasks={tasks} today={today} onTaskClick={setSelectedTask} />}
      {view === "week"  && <WeekView  weekStart={wkStart} tasks={tasks} today={today} onTaskClick={setSelectedTask} />}
      {view === "month" && <MonthView year={year} month={month} tasks={tasks} today={today} />}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          mode={energyMode}
          onSave={(updated) => setTasks((prev) => prev.map((t) => t.id === updated.id ? updated : t))}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {/* Export */}
      {view === "month" && (
        <div style={{ marginTop: 4 }}>
          <button
            className="btn"
            style={{ fontSize: 13 }}
            onClick={() => {
              const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Circuit//EN"];
              for (const t of tasks.filter((x) => x.scheduled_at && !x.completed)) {
                const start = new Date(t.scheduled_at!);
                const end   = new Date(t.scheduled_at! + (t.duration ?? 30) * 60_000);
                const fmt   = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
                lines.push("BEGIN:VEVENT", `UID:circuit-${t.id}@circuit`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`, `SUMMARY:${t.text}`, t.tiny_step ? `DESCRIPTION:${t.tiny_step}` : "", "END:VEVENT");
              }
              lines.push("END:VCALENDAR");
              const blob = new Blob([lines.filter(Boolean).join("\r\n")], { type: "text/calendar" });
              const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "circuit.ics"; a.click();
            }}
          >
            Export .ics
          </button>
        </div>
      )}
    </div>
  );
}
