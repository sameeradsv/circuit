import { createTask, inferEffortFromText, inferTagFromText } from '../task-engine';
import type { DeadlineType, Task, TaskTag } from '../types';
import { callAI } from './call-ai';

export interface ParsedInput {
  text: string;
  tag: ReturnType<typeof inferTagFromText>;
  effort: ReturnType<typeof inferEffortFromText>;
  duration?: number;
  deadlineType?: 'soft' | 'hard';
}

export interface AITaskParse {
  text: string;
  duration?: number;
  deadlineType?: DeadlineType;
  tag?: TaskTag;
  urgency?: number;
  cognitiveLoad?: number;
}

/** Rule-based natural-language task capture (no external API). */
export function parseConversationalInput(input: string): ParsedInput | null {
  const trimmed = input.trim();
  if (trimmed.length < 2) return null;

  let text = trimmed;
  let deadlineType: 'soft' | 'hard' | undefined;
  let duration: number | undefined;

  const urgent = /\b(urgent|asap|today|tonight)\b/i.test(text);
  const later = /\b(tomorrow|next week|someday)\b/i.test(text);
  if (urgent) deadlineType = 'hard';
  if (later) deadlineType = 'soft';

  const durMatch = text.match(/\b(\d+)\s*(min|minutes?|hr|hours?)\b/i);
  if (durMatch) {
    const n = parseInt(durMatch[1]!, 10);
    const unit = durMatch[2]!.toLowerCase();
    duration = unit.startsWith('h') ? n * 60 : n;
    text = text.replace(durMatch[0], '').trim();
  }

  text = text.replace(/^(add|create|remind me to|i need to)\s+/i, '').trim();
  if (text.length < 2) return null;

  return {
    text,
    tag: inferTagFromText(text),
    effort: inferEffortFromText(text),
    duration,
    deadlineType,
  };
}

export function taskFromConversationalInput(input: string): Task | null {
  const parsed = parseConversationalInput(input);
  if (!parsed) return null;
  return createTask(parsed.text, {
    tag: parsed.tag,
    effort: parsed.effort,
    duration: parsed.duration,
    deadlineType: parsed.deadlineType ?? 'none',
    urgency: parsed.deadlineType === 'hard' ? 0.9 : parsed.deadlineType === 'soft' ? 0.5 : 0.4,
  });
}

/** AI-powered task parsing. Falls back to regex on failure. */
export async function parseTaskWithAI(input: string): Promise<AITaskParse> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Parse this task into structured data. Return valid JSON only, no markdown or explanation.
Task: "${input}"
Today's date: ${today}

Return exactly this JSON shape (use null for unknown fields):
{"text":"clean task text without duration/date info","duration":null,"deadlineType":"none","tag":"general","urgency":0.5,"cognitiveLoad":2}

Rules:
- text: clean task description, remove parsed time/date fragments
- duration: integer minutes or null
- deadlineType: "none", "soft" (later/flexible), or "hard" (today/urgent/deadline)
- tag: "work", "social", "later", or "general"
- urgency: 0.0 to 1.0 (0=low, 1=critical)
- cognitiveLoad: 1 (easy) to 5 (very hard)`;

  const raw = await callAI(prompt, true);
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  return {
    text: typeof parsed['text'] === 'string' && parsed['text'].length > 0 ? parsed['text'] : input,
    duration: typeof parsed['duration'] === 'number' && parsed['duration'] > 0 ? Math.round(parsed['duration']) : undefined,
    deadlineType: (['none', 'soft', 'hard'] as DeadlineType[]).includes(parsed['deadlineType'] as DeadlineType)
      ? (parsed['deadlineType'] as DeadlineType)
      : undefined,
    tag: (['general', 'work', 'social', 'later'] as TaskTag[]).includes(parsed['tag'] as TaskTag)
      ? (parsed['tag'] as TaskTag)
      : undefined,
    urgency:
      typeof parsed['urgency'] === 'number'
        ? Math.max(0, Math.min(1, parsed['urgency']))
        : undefined,
    cognitiveLoad:
      typeof parsed['cognitiveLoad'] === 'number'
        ? Math.round(Math.max(1, Math.min(5, parsed['cognitiveLoad'])))
        : undefined,
  };
}
