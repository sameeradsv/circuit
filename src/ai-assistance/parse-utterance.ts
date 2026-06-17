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

  let cognitive_load: number = EFFORT_COG[effort];
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

export function parseUtterance(input: string): ParsedUtterance {
  const { parsed, preview } = parseTaskText(input);
  const chips = energyChips(input);
  const classified = classifyUtteranceHeuristic(parsed.text || input.trim());

  const tag = parsed.tag ?? classified.tag;
  const urgency = parsed.urgency ?? classified.urgency;
  const { effort, cognitive_load } = applyEnergyHints(classified.effort, classified.cognitive_load, chips);

  return {
    text: parsed.text,
    tag,
    urgency,
    importance: classified.importance,
    duration: parsed.duration,
    scheduledAt: parsed.scheduledAt,
    effort,
    cognitive_load,
    chips,
    preview,
  };
}
