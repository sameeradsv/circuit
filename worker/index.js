const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const MAX_BODY_BYTES = 5 * 1024 * 1024;
const USERNAME_RE = /^[a-z0-9_-]{3,64}$/;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts[0] !== 'sync' || !parts[1]) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    const username = decodeURIComponent(parts[1]);
    if (!USERNAME_RE.test(username)) {
      return jsonResponse({ error: 'Invalid username' }, 400);
    }

    if (request.method === 'GET') {
      const data = await env.BUNDLES.get(username);
      if (!data) return jsonResponse({ error: 'Not found' }, 404);
      return new Response(data, {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'PUT') {
      const body = await request.text();
      if (body.length > MAX_BODY_BYTES) {
        return jsonResponse({ error: 'Payload too large' }, 413);
      }

      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400);
      }

      if (
        typeof parsed.ct !== 'string' ||
        typeof parsed.iv !== 'string' ||
        typeof parsed.ts !== 'number'
      ) {
        return jsonResponse({ error: 'Invalid payload structure' }, 400);
      }

      await env.BUNDLES.put(username, body);
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  },
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
