"use client";

import { Slider } from "./fields";
import type { TaskSectionProps } from "./types";

export function TaskCognitiveSection({ merged, set }: TaskSectionProps) {
  return (
    <section className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wider text-circuit-muted">Effort and payoff</p>
      <Slider label="Mental load" value={merged.cognitive_load ?? 0.5} onChange={(v) => set("cognitive_load", v)} hint="Mental bandwidth required. Heavy tasks are deprioritized when your energy is low." />
      <Slider label="Dread / resistance" value={merged.emotional_resistance ?? 0.5} onChange={(v) => set("emotional_resistance", v)} hint="How much you are avoiding this. Higher resistance lowers the score when willpower is depleted." />
      <Slider label="Hard to start" value={merged.activation_energy ?? 0.5} onChange={(v) => set("activation_energy", v)} hint="How much setup or emotional push it takes to begin." />
      <Slider label="After-task drain" value={merged.recovery_cost ?? 0.3} onChange={(v) => set("recovery_cost", v)} hint="How drained you expect to feel after finishing. Used to space demanding tasks apart." />
      <Slider label="Feels good after" value={merged.energy_to_reward_ratio ?? 0.5} onChange={(v) => set("energy_to_reward_ratio", v)} hint="Whether completing this task will feel satisfying, relieving, energizing, or worth it." />
    </section>
  );
}
