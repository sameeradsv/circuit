"use client";

import { useEffect, useState } from "react";

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

const PASSKEY_KEY = "circuit_passkey_registered";
const TOKEN_KEY = "circuit_auth_token";

export function usePasskey() {
  const [supported, setSupported] = useState(false);
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    setRegistered(!!localStorage.getItem(PASSKEY_KEY));
    if (typeof window !== "undefined" && "PublicKeyCredential" in window) {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
        .then(setSupported)
        .catch(() => setSupported(false));
    }
  }, []);

  async function registerPasskey(): Promise<void> {
    const { startRegistration } = await import("@simplewebauthn/browser");
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) throw new Error("Not authenticated");

    const beginRes = await fetch(`${API_BASE}/api/auth/webauthn/register/begin`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!beginRes.ok) {
      const e = await beginRes.json().catch(() => ({}));
      throw new Error((e as any).detail ?? "Failed to begin passkey registration");
    }
    const { challenge_id, options } = await beginRes.json();
    const credential = await startRegistration(options);

    const completeRes = await fetch(`${API_BASE}/api/auth/webauthn/register/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ challenge_id, credential }),
    });
    if (!completeRes.ok) {
      const e = await completeRes.json().catch(() => ({}));
      throw new Error((e as any).detail ?? "Failed to complete passkey registration");
    }
    localStorage.setItem(PASSKEY_KEY, "1");
    setRegistered(true);
  }

  async function loginWithPasskey(): Promise<{ token: string; user: { id: number; username: string } }> {
    const { startAuthentication } = await import("@simplewebauthn/browser");

    const beginRes = await fetch(`${API_BASE}/api/auth/webauthn/login/begin`, {
      method: "POST",
    });
    if (!beginRes.ok) {
      const e = await beginRes.json().catch(() => ({}));
      throw new Error((e as any).detail ?? "Failed to begin biometric login");
    }
    const { challenge_id, options } = await beginRes.json();
    const credential = await startAuthentication(options);

    const completeRes = await fetch(`${API_BASE}/api/auth/webauthn/login/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge_id, credential }),
    });
    if (!completeRes.ok) {
      const e = await completeRes.json().catch(() => ({}));
      throw new Error((e as any).detail ?? "Biometric login failed");
    }
    return completeRes.json();
  }

  return { supported, registered, registerPasskey, loginWithPasskey };
}
