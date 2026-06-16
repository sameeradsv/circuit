"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { api, ApiTask } from "@/lib/api";

// ── Circuit native agent ──────────────────────────────────────────────────────

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const TOKEN_KEY = "circuit_auth_token";

async function* agentStream(
  history: { role: string; content: string }[],
  token: string | null,
  signal: AbortSignal,
  onTool: (name: string) => void,
): AsyncGenerator<string> {
  const res = await fetch(`${API_BASE}/api/agent/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages: history }),
    signal,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(e.detail || `HTTP ${res.status}`);
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) {
      if (!l.startsWith("data: ")) continue;
      const raw = l.slice(6).trim();
      if (raw === "[DONE]") return;
      try {
        const p = JSON.parse(raw);
        if (p.error) throw new Error(p.error);
        if (p.status === "calling_tool" && p.tool) { onTool(p.tool); continue; }
        if (p.delta) yield p.delta;
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
}

// ── Command parsing ───────────────────────────────────────────────────────────

export interface TaskAction {
  ids: number[];
  tasks: ApiTask[];
  patch: Record<string, unknown>;
  summary: string;         // "Push 5 high cognitive-load tasks to tomorrow"
  changeLabel: string;     // "→ tomorrow 9 AM"
}

type FilterFn = (t: ApiTask) => boolean;

interface FilterDef { fn: FilterFn; label: string; }
interface DateTarget { ms: number; label: string; }

function resolveDate(text: string): DateTarget | null {
  const now = new Date();
  const DAY = 86_400_000;

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  if (/tomorrow/i.test(text)) return { ms: tomorrow.getTime(), label: "tomorrow 9 AM" };

  if (/next week|next mon/i.test(text)) {
    const d = new Date(now);
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    d.setHours(9, 0, 0, 0);
    return { ms: d.getTime(), label: "next Monday 9 AM" };
  }

  const dayMatch = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (dayMatch) {
    const dayMap: Record<string, number> = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0 };
    const target = dayMap[dayMatch[1].toLowerCase()];
    const d = new Date(now);
    const diff = (target + 7 - d.getDay()) % 7 || 7;
    d.setDate(d.getDate() + diff);
    d.setHours(9, 0, 0, 0);
    return { ms: d.getTime(), label: `${dayMatch[1].charAt(0).toUpperCase() + dayMatch[1].slice(1)} 9 AM` };
  }

  if (/end of (the )?week|this friday/i.test(text)) {
    const d = new Date(now);
    const diff = (5 + 7 - d.getDay()) % 7 || 7;
    d.setDate(d.getDate() + diff);
    d.setHours(9, 0, 0, 0);
    return { ms: d.getTime(), label: "Friday 9 AM" };
  }

  if (/end of (the )?day|tonight|evening/i.test(text)) {
    const d = new Date(now);
    d.setHours(20, 0, 0, 0);
    return { ms: d.getTime(), label: "today 8 PM" };
  }

  if (/next month/i.test(text)) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    d.setDate(1);
    d.setHours(9, 0, 0, 0);
    return { ms: d.getTime(), label: "start of next month" };
  }

  return null;
}

function resolveFilter(text: string, allTasks: ApiTask[]): FilterDef | null {
  const lower = text.toLowerCase();
  const nowMs = Date.now();

  // Ordered from most specific to least
  if (/high[\s-]cognitive[\s-]load|cognitiv(e|ely)[\s-]?(heavy|demand|load)|brain[\s-]?heavy|mentally[\s-]?(demand|drain)|heav(y|ier) task/i.test(lower))
    return { fn: (t) => (t.cognitive_load ?? 0) >= 0.6, label: "high cognitive-load tasks" };

  if (/high[\s-]?(activat|resist|block)|activat(ion|e)[\s-]energy/i.test(lower))
    return { fn: (t) => (t.activation_energy ?? 0) >= 0.6, label: "high activation-energy tasks" };

  if (/high[\s-]?effort|demanding|heavy effort|tough task/i.test(lower))
    return { fn: (t) => t.effort === "high", label: "high-effort tasks" };

  if (/deep[\s-]?work|focus task/i.test(lower))
    return { fn: (t) => t.focus_type === "deep" || t.focus_type === "creative", label: "deep work tasks" };

  if (/overdue|late|past[\s-]?due|missed/i.test(lower))
    return { fn: (t) => !!(t.scheduled_at && t.scheduled_at < nowMs), label: "overdue tasks" };

  if (/\bwork\b/i.test(lower) && !/deep work/i.test(lower))
    return { fn: (t) => t.tag === "work", label: "work tasks" };

  if (/\bsocial\b|meeting|call|comms/i.test(lower))
    return { fn: (t) => t.tag === "social", label: "social tasks" };

  if (/today|scheduled today/i.test(lower)) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end   = new Date(); end.setHours(23, 59, 59, 999);
    return { fn: (t) => !!(t.scheduled_at && t.scheduled_at >= start.getTime() && t.scheduled_at <= end.getTime()), label: "today's tasks" };
  }

  if (/\ball\b|everything|any/i.test(lower))
    return { fn: () => true, label: "all open tasks" };

  return null;
}

export function parseTaskCommand(text: string, allTasks: ApiTask[]): TaskAction | null {
  const lower = text.toLowerCase();
  const open  = allTasks.filter((t) => !t.completed);

  // ── Reschedule / defer ────────────────────────────────────────────────────
  if (/\b(push|move|reschedule|defer|delay|shift|bump|send)\b/i.test(lower)) {
    const filter = resolveFilter(lower, open) ?? { fn: () => true, label: "all open tasks" };
    const date   = resolveDate(lower);
    if (!date) return null;

    const matched = open.filter(filter.fn).filter((t) => !t.is_recurring_template);
    if (!matched.length) return null;

    return {
      ids: matched.map((t) => t.id),
      tasks: matched,
      patch: { scheduled_at: date.ms },
      summary: `Reschedule ${matched.length} ${filter.label} to ${date.label}`,
      changeLabel: `→ ${date.label}`,
    };
  }

  // ── Mark complete ─────────────────────────────────────────────────────────
  if (/\b(complete|finish|done|close|mark)\b.*(overdue|today)/i.test(lower)) {
    const filter = resolveFilter(lower, open) ?? { fn: (t) => !!(t.scheduled_at && t.scheduled_at < Date.now()), label: "overdue tasks" };
    const matched = open.filter(filter.fn).filter((t) => !t.is_recurring_template);
    if (!matched.length) return null;

    return {
      ids: matched.map((t) => t.id),
      tasks: matched,
      patch: { completed: true },
      summary: `Mark ${matched.length} ${filter.label} as done`,
      changeLabel: "→ completed",
    };
  }

  // ── Reprioritize ──────────────────────────────────────────────────────────
  if (/\b(priorit(is|iz)|boost|elevat|surface|raise)\b.*(urgency|importance|priority)/i.test(lower)) {
    const filter = resolveFilter(lower, open);
    if (!filter) return null;
    const matched = open.filter(filter.fn).filter((t) => !t.is_recurring_template);
    if (!matched.length) return null;

    return {
      ids: matched.map((t) => t.id),
      tasks: matched,
      patch: { urgency: 0.9, importance: 0.85 },
      summary: `Boost priority of ${matched.length} ${filter.label}`,
      changeLabel: "→ urgency 90%, importance 85%",
    };
  }

  return null;
}

// ── Message types ─────────────────────────────────────────────────────────────

type Role = "user" | "assistant" | "system";
interface Msg {
  id: string;
  role: Role;
  content: string;
  streaming?: boolean;
  action?: TaskAction;          // pending approval
  actionState?: "pending" | "applied" | "cancelled";
}

let _n = 0;
const uid = () => `m${++_n}`;

const RECURRENCE_HELP = `**Recurrence patterns**

Type the pattern exactly into the **Recurrence** field when editing a task (not raw ICS/RRULE strings):

| Pattern | Meaning |
|---|---|
| \`daily\` | Every day |
| \`every:4d\` | Every 4 days (\`every:Nd\` — N = day count) |
| \`every:2w\` | Every 2 weeks (\`every:Nw\` — N = week count) |
| \`every:4h\` | Every 4 hours (\`every:Nh\` — N = hour count) |
| \`weekday\` | Mon – Fri |
| \`weekend\` | Sat & Sun |
| \`monday\` … \`sunday\` | Every specific weekday |
| \`weekly:MO,WE,FR\` | Specific days (MO TU WE TH FR SA SU) |
| \`monthly:15\` | 15th of each month |
| \`monthly:1MO\` | 1st Monday of the month |
| \`monthly:3FR\` | 3rd Friday of the month |
| \`monthly:LFR\` | **Last Friday** of the month |
| \`monthly:LWD\` | **Last working day** (last Mon–Fri) |
| \`monthly:LMO\` | Last Monday of the month |

**Interval examples:** every 4 days → \`every:4d\`; every 2 weeks → \`every:2w\`; every 3 hours → \`every:3h\`.

Do **not** paste \`FREQ=DAILY;INTERVAL=4\` into Recurrence — that is calendar RRULE syntax. Use \`every:4d\` instead (ICS imports map RRULE automatically).

The edit modal also has a quick-pick dropdown with the most common options.

**After-blackout behavior** (set per task in the edit modal):

| Option | Meaning |
|---|---|
| Resume on next schedule | Skip to the next natural occurrence after the blackout — series unchanged |
| Catch up next slot, shift series | Next valid pattern slot after the blackout (e.g. next Saturday); anchors the series from there |
| Catch up next slot, keep schedule | Next valid slot once, original series preserved; anchor slots within 2 days of catch-up are skipped |
| Catch up immediately, keep schedule | First day after blackout ends; original series preserved; next anchor slot kept even if close |
| Catch up immediately, shift series | First day after blackout ends; whole series re-anchors from that date |`;

function wantsRecurrenceHelp(text: string): boolean {
  return /recur|repeat|pattern|format|weekly|daily|monthly|hourly|\bhours?\b|interval|blackout|catch.?up|after.*blackout|every:\d+[dwh]|FREQ=|RRULE|friday|monday|working day|weekday|how.*set.*recur|\bevery\s+\d+\s+(day|days|week|weeks|hour|hours)\b/i.test(
    text,
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TerminalChat() {
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      id: uid(), role: "system",
      content: "Ask about your day, tasks, or energy — or give a command like \"push high cognitive-load tasks to tomorrow\". Type /recurrence for recurrence format reference.",
    },
  ]);
  const [value, setValue]     = useState("");
  const [streaming, setStreaming] = useState(false);
  const [tasks, setTasks]     = useState<ApiTask[]>([]);
  const feedRef   = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  useEffect(() => {
    api.listTasks().then(setTasks).catch(() => {});
  }, []);

  const push = useCallback((m: Omit<Msg, "id">): string => {
    const id = uid();
    setMsgs((prev) => [...prev, { ...m, id }]);
    return id;
  }, []);

  async function applyAction(msgId: string, action: TaskAction) {
    setMsgs((prev) => prev.map((m) => m.id === msgId ? { ...m, actionState: "applied" } : m));
    try {
      await api.batchUpdate(action.ids, action.patch as Parameters<typeof api.batchUpdate>[1]);
      const updated = await api.listTasks();
      setTasks(updated);
      push({ role: "system", content: `Done — ${action.summary.toLowerCase()}.` });
    } catch (e) {
      push({ role: "system", content: `Failed: ${e instanceof Error ? e.message : "unknown error"}` });
    }
  }

  function cancelAction(msgId: string) {
    setMsgs((prev) => prev.map((m) => m.id === msgId ? { ...m, actionState: "cancelled" } : m));
    push({ role: "system", content: "Action cancelled." });
  }

  const handleSend = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || streaming) return;

    if (t === "/clear") {
      setMsgs([{ id: uid(), role: "system", content: "Conversation cleared." }]);
      return;
    }

    if (t === "/recurrence" || t === "/help") {
      push({ role: "user", content: t });
      push({ role: "assistant", content: RECURRENCE_HELP });
      return;
    }

    push({ role: "user", content: t });

    // Try command parsing first
    const action = parseTaskCommand(t, tasks);
    if (action) {
      push({
        role: "assistant",
        content: action.summary,
        action,
        actionState: "pending",
      });
      return;
    }

    // Client-side recurrence format help — instant, no API call
    if (wantsRecurrenceHelp(t)) {
      push({
        role: "assistant",
        content: RECURRENCE_HELP,
      });
      return;
    }

    // Fall through to Circuit native agent for Q&A
    setStreaming(true);
    const history = [
      ...msgs
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: t },
    ];
    const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    abortRef.current = new AbortController();
    const aiId = push({ role: "assistant", content: "", streaming: true });
    let full = "";

    try {
      for await (const chunk of agentStream(
        history, token, abortRef.current.signal,
        (tool) => push({ role: "system", content: `Checking ${tool.replace(/_/g, " ")}…` }),
      )) {
        full += chunk;
        setMsgs((prev) => prev.map((m) => m.id === aiId ? { ...m, content: full } : m));
      }
      setMsgs((prev) => prev.map((m) => m.id === aiId ? { ...m, streaming: false } : m));
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const errMsg  = !isAbort && err instanceof Error ? err.message : null;
      setMsgs((prev) => prev.map((m) =>
        m.id === aiId ? {
          ...m,
          content: isAbort
            ? (full || "(cancelled)")
            : full
            ? full + "\n\n_(Agent error — task commands still work)_"
            : errMsg
            ? `Agent error: ${errMsg}`
            : "Agent unavailable. Try a task command instead, e.g. \"push work tasks to tomorrow\".",
          streaming: false,
        } : m,
      ));
    } finally {
      setStreaming(false);
    }
  }, [msgs, streaming, tasks, push]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(value);
      setValue("");
    }
  }, [value, handleSend]);

  return (
    <div
      className="terminal-chat rounded-lg border border-circuit-border bg-circuit-bg overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-circuit-surface border-b border-circuit-border flex-shrink-0">
        <span className="text-sm font-semibold text-circuit-accent">Circuit Chat</span>
        <span className="text-circuit-border">·</span>
        <span className="text-xs text-circuit-muted">tasks &amp; commands</span>
        <div className="flex-1" />
        {streaming && (
          <span className="text-xs text-circuit-muted animate-pulse">thinking…</span>
        )}
      </div>

      {/* Messages */}
      <div
        ref={feedRef}
        className="flex-1 overflow-y-auto flex flex-col gap-3 px-4 py-4 min-h-0"
      >
        {msgs.map((msg) => {
          if (msg.role === "system") {
            return (
              <div key={msg.id} className="flex justify-center py-0.5">
                <span className="text-xs text-circuit-muted px-3 py-1 rounded-full bg-circuit-surface border border-circuit-border">
                  {msg.content}
                </span>
              </div>
            );
          }

          if (msg.role === "user") {
            return (
              <div key={msg.id} className="flex justify-end">
                <div
                  className="max-w-[80%] px-3.5 py-2 rounded-lg rounded-tr-sm text-sm leading-relaxed"
                  style={{ background: "var(--circuit-accent)", color: "var(--circuit-bg)" }}
                >
                  {msg.content}
                </div>
              </div>
            );
          }

          // Assistant message — may carry an action
          return (
            <div key={msg.id} className="flex justify-start">
              <div className="max-w-[90%] flex flex-col gap-2">
                <div className="px-3.5 py-2.5 rounded-lg rounded-tl-sm bg-circuit-surface border border-circuit-border text-circuit-text text-sm leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                  {msg.streaming && (
                    <span
                      className="inline-block w-1.5 h-3.5 ml-0.5 rounded-sm align-text-bottom animate-pulse"
                      style={{ background: "var(--circuit-accent)" }}
                    />
                  )}
                </div>

                {/* Action preview panel */}
                {msg.action && msg.actionState === "pending" && (
                  <ActionPreview
                    action={msg.action}
                    onApply={() => applyAction(msg.id, msg.action!)}
                    onCancel={() => cancelAction(msg.id)}
                  />
                )}
                {msg.action && msg.actionState === "applied" && (
                  <div className="text-xs text-circuit-muted px-1">✓ Applied</div>
                )}
                {msg.action && msg.actionState === "cancelled" && (
                  <div className="text-xs text-circuit-muted px-1">✕ Cancelled</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick command chips */}
      <div className="px-4 pb-2 flex gap-2 flex-wrap border-t border-circuit-border pt-2 bg-circuit-surface">
        {[
          "How busy is today?",
          "What recurrence formats are supported?",
          "Push high cognitive-load tasks to tomorrow",
          "Reschedule overdue tasks to tomorrow",
        ].map((cmd) => (
          <button
            key={cmd}
            onClick={() => { handleSend(cmd); }}
            disabled={streaming}
            className="text-xs px-2.5 py-1 rounded-full border border-circuit-border text-circuit-muted hover:border-circuit-accent hover:text-circuit-text transition-colors disabled:opacity-40"
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-end gap-2 px-4 py-3 bg-circuit-surface border-t border-circuit-border flex-shrink-0 terminal-chat-input">
        <textarea
          ref={inputRef}
          className="flex-1 bg-circuit-bg border border-circuit-border rounded px-3 py-2 text-sm text-circuit-text placeholder:text-circuit-muted resize-none outline-none focus:border-circuit-accent transition-colors"
          style={{ minHeight: "38px", maxHeight: "120px" }}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
          onKeyDown={handleKey}
          placeholder={streaming ? "thinking…" : "how busy is today? / push work tasks to tomorrow…"}
          rows={1}
          spellCheck={false}
          autoComplete="off"
        />
        {streaming ? (
          <button
            className="px-3 py-2 text-xs rounded border border-circuit-border text-circuit-muted hover:text-circuit-text hover:border-circuit-accent transition-colors flex-shrink-0"
            onClick={() => abortRef.current?.abort()}
          >
            stop
          </button>
        ) : (
          <button
            className="px-3 py-2 text-xs rounded flex-shrink-0 transition-colors disabled:opacity-40"
            style={{ background: "var(--circuit-accent)", color: "var(--circuit-bg)" }}
            onClick={() => { handleSend(value); setValue(""); }}
            disabled={!value.trim()}
          >
            send
          </button>
        )}
      </div>
    </div>
  );
}

// ── Action preview ─────────────────────────────────────────────────────────────

function ActionPreview({
  action,
  onApply,
  onCancel,
}: {
  action: TaskAction;
  onApply: () => void;
  onCancel: () => void;
}) {
  const SHOW = 5;
  const rest = action.tasks.length - SHOW;

  return (
    <div className="rounded-lg border border-circuit-border bg-circuit-bg overflow-hidden text-xs">
      <div className="px-3 py-2 border-b border-circuit-border flex items-center justify-between gap-2 bg-circuit-surface">
        <span className="font-medium text-circuit-text">{action.tasks.length} task{action.tasks.length !== 1 ? "s" : ""} will change</span>
        <span className="text-circuit-muted font-mono">{action.changeLabel}</span>
      </div>

      <div className="divide-y divide-circuit-border">
        {action.tasks.slice(0, SHOW).map((t) => (
          <div key={t.id} className="px-3 py-1.5 flex items-center gap-2">
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: t.tag === "work" ? "var(--sage)" : t.tag === "social" ? "var(--mustard)" : "var(--ink-3)" }}
            />
            <span className="flex-1 truncate text-circuit-text">{t.text}</span>
            {t.scheduled_at && (
              <span className="text-circuit-muted flex-shrink-0">
                {new Date(t.scheduled_at).toLocaleDateString("en-IN", { month: "short", day: "numeric", timeZone: "Asia/Kolkata" })}
              </span>
            )}
          </div>
        ))}
        {rest > 0 && (
          <div className="px-3 py-1.5 text-circuit-muted">+ {rest} more</div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-circuit-border flex gap-2 bg-circuit-surface">
        <button
          onClick={onApply}
          className="px-3 py-1 rounded text-xs font-medium transition-colors"
          style={{ background: "var(--circuit-accent)", color: "var(--circuit-bg)" }}
        >
          Apply
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1 rounded text-xs border border-circuit-border text-circuit-muted hover:text-circuit-text hover:border-circuit-accent transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
