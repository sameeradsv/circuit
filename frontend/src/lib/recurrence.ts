/**
 * Recurrence pattern parsing and formatting for user tasks.
 *
 * Supported patterns:
 * - daily
 * - every:4d, every:2w, every:4h — every N days, weeks, or hours
 * - weekend
 * - weekday
 * - monday, tuesday, wednesday, thursday, friday, saturday, sunday
 * - weekly:MO,WE,FR
 * - monthly:1, monthly:15
 * - monthly:1MO (1st Monday), monthly:3FR (3rd Friday), monthly:LMO (last Monday)
 */

export interface RecurrenceOption {
  label: string;
  pattern: string;
  description: string;
}

export const QUICK_PATTERNS: RecurrenceOption[] = [
  { label: "Daily", pattern: "daily", description: "Every day" },
  { label: "Weekdays", pattern: "weekday", description: "Monday–Friday" },
  { label: "Weekends", pattern: "weekend", description: "Saturday & Sunday" },
  { label: "Monday", pattern: "monday", description: "Every Monday" },
  { label: "Tuesday", pattern: "tuesday", description: "Every Tuesday" },
  { label: "Wednesday", pattern: "wednesday", description: "Every Wednesday" },
  { label: "Thursday", pattern: "thursday", description: "Every Thursday" },
  { label: "Friday", pattern: "friday", description: "Every Friday" },
  { label: "Saturday", pattern: "saturday", description: "Every Saturday" },
  { label: "Sunday", pattern: "sunday", description: "Every Sunday" },
  { label: "1st of month", pattern: "monthly:1", description: "1st day each month" },
  { label: "15th of month", pattern: "monthly:15", description: "15th day each month" },
  { label: "1st Monday", pattern: "monthly:1MO", description: "1st Monday each month" },
  { label: "Last Friday", pattern: "monthly:LFR", description: "Last Friday each month" },
  { label: "Last working day", pattern: "monthly:LWD", description: "Last weekday each month" },
];

export function formatRecurrence(pattern: string | null): string {
  if (!pattern) return "—";

  // Check quick patterns
  const found = QUICK_PATTERNS.find((p) => p.pattern === pattern);
  if (found) return found.label;

  // Interval patterns: every:4d, every:2w, every:4h
  const interval = pattern.match(/^every:(\d+)([dwh])$/i);
  if (interval) {
    const n = parseInt(interval[1], 10);
    const unit =
      interval[2].toLowerCase() === "w"
        ? "week"
        : interval[2].toLowerCase() === "h"
          ? "hour"
          : "day";
    return `Every ${n} ${unit}${n === 1 ? "" : "s"}`;
  }

  // Try to format custom patterns
  if (pattern.startsWith("weekly:")) {
    const days = pattern.slice(7).split(",").map(formatDay).join(", ");
    return `Every ${days}`;
  }

  if (pattern === "monthly:LWD") return "Last working day";

  if (pattern.startsWith("monthly:")) {
    const spec = pattern.slice(8);
    return `Monthly: ${formatMonthlySpec(spec)}`;
  }

  return pattern;
}

function formatDay(abbr: string): string {
  const map: Record<string, string> = {
    MO: "Mon",
    TU: "Tue",
    WE: "Wed",
    TH: "Thu",
    FR: "Fri",
    SA: "Sat",
    SU: "Sun",
  };
  return map[abbr.toUpperCase()] || abbr;
}

function formatMonthlySpec(spec: string): string {
  if (spec.match(/^\d+$/)) {
    const day = parseInt(spec);
    return `${day}${getDaySuffix(day)}`;
  }

  const match = spec.match(/^(L|\d+)(MO|TU|WE|TH|FR|SA|SU)$/i);
  if (match) {
    const [, position, day] = match;
    const dayName = formatDay(day);
    if (position === "L") return `Last ${dayName}`;
    return `${position}${getDaySuffix(parseInt(position))} ${dayName}`;
  }

  return spec;
}

function getDaySuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}
