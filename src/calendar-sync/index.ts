/** Placeholder for future calendar integration (local-first). */
export interface CalendarEvent {
  id: string;
  title: string;
  start: number;
  end: number;
}

export function syncFromCalendar(_events: CalendarEvent[]): void {
  // Not implemented — offline-first; no external sync yet.
}
