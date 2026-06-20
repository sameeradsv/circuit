import { parseTaskText, type ParsePreview } from "./parse-task";

export interface ParseChip {
  k: string;
  v: string;
}

export interface UtteranceClassification {
  urgency: number;
  importance: number;
  cognitive_load: number;
  effort: "low" | "medium" | "high";
  tag: string;
  reasoning: string;
}

export interface ParsedUtterance {
  text: string;
  tag?: string;
  urgency?: number;
  importance?: number;
  duration?: number;
  scheduledAt?: number;
  effort?: "low" | "medium" | "high";
  cognitive_load?: number;
  emotional_resistance?: number;
  activation_energy?: number;
  recovery_cost?: number;
  energy_to_reward_ratio?: number;
  consequence_of_delay?: number;
  momentum_value?: number;
  compound_benefit?: number;
  identity_alignment?: number;
  task_decomposition_potential?: number;
  focus_type?: "shallow" | "deep" | "admin" | "creative";
  tiny_step?: string;
  chips: ParseChip[];
  preview: ParsePreview;
}

const _URGENT = new Set(["urgent", "asap", "today", "now", "immediately", "critical", "deadline", "overdue", "emergency"]);
const _IMPORTANT = new Set(["important", "key", "essential", "must", "priority", "vital", "crucial"]);
const _WORK = new Set(["write", "code", "build", "design", "review", "report", "meeting", "email", "presentation", "project", "ticket", "deploy", "fix", "debug", "implement", "develop", "test", "research", "analyze"]);
const _SOCIAL = new Set(["call", "meet", "lunch", "dinner", "coffee", "friend", "family", "party", "visit", "chat", "talk", "catch"]);
const _LATER = new Set(["someday", "maybe", "eventually", "later", "backlog", "wishlist"]);
const _EASY = new Set(["quick", "simple", "easy", "brief", "small", "minor"]);
const _HARD = new Set(["complex", "difficult", "hard", "thorough", "comprehensive", "refactor", "redesign", "multiple", "several", "extensive"]);

const EFFORT_COG: Record<string, number> = { low: 0.3, medium: 0.5, high: 0.7 };

const clamp01 = (n: number) => Math.max(0, Math.min(1, Math.round(n * 100) / 100));

/** Sync heuristic — mirrors backend `ai._classify_heuristic` (no network). */
export function classifyUtteranceHeuristic(text: string, context?: string): UtteranceClassification {
  const words = new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
  const full = `${text} ${context ?? ""}`.toLowerCase();

  let urgency = [...words].some((w) => _URGENT.has(w)) ? 0.8 : 0.5;
  if (/(by tomorrow|by today|due today|due tomorrow|end of day|\beod\b)/i.test(full)) {
    urgency = Math.max(urgency, 0.75);
  }

  const importance = [...words].some((w) => _IMPORTANT.has(w)) ? 0.8 : 0.5;

  let tag = "general";
  if ([...words].some((w) => _SOCIAL.has(w)) || /catch up|check in/i.test(full)) tag = "social";
  else if ([...words].some((w) => _WORK.has(w)) || /follow up/i.test(full)) tag = "work";
  else if ([...words].some((w) => _LATER.has(w))) tag = "later";

  let effort: "low" | "medium" | "high" = "medium";
  if ([...words].some((w) => _EASY.has(w)) || /(5 min|10 min|quick check|quick call)/i.test(full)) effort = "low";
  else if ([...words].some((w) => _HARD.has(w))) effort = "high";

  let cognitive_load = EFFORT_COG[effort];
  if (text.split(/\s+/).length > 15) cognitive_load = Math.min(1, cognitive_load + 0.1);

  const reasons: string[] = [];
  if (urgency > 0.6) reasons.push("urgency markers found");
  if (importance > 0.6) reasons.push("importance markers found");
  reasons.push(`classified as ${tag} (${effort} effort)`);

  return {
    urgency: Math.round(urgency * 100) / 100,
    importance: Math.round(importance * 100) / 100,
    cognitive_load: Math.round(cognitive_load * 100) / 100,
    effort,
    tag,
    reasoning: reasons.join("; "),
  };
}

function energyChips(s: string): ParseChip[] {
  const chips: ParseChip[] = [];
  if (/\bhigh energy|high.?focus|peak\b/i.test(s)) chips.push({ k: "energy", v: "high" });
  else if (/\blow energy|drained|tired\b/i.test(s)) chips.push({ k: "energy", v: "low" });
  else if (/\bfocus(ed)?|deep\b/i.test(s)) chips.push({ k: "energy", v: "focused" });
  return chips;
}

function applyEnergyHints(
  effort: "low" | "medium" | "high",
  cognitive_load: number,
  chips: ParseChip[],
): { effort: "low" | "medium" | "high"; cognitive_load: number } {
  const energy = chips.find((c) => c.k === "energy")?.v;
  if (energy === "low") return { effort: "low", cognitive_load: Math.min(cognitive_load, 0.35) };
  if (energy === "high") return { effort: "high", cognitive_load: Math.max(cognitive_load, 0.75) };
  if (energy === "focused") return { effort: "high", cognitive_load: Math.max(cognitive_load, 0.65) };
  return { effort, cognitive_load };
}

function firstTinyStep(text: string): string {
  const lower = text.toLowerCase();
  if (/\breply|email|message|dm\b/.test(lower)) return "Open the thread and write the first sentence.";
  if (/\bcall|phone\b/.test(lower)) return "Find the contact and start the call.";
  if (/\bwrite|draft|doc|narrative|deck\b/.test(lower)) return "Open the document and add a rough heading.";
  if (/\bcode|build|fix|debug|implement|test\b/.test(lower)) return "Open the relevant file and reproduce the current state.";
  if (/\bbuy|pick up|groceries|errand\b/.test(lower)) return "Check what you need before leaving.";
  return "Do the first visible two-minute step.";
}

function inferMetrics(text: string, classified: UtteranceClassification, chips: ParseChip[]) {
  const full = text.toLowerCase();
  const positivePayoff = /\b(feel(s|ing)? (nice|good|great|better)|satisfying|rewarding|relief|nice to finish|fun)\b/.test(full);
  const healthy = /\b(healthy|health|workout|exercise|walk|run|stretch|sleep|meditat(e|ion)|therapy|rest)\b/.test(full);
  const blocks = /\b(blocks?|unblocks?|dependent|dependency|before i can|launch|release|client|investor|deadline)\b/.test(full);
  const dread = /\b(dread|avoid|avoiding|anxious|scary|awkward|hard to start)\b/.test(full);
  const easyStart = /\b(quick|simple|easy|tiny|small|5 min|10 min)\b/.test(full);
  const deep = /\b(deep|focus|focused|write|code|design|research|analy[sz]e|strategy)\b/.test(full);
  const admin = classified.effort === "low" || /\b(admin|email|reply|schedule|book|pay|file)\b/.test(full);

  const focus_type: "shallow" | "deep" | "admin" | "creative" =
    classified.tag === "social" ? "shallow"
    : deep && classified.effort === "high" ? "deep"
    : admin ? "admin"
    : "shallow";

  return {
    emotional_resistance: clamp01(dread ? 0.75 : positivePayoff || healthy ? 0.25 : 0.45),
    activation_energy: clamp01(easyStart ? 0.25 : classified.effort === "high" ? 0.7 : 0.5),
    recovery_cost: clamp01(classified.effort === "high" ? 0.55 : classified.effort === "low" ? 0.2 : 0.35),
    energy_to_reward_ratio: clamp01(positivePayoff ? 0.85 : healthy ? 0.75 : classified.effort === "high" ? 0.45 : 0.6),
    consequence_of_delay: clamp01(classified.urgency > 0.7 || blocks ? 0.75 : 0.35),
    momentum_value: clamp01(blocks ? 0.85 : classified.urgency > 0.7 ? 0.65 : 0.5),
    compound_benefit: clamp01(blocks || healthy ? 0.7 : 0.35),
    identity_alignment: clamp01(healthy ? 0.85 : positivePayoff ? 0.6 : 0.4),
    task_decomposition_potential: clamp01(classified.effort === "high" ? 0.7 : 0.3),
    focus_type,
    tiny_step: firstTinyStep(text),
    chips: [
      ...chips,
      ...(positivePayoff ? [{ k: "payoff", v: "feels good" }] : []),
      ...(healthy ? [{ k: "good-for-me", v: "healthy" }] : []),
      ...(blocks ? [{ k: "unblocks", v: "yes" }] : []),
    ],
  };
}

/** Merge scheduling parse + NL chips + local classification. */
export function parseUtterance(input: string): ParsedUtterance {
  const { parsed, preview } = parseTaskText(input);
  const chips = energyChips(input);
  const classified = classifyUtteranceHeuristic(parsed.text || input.trim());

  const tag = parsed.tag ?? classified.tag;
  const urgency = parsed.urgency ?? classified.urgency;
  const { effort, cognitive_load } = applyEnergyHints(classified.effort, classified.cognitive_load, chips);
  const metrics = inferMetrics(parsed.text || input.trim(), { ...classified, effort, cognitive_load }, chips);

  return {
    text: parsed.text,
    tag,
    urgency,
    importance: classified.importance,
    duration: parsed.duration,
    scheduledAt: parsed.scheduledAt,
    effort,
    cognitive_load,
    ...metrics,
    preview,
  };
}

export function taskInputFromUtterance(input: string) {
  const u = parseUtterance(input);
  return {
    text: u.text,
    tag: u.tag ?? "general",
    urgency: u.urgency ?? 0.5,
    importance: u.importance ?? 0.5,
    tiny_step: u.tiny_step ?? "",
    effort: u.effort ?? "medium",
    duration: u.duration ?? 30,
    cognitive_load: u.cognitive_load ?? 0.5,
    emotional_resistance: u.emotional_resistance ?? 0.45,
    activation_energy: u.activation_energy ?? 0.5,
    recovery_cost: u.recovery_cost ?? 0.35,
    energy_to_reward_ratio: u.energy_to_reward_ratio ?? 0.6,
    consequence_of_delay: u.consequence_of_delay ?? 0.35,
    momentum_value: u.momentum_value ?? 0.5,
    compound_benefit: u.compound_benefit ?? 0.35,
    identity_alignment: u.identity_alignment ?? 0.4,
    task_decomposition_potential: u.task_decomposition_potential ?? 0.3,
    focus_type: u.focus_type ?? "shallow",
    ...(u.scheduledAt ? { scheduled_at: u.scheduledAt } : {}),
  };
}
