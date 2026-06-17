"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiBlackout, ApiTask } from "@/lib/api";
import { useAuth } from "@shared/cortex";
import { TaskDetailModal } from "@/components/TaskDetailModal";
import { BlackoutDayOverlay, BlackoutMonthBadge, blackoutCellStyle } from "@/components/calendar/BlackoutLayers";
import { useEnergyMode } from "@/lib/use-energy-mode";
import { updateTaskInCache } from "@/lib/task-cache";
import { layoutOverlappingTasks, TaskLayoutSlot } from "@/lib/calendar-layout";

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

function snapMs(ms: number, snapMins = 15): number {
  return Math.round(ms / (snapMins * 60_000)) * (snapMins * 60_000);
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

/** Visible calendar grid range (ms), including leading/trailing days in month view. */
function visibleRangeMs(view: CalView, focusDate: Date): { from: number; to: number } {
  if (view === "day") {
    const start = startOfDay(focusDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { from: start.getTime(), to: end.getTime() - 1 };
  }
  if (view === "week") {
    const start = startOfWeek(focusDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { from: start.getTime(), to: end.getTime() - 1 };
  }
  const year = focusDate.getFullYear();
  const month = focusDate.getMonth();
  const gridStart = startOfWeek(new Date(year, month, 1));
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridEnd.getDate() + 42);
  return { from: gridStart.getTime(), to: gridEnd.getTime() - 1 };
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

// Compute drop time from Y position within a grid column
function yToMs(relY: number, dayStart: number): number {
  const totalMins = Math.max(0, Math.min(23 * 60 + 45, Math.round(relY / HOUR_H * 60 / 15) * 15));
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  const d = new Date(dayStart);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

const DAY_SHORT   = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL    = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

type CalView = "day" | "week" | "month";

function defaultCalView(): CalView {
  if (typeof window === "undefined") return "month";
  return window.matchMedia("(orientation: portrait)").matches ? "day" : "month";
}

interface PendingDrop {
  task: ApiTask;
  newMs: number;
  origMs: number;
}

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

// ── Drop indicator line ───────────────────────────────────────────────────────

function DropLine({ top }: { top: number }) {
  return (
    <div style={{
      position: "absolute",
      top,
      left: 0,
      right: 0,
      height: 2,
      background: "var(--circuit-accent, var(--terra))",
      zIndex: 10,
      pointerEvents: "none",
      borderRadius: 1,
    }} />
  );
}

function blockHorizontalStyle(
  layout: TaskLayoutSlot | undefined,
  compact: boolean,
): { left: string; width: string; right?: string } {
  const pad = compact ? 2 : 4;
  const gap = compact ? 2 : 4;
  if (!layout || layout.totalColumns <= 1) {
    return { left: `${pad}px`, right: `${pad}px`, width: "auto" };
  }
  const colW = 100 / layout.totalColumns;
  return {
    left: `calc(${layout.column * colW}% + ${pad}px)`,
    width: `calc(${colW}% - ${gap}px)`,
  };
}

// ── Task block ────────────────────────────────────────────────────────────────

function TaskBlock({
  task,
  compact = false,
  layout,
  onClick,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  task: ApiTask;
  compact?: boolean;
  layout?: TaskLayoutSlot;
  onClick?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  const top       = taskTop(task.scheduled_at!);
  const rawHeight = taskHeight(task.duration ?? 30);
  // Cap at midnight so overnight tasks don't push the grid taller than 24 h
  const height    = Math.min(rawHeight, TOTAL_H - top - 2);
  const overflows = rawHeight > height; // task continues into next day
  const bufBefore = task.travel_buffer_before_mins ?? 0;
  const bufAfter  = task.travel_buffer_after_mins  ?? 0;
  const bufBeforeH = bufBefore / 60 * HOUR_H;
  const bufAfterH  = bufAfter  / 60 * HOUR_H;
  const hPos = blockHorizontalStyle(layout, compact);
  const bufferStyle = {
    position: "absolute" as const,
    ...hPos,
    background: "repeating-linear-gradient(45deg, var(--line) 0px, var(--line) 1px, transparent 1px, transparent 6px)",
    opacity: 0.5,
    borderRadius: 3,
    pointerEvents: "none" as const,
    zIndex: 0,
  };
  return (
    <>
      {bufBefore > 0 && (
        <div
          title={`${bufBefore}m travel before ${task.text}`}
          style={{ ...bufferStyle, top: top - bufBeforeH, height: bufBeforeH }}
        />
      )}
      <div
        title={`${task.text} · ${fmtTime(task.scheduled_at!)} · ${task.duration ?? 30}m`}
        draggable={!!onDragStart}
        onClick={onClick}
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", String(task.id));
          e.dataTransfer.effectAllowed = "move";
          onDragStart?.();
        }}
        onDragEnd={onDragEnd}
        style={{
          position: "absolute",
          top,
          ...hPos,
          height,
          background: "var(--paper)",
          borderLeft: `3px solid ${taskAccent(task)}`,
          borderRadius: overflows ? "0 4px 0 0" : "0 4px 4px 0",
          borderBottom: overflows ? `2px dashed ${taskAccent(task)}` : undefined,
          padding: compact ? "2px 4px" : "3px 6px",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          zIndex: 1,
          cursor: onDragStart ? "grab" : (onClick ? "pointer" : "default"),
          opacity: isDragging ? 0.35 : 1,
          transition: "opacity 0.1s",
          minWidth: 0,
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
            {fmtTime(task.scheduled_at!)} · {task.duration ?? 30}m{overflows ? " →" : ""}
          </span>
        )}
      </div>
      {bufAfter > 0 && (
        <div
          title={`${bufAfter}m travel after ${task.text}`}
          style={{ ...bufferStyle, top: top + height + 2, height: bufAfterH }}
        />
      )}
    </>
  );
}

// ── Continuation block (overnight task from previous day) ─────────────────────

function ContinuationBlock({
  task,
  dayStart,
  dayEnd,
  compact = false,
  layout,
  onClick,
}: {
  task: ApiTask;
  dayStart: number;
  dayEnd: number;
  compact?: boolean;
  layout?: TaskLayoutSlot;
  onClick?: () => void;
}) {
  const endMs      = task.scheduled_at! + (task.duration ?? 30) * 60_000;
  const overlapMin = (Math.min(endMs, dayEnd) - dayStart) / 60_000;
  const height     = Math.max(24, overlapMin / 60 * HOUR_H - 2);
  const accent     = taskAccent(task);
  const hPos = blockHorizontalStyle(layout, compact);
  return (
    <div
      title={`${task.text} · continued from previous day · ends ${fmtTime(endMs)}`}
      onClick={onClick}
      style={{
        position: "absolute",
        top: 0,
        ...hPos,
        height,
        background: "var(--paper)",
        borderLeft: `3px solid ${accent}`,
        borderTop: `2px dashed ${accent}`,
        borderRadius: "0 0 4px 0",
        padding: compact ? "2px 4px" : "3px 6px",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        zIndex: 1,
        cursor: onClick ? "pointer" : "default",
        opacity: 0.85,
        minWidth: 0,
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
          ← ends {fmtTime(endMs)}
        </span>
      )}
    </div>
  );
}

// ── Day view ──────────────────────────────────────────────────────────────────

function DayView({
  date, tasks, today, blackouts, onTaskClick,
  dragTask, onDropTask, onDragStart, onDragEnd,
}: {
  date: Date;
  tasks: ApiTask[];
  today: Date;
  blackouts: ApiBlackout[];
  onTaskClick: (t: ApiTask) => void;
  dragTask: ApiTask | null;
  onDropTask: (task: ApiTask, newMs: number) => void;
  onDragStart: (t: ApiTask) => void;
  onDragEnd: () => void;
}) {
  const scrollRef  = useRef<HTMLDivElement>(null);
  const taskColRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_7AM; }, []);

  const [dropTop, setDropTop] = useState<number | null>(null);

  const dayStart = startOfDay(date).getTime();
  const end      = dayStart + 86_400_000;

  const dayTasks = tasks
    .filter((t) => t.scheduled_at && t.scheduled_at >= dayStart && t.scheduled_at < end)
    .sort((a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0));

  // Tasks that started yesterday but extend into today
  const continuationTasks = tasks.filter((t) => {
    if (!t.scheduled_at || !t.duration) return false;
    return t.scheduled_at < dayStart && t.scheduled_at + t.duration * 60_000 > dayStart;
  });

  const visible    = dayTasks.filter((t) => inRange(t.scheduled_at!));
  const outOfRange = dayTasks.filter((t) => !inRange(t.scheduled_at!));
  const unscheduled = tasks.filter((t) => !t.scheduled_at && !t.completed);

  const layoutMap = layoutOverlappingTasks([...visible, ...continuationTasks]);

  const isToday = date.toDateString() === today.toDateString();
  const nowMins = isToday ? (today.getHours() - START_H) * 60 + today.getMinutes() : -1;

  function getRelY(e: React.DragEvent): number {
    const rect = taskColRef.current!.getBoundingClientRect();
    return e.clientY - rect.top;
  }

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

          {/* Task column */}
          <div
            ref={taskColRef}
            style={{ position: "absolute", top: 0, bottom: 0, left: LABEL_W, right: 0 }}
            onDragOver={(e) => {
              if (!dragTask) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDropTop(getRelY(e));
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTop(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!dragTask) return;
              onDropTask(dragTask, snapMs(yToMs(getRelY(e), dayStart)));
              setDropTop(null);
            }}
          >
            <BlackoutDayOverlay day={date} blackouts={blackouts} />
            <HourLines />

            {/* Current time indicator */}
            {nowMins >= 0 && nowMins < (END_H - START_H) * 60 && (
              <div style={{ position: "absolute", top: nowMins / 60 * HOUR_H, left: 0, right: 0, zIndex: 5, display: "flex", alignItems: "center" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--terra)", flexShrink: 0, marginLeft: -4 }} />
                <div style={{ flex: 1, height: 2, background: "var(--terra)" }} />
              </div>
            )}

            {dropTop !== null && <DropLine top={dropTop} />}

            {continuationTasks.map((t) => (
              <ContinuationBlock
                key={`cont-${t.id}`}
                task={t}
                dayStart={dayStart}
                dayEnd={end}
                layout={layoutMap.get(t.id)}
                onClick={() => onTaskClick(t)}
              />
            ))}

            {visible.map((t) => (
              <TaskBlock
                key={t.id}
                task={t}
                layout={layoutMap.get(t.id)}
                onClick={() => onTaskClick(t)}
                onDragStart={() => onDragStart(t)}
                onDragEnd={onDragEnd}
                isDragging={dragTask?.id === t.id}
              />
            ))}
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

function WeekView({
  weekStart, tasks, today, blackouts, onTaskClick,
  dragTask, onDropTask, onDragStart, onDragEnd,
}: {
  weekStart: Date;
  tasks: ApiTask[];
  today: Date;
  blackouts: ApiBlackout[];
  onTaskClick: (t: ApiTask) => void;
  dragTask: ApiTask | null;
  onDropTask: (task: ApiTask, newMs: number) => void;
  onDragStart: (t: ApiTask) => void;
  onDragEnd: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_7AM; }, []);

  // Track which column is being dragged over and at what Y
  const [dropInfo, setDropInfo] = useState<{ dayIdx: number; top: number } | null>(null);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  const todayIdx = days.findIndex((d) => d.toDateString() === today.toDateString());
  const nowMins  = (today.getHours() - START_H) * 60 + today.getMinutes();

  return (
    <div className="cal-week-scroll">
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden", minWidth: 900 }}>
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
            const dayStart = startOfDay(day).getTime();
            const end      = dayStart + 86_400_000;
            const isToday  = di === todayIdx;
            const dayTasks = tasks
              .filter((t) => t.scheduled_at && t.scheduled_at >= dayStart && t.scheduled_at < end && inRange(t.scheduled_at))
              .sort((a, b) => (a.scheduled_at ?? 0) - (b.scheduled_at ?? 0));
            const dayContinuations = tasks.filter((t) => {
              if (!t.scheduled_at || !t.duration) return false;
              return t.scheduled_at < dayStart && t.scheduled_at + t.duration * 60_000 > dayStart;
            });
            const dayLayoutMap = layoutOverlappingTasks([...dayTasks, ...dayContinuations]);

            return (
              <div
                key={di}
                style={{ position: "relative", height: TOTAL_H, borderLeft: "1px solid var(--line)", background: isToday ? "rgba(0,0,0,0.02)" : undefined }}
                onDragOver={(e) => {
                  if (!dragTask) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDropInfo({ dayIdx: di, top: e.clientY - rect.top });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDropInfo((prev) => prev?.dayIdx === di ? null : prev);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!dragTask) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const relY = e.clientY - rect.top;
                  onDropTask(dragTask, snapMs(yToMs(relY, dayStart)));
                  setDropInfo(null);
                }}
              >
                <BlackoutDayOverlay day={day} blackouts={blackouts} />
                <HourLines />

                {/* Current time bar */}
                {isToday && nowMins >= 0 && nowMins < (END_H - START_H) * 60 && (
                  <div style={{ position: "absolute", top: nowMins / 60 * HOUR_H, left: 0, right: 0, height: 2, background: "var(--terra)", zIndex: 5 }} />
                )}

                {dropInfo?.dayIdx === di && <DropLine top={dropInfo.top} />}

                {dayContinuations.map((t) => (
                  <ContinuationBlock
                    key={`cont-${t.id}`}
                    task={t}
                    dayStart={dayStart}
                    dayEnd={end}
                    compact
                    layout={dayLayoutMap.get(t.id)}
                    onClick={() => onTaskClick(t)}
                  />
                ))}

                {dayTasks.map((t) => (
                  <TaskBlock
                    key={t.id}
                    task={t}
                    compact
                    layout={dayLayoutMap.get(t.id)}
                    onClick={() => onTaskClick(t)}
                    onDragStart={() => onDragStart(t)}
                    onDragEnd={onDragEnd}
                    isDragging={dragTask?.id === t.id}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </div>
  );
}

// ── Month view ────────────────────────────────────────────────────────────────

function MonthView({
  year, month, tasks, today, blackouts, onTaskClick,
  dragTask, onDropTask, onDragStart, onDragEnd,
}: {
  year: number;
  month: number;
  tasks: ApiTask[];
  today: Date;
  blackouts: ApiBlackout[];
  onTaskClick: (t: ApiTask) => void;
  dragTask: ApiTask | null;
  onDropTask: (task: ApiTask, newMs: number) => void;
  onDragStart: (t: ApiTask) => void;
  onDragEnd: () => void;
}) {
  const dim        = daysInMonth(year, month);
  const startWd    = new Date(year, month, 1).getDay();
  const totalCells = Math.ceil((dim + startWd) / 7) * 7;
  const [dropDay, setDropDay] = useState<number | null>(null);
  const dragClickBlock = useRef(false);

  const tasksByDay: Record<number, ApiTask[]> = {};
  tasks.forEach((t) => {
    if (!t.scheduled_at) return;
    const d = new Date(t.scheduled_at);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    (tasksByDay[d.getDate()] ??= []).push(t);
  });

  return (
    <div className="cal-month-scroll">
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
        const isDropTarget = inMonth && dropDay === dayNum;
        const cellDay = inMonth ? new Date(year, month, dayNum) : null;
        const cellStyle = cellDay ? blackoutCellStyle(cellDay, blackouts) : undefined;

        return (
          <div
            key={i}
            className={"cal-cell" + (!inMonth ? " is-other" : "") + (isToday ? " is-today" : "")}
            style={{
              ...(isDropTarget ? { outline: "2px solid var(--circuit-accent, var(--terra))", outlineOffset: -2 } : {}),
              ...cellStyle,
            }}
            onDragOver={(e) => {
              if (!dragTask || !inMonth) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              setDropDay(dayNum);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDropDay((prev) => prev === dayNum ? null : prev);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!dragTask || !inMonth) return;
              // Keep original time-of-day, only change the date
              const orig = dragTask.scheduled_at ? new Date(dragTask.scheduled_at) : new Date();
              const newDate = new Date(year, month, dayNum, orig.getHours(), orig.getMinutes(), 0, 0);
              onDropTask(dragTask, newDate.getTime());
              setDropDay(null);
            }}
          >
            <div className="between" style={{ marginBottom: 4 }}>
              <span className="cal-num">{inMonth ? String(dayNum).padStart(2, "0") : ""}</span>
              <div className="row gap-2 aic">
                {inMonth && cellDay && <BlackoutMonthBadge day={cellDay} blackouts={blackouts} />}
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
                <div
                  key={t.id}
                  className={`cal-task ${taskTypeCls(t)}`}
                  title={`${fmtTime(t.scheduled_at!)} · ${t.text}`}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    dragClickBlock.current = true;
                    e.dataTransfer.setData("text/plain", String(t.id));
                    e.dataTransfer.effectAllowed = "move";
                    onDragStart(t);
                  }}
                  onDragEnd={(e) => {
                    e.stopPropagation();
                    onDragEnd();
                    window.setTimeout(() => { dragClickBlock.current = false; }, 0);
                  }}
                  onClick={() => {
                    if (dragClickBlock.current) return;
                    onTaskClick(t);
                  }}
                  style={{
                    cursor: "grab",
                    opacity: dragTask?.id === t.id ? 0.35 : 1,
                  }}
                >
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
    </div>
  );
}

// ── Drop confirmation banner ──────────────────────────────────────────────────

function DropConfirmBanner({
  task,
  newMs,
  onOccurrence,
  onSeries,
  onCancel,
}: {
  task: ApiTask;
  newMs: number;
  onOccurrence: () => void;
  onSeries: () => void;
  onCancel: () => void;
}) {
  const newTime = fmtTime(newMs);
  const newDate = new Date(newMs).toLocaleDateString("en-IN", {
    weekday: "short", month: "short", day: "numeric", timeZone: "Asia/Kolkata",
  });
  return (
    <div
      className="above-tab-bar"
      style={{
        position: "fixed",
        left: "50%",
        transform: "translateX(-50%)",
        background: "var(--paper)",
        border: "1px solid var(--line)",
        borderRadius: 10,
        padding: "12px 16px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: "min(320px, calc(100vw - 32px))",
        maxWidth: "min(480px, calc(100vw - 32px))",
        width: "calc(100vw - 32px)",
      }}
    >
      <div style={{ fontSize: 13, color: "var(--ink)", fontWeight: 500 }}>
        Move <em style={{ fontStyle: "normal", color: "var(--ink-2)" }}>{task.text}</em> to {newDate} at {newTime}?
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: -4 }}>
        This is a recurring task.
      </div>
      <div className="row gap-2 drop-confirm-actions" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
        <button
          className="btn"
          style={{ fontSize: 12, padding: "5px 12px", background: "none", color: "var(--ink-3)", border: "1px solid var(--line)" }}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="btn"
          style={{ fontSize: 12, padding: "5px 12px", background: "var(--paper-2)", color: "var(--ink)" }}
          onClick={onSeries}
        >
          Shift series
        </button>
        <button
          className="btn"
          style={{ fontSize: 12, padding: "5px 12px", background: "var(--ink)", color: "var(--paper)" }}
          onClick={onOccurrence}
        >
          This occurrence only
        </button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tasks, setTasks]   = useState<ApiTask[]>([]);
  const [blackouts, setBlackouts] = useState<ApiBlackout[]>([]);
  const [fetching, setFetching] = useState(false);
  const [view, setView]     = useState<CalView>("month");
  const today = useMemo(() => startOfDay(new Date()), []);
  const [focusDate, setFocusDate] = useState<Date>(() => startOfDay(new Date()));
  const [energyMode] = useEnergyMode();
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<ApiTask | null>(null);
  const [dragTask, setDragTask] = useState<ApiTask | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    setView(defaultCalView());
  }, []);

  useEffect(() => {
    if (!user) return;
    api.listBlackouts().then(setBlackouts).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const { from, to } = visibleRangeMs(view, focusDate);
    setFetching(true);
    api.listTasks({ scheduled_from_ms: from, scheduled_to_ms: to, include_unscheduled: true })
      .then(setTasks)
      .catch(() => {})
      .finally(() => setFetching(false));
  }, [user, view, focusDate]);

  if (loading || !user) return null;

  async function applyDrop(taskId: number, patch: { scheduled_at: number; recurrence_anchor_ms?: number }) {
    try {
      const updated = await api.updateTask(taskId, patch);
      updateTaskInCache(updated);
      setTasks((prev) => prev.map((t) => t.id === updated.id ? updated : t));
    } catch {
      // silent — task stays in its original position
    }
  }

  function handleDropTask(task: ApiTask, newMs: number) {
    if (newMs === task.scheduled_at) return;
    if (task.recurrence || task.rrule) {
      setPendingDrop({ task, newMs, origMs: task.scheduled_at! });
      return;
    }
    void applyDrop(task.id, { scheduled_at: newMs });
  }

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
      const { from, to } = visibleRangeMs(view, focusDate);
      const updated = await api.listTasks({ scheduled_from_ms: from, scheduled_to_ms: to, include_unscheduled: true });
      setTasks(updated);
    } catch (e) {
      setImportMsg(`Import failed: ${e instanceof Error ? e.message : "unknown error"}`);
    } finally {
      setImporting(false);
    }
  }

  async function downloadIcs() {
    try {
      const res = await api.exportCalendar();
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const dateStr = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `circuit-${dateStr}.ics`;
      a.click();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Export failed");
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

  const dragHandlers = {
    dragTask,
    onDropTask: handleDropTask,
    onDragStart: (t: ApiTask) => setDragTask(t),
    onDragEnd: () => setDragTask(null),
  };

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

          {/* ICS import/export — hidden on mobile; export also lives at page bottom */}
          <input
            ref={fileRef}
            type="file"
            accept=".ics"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleImport(f); e.target.value = ""; } }}
          />
          <div className="cal-ics-btns row gap-2">
            <button
              className="btn"
              style={{ fontSize: 12 }}
              disabled={importing}
              onClick={() => fileRef.current?.click()}
              title="Import .ics file"
            >
              {importing ? "Importing…" : "Import .ics"}
            </button>
            <button
              className="btn"
              style={{ fontSize: 12 }}
              onClick={() => api.exportCalendar()}
              title="Download .ics export"
            >
              Export .ics
            </button>
          </div>
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
      {view === "day"   && <DayView   date={focusDate} tasks={tasks} today={today} blackouts={blackouts} onTaskClick={setSelectedTask} {...dragHandlers} />}
      {view === "week"  && <WeekView  weekStart={wkStart} tasks={tasks} today={today} blackouts={blackouts} onTaskClick={setSelectedTask} {...dragHandlers} />}
      {view === "month" && <MonthView year={year} month={month} tasks={tasks} today={today} blackouts={blackouts} onTaskClick={setSelectedTask} {...dragHandlers} />}

      {pendingDrop && (
        <DropConfirmBanner
          task={pendingDrop.task}
          newMs={pendingDrop.newMs}
          onOccurrence={() => {
            const { task, newMs, origMs } = pendingDrop;
            setPendingDrop(null);
            void applyDrop(task.id, { scheduled_at: newMs, recurrence_anchor_ms: origMs });
          }}
          onSeries={() => {
            const { task, newMs } = pendingDrop;
            setPendingDrop(null);
            void applyDrop(task.id, { scheduled_at: newMs });
          }}
          onCancel={() => setPendingDrop(null)}
        />
      )}

      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          mode={energyMode}
          onSave={(updated) => {
            setTasks((prev) => {
              const next = prev.map((t) => t.id === updated.id ? updated : t);
              updateTaskInCache(updated);
              return next;
            });
          }}
          onClose={() => setSelectedTask(null)}
        />
      )}

      {/* Desktop-only export below month grid */}
      {view === "month" && (
        <div style={{ marginTop: 4 }}>
          <button className="btn" style={{ fontSize: 13 }} onClick={downloadIcs}>
            Export .ics
          </button>
        </div>
      )}

      {/* Mobile-only footer: import + export (header buttons are hidden on mobile) */}
      <div className="cal-ics-footer">
        <button
          className="btn"
          style={{ fontSize: 13 }}
          disabled={importing}
          onClick={() => fileRef.current?.click()}
        >
          {importing ? "Importing…" : "Import .ics"}
        </button>
        <button className="btn" style={{ fontSize: 13 }} onClick={downloadIcs}>
          Export .ics
        </button>
      </div>
    </div>
  );
}
