const AI_KEY_PREFIX = 'circuit_ai_key';
const AI_PROVIDER_KEY = 'circuit_ai_provider';

export type AIProvider = 'gemini' | 'groq';

export function getAIProvider(): AIProvider {
  return (localStorage.getItem(AI_PROVIDER_KEY) as AIProvider) ?? 'gemini';
}

export function setAIProvider(provider: AIProvider): void {
  localStorage.setItem(AI_PROVIDER_KEY, provider);
}

export function getAIKey(): string | null {
  const provider = getAIProvider();
  return (
    localStorage.getItem(`${AI_KEY_PREFIX}_${provider}`) ||
    // Migrate legacy single-key storage (gemini only)
    (provider === 'gemini' ? localStorage.getItem(AI_KEY_PREFIX) : null) ||
    null
  );
}

export function setAIKey(key: string): void {
  const provider = getAIProvider();
  const storageKey = `${AI_KEY_PREFIX}_${provider}`;
  if (key.trim()) {
    localStorage.setItem(storageKey, key.trim());
  } else {
    localStorage.removeItem(storageKey);
  }
}

export function isAIConfigured(): boolean {
  return !!getAIKey();
}
