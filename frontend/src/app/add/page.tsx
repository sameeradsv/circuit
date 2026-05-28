"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useCircuitAuth } from "@/lib/use-circuit-auth";
import { parseTaskText } from "@/lib/parse-task";

// ── NL parser (adapted from design reference) ─────────────────────────────────

interface ParseChip { k: string; v: string; }
interface NLResult  { title: string; chips: ParseChip[]; reason: string; }

function parseNL(s: string): NLResult {
  const chips: ParseChip[] = [];

  const dueMap: [RegExp, string][] = [
    [/\b(today|EOD|end of day)\b/i,      "today"],
    [/\btomorrow\b/i,                     "tomorrow"],
    [/\bmon(day)?\b/i,                    "Mon"],
    [/\btue(s|sday)?\b/i,                 "Tue"],
    [/\bwed(nesday)?\b/i,                 "Wed"],
    [/\bthu(rs|rsday)?\b/i,               "Thu"],
    [/\bfri(day)?\b/i,                    "Fri"],
    [/\bnext week\b/i,                    "next week"],
    [/\bthis week\b/i,                    "this week"],
  ];
  for (const [re, val] of dueMap) {
    if (re.test(s)) { chips.push({ k: "due", v: val }); break; }
  }

  const tm = s.match(/(\d+)\s*(h|hr|hour|hours|m|min|mins|minutes)/i);
  if (tm) {
    const n = parseInt(tm[1]);
    chips.push({ k: "time", v: /^h/i.test(tm[2]) ? `${n}h` : `${n}m` });
  }

  if      (/\bhigh energy|high.?focus|peak\b/i.test(s))  chips.push({ k: "energy", v: "high (8)" });
  else if (/\blow energy|drained|tired\b/i.test(s))       chips.push({ k: "energy", v: "low (3)" });
  else if (/\bfocus(ed)?|deep\b/i.test(s))                chips.push({ k: "energy", v: "focused (7)" });

  if      (/\bcreative|sketch|design|draft|write\b/i.test(s)) chips.push({ k: "type", v: "creative" });
  else if (/\breply|email|message|call|1:1\b/i.test(s))       chips.push({ k: "type", v: "comms" });
  else if (/\bdeep work|refactor|build|code|review\b/i.test(s)) chips.push({ k: "type", v: "deep" });
  else if (/\bgroceries|pick up|errand|dry clean\b/i.test(s))  chips.push({ k: "type", v: "errand" });
  else if (/\bexpense|file|book|schedule\b/i.test(s))          chips.push({ k: "type", v: "admin" });

  const bm = s.match(/blocks ([\w\s]+?)(?=,|$)/i);
  if (bm) chips.push({ k: "blocks", v: bm[1].trim() });

  let title = s.split(",")[0]
    .replace(/\bby (today|EOD|tomorrow|mon(day)?|tue(s|sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|next week|this week)/i, "")
    .replace(/~?\d+\s*(h|hr|hours?|m|min|mins|minutes?)/i, "")
    .trim();
  title = title.charAt(0).toUpperCase() + title.slice(1);

  let reason = "";
  if (chips.length > 0) {
    const hasUrgency = chips.some((c) => c.k === "due");
    const hasEnergy  = chips.some((c) => c.k === "energy");
    if (hasUrgency && hasEnergy)  reason = "will rank by urgency × energy match — you'll see it surface when you're in the right state.";
    else if (hasUrgency)          reason = "no energy hint — circuit will guess based on type.";
    else if (hasEnergy)           reason = "no due date — it'll sit in the backlog until your energy matches.";
    else                          reason = "captured, but won't rank highly without a due date or energy hint.";
  }

  return { title, chips, reason };
}

const EXAMPLES = [
  "reply to Sam by EOD, 15m, low energy",
  "deep work on auth refactor, 2h, high energy, blocks mobile launch",
  "pick up groceries on the way home tomorrow",
  "review investor deck Mon morning, 45m, focused",
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AddPage() {
  const { user, loading } = useCircuitAuth();
  const router = useRouter();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const parsed = text.trim() ? parseNL(text) : { title: "", chips: [], reason: "" };
  const taskParseResult = text.trim() ? parseTaskText(text) : null;
  const taskParsed = taskParseResult?.parsed ?? { text: "" };

  async function handleCapture() {
    const taskText = taskParsed.text?.trim() || text.trim();
    if (!taskText) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createTask({
        text: taskText,
        tag: (taskParsed as { text: string; tag?: string }).tag ?? "general",
        urgency: (taskParsed as { text: string; urgency?: number }).urgency ?? 0.5,
        importance: 0.5,
        tiny_step: "",
        effort: "medium",
        ...((taskParsed as { text: string; scheduledAt?: number }).scheduledAt ? { scheduled_at: (taskParsed as { text: string; scheduledAt?: number }).scheduledAt } : {}),
        ...((taskParsed as { text: string; duration?: number }).duration ? { duration: (taskParsed as { text: string; duration?: number }).duration } : {}),
      });
      router.push("/tasks");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to capture task");
      setSubmitting(false);
    }
  }

  if (loading || !user) return null;

  return (
    <div className="col gap-6" style={{ maxWidth: 760 }}>
      {/* Header */}
      <header>
        <div className="label" style={{ marginBottom: 6 }}>Quick capture</div>
        <h1 className="display" style={{ fontSize: 36, margin: 0 }}>
          What would you like to capture?
        </h1>
        <p className="serif" style={{ color: "var(--ink-3)", fontSize: 18, marginTop: 4 }}>
          write it like you'd say it. circuit will figure out the rest.
        </p>
      </header>

      {/* Input card */}
      <div className="card" style={{ padding: 20 }}>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              void handleCapture();
            }
          }}
          rows={3}
          placeholder="finish Q3 narrative by Friday, ~90m, high energy"
          style={{
            fontSize: 19,
            fontFamily: "var(--font-display)",
            border: "none",
            background: "transparent",
            resize: "none",
            padding: 6,
            width: "100%",
            outline: "none",
            color: "var(--ink)",
          }}
        />
        <div className="row gap-2 aic" style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <button className="btn" type="button" title="Voice (coming soon)" disabled style={{ opacity: 0.4 }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </button>
          <button className="btn" type="button" title="Suggest tags (coming soon)" disabled style={{ opacity: 0.5, fontSize: 13 }}>
            ✨ Suggest tags
          </button>
          <div style={{ flex: 1 }} />
          <span className="mono muted" style={{ fontSize: 11 }}>⌘ + Enter</span>
          <button
            className="btn btn-primary"
            onClick={handleCapture}
            disabled={submitting || !text.trim()}
          >
            {submitting ? "Capturing…" : "Capture →"}
          </button>
        </div>
        {error && <p style={{ color: "var(--terra)", fontSize: 13, marginTop: 8 }}>{error}</p>}
      </div>

      {/* Parsed preview */}
      {text.trim() && (
        <div>
          <div className="label" style={{ marginBottom: 10 }}>circuit reads this as</div>
          <div className="card-2" style={{ padding: 20 }}>
            <div className="display" style={{ fontSize: 22, marginBottom: 14, lineHeight: 1.2, color: "var(--ink)" }}>
              {parsed.title || <span className="serif muted">your task here…</span>}
            </div>
            <div className="row gap-2 wrap">
              {taskParseResult?.preview.date && (
                <span className="parse-chip">
                  <span className="k">scheduled</span> {taskParseResult.preview.date}
                </span>
              )}
              {taskParseResult?.preview.duration && (
                <span className="parse-chip">
                  <span className="k">duration</span> {taskParseResult.preview.duration}
                </span>
              )}
              {taskParseResult?.preview.priority && (
                <span className="parse-chip">
                  <span className="k">priority</span> {taskParseResult.preview.priority}
                </span>
              )}
              {taskParseResult?.preview.tag && (
                <span className="parse-chip">
                  <span className="k">tag</span> {taskParseResult.preview.tag}
                </span>
              )}
              {parsed.chips.filter((c) => !['due', 'time'].includes(c.k)).map((c, i) => (
                <span key={i} className="parse-chip">
                  <span className="k">{c.k}</span> {c.v}
                </span>
              ))}
              {!taskParseResult?.preview.date && !taskParseResult?.preview.duration && parsed.chips.length === 0 && (
                <span className="serif muted" style={{ fontSize: 13 }}>no signals detected yet</span>
              )}
            </div>
            {parsed.reason && (
              <div className="marginalia" style={{ marginTop: 14 }}>↳ {parsed.reason}</div>
            )}
          </div>
        </div>
      )}

      {/* Examples */}
      <div>
        <div className="label" style={{ marginBottom: 10 }}>Try one of these</div>
        <div className="col gap-2">
          {EXAMPLES.map((ex, i) => (
            <button
              key={i}
              className="btn"
              onClick={() => { setText(ex); textareaRef.current?.focus(); }}
              style={{
                justifyContent: "flex-start",
                textAlign: "left",
                padding: "12px 16px",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 16,
              }}
            >
              "{ex}"
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
