"use client";

import { useState } from "react";
import { usePasskey } from "@/lib/usePasskey";

export function PasskeyBanner() {
  const { supported, registered, registerPasskey } = usePasskey();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!supported || registered || dismissed || done) return null;

  async function handleEnable() {
    setBusy(true);
    setErr(null);
    try {
      await registerPasskey();
      setDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="row aic gap-3" style={{ padding: "8px 20px", background: "var(--surface-2)", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
      {err ? (
        <span style={{ color: "var(--error, #e53e3e)" }}>{err}</span>
      ) : (
        <span style={{ color: "var(--ink-2)" }}>Enable biometric sign-in?</span>
      )}
      <button onClick={handleEnable} disabled={busy} className="btn btn-primary" style={{ padding: "2px 12px", fontSize: 12 }}>
        {busy ? "Setting up…" : "Enable"}
      </button>
      <button onClick={() => setDismissed(true)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--ink-3)" }}>
        Not now
      </button>
    </div>
  );
}
