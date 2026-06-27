"use client";

export function FieldHint({ text }: { text: string }) {
  return (
    <span className="relative group inline-flex items-center">
      <span
        className="w-3.5 h-3.5 rounded-full border border-circuit-border text-circuit-muted inline-flex items-center justify-center cursor-default select-none"
        style={{ fontSize: 9, lineHeight: 1, flexShrink: 0 }}
      >?</span>
      <span
        className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 px-2.5 py-2 rounded-lg text-xs text-circuit-text border border-circuit-border shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 leading-relaxed"
        style={{ background: "var(--paper)", whiteSpace: "normal" }}
      >
        {text}
      </span>
    </span>
  );
}

export const TASK_ENTRY_CLASS = "input-field h-11 w-full flex-1 px-3 py-2 text-sm sm:h-auto sm:py-1 sm:text-xs";

export function Slider({
  label, value, onChange, hint,
}: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
        {label}
        {hint && <FieldHint text={hint} />}
      </span>
      <div className="flex items-center gap-2 flex-1">
        <input
          type="range" min={0} max={1} step={0.05} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-circuit-accent"
        />
        <span className="w-8 text-right text-xs text-circuit-text shrink-0">{Math.round(value * 100)}%</span>
      </div>
    </label>
  );
}

export function Select({
  label, value, options, onChange, hint,
}: { label: string; value: string; options: string[]; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="sm:w-44 sm:shrink-0 text-xs text-circuit-muted flex items-center gap-1.5">
        {label}
        {hint && <FieldHint text={hint} />}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={TASK_ENTRY_CLASS}
      >
        {options.map((o) => (
          <option key={o} value={o} className="bg-circuit-bg capitalize">{o || "any"}</option>
        ))}
      </select>
    </label>
  );
}

export function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
