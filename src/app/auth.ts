const USERS_KEY = 'circuit_auth_users_v1';
const SESSION_KEY = 'circuit_session_v1';
const LOCAL_USER = '__local__';

let sessionPasscode: string | null = null;

export function getPasscodeForSession(): string | null {
  return sessionPasscode;
}

function setSessionPasscode(p: string): void {
  sessionPasscode = p;
}

export function clearSessionPasscode(): void {
  sessionPasscode = null;
}

export interface AuthSession {
  username: string;
  isLocal: boolean;
}

interface StoredUser {
  username: string;
  salt: string;
  passHash: string;
}

function readUsers(): StoredUser[] {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredUser[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeUsers(users: StoredUser[]): void {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

function sanitizeUsername(username: string): string {
  return username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function validateUsername(username: string): string | null {
  const u = sanitizeUsername(username);
  if (u.length < 3) return 'Username must be at least 3 characters.';
  if (u.length > 32) return 'Username is too long.';
  return null;
}

function validatePasscode(passcode: string): string | null {
  if (passcode.length < 4) return 'Passcode must be at least 4 characters.';
  if (passcode.length > 64) return 'Passcode is too long.';
  return null;
}

async function hashPasscode(passcode: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passcode),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: 120_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

function randomSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return salt;
}

function saltToB64(salt: Uint8Array): string {
  return btoa(String.fromCharCode(...salt));
}

function saltFromB64(salt: string): Uint8Array {
  const bin = atob(salt);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function getSession(): AuthSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.username) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function storageNamespace(session: AuthSession | null): string {
  if (!session || session.isLocal) return '';
  return `_${sanitizeUsername(session.username)}`;
}

function setSession(session: AuthSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export async function registerAccount(username: string, passcode: string): Promise<void> {
  const userErr = validateUsername(username);
  if (userErr) throw new Error(userErr);
  const passErr = validatePasscode(passcode);
  if (passErr) throw new Error(passErr);

  const normalized = sanitizeUsername(username);
  const users = readUsers();
  if (users.some((u) => u.username === normalized)) {
    throw new Error('Username already exists.');
  }

  const salt = randomSalt();
  const passHash = await hashPasscode(passcode, salt);
  users.push({ username: normalized, salt: saltToB64(salt), passHash });
  writeUsers(users);
  setSessionPasscode(passcode);
  setSession({ username: normalized, isLocal: false });
}

export async function loginAccount(username: string, passcode: string): Promise<void> {
  const userErr = validateUsername(username);
  if (userErr) throw new Error(userErr);
  const passErr = validatePasscode(passcode);
  if (passErr) throw new Error(passErr);

  const normalized = sanitizeUsername(username);
  const user = readUsers().find((u) => u.username === normalized);
  if (!user) throw new Error('Account not found.');

  const hash = await hashPasscode(passcode, saltFromB64(user.salt));
  if (hash !== user.passHash) throw new Error('Incorrect passcode.');

  setSessionPasscode(passcode);
  setSession({ username: normalized, isLocal: false });
}

export function continueLocally(): void {
  setSession({ username: LOCAL_USER, isLocal: true });
}

export function logout(): void {
  clearSession();
  clearSessionPasscode();
}

export type AuthReadyHandler = (session: AuthSession) => void;

export function initAuthUI(onReady: AuthReadyHandler): void {
  const overlay = document.getElementById('auth-overlay');
  const usernameInput = document.getElementById('auth-username') as HTMLInputElement | null;
  const passcodeInput = document.getElementById('auth-passcode') as HTMLInputElement | null;
  const errorEl = document.getElementById('auth-error');
  const signInBtn = document.getElementById('auth-sign-in');
  const registerBtn = document.getElementById('auth-register');
  const localBtn = document.getElementById('auth-continue-local');
  const accountBtn = document.getElementById('account-btn');
  const accountLabel = document.getElementById('account-label');
  const signOutBtn = document.getElementById('auth-sign-out');

  const showError = (msg: string) => {
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.hidden = !msg;
    }
  };

  const hideOverlay = () => {
    overlay?.setAttribute('hidden', '');
  };

  const showOverlay = () => {
    overlay?.removeAttribute('hidden');
    usernameInput?.focus();
  };

  const updateAccountChip = (session: AuthSession) => {
    if (accountLabel) {
      accountLabel.textContent = session.isLocal ? 'Local' : session.username;
    }
    if (accountBtn) {
      accountBtn.title = session.isLocal
        ? 'Using this device only — sign in to sync'
        : `Signed in as ${session.username}`;
    }
  };

  const finish = (session: AuthSession) => {
    hideOverlay();
    updateAccountChip(session);
    onReady(session);
  };

  const existing = getSession();
  if (existing) {
    hideOverlay();
    updateAccountChip(existing);
    onReady(existing);
    return;
  }

  showOverlay();

  signInBtn?.addEventListener('click', async () => {
    showError('');
    try {
      await loginAccount(usernameInput?.value ?? '', passcodeInput?.value ?? '');
      finish(getSession()!);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Sign in failed.');
    }
  });

  registerBtn?.addEventListener('click', async () => {
    showError('');
    try {
      await registerAccount(usernameInput?.value ?? '', passcodeInput?.value ?? '');
      finish(getSession()!);
    } catch (e) {
      showError(e instanceof Error ? e.message : 'Could not create account.');
    }
  });

  localBtn?.addEventListener('click', () => {
    showError('');
    continueLocally();
    finish(getSession()!);
  });

  signOutBtn?.addEventListener('click', () => {
    logout();
    window.location.reload();
  });

  accountBtn?.addEventListener('click', () => {
    const session = getSession();
    if (session?.isLocal) showOverlay();
  });
}
