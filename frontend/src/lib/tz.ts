export const TZ = "Asia/Kolkata";

export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export function fmtTimeIST(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: TZ });
}

export function fmtDateIST(ms: number, opts: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {}): string {
  return new Date(ms).toLocaleDateString("en-IN", { ...opts, timeZone: TZ });
}
