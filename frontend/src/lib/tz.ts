export const TZ = "Asia/Kolkata";

export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/** Parse a "YYYY-MM-DD" string as IST midnight (00:00:00 IST). */
export function dateStrToISTMs(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00+05:30`).getTime();
}

/** Parse a "YYYY-MM-DD" string as IST end-of-day (23:59:59.999 IST). */
export function dateStrToISTEndMs(dateStr: string): number {
  return new Date(`${dateStr}T23:59:59.999+05:30`).getTime();
}

export function fmtTimeIST(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

export function fmtDateIST(ms: number, opts: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {}): string {
  return new Date(ms).toLocaleDateString("en-IN", { ...opts, timeZone: TZ });
}
