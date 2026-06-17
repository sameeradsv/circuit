"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { getAuthToken, getLocalUser, setAuthToken, setLocalUser, type LocalUser } from "./auth";

export type { LocalUser };

const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export function useCircuitAuth() {
  const [user, setUserState] = useState<LocalUser | null>(() => getLocalUser());
  const [loading, setLoading] = useState(() => !!getAuthToken());

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setUserState(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    async function init() {
      try {
        const me = await api.me();
        if (!controller.signal.aborted) {
          setLocalUser(me);
          setUserState(me);
        }
      } catch {
        if (!controller.signal.aborted) {
          setAuthToken(null);
          setLocalUser(null);
          setUserState(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void init();
    return () => controller.abort();
  }, []);

  function setUser(u: LocalUser | null) {
    setLocalUser(u);
    setUserState(u);
  }

  function logout() {
    const token = getAuthToken();
    setAuthToken(null);
    setLocalUser(null);
    setUserState(null);
    if (token) {
      fetch(`${apiBase}/api/auth/logout`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }

  return { user, loading, setUser, logout };
}
