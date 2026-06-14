export interface ParsedTask {
  text: string;
  scheduledAt?: number;
  duration?: number;
  tag?: string;
  urgency?: number;
}

export interface ParsePreview {
  date?: string;
  tag?: string;
  priority?: string;
  duration?: string;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PRIORITY_URGENCY: Record<number, number> = { 1: 1.0, 2: 0.72, 3: 0.42, 4: 0.1 };

function nextWeekday(from: Date, day: string, forceNext = false): Date {
  const target = DAYS.indexOf(day.toLowerCase());
  const d = new Date(from);
  let diff = target - d.getDay();
  if (diff <= 0 || forceNext) diff += 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function previewDate(d: Date, hasTime: boolean): string {
  const now = new Date();
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrowMs = todayMs + 86_400_000;

  let label: string;
  if (d.getTime() >= todayMs && d.getTime() < tomorrowMs) {
    label = 'Today';
  } else if (d.getTime() >= tomorrowMs && d.getTime() < tomorrowMs + 86_400_000) {
    label = 'Tomorrow';
  } else {
    label = d.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' });
  }

  if (hasTime) {
    const timeStr = d.toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: d.getMinutes() ? '2-digit' : undefined,
      timeZone: 'Asia/Kolkata',
    });
    return `${label} · ${timeStr}`;
  }
  return label;
}

export function parseTaskText(input: string): { parsed: ParsedTask; preview: ParsePreview } {
  let t = input;
  const preview: ParsePreview = {};
  const parsed: ParsedTask = { text: input };

  // Duration: 30m, 1h, 1.5h, "2 hours", "30 minutes"
  t = t.replace(/\b(\d+(?:\.\d+)?)\s*(h(?:ours?|rs?)?|m(?:in(?:utes?)?)?)\b/gi, (_, val, unit) => {
    const v = parseFloat(val);
    parsed.duration = unit[0].toLowerCase() === 'h' ? Math.round(v * 60) : Math.round(v);
    preview.duration = parsed.duration >= 60
      ? `${parsed.duration / 60}h`
      : `${parsed.duration}m`;
    return '';
  });

  // Priority: p1–p4 or !1–!4
  t = t.replace(/\b[p!]([1-4])\b/gi, (_, n) => {
    const level = parseInt(n) as 1 | 2 | 3 | 4;
    parsed.urgency = PRIORITY_URGENCY[level];
    preview.priority = `P${level}`;
    return '';
  });

  // Tag: #work #social #general #later
  t = t.replace(/#(work|social|general|later)\b/gi, (_, tag) => {
    parsed.tag = tag.toLowerCase();
    preview.tag = parsed.tag;
    return '';
  });

  // Time: at 3pm, @9am, at 14:30
  let parsedHour: number | null = null;
  let parsedMinute = 0;
  t = t.replace(/(?:@|at\s+)(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi, (_, h, m, mer) => {
    parsedHour = parseInt(h);
    parsedMinute = m ? parseInt(m) : 0;
    if (mer?.toLowerCase() === 'pm' && parsedHour < 12) parsedHour += 12;
    if (mer?.toLowerCase() === 'am' && parsedHour === 12) parsedHour = 0;
    return '';
  });

  // Date keywords — order matters: check longer phrases first
  let scheduledDate: Date | null = null;

  const tryReplace = (pattern: RegExp, fn: () => Date): boolean => {
    if (pattern.test(t)) {
      scheduledDate = fn();
      t = t.replace(pattern, '');
      return true;
    }
    return false;
  };

  tryReplace(/\btonight\b/gi, () => {
    if (parsedHour === null) parsedHour = 20;
    return new Date();
  }) ||
  tryReplace(/\btoday\b/gi, () => new Date()) ||
  tryReplace(/\btomorrow\b/gi, () => {
    const d = new Date(); d.setDate(d.getDate() + 1); return d;
  }) ||
  tryReplace(/\bnext\s+week\b/gi, () => {
    const d = new Date(); d.setDate(d.getDate() + 7); return d;
  }) ||
  (() => {
    const m = t.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
    if (m) {
      scheduledDate = nextWeekday(new Date(), m[2], !!m[1]);
      t = t.replace(m[0], '');
    }
  })();

  if (scheduledDate) {
    const h = parsedHour ?? 9;
    (scheduledDate as Date).setHours(h, parsedMinute, 0, 0);
    parsed.scheduledAt = (scheduledDate as Date).getTime();
    preview.date = previewDate(scheduledDate as Date, parsedHour !== null);
  }

  parsed.text = t.replace(/\s{2,}/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '').trim() || input.trim();
  return { parsed, preview };
}
