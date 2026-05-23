import { getAuthToken as _get, setAuthToken as _set } from "@shared/cortex";

const TOKEN_KEY = "circuit_auth_token";
const USER_KEY = "circuit_user_v1";

export interface LocalUser {
  id: number;
  username: string;
}

export function getAuthToken(): string | null {
  return _get(TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  _set(TOKEN_KEY, token);
}

export function setLocalUser(user: LocalUser | null): void {
  if (typeof window === "undefined") return;
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

export function getLocalUser(): LocalUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as LocalUser) : null;
  } catch {
    return null;
  }
}
