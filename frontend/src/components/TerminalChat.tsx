"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";

const CONDUIT = (process.env.NEXT_PUBLIC_CONDUIT_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
const SCOPE = "circuit";
const TOKEN_KEY = "circuit_auth_token";

const HELP = `circuit chat — powered by conduit
  /help    show this message
  /clear   clear chat history

example questions:
  what are my tasks today?
  what's most urgent right now?
  how many tasks did i complete this week?
  add a task: call the dentist [tag: personal]`;

const CSS = `
.tc-shell{position:fixed;inset:0;z-index:100;display:flex;flex-direction:column;background:#0b130d;color:#8dce8a;font-family:ui-monospace,'Cascadia Code','Fira Code',monospace;font-size:13px;line-height:1.6}
.tc-topbar{display:flex;align-items:center;gap:12px;padding:8px 16px;border-bottom:1px solid #1e3d22;background:#0e1811;flex-shrink:0;min-height:44px}
.tc-brand{color:#56ff56;font-size:14px;letter-spacing:.05em}
.tc-scope{color:#5a9456;font-size:12px}
.tc-grow{flex:1}
.tc-back{color:#5a9456;text-decoration:none;font-size:11px;padding:3px 8px;border:1px solid #1e3d22;transition:color .1s,border-color .1s}
.tc-back:hover{color:#8dce8a;border-color:#5a9456}
.tc-feed{flex:1;overflow-y:auto;padding:12px 0}
.tc-feed::-webkit-scrollbar{width:5px}
.tc-feed::-webkit-scrollbar-thumb{background:#1e3d22;border-radius:3px}
.tc-row{display:flex;gap:10px;padding:5px 16px;transition:background .06s}
.tc-row:hover{background:#0d180e}
.tc-row.user{background:#0f1a10}
.tc-px{flex-shrink:0;width:14px;text-align:right;padding-top:1px;user-select:none;font-size:13px;color:#3a5e38}
.tc-px.assistant{color:#56ff56}
.tc-px.user{color:#5a9456}
.tc-px.error{color:#c04040}
.tc-body{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.65}
.tc-body.system{color:#3a5e38;font-style:italic}
.tc-body.error{color:#c04040}
.tc-cursor{display:inline-block;width:6px;height:12px;background:#56ff56;vertical-align:text-bottom;margin-left:1px;animation:tc-blink 1.1s step-end infinite}
@keyframes tc-blink{0%,100%{opacity:1}50%{opacity:0}}
.tc-input-wrap{border-top:1px solid #1e3d22;background:#0e1811;padding:8px 16px;display:flex;align-items:flex-start;gap:8px;flex-shrink:0}
.tc-prompt{color:#56ff56;padding-top:2px;flex-shrink:0;user-select:none}
.tc-field{flex:1;background:transparent;border:none;outline:none;color:#8dce8a;font-family:inherit;font-size:13px;line-height:1.6;resize:none;min-height:20px;max-height:180px;padding:0;caret-color:#56ff56}
.tc-field::placeholder{color:#2a4e2a}
.tc-btn{appearance:none;border:1px solid #1e3d22;background:transparent;color:#5a9456;padding:2px 8px;font-family:inherit;font-size:11px;cursor:pointer;flex-shrink:0;align-self:flex-end;margin-bottom:1px;transition:color .1s,border-color .1s}
.tc-btn:hover{border-color:#5a9456;color:#8dce8a}
.tc-btn:disabled{opacity:.3;pointer-events:none}
.tc-statusbar{padding:3px 16px;border-top:1px solid #152015;background:#090f09;font-size:10px;color:#3a5e38;flex-shrink:0}
`;

type Role = "user" | "assistant" | "system";
interface Msg { id: string; role: Role; content: string; streaming?: boolean; }

let _n = 0;
const uid = () => `tc${++_n}`;
const PREFIX: Record<Role, string> = { user: ">", assistant: "~", system: "#" };

async function* agentStream(
  history: { role: string; content: string }[],
  token: string | null,
  signal: AbortSignal,
  onTool: (name: string) => void,
): AsyncGenerator<string> {
  const res = await fetch(`${CONDUIT}/api/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: history,
      model: "llama-3.3-70b-versatile",
      sibling_token: token,
      scope: SCOPE,
      diary: false,
    }),
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

export function TerminalChat() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { id: uid(), role: "system", content: "circuit chat ready. type a question or /help for commands." },
  ]);
  const [value, setValue] = useState("");
  const [streaming, setStreaming] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const push = useCallback((m: Omit<Msg, "id">): string => {
    const id = uid();
    setMsgs(prev => [...prev, { ...m, id }]);
    return id;
  }, []);

  const handleSend = useCallback(async (text: string) => {
    const t = text.trim();
    if (!t || streaming) return;
    if (t === "/clear") { setMsgs([{ id: uid(), role: "system", content: "cleared." }]); return; }
    if (t === "/help") { push({ role: "system", content: HELP }); return; }
    if (t.startsWith("/")) { push({ role: "system", content: `! unknown command: ${t}` }); return; }

    push({ role: "user", content: t });
    setStreaming(true);

    const history = [
      ...msgs.filter(m => m.role === "user" || m.role === "assistant").map(m => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: t },
    ];
    const token = typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
    abortRef.current = new AbortController();
    const aiId = push({ role: "assistant", content: "", streaming: true });
    let full = "";

    try {
      for await (const chunk of agentStream(
        history, token, abortRef.current.signal,
        (tool) => push({ role: "system", content: `~ ${tool.replace(/_/g, " ")}…` }),
      )) {
        full += chunk;
        setMsgs(prev => prev.map(m => m.id === aiId ? { ...m, content: full } : m));
      }
      setMsgs(prev => prev.map(m => m.id === aiId ? { ...m, streaming: false } : m));
    } catch (err: unknown) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      setMsgs(prev => prev.map(m =>
        m.id === aiId ? {
          ...m,
          content: isAbort ? (full || "(cancelled)") : `! ${err instanceof Error ? err.message : "error"}`,
          streaming: false,
        } : m,
      ));
    } finally {
      setStreaming(false);
    }
  }, [msgs, streaming, push]);

  const handleKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(value);
      setValue("");
    }
  }, [value, handleSend]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="tc-shell">
        <div className="tc-topbar">
          <span className="tc-brand">circuit</span>
          <span style={{ color: "#3a5e38" }}>·</span>
          <span className="tc-scope">~ chat</span>
          <span className="tc-grow" />
          <Link href="/" className="tc-back">← back</Link>
        </div>

        <div className="tc-feed" ref={feedRef}>
          {msgs.map(msg => {
            const isErr = msg.content.startsWith("! ");
            const rc = isErr ? "error" : msg.role;
            const prefix = isErr ? "!" : (PREFIX[msg.role] ?? "#");
            return (
              <div key={msg.id} className={`tc-row ${msg.role}`}>
                <span className={`tc-px ${rc}`}>{prefix}</span>
                <span className={`tc-body ${rc}`}>
                  {msg.content}
                  {msg.streaming && <span className="tc-cursor" aria-hidden />}
                </span>
              </div>
            );
          })}
        </div>

        <div className="tc-input-wrap">
          <span className="tc-prompt">{streaming ? "~" : ">"}</span>
          <textarea
            ref={inputRef}
            className="tc-field"
            value={value}
            onChange={e => {
              setValue(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
            }}
            onKeyDown={handleKey}
            placeholder={streaming ? "streaming…" : "what are my tasks today?"}
            rows={1}
            spellCheck={false}
            autoComplete="off"
          />
          {streaming
            ? <button className="tc-btn" onClick={() => abortRef.current?.abort()}>[stop]</button>
            : <button className="tc-btn" onClick={() => { handleSend(value); setValue(""); }} disabled={!value.trim()}>[↵]</button>
          }
        </div>

        <div className="tc-statusbar">
          circuit · tasks · {streaming ? "streaming…" : "ready"}
        </div>
      </div>
    </>
  );
}
