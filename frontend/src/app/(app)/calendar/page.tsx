"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiTask } from "@/lib/api";
import { useCircuitAuth } from "@/lib/use-circuit-auth";

// ── Helpers ───────────────────────────────────────────────────────────────────

function startOfMonth(y: number, m: number): Date {
  return new Date(y, m, 1);
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
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

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  creative: { label: "creative",  color: "var(--terra)"   },
  deep:     { label: "deep work", color: "var(--sage)"    },
  comms:    { label: "comms",     color: "var(--mustard)" },
  admin:    { label: "admin",     color: "var(--ink-3)"   },
  errand:   { label: "errand",    color: "var(--rose)"    },
};

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { user, loading } = useCircuitAuth();
  const router = useRouter();
  const [tasks, setTasks]   = useState<ApiTask[]>([]);
  const [fetching, setFetching] = useState(false);
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    api.listTasks().then(setTasks).catch(() => {}).finally(() => setFetching(false));
  }, [user]);

  if (loading || !user) return null;

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  }
  function goToday() { setYear(today.getFullYear()); setMonth(today.getMonth()); }

  const dim        = daysInMonth(year, month);
  const startWd    = startOfMonth(year, month).getDay();
  const totalCells = Math.ceil((dim + startWd) / 7) * 7;

  // Map tasks to day buckets for this month
  const tasksByDay: Record<number, ApiTask[]> = {};
  tasks.forEach((t) => {
    if (!t.scheduled_at) return;
    const d = new Date(t.scheduled_at);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    const day = d.getDate();
    (tasksByDay[day] ??= []).push(t);
  });

  const unscheduledCount = tasks.filter((t) => !t.scheduled_at && !t.completed).length;
  const totalPlaced = Object.values(tasksByDay).reduce((s, ts) => s + ts.length, 0);

  return (
    <div className="col gap-5">
      {/* Header */}
      <header className="between" style={{ alignItems: "flex-end" }}>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>Month view</div>
          <h1 className="display" style={{ fontSize: 36, margin: 0 }}>
            {MONTH_NAMES[month]} {year}{" "}
            <span className="serif" style={{ color: "var(--ink-3)", fontSize: 24 }}>
              — {totalPlaced} task{totalPlaced !== 1 ? "s" : ""} placed
            </span>
          </h1>
        </div>
        <div className="row gap-2 aic">
          <button className="btn-icon" onClick={prevMonth} title="Previous month">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          {(year !== today.getFullYear() || month !== today.getMonth()) && (
            <button className="btn" onClick={goToday} style={{ padding: "6px 14px", fontSize: 13 }}>Today</button>
          )}
          <button className="btn-icon" onClick={nextMonth} title="Next month">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
      </header>

      {/* Type legend */}
      <div className="row gap-4 wrap" style={{ paddingLeft: 4 }}>
        {Object.entries(TYPE_LABELS).map(([k, v]) => (
          <span key={k} className="mono" style={{ fontSize: 11, color: "var(--ink-2)" }}>
            <span
              className="type-dot"
              style={{ background: v.color, marginRight: 6, verticalAlign: "middle" }}
            />
            {v.label}
          </span>
        ))}
        {unscheduledCount > 0 && (
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)", marginLeft: "auto" }}>
            {unscheduledCount} unscheduled
          </span>
        )}
      </div>

      {fetching && (
        <p className="serif" style={{ color: "var(--ink-3)" }}>Loading…</p>
      )}

      {/* Calendar grid */}
      <div className="cal-grid">
        {/* Day headers */}
        {DAY_HEADERS.map((d) => (
          <div
            key={d}
            style={{
              background: "var(--paper-2)",
              padding: "8px 10px",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              fontWeight: 500,
              color: "var(--ink-3)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
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
            <div
              key={i}
              className={"cal-cell" + (!inMonth ? " is-other" : "") + (isToday ? " is-today" : "")}
            >
              <div className="between" style={{ marginBottom: 2 }}>
                <span className="cal-num">
                  {inMonth ? String(dayNum).padStart(2, "0") : ""}
                </span>
                {isToday && (
                  <span className="tiny" style={{ color: "var(--terra)" }}>TODAY</span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {dayTasks.slice(0, 3).map((t) => (
                  <div key={t.id} className={`cal-task ${taskTypeCls(t)}`} title={t.text}>
                    {t.text}
                  </div>
                ))}
                {overflow && (
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: "var(--ink-3)" }}
                  >
                    +{dayTasks.length - 3} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Export */}
      <div style={{ marginTop: 4 }}>
        <button
          className="btn"
          style={{ fontSize: 13 }}
          onClick={() => {
            const lines = [
              "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Circuit//EN",
            ];
            for (const t of tasks.filter((x) => x.scheduled_at && !x.completed)) {
              const start = new Date(t.scheduled_at!);
              const end   = new Date(t.scheduled_at! + (t.duration ?? 30) * 60000);
              const fmt   = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
              lines.push(
                "BEGIN:VEVENT",
                `UID:circuit-${t.id}@circuit`,
                `DTSTART:${fmt(start)}`,
                `DTEND:${fmt(end)}`,
                `SUMMARY:${t.text}`,
                t.tiny_step ? `DESCRIPTION:Next: ${t.tiny_step}` : "",
                "END:VEVENT",
              );
            }
            lines.push("END:VCALENDAR");
            const blob = new Blob([lines.filter(Boolean).join("\r\n")], { type: "text/calendar" });
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "circuit.ics";
            a.click();
          }}
        >
          Export .ics
        </button>
      </div>
    </div>
  );
}
