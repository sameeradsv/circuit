"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth, CortexSignIn } from "@shared/cortex";
import { api } from "@/lib/api";
import { setAuthToken } from "@/lib/auth";

const CORTEX_URL = (process.env.NEXT_PUBLIC_CORTEX_URL ?? "").replace(/\/$/, "");

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, refetch } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"login" | "register">("register");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showLocal, setShowLocal] = useState(true);

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
      await refetch();
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || user) return null;

  return (
    <div className="mx-auto max-w-md space-y-6">
      <header>
        <h1 className="text-2xl font-medium text-circuit-text">
          {mode === "register" ? "Create account" : "Sign in"}
        </h1>
        <p className="mt-1 text-sm text-circuit-muted">
          Your account keeps data synced across devices. Credentials are hashed and never stored in plain text.
        </p>
      </header>

      {/* Cortex sign-in section */}
      {CORTEX_URL && !showLocal && (
        <div className="panel p-5 space-y-4">
          <p className="text-xs text-circuit-muted">One account across Canopy, Chef, and Circuit.</p>
          <CortexSignIn
            cortexApiBase={CORTEX_URL}
            tokenKey="circuit_auth_token"
            appName="Circuit"
            showHeader={false}
            onSuccess={async () => {
              await refetch();
              router.push("/");
            }}
            onLocalMode={() => setShowLocal(true)}
            classNames={{
              title: "text-base font-medium text-circuit-text",
              subtitle: "text-xs text-circuit-muted",
              input: "input-field",
              submitBtn: "btn-primary w-full",
              toggleBtn: "w-full text-center text-xs text-circuit-muted hover:text-circuit-text",
              localBtn: "w-full text-center text-xs text-circuit-muted hover:text-circuit-text",
              error: "text-sm text-red-400",
            }}
          />
        </div>
      )}

      {/* Local login form */}
      {showLocal && (
        <form onSubmit={handleLocalSubmit} className="panel space-y-4 p-5">
          {hasUsers === null ? (
            <p className="text-sm text-circuit-muted">Checking status…</p>
          ) : (
            <>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                required
                autoComplete="username"
                className="input-field"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min 6 characters)"
                required
                minLength={6}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                className="input-field"
              />
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button type="submit" disabled={submitting} className="btn-primary w-full">
                {submitting ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
              </button>
              <button
                type="button"
                onClick={() => setMode(mode === "login" ? "register" : "login")}
                className="w-full text-center text-xs text-circuit-muted hover:text-circuit-text"
              >
                {mode === "login" ? "Need an account? Register" : "Already have an account? Sign in"}
              </button>
              {CORTEX_URL && (
                <button
                  type="button"
                  onClick={() => setShowLocal(false)}
                  className="w-full text-center text-xs text-circuit-muted hover:text-circuit-text"
                >
                  ← Use Cortex account instead
                </button>
              )}
            </>
          )}
        </form>
      )}
    </div>
  );
}
