"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { getAuthToken, getLocalUser, setAuthToken, setLocalUser, type LocalUser } from "./auth";

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
      try {
        const me = await api.me();
        setLocalUser(me);
        setUserState(me);
      } catch {
        setAuthToken(null);
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

  function logout() {
    setAuthToken(null);
    setLocalUser(null);
    setUserState(null);
  }

  return { user, loading, setUser, logout };
}
