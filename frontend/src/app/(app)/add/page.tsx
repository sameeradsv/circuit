"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiTask } from "@/lib/api";
import { useAuth } from "@shared/cortex";
import { parseUtterance } from "@/lib/parse-utterance";
import { useVoiceInput } from "@/lib/use-voice-input";
import { suggestSlot, formatSlot } from "@/lib/suggest-slot";
import { useCombinedEnergy } from "@/lib/use-combined-energy";
import { QUICK_PATTERNS, formatRecurrence } from "@/lib/recurrence";

// ── Examples ─────────────────────────────────────────────────────────────────

const EXAMPLES = [
  "reply to Sam by EOD, 15m, low energy",
  "deep work on auth refactor, 2h, high energy, blocks mobile launch",
  "pick up groceries on the way home tomorrow",
  "review investor deck Mon morning, 45m, focused",
];

// ── Page ─────────────────────────────────────────────────────────────────────

function toDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AddPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [text, setText] = useState("");
  const [scheduledAt, setScheduledAt] = useState<number | null>(null);
  const [recurrence, setRecurrence] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ label: string; rationale: string[] } | null>(null);
  const [allTasks, setAllTasks] = useState<ApiTask[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const voice = useVoiceInput();
  const { energy } = useCombinedEnergy();

  useEffect(() => {
    api.listTasks().then(setAllTasks).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleSuggest() {
    const taskParsedLocal = text.trim() ? parseUtterance(text) : null;
    const partial = {
      id: -1,
      text: text.trim() || "task",
      completed: false,
      tag: taskParsedLocal?.tag ?? "work",
      effort: taskParsedLocal?.effort ?? "medium",
      duration: taskParsedLocal?.duration ?? 30,
      focus_type: null,
      preferred_execution_window: null,
      delay_pattern: null,
      scheduled_at: null,
      urgency: 0.5, importance: 0.5,
      cognitive_load: 0.5, emotional_resistance: 0.5, activation_energy: 0.5,
      recovery_cost: 0.3, energy_to_reward_ratio: 0.5,
      consequence_of_delay: 0.3, momentum_value: 0.5,
      compound_benefit: 0.3, identity_alignment: 0.3,
      historical_completion_rate: 0.7, task_decomposition_potential: 0.3,
      skipped_count: 0, last_skipped_at: null, tiny_step: "", location_dependency: null,
      recurrence: null, deadline_type: "none" as const,
      time_sensitivity: 0.5, client_id: null, required_resources: "[]",
      dependencies: "[]", metadata_json: "{}", metadata: {},
      client_created_at: null, client_updated_at: null,
      created_at: "", updated_at: "",
    } as unknown as ApiTask;

    const slot = suggestSlot(partial, allTasks, Date.now(), energy ?? undefined);
    setScheduledAt(slot.scheduledAt);
    setSuggestion({ label: formatSlot(slot.scheduledAt), rationale: slot.rationale });
  }

  const utterance = text.trim() ? parseUtterance(text) : null;
  const taskParsed = utterance ?? { text: "" };
  const previewChips = utterance
    ? [
        ...(utterance.preview.date ? [{ k: "date", v: utterance.preview.date }] : []),
        ...(utterance.preview.tag ? [{ k: "tag", v: utterance.preview.tag }] : []),
        ...(utterance.preview.priority ? [{ k: "priority", v: utterance.preview.priority }] : []),
        ...(utterance.preview.duration ? [{ k: "time", v: utterance.preview.duration }] : []),
        ...utterance.chips,
      ]
    : [];

  // Explicit picker overrides NL-parsed date
  const finalScheduledAt = scheduledAt ?? utterance?.scheduledAt ?? null;

  async function handleCapture() {
    const taskText = taskParsed.text?.trim() || text.trim();
    if (!taskText) return;
    setSubmitting(true);
    setError(null);
    try {
      const u = parseUtterance(text);
      await api.createTask({
        text: taskText,
        tag: u.tag ?? "general",
        urgency: u.urgency ?? 0.5,
        importance: u.importance ?? 0.5,
        tiny_step: "",
        effort: u.effort ?? "medium",
        cognitive_load: u.cognitive_load,
        ...(finalScheduledAt ? { scheduled_at: finalScheduledAt } : {}),
        ...(recurrence ? { recurrence } : {}),
        ...(u.duration ? { duration: u.duration } : {}),
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
        {/* Schedule row */}
        <div className="col gap-2" style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <div className="row gap-3 aic">
            <span className="tiny muted" style={{ whiteSpace: "nowrap" }}>Schedule for</span>
            <button
              type="button"
              onClick={handleSuggest}
              className="btn"
              title={energy ? `Suggest based on energy (${Math.round(energy.composite * 100)}% · ${energy.sources.join(', ')})` : "Suggest a time"}
              style={{ fontSize: 11, padding: "3px 10px", whiteSpace: "nowrap", flexShrink: 0 }}
            >
              ✦ Suggest
            </button>
          </div>
          {suggestion && (
            <div className="row gap-2 wrap" style={{ marginBottom: 4 }}>
              <span className="parse-chip" style={{ background: "var(--sage)", color: "var(--paper)" }}>
                {suggestion.label}
              </span>
              {suggestion.rationale.map((r) => (
                <span key={r} className="parse-chip">{r}</span>
              ))}
            </div>
          )}
          <div className="row gap-3 aic">
          <input
            type="datetime-local"
            value={finalScheduledAt ? toDatetimeLocal(finalScheduledAt) : ""}
            onChange={(e) => setScheduledAt(e.target.value ? new Date(e.target.value).getTime() : null)}
            className="input-base"
            style={{ flex: 1, fontSize: 13, padding: "4px 8px" }}
          />
          {scheduledAt && (
            <button
              type="button"
              onClick={() => { setScheduledAt(null); setSuggestion(null); }}
              className="btn-icon"
              title="Clear"
              style={{ flexShrink: 0 }}
            >
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
          </div>
        </div>

        {/* Recurrence row */}
        {finalScheduledAt && (
          <div className="col gap-2" style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <div className="row gap-3 aic">
              <span className="tiny muted" style={{ whiteSpace: "nowrap" }}>Repeats</span>
              {recurrence && (
                <span className="parse-chip" style={{ background: "var(--sage)", color: "var(--paper)" }}>
                  {formatRecurrence(recurrence)}
                </span>
              )}
              <select
                value={recurrence || ""}
                onChange={(e) => setRecurrence(e.target.value || null)}
                className="input-field"
                style={{ fontSize: 12, padding: "4px 8px", flex: 1 }}
              >
                <option value="">No recurrence</option>
                {QUICK_PATTERNS.map((p) => (
                  <option key={p.pattern} value={p.pattern}>
                    {p.label} — {p.description}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="row gap-2 aic" style={{ marginTop: 10 }}>
          {voice.supported && (
            <button
              type="button"
              onClick={() => voice.listening ? voice.stop() : voice.start((t) => setText((prev) => prev ? prev + " " + t : t))}
              className="btn-icon"
              title={voice.listening ? "Stop listening" : "Voice input"}
              style={{ color: voice.listening ? "var(--terra)" : "var(--ink-3)", flexShrink: 0 }}
            >
              {voice.listening
                ? <svg width={15} height={15} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                : <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              }
            </button>
          )}
          {voice.listening && <span className="mono" style={{ fontSize: 11, color: "var(--terra)" }}>listening…</span>}
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
        {(error || voice.error) && (
          <p style={{ color: "var(--terra)", fontSize: 13, marginTop: 8 }}>{error ?? voice.error}</p>
        )}
      </div>

      {/* Parsed preview */}
      {text.trim() && (
        <div>
          <div className="label" style={{ marginBottom: 10 }}>circuit reads this as</div>
          <div className="card-2" style={{ padding: 20 }}>
            <div className="display" style={{ fontSize: 22, marginBottom: 14, lineHeight: 1.2, color: "var(--ink)" }}>
              {taskParsed.text || <span className="serif muted">your task here…</span>}
            </div>
            <div className="row gap-2 wrap">
              {previewChips.map((c, i) => (
                <span key={i} className="parse-chip">
                  <span className="k">{c.k}</span> {c.v}
                </span>
              ))}
              {utterance?.tag && !previewChips.some((c) => c.k === "tag") && (
                <span className="parse-chip"><span className="k">tag</span> {utterance.tag}</span>
              )}
              {utterance?.effort && (
                <span className="parse-chip"><span className="k">effort</span> {utterance.effort}</span>
              )}
              {previewChips.length === 0 && !utterance?.tag && (
                <span className="serif muted" style={{ fontSize: 13 }}>no signals detected yet</span>
              )}
            </div>
            {utterance && (
              <div className="marginalia" style={{ marginTop: 14 }}>
                ↳ local parser — no API call on capture
              </div>
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
