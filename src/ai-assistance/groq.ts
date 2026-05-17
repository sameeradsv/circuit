const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

interface GroqResponse {
  choices?: Array<{
    message?: { content?: string };
  }>;
}

export async function callGroq(apiKey: string, prompt: string, jsonMode = false): Promise<string> {
  const body: Record<string, unknown> = {
    model: GROQ_MODEL,
    messages: [{ role: 'user', content: prompt }],
  };
  if (jsonMode) {
    body['response_format'] = { type: 'json_object' };
  }

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Groq API error: ${res.status}`);

  const data = (await res.json()) as GroqResponse;
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Empty response from Groq');
  return text;
}
