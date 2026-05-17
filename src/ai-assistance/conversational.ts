import { createTask, inferEffortFromText, inferTagFromText } from '../task-engine';
import type { Task } from '../types';

export interface ParsedInput {
  text: string;
  tag: ReturnType<typeof inferTagFromText>;
  effort: ReturnType<typeof inferEffortFromText>;
  duration?: number;
  deadlineType?: 'soft' | 'hard';
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
