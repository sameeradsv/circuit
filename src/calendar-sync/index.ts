import { createTask } from '../task-engine/schema';
import type { Task } from '../types';

/** Local-first calendar integration helpers. */
export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
}

export interface CalendarSyncResult {
  tasks: Task[];
  imported: number;
  skipped: number;
}

export function syncFromCalendar(existing: Task[], events: CalendarEvent[]): CalendarSyncResult {
  const seen = new Set(
    existing
      .map((task) => task.metadata.calendarEventId)
      .filter((id): id is string => typeof id === 'string'),
  );
  const additions: Task[] = [];
  let skipped = 0;

  for (const event of events) {
    if (seen.has(event.id)) {
      skipped += 1;
      continue;
    }
    seen.add(event.id);
    additions.push(
      createTask(event.title, {
        tag: 'work',
        effort: minutesBetween(event.start, event.end) > 45 ? 'high' : 'medium',
        duration: Math.max(5, minutesBetween(event.start, event.end)),
        deadlineType: 'hard',
        scheduledAt: event.start,
        focusType: 'admin',
        metadata: {
          calendarEventId: event.id,
          calendarStart: event.start,
          calendarEnd: event.end,
          calendarSource: 'ics-import',
        },
      }),
    );
  }

  return {
    tasks: [...existing, ...additions],
    imported: additions.length,
    skipped,
  };
}

export function parseIcs(text: string): CalendarEvent[] {
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];
  return blocks
    .map(parseEvent)
    .filter((event): event is CalendarEvent => Boolean(event));
}

export function tasksToIcs(tasks: Task[]): string {
  const now = formatIcsDate(Date.now());
  const events = tasks
    .filter((task) => !task.completed && task.scheduledAt)
    .map((task) => {
      const start = task.scheduledAt!;
      const end = start + task.duration * 60000;
      return [
        'BEGIN:VEVENT',
        `UID:${escapeIcsText(task.id)}@circuit.local`,
        `DTSTAMP:${now}`,
        `DTSTART:${formatIcsDate(start)}`,
        `DTEND:${formatIcsDate(end)}`,
        `SUMMARY:${escapeIcsText(task.text)}`,
        task.recurrence ? `RRULE:${recurrenceToRRule(task.recurrence)}` : '',
        'END:VEVENT',
      ]
        .filter(Boolean)
        .join('\r\n');
    });

  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Circuit//Canopy Local Sync//EN', ...events, 'END:VCALENDAR'].join('\r\n');
}

function parseEvent(block: string): CalendarEvent | null {
  const uid = getField(block, 'UID') ?? `ics-${hash(block)}`;
  const title = getField(block, 'SUMMARY') ?? 'Calendar event';
  const startRaw = getField(block, 'DTSTART');
  const endRaw = getField(block, 'DTEND');
  const start = startRaw ? parseIcsDate(startRaw) : null;
  const end = endRaw ? parseIcsDate(endRaw) : null;
  if (!start) return null;

  return {
    id: uid,
    title: unescapeIcsText(title),
    start,
    end: end && end > start ? end : start + 30 * 60000,
  };
}

function getField(block: string, name: string): string | null {
  const line = block
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}:`) || candidate.startsWith(`${name};`));
  if (!line) return null;
  return line.slice(line.indexOf(':') + 1).trim();
}

function parseIcsDate(value: string): number | null {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
  if (!match) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = match;
  const local = !value.endsWith('Z');
  const parts = [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)] as const;
  return local ? new Date(...parts).getTime() : Date.UTC(...parts);
}

function formatIcsDate(ts: number): string {
  return new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function recurrenceToRRule(recurrence: string): string {
  switch (recurrence) {
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekly':
      return 'FREQ=WEEKLY';
    case 'monthly':
      return 'FREQ=MONTHLY';
    case 'weekdays':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    default:
      return recurrence.toUpperCase().startsWith('FREQ=') ? recurrence.toUpperCase() : `FREQ=${recurrence.toUpperCase()}`;
  }
}

function minutesBetween(start: number, end: number): number {
  return Math.max(5, Math.round((end - start) / 60000));
}

function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

function unescapeIcsText(text: string): string {
  return text.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function hash(text: string): string {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) value = (value * 31 + text.charCodeAt(i)) >>> 0;
  return value.toString(36);
}
