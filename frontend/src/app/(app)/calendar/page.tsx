"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiTask } from "@/lib/api";
import { useCircuitAuth } from "@/lib/use-circuit-auth";

// ── Helpers ───────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() - s.getDay()); // back to Sunday
  return s;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function taskTypeCls(task: ApiTask): string {
  const tag    = task.tag    ?? "general";
  const effort = task.effort ?? "medium";
  if (tag === "social")                      return "comms";
  if (tag === "work" && effort === "high")   return "creative";
  if (tag === "work")                        return "deep";
  if (effort === "low")                      return "admin";
  return "deep";
}

const DAY_SHORT  = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL   = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

type CalView = "day" | "week" | "month";

// ── Sub-views ─────────────────────────────────────────────────────────────────

function DayView({ date, tasks, today }: { date: Date; tasks: ApiTask[]; today: Date }) {
  const start = startOfDay(date).getTime();
  const end   = start + 86_400_000;

  const scheduled = tasks
    .filter((t) => t.scheduled_at && t.scheduled_at >= start && t.scheduled_at < end)
    .sort((a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0));

  const unscheduled = tasks.filter((t) => !t.scheduled_at && !t.completed);
  const isToday = date.toDateString() === today.toDateString();

  return (
    <div className="col gap-4">
      {scheduled.length === 0 && (
        <div className="card" style={{ padding: 32, textAlign: "center" }}>
          <p className="serif" style={{ color: "var(--ink-3)" }}>
            No tasks scheduled {isToday ? "today" : "this day"}.
          </p>
        </div>
      )}

      {scheduled.map((t) => (
        <div key={t.id} className="card" style={{ padding: "14px 18px", display: "flex", gap: 16, alignItems: "flex-start" }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)", minWidth: 64, paddingTop: 2 }}>
            {fmtTime(t.scheduled_at!)}
          </span>
          <div style={{ flex: 1 }}>
            <div className="row aic gap-2" style={{ marginBottom: t.tiny_step ? 4 : 0 }}>
              <span className={`type-dot type-${taskTypeCls(t)}`} />
              <span style={{ fontWeight: 500 }}>{t.text}</span>
              {t.duration && (
                <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                  {t.duration}m
                </span>
              )}
            </div>
            {t.tiny_step && (
              <p className="serif" style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>
                {t.tiny_step}
              </p>
            )}
          </div>
        </div>
      ))}

      {unscheduled.length > 0 && (
        <div>
          <div className="label" style={{ marginBottom: 8 }}>Unscheduled</div>
          <div className="card" style={{ padding: 6 }}>
            {unscheduled.map((t) => (
              <div key={t.id} className="task" style={{ cursor: "default", opacity: 0.7 }}>
                <span className={`type-dot type-${taskTypeCls(t)}`} />
                <span style={{ flex: 1 }}>{t.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WeekView({ weekStart, tasks, today }: { weekStart: Date; tasks: ApiTask[]; today: Date }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
      {days.map((day) => {
        const start    = startOfDay(day).getTime();
        const end      = start + 86_400_000;
        const isToday  = day.toDateString() === today.toDateString();
        const dayTasks = tasks
          .filter((t) => t.scheduled_at && t.scheduled_at >= start && t.scheduled_at < end)
          .sort((a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0));

        return (
          <div
            key={start}
            style={{
              background: isToday ? "var(--paper-2)" : "var(--paper)",
              borderLeft: "1px solid var(--line)",
              minHeight: 180,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Column header */}
            <div style={{
              padding: "8px 10px",
              borderBottom: "1px solid var(--line)",
              background: isToday ? "var(--ink)" : "var(--paper-2)",
            }}>
              <div className="mono" style={{ fontSize: 10, color: isToday ? "var(--paper-2)" : "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {DAY_SHORT[day.getDay()]}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                <span className="display" style={{ fontSize: 22, fontWeight: 600, color: isToday ? "var(--paper)" : "var(--ink)", lineHeight: 1 }}>
                  {day.getDate()}
                </span>
                {dayTasks.length > 0 && (
                  <span style={{
                    fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
                    background: isToday ? "var(--paper-2)" : "var(--ink)", color: isToday ? "var(--ink)" : "var(--paper)",
                    borderRadius: 99, padding: "1px 5px",
                  }}>
                    {dayTasks.length}
                  </span>
                )}
              </div>
            </div>

            {/* Tasks */}
            <div style={{ padding: "6px 6px", display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
              {dayTasks.map((t) => (
                <div key={t.id} className={`cal-task ${taskTypeCls(t)}`} title={t.text}>
                  <span style={{ fontSize: 10, opacity: 0.7, marginRight: 4 }}>{fmtTime(t.scheduled_at!)}</span>
                  {t.text}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

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
      {/* Day headers */}
      {DAY_SHORT.map((d) => (
        <div key={d} style={{ background: "var(--paper-2)", padding: "8px 10px", fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 500, color: "var(--ink-3)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          {d}
        </div>
      ))}

      {/* Day cells */}
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
                  <span style={{
                    fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600,
                    background: "var(--ink)", color: "var(--paper)",
                    borderRadius: 99, padding: "1px 5px", lineHeight: 1.4,
                  }}>
                    {dayTasks.length}
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {dayTasks.slice(0, 3).map((t) => (
                <div key={t.id} className={`cal-task ${taskTypeCls(t)}`} title={t.text}>{t.text}</div>
              ))}
              {overflow && (
                <span className="mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                  +{dayTasks.length - 3} more
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { user, loading } = useCircuitAuth();
  const router = useRouter();
  const [tasks, setTasks]   = useState<ApiTask[]>([]);
  const [fetching, setFetching] = useState(false);
  const [view, setView]     = useState<CalView>("month");
  const today = useMemo(() => startOfDay(new Date()), []);
  const [focusDate, setFocusDate] = useState<Date>(() => startOfDay(new Date()));

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    api.listTasks().then(setTasks).catch(() => {}).finally(() => setFetching(false));
  }, [user]);

  if (loading || !user) return null;

  function navigate(delta: -1 | 1) {
    setFocusDate((d) => {
      const next = new Date(d);
      if (view === "day")   next.setDate(d.getDate() + delta);
      else if (view === "week") next.setDate(d.getDate() + delta * 7);
      else { next.setDate(1); next.setMonth(d.getMonth() + delta); }
      return next;
    });
  }

  function goToday() { setFocusDate(startOfDay(new Date())); }

  // Header label
  const year  = focusDate.getFullYear();
  const month = focusDate.getMonth();
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

  const scheduledCount = tasks.filter((t) => t.scheduled_at && !t.completed).length;
  const unscheduledCount = tasks.filter((t) => !t.scheduled_at && !t.completed).length;

  return (
    <div className="col gap-5">
      {/* Header */}
      <header className="between" style={{ alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Calendar</div>
          <h1 className="display" style={{ fontSize: 32, margin: 0 }}>
            {headerLabel}
          </h1>
          <div className="row gap-3" style={{ marginTop: 4 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
              {scheduledCount} scheduled
            </span>
            {unscheduledCount > 0 && (
              <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                · {unscheduledCount} unscheduled
              </span>
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
                style={{
                  padding: "4px 12px",
                  fontSize: 12,
                  background: view === v ? "var(--ink)" : "transparent",
                  color: view === v ? "var(--paper)" : "var(--ink-2)",
                  border: "none",
                  borderRadius: 6,
                  textTransform: "capitalize",
                }}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div className="row gap-1 aic">
            <button className="btn-icon" onClick={() => navigate(-1)} title="Previous">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            {!isAtToday && (
              <button className="btn" onClick={goToday} style={{ padding: "4px 12px", fontSize: 12 }}>Today</button>
            )}
            <button className="btn-icon" onClick={() => navigate(1)} title="Next">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {fetching && <p className="serif" style={{ color: "var(--ink-3)" }}>Loading…</p>}

      {/* View content */}
      {view === "day"   && <DayView   date={focusDate} tasks={tasks} today={today} />}
      {view === "week"  && <WeekView  weekStart={wkStart} tasks={tasks} today={today} />}
      {view === "month" && <MonthView year={year} month={month} tasks={tasks} today={today} />}

      {/* Export — month view only */}
      {view === "month" && (
        <div style={{ marginTop: 4 }}>
          <button
            className="btn"
            style={{ fontSize: 13 }}
            onClick={() => {
              const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Circuit//EN"];
              for (const t of tasks.filter((x) => x.scheduled_at && !x.completed)) {
                const start = new Date(t.scheduled_at!);
                const end   = new Date(t.scheduled_at! + (t.duration ?? 30) * 60000);
                const fmt   = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
                lines.push("BEGIN:VEVENT", `UID:circuit-${t.id}@circuit`, `DTSTART:${fmt(start)}`, `DTEND:${fmt(end)}`, `SUMMARY:${t.text}`, t.tiny_step ? `DESCRIPTION:Next: ${t.tiny_step}` : "", "END:VEVENT");
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
