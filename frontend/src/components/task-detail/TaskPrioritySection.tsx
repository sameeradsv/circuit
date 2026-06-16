"use client";

import { Slider } from "./fields";
import type { TaskSectionProps } from "./types";

export function TaskPrioritySection({ merged, set }: TaskSectionProps) {
  return (
    <section className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wider text-circuit-muted">Priority</p>
      <Slider label="Importance" value={merged.importance ?? 0.5} onChange={(v) => set("importance", v)} hint="How critical this task is to your goals. High = essential work; low = nice-to-have." />
      <Slider label="Urgency" value={merged.urgency ?? 0.5} onChange={(v) => set("urgency", v)} hint="How time-sensitive this is. High urgency surfaces the task sooner in your list." />
      <Slider label="Consequence of delay" value={merged.consequence_of_delay ?? 0.3} onChange={(v) => set("consequence_of_delay", v)} hint="Impact if this is pushed back. Raises the score when delay has real consequences." />
      <Slider label="Momentum value" value={merged.momentum_value ?? 0.5} onChange={(v) => set("momentum_value", v)} hint="Whether completing this creates forward momentum — e.g. it unblocks other work." />
    </section>
  );
}
