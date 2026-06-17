"use client";

import { FieldHint } from "./fields";
import type { TaskSectionProps } from "./types";

export function TaskGroupSection({ merged, set }: TaskSectionProps) {
  return (
    <section className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wider text-circuit-muted">Task group</p>
      <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
          Group name
          <FieldHint text="Tasks sharing this label shift together when any one is rescheduled. e.g. 'morning-routine' or 'laundry'." />
        </span>
        <input
          type="text"
          placeholder="e.g. laundry, morning-routine"
          value={merged.group_id ?? ""}
          onChange={(e) => set("group_id", (e.target.value || null) as unknown as string)}
          className="input-field flex-1 py-1 text-xs"
          maxLength={50}
        />
      </label>
      {merged.group_id && (
        <p className="text-xs text-circuit-muted sm:pl-[188px]">
          Tasks sharing this name shift together when rescheduled.
        </p>
      )}
    </section>
  );
}
