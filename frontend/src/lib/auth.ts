import { getAuthToken as _get, setAuthToken as _set } from "@shared/cortex";

const TOKEN_KEY = "circuit_auth_token";

export function getAuthToken(): string | null {
  return _get(TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  _set(TOKEN_KEY, token);
}
