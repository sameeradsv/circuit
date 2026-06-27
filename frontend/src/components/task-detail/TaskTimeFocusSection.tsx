"use client";

import { useState } from "react";
import type { ApiTask } from "@/lib/api";
import { FieldHint, Select, TASK_ENTRY_CLASS, toDatetimeLocal } from "./fields";
import type { TaskSectionProps } from "./types";

interface TaskTimeFocusSectionProps extends TaskSectionProps {
  weekendTime: string;
  onWeekendTimeChange: (value: string) => void;
}

const REMINDER_OPTIONS = [
  { label: "No reminder", value: "" },
  { label: "At start time", value: "0" },
  { label: "5 minutes before", value: "5" },
  { label: "10 minutes before", value: "10" },
  { label: "15 minutes before", value: "15" },
  { label: "30 minutes before", value: "30" },
  { label: "1 hour before", value: "60" },
  { label: "2 hours before", value: "120" },
  { label: "1 day before", value: "1440" },
];

export function TaskTimeFocusSection({
  merged, set, weekendTime, onWeekendTimeChange,
}: TaskTimeFocusSectionProps) {
  const hasRecurrence = !!(merged.recurrence || merged.rrule);
  const [showRecurrence, setShowRecurrence] = useState(hasRecurrence);

  function clearRecurrence() {
    set("recurrence", null as unknown as string);
    setShowRecurrence(false);
  }

  return (
    <section className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wider text-circuit-muted">Time & focus</p>

      <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
          Scheduled for
          <FieldHint text="Pin this task to a specific date and time." />
        </span>
        <input
          type="datetime-local"
          value={merged.scheduled_at ? toDatetimeLocal(merged.scheduled_at) : ""}
          onChange={(e) => set("scheduled_at", e.target.value ? new Date(e.target.value).getTime() : null as unknown as number)}
          className={TASK_ENTRY_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
          Duration (minutes)
          <FieldHint text="Expected time to complete. Used for calendar blocks and capacity planning." />
        </span>
        <input
          type="number" min={5} max={480} step={5}
          value={merged.duration ?? 30}
          onChange={(e) => set("duration", Number(e.target.value))}
          className={TASK_ENTRY_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
          Notifications
          <FieldHint text="Enable browser notifications for this task. The global bell in the sidebar must also be enabled." />
        </span>
        <span className="flex min-h-11 items-center gap-2 text-xs text-circuit-muted">
          <input
            type="checkbox"
            checked={merged.notifications_enabled ?? true}
            onChange={(e) => set("notifications_enabled", e.target.checked)}
          />
          Notify me for this task
        </span>
      </label>

      {(merged.notifications_enabled ?? true) && (
        <>
          <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
              First reminder
              <FieldHint text="When to notify before this task starts." />
            </span>
            <select
              value={merged.notification_offset_1_mins ?? ""}
              onChange={(e) => set("notification_offset_1_mins", e.target.value === "" ? null as unknown as number : Number(e.target.value))}
              className={TASK_ENTRY_CLASS}
            >
              {REMINDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
              Second reminder
              <FieldHint text="Optional additional notification before this task starts." />
            </span>
            <select
              value={merged.notification_offset_2_mins ?? ""}
              onChange={(e) => set("notification_offset_2_mins", e.target.value === "" ? null as unknown as number : Number(e.target.value))}
              className={TASK_ENTRY_CLASS}
            >
              {REMINDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
        </>
      )}

      <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
          Travel before (min)
          <FieldHint text="Transit time needed before this task. Shown as a hatched buffer block in the calendar." />
        </span>
        <input
          type="number" min={0} max={120} step={5}
          value={merged.travel_buffer_before_mins ?? ""}
          placeholder="0"
          onChange={(e) => set("travel_buffer_before_mins", e.target.value ? Number(e.target.value) : null as unknown as number)}
          className={TASK_ENTRY_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
          Travel after (min)
          <FieldHint text="Transit time needed after this task. Shown as a hatched buffer block in the calendar." />
        </span>
        <input
          type="number" min={0} max={120} step={5}
          value={merged.travel_buffer_after_mins ?? ""}
          placeholder="0"
          onChange={(e) => set("travel_buffer_after_mins", e.target.value ? Number(e.target.value) : null as unknown as number)}
          className={TASK_ENTRY_CLASS}
        />
      </label>

      <Select label="Effort" value={merged.effort ?? "medium"} options={["low", "medium", "high"]} onChange={(v) => set("effort", v as ApiTask["effort"])} hint="Overall effort level — affects how tasks are grouped and suggested during your day." />
      <Select label="Focus type" value={merged.focus_type ?? "shallow"} options={["shallow", "deep", "admin", "creative"]} onChange={(v) => set("focus_type", v)} hint="Type of cognitive engagement. Deep and creative tasks score higher during peak energy windows." />
      <Select label="Deadline" value={merged.deadline_type ?? "none"} options={["none", "soft", "hard"]} onChange={(v) => set("deadline_type", v as ApiTask["deadline_type"])} hint="Soft = flexible target. Hard = fixed cutoff that significantly boosts urgency as the date approaches." />

      {!showRecurrence ? (
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted">Recurrence</span>
          <button
            type="button"
            onClick={() => setShowRecurrence(true)}
            className="text-xs text-circuit-muted hover:text-circuit-text transition-colors self-start"
          >
            + Make recurring
          </button>
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
              Recurrence
              <FieldHint text="How often this repeats. e.g. daily, every:4d, every:2w, every:4h, weekday, weekly:MO,WE,FR, monthly:1MO, monthly:LFR (last Friday), monthly:LWD (last working day)." />
            </span>
            <div className="relative flex-1 w-full">
              <input
                type="text"
                value={merged.recurrence ?? ""}
                placeholder="daily, weekly, monthly…"
                onChange={(e) => set("recurrence", e.target.value || null as unknown as string)}
                className={`${TASK_ENTRY_CLASS} ${!merged.rrule ? "pr-11" : ""}`}
              />
              {/* Only allow collapsing for user-set recurrence, not rrule (calendar import) */}
              {!merged.rrule && (
                <button
                  type="button"
                  onClick={clearRecurrence}
                  className="absolute right-0 top-0 h-11 w-11 text-circuit-muted hover:text-circuit-text transition-colors text-xs sm:h-full"
                  title="Remove recurrence"
                >
                  ✕
                </button>
              )}
            </div>
          </label>

          <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
              Repeat until
              <FieldHint text="Stop generating new occurrences after this date. Leave blank to repeat indefinitely." />
            </span>
            <input
              type="date"
              value={merged.recurrence_ends_at ? new Date(merged.recurrence_ends_at).toISOString().slice(0, 10) : ""}
              onChange={(e) => set("recurrence_ends_at", e.target.value ? new Date(e.target.value).getTime() : null as unknown as number)}
              className={TASK_ENTRY_CLASS}
            />
          </label>

          <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
              After blackout
              <FieldHint text="Resume: skips to the next natural schedule occurrence (missed instance is dropped). Catch up next slot, shift series: next valid pattern slot after the blackout; anchors the series there. Catch up next slot, keep schedule: same next-slot catch-up once, original series preserved; occurrences within 2 days of catch-up are skipped. Catch up immediately, keep schedule: first day after blackout, original series preserved. Catch up immediately, shift series: first day after blackout; whole series re-anchors from that date." />
            </span>
            <select
              value={merged.post_blackout_behavior ?? "resume"}
              onChange={(e) => set("post_blackout_behavior", e.target.value as "resume" | "catch_up" | "catch_up_once" | "catch_up_immediate" | "catch_up_imm_shift")}
              className={TASK_ENTRY_CLASS}
            >
              <option value="resume">Resume on next schedule</option>
              <option value="catch_up">Catch up next slot, shift series</option>
              <option value="catch_up_once">Catch up next slot, keep schedule</option>
              <option value="catch_up_immediate">Catch up immediately, keep schedule</option>
              <option value="catch_up_imm_shift">Catch up immediately, shift series</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
              Weekend time (Sa–Su, AM)
              <FieldHint text="Override the recurrence time on Saturday and Sunday. Only applies to morning tasks (originally scheduled before noon)." />
            </span>
            <input
              type="time"
              value={weekendTime}
              onChange={(e) => onWeekendTimeChange(e.target.value)}
              className={TASK_ENTRY_CLASS}
            />
          </label>
        </>
      )}

      <Select
        label="Preferred window"
        value={merged.preferred_execution_window ?? ""}
        options={["", "morning", "afternoon", "evening"]}
        onChange={(v) => set("preferred_execution_window", v || null as unknown as string)}
        hint="Best time of day for this task. Used to match tasks to your natural energy peaks."
      />
    </section>
  );
}
