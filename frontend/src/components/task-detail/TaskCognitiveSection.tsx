"use client";

import { Slider } from "./fields";
import type { TaskSectionProps } from "./types";

export function TaskCognitiveSection({ merged, set }: TaskSectionProps) {
  return (
    <section className="space-y-3">
      <p className="text-xs font-medium uppercase tracking-wider text-circuit-muted">Cognitive load</p>
      <Slider label="Cognitive load" value={merged.cognitive_load ?? 0.5} onChange={(v) => set("cognitive_load", v)} hint="Mental bandwidth required. Heavy tasks are deprioritised when your energy is low." />
      <Slider label="Emotional resistance" value={merged.emotional_resistance ?? 0.5} onChange={(v) => set("emotional_resistance", v)} hint="How much you're dreading or avoiding this. Higher resistance lowers the score when willpower is depleted." />
      <Slider label="Activation energy" value={merged.activation_energy ?? 0.5} onChange={(v) => set("activation_energy", v)} hint="How hard it is to start. High = needs a good uninterrupted block to get into." />
      <Slider label="Recovery cost" value={merged.recovery_cost ?? 0.3} onChange={(v) => set("recovery_cost", v)} hint="How drained you'll feel after finishing. Used to space out back-to-back demanding tasks." />
      <Slider label="Energy → reward ratio" value={merged.energy_to_reward_ratio ?? 0.5} onChange={(v) => set("energy_to_reward_ratio", v)} hint="Net energy after completing — a high-ratio task can feel energising even if cognitively heavy." />
    </section>
  );
}
