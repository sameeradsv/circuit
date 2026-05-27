"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CortexSignIn } from "@shared/cortex";
import { api } from "@/lib/api";
import { setAuthToken } from "@/lib/auth";
import { useCircuitAuth } from "@/lib/use-circuit-auth";

const CORTEX_URL = (process.env.NEXT_PUBLIC_CORTEX_URL ?? "").replace(/\/$/, "");

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, setUser } = useCircuitAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLocal, setShowLocal] = useState(!CORTEX_URL);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [user, loading, router]);

  useEffect(() => {
    api
      .authStatus()
      .then((s) => {
        setHasUsers(s.has_users);
        setMode(s.has_users ? "login" : "register");
      })
      .catch(() => setHasUsers(false));
  }, []);

  async function handleLocalSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result =
        mode === "register"
          ? await api.register(username.trim(), password)
          : await api.login(username.trim(), password);
      setAuthToken(result.token);
      setUser(result.user);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || user) return null;

  return (
    <div className="col gap-6" style={{ width: "100%", maxWidth: 400 }}>
      <div>
        <div className="row aic gap-2" style={{ marginBottom: 20 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--terra)", display: "inline-block" }} />
          <span className="display" style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.03em" }}>circuit</span>
        </div>
        <h1 className="display" style={{ fontSize: 28, margin: "0 0 6px" }}>
          {mode === "register" ? "Create account" : "Sign in"}
        </h1>
        <p className="serif" style={{ color: "var(--ink-3)", fontSize: 15, margin: 0 }}>
          your tasks, ranked by energy and urgency.
        </p>
      </div>

      {CORTEX_URL && !showLocal && (
        <div className="card" style={{ padding: 24 }}>
          <p className="tiny muted" style={{ marginBottom: 16 }}>One account across Canopy, Chef, and Circuit.</p>
          <CortexSignIn
            cortexApiBase={CORTEX_URL}
            tokenKey="circuit_auth_token"
            appName="Circuit"
            showHeader={false}
            onSuccess={async () => {
              try { setUser(await api.me()); } catch { /* ignore */ }
              router.push("/");
            }}
            onLocalMode={() => setShowLocal(true)}
            classNames={{
              title: "display",
              subtitle: "serif muted",
              input: "input-base",
              submitBtn: "btn btn-primary",
              toggleBtn: "btn",
              localBtn: "btn",
              error: "marginalia",
            }}
          />
        </div>
      )}

      {showLocal && (
        <form onSubmit={handleLocalSubmit} className="card col gap-4" style={{ padding: 24 }}>
          {hasUsers === null ? (
            <p className="serif muted">Checking…</p>
          ) : (
            <>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                required
                autoComplete="username"
                className="input-base"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min 6 characters)"
                required
                minLength={6}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                className="input-base"
              />
              {error && (
                <p style={{ color: "var(--terra)", fontSize: 13, margin: 0 }}>{error}</p>
              )}
              <button type="submit" disabled={submitting} className="btn btn-primary" style={{ justifyContent: "center" }}>
                {submitting ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
              </button>
              <div className="col gap-2" style={{ alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => setMode(mode === "login" ? "register" : "login")}
                  style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--ink-3)", fontFamily: "var(--font-body)" }}
                >
                  {mode === "login" ? "Need an account? Register" : "Already have an account? Sign in"}
                </button>
                {CORTEX_URL && (
                  <button
                    type="button"
                    onClick={() => setShowLocal(false)}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--ink-3)", fontFamily: "var(--font-body)" }}
                  >
                    ← Back to Cortex sign-in
                  </button>
                )}
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
