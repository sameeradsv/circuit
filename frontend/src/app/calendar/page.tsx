"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiTask } from "@/lib/api";
import { useCircuitAuth } from "@/lib/use-circuit-auth";
import { formatSlot } from "@/lib/suggest-slot";

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 22;
const TOTAL_HOURS = DAY_END_HOUR - DAY_START_HOUR;
const SLOT_HEIGHT_PX = 64; // px per hour

function startOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function fmtHour(h: number): string {
  const ampm = h < 12 ? 'am' : 'pm';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${ampm}`;
}

function taskTopPct(scheduledAt: number, date: Date): number {
  const d = new Date(scheduledAt);
  const hours = d.getHours() + d.getMinutes() / 60;
  return ((hours - DAY_START_HOUR) / TOTAL_HOURS) * 100;
}

function taskHeightPct(duration: number): number {
  return ((duration / 60) / TOTAL_HOURS) * 100;
}

export default function CalendarPage() {
  const { user, loading } = useCircuitAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [date, setDate] = useState(new Date());
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    setFetching(true);
    api.listTasks().then(setTasks).catch(() => {}).finally(() => setFetching(false));
  }, [user]);

  if (loading || !user) return null;

  const dayStart = startOfDay(date);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;

  const scheduled = tasks.filter(
    (t) => t.scheduled_at != null && t.scheduled_at >= dayStart && t.scheduled_at < dayEnd && !t.completed
  );
  const unscheduled = tasks.filter((t) => !t.scheduled_at && !t.completed);

  function prevDay() { setDate((d) => new Date(d.getTime() - 86400000)); }
  function nextDay() { setDate((d) => new Date(d.getTime() + 86400000)); }
  function goToday() { setDate(new Date()); }

  function exportIcs() {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Circuit//EN',
    ];
    for (const t of tasks.filter((x) => x.scheduled_at && !x.completed)) {
      const start = new Date(t.scheduled_at!);
      const end = new Date(t.scheduled_at! + (t.duration ?? 30) * 60000);
      const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      lines.push(
        'BEGIN:VEVENT',
        `UID:circuit-${t.id}@circuit`,
        `DTSTART:${fmt(start)}`,
        `DTEND:${fmt(end)}`,
        `SUMMARY:${t.text}`,
        t.tiny_step ? `DESCRIPTION:Next: ${t.tiny_step}` : '',
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.filter(Boolean).join('\r\n')], { type: 'text/calendar' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'circuit.ics';
    a.click();
  }

  const isToday = startOfDay(date) === startOfDay(new Date());

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={prevDay} className="text-circuit-muted hover:text-circuit-text text-lg">‹</button>
          <h1 className={`text-sm font-medium ${isToday ? 'text-circuit-accent' : 'text-circuit-text'}`}>
            {isToday ? 'Today — ' : ''}{fmtDate(date)}
          </h1>
          <button onClick={nextDay} className="text-circuit-muted hover:text-circuit-text text-lg">›</button>
          {!isToday && (
            <button onClick={goToday} className="text-xs text-circuit-muted hover:text-circuit-accent">
              Today
            </button>
          )}
        </div>
        <button onClick={exportIcs} className="text-xs text-circuit-muted hover:text-circuit-accent">
          Export .ics
        </button>
      </div>

      {fetching && <p className="text-sm text-circuit-muted">Loading…</p>}

      <div className="flex gap-4">
        {/* Day grid */}
        <div className="flex-1 relative">
          {/* Hour lines */}
          <div
            className="relative border border-circuit-border rounded-lg overflow-hidden"
            style={{ height: `${TOTAL_HOURS * SLOT_HEIGHT_PX}px` }}
          >
            {Array.from({ length: TOTAL_HOURS }, (_, i) => (
              <div
                key={i}
                className="absolute w-full border-t border-circuit-border flex items-start"
                style={{ top: `${(i / TOTAL_HOURS) * 100}%` }}
              >
                <span className="text-xs text-circuit-muted px-2 py-0.5 w-12 shrink-0">
                  {fmtHour(DAY_START_HOUR + i)}
                </span>
              </div>
            ))}

            {/* Current time indicator */}
            {isToday && (() => {
              const now = new Date();
              const h = now.getHours() + now.getMinutes() / 60;
              if (h < DAY_START_HOUR || h > DAY_END_HOUR) return null;
              const top = ((h - DAY_START_HOUR) / TOTAL_HOURS) * 100;
              return (
                <div
                  className="absolute left-12 right-0 border-t-2 border-circuit-accent z-10 pointer-events-none"
                  style={{ top: `${top}%` }}
                >
                  <div className="w-2 h-2 rounded-full bg-circuit-accent -mt-1 -ml-1" />
                </div>
              );
            })()}

            {/* Scheduled tasks */}
            {scheduled.map((t) => {
              const top = taskTopPct(t.scheduled_at!, date);
              const height = Math.max(3, taskHeightPct(t.duration ?? 30));
              const isOverdue = t.scheduled_at! < Date.now() && !t.completed;
              return (
                <div
                  key={t.id}
                  className={`absolute left-12 right-2 rounded px-2 py-1 text-xs overflow-hidden border ${
                    isOverdue
                      ? 'bg-red-900/30 border-red-500/50 text-red-300'
                      : 'bg-circuit-accent/15 border-circuit-accent/40 text-circuit-text'
                  }`}
                  style={{ top: `${top}%`, height: `${height}%`, minHeight: '22px' }}
                  title={`${t.text} (${t.duration}m)`}
                >
                  <p className="font-medium truncate">{t.text}</p>
                  {height > 5 && (
                    <p className="text-circuit-muted truncate">{formatSlot(t.scheduled_at!)}</p>
                  )}
                </div>
              );
            })}
          </div>

          {scheduled.length === 0 && !fetching && (
            <p className="mt-4 text-center text-sm text-circuit-muted">
              No tasks scheduled for this day. Use ↷ reschedule on a task.
            </p>
          )}
        </div>

        {/* Unscheduled sidebar */}
        {unscheduled.length > 0 && (
          <div className="w-56 shrink-0 space-y-2">
            <p className="text-xs uppercase tracking-wider text-circuit-muted">Unscheduled</p>
            <ul className="space-y-1">
              {unscheduled.map((t) => (
                <li
                  key={t.id}
                  className="panel px-3 py-2 text-xs text-circuit-muted truncate"
                  title={t.text}
                >
                  {t.text}
                  <span className="ml-1 opacity-60">{t.duration}m</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
