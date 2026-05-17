import { buildSyncBundle, parseSyncBundle, type CircuitSyncBundle } from './sync-bundle';
import type { Task } from '../types';

const ENDPOINT_KEY = 'circuit_sync_endpoint';

export function getCloudEndpoint(): string | null {
  return localStorage.getItem(ENDPOINT_KEY) || null;
}

export function setCloudEndpoint(url: string): void {
  if (url.trim()) {
    localStorage.setItem(ENDPOINT_KEY, url.trim().replace(/\/$/, ''));
  } else {
    localStorage.removeItem(ENDPOINT_KEY);
  }
}

async function deriveEncKey(passcode: string, username: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const saltBytes = await crypto.subtle.digest('SHA-256', enc.encode(username + ':circuit-enc'));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passcode), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 120_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromB64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function encryptBundle(
  key: CryptoKey,
  bundle: CircuitSyncBundle,
): Promise<{ ct: string; iv: string; ts: number }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(bundle));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    ct: toB64(ciphertext),
    iv: btoa(String.fromCharCode(...iv)),
    ts: bundle.exportedAt,
  };
}

async function decryptBundle(
  key: CryptoKey,
  payload: { ct: string; iv: string },
): Promise<CircuitSyncBundle> {
  const iv = fromB64(payload.iv);
  const ct = fromB64(payload.ct);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return parseSyncBundle(new TextDecoder().decode(plaintext));
}

export async function pushToCloud(
  tasks: Task[],
  username: string,
  passcode: string,
  endpoint: string,
): Promise<void> {
  const key = await deriveEncKey(passcode, username);
  const bundle = buildSyncBundle(tasks);
  const payload = await encryptBundle(key, bundle);
  const res = await fetch(`${endpoint}/sync/${encodeURIComponent(username)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
}

export async function pullFromCloud(
  username: string,
  passcode: string,
  endpoint: string,
): Promise<CircuitSyncBundle | null> {
  const res = await fetch(`${endpoint}/sync/${encodeURIComponent(username)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
  const payload = (await res.json()) as { ct: string; iv: string; ts: number };
  if (!payload.ct || !payload.iv) return null;
  const key = await deriveEncKey(passcode, username);
  return decryptBundle(key, payload);
}
