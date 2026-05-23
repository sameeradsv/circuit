"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { getAuthToken, getLocalUser, setLocalUser, type LocalUser } from "./auth";

export type { LocalUser };

export function useCircuitAuth() {
  const [user, setUserState] = useState<LocalUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      const token = getAuthToken();
      if (!token) {
        setLoading(false);
        return;
      }
      // Fast path: user cached in localStorage from last login
      const cached = getLocalUser();
      if (cached) {
        setUserState(cached);
        setLoading(false);
        return;
      }
      // Token exists but no cached user — validate with backend
      try {
        const me = await api.me();
        setLocalUser(me);
        setUserState(me);
      } catch {
        // Token invalid/expired — clear stale state
        setLocalUser(null);
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, []);

  function setUser(u: LocalUser | null) {
    setLocalUser(u);
    setUserState(u);
  }

  return { user, loading, setUser };
}
