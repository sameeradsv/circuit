import { getAIKey, getAIProvider } from '../app/ai-config';
import { callGemini } from './gemini';
import { callGroq } from './groq';

export async function callAI(prompt: string, jsonMode = false): Promise<string> {
  const provider = getAIProvider();
  const key = getAIKey();
  if (!key) throw new Error('No AI key configured');
  if (provider === 'groq') return callGroq(key, prompt, jsonMode);
  return callGemini(key, prompt, jsonMode);
}
