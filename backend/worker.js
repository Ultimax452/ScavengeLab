const ALLOWED_ORIGINS = [
  'https://www.divokekmeny.cz',
  'https://divokekmeny.cz',
  'https://www.tribalwars.net',
  'https://tribalwars.net'
];

const REQUIRED_FIELDS = ['world', 'option', 'duration_s', 'troops', 'expected', 'actual', 'ts'];
const MAX_BATCH_SIZE = 100;

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/collect') {
      return json({ ok: false, error: 'not_found' }, 404, request);
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'method_not_allowed' }, 405, request);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (_) {
      return json({ ok: false, error: 'invalid_json' }, 400, request);
    }

    const batch = Array.isArray(payload) ? payload : [];
    if (!batch.length || batch.length > MAX_BATCH_SIZE) {
      return json({ ok: false, error: 'invalid_batch_size' }, 400, request);
    }

    const sanitized = batch.map(sanitizeRecord).filter(Boolean);
    if (!sanitized.length) {
      return json({ ok: false, error: 'no_valid_records' }, 400, request);
    }

    // MVP: validated anonymous records are only logged.
    // Later this can be replaced by D1, R2, KV, Queues, or Analytics Engine.
    console.log(JSON.stringify({
      type: 'scavenge_assistant_batch',
      count: sanitized.length,
      records: sanitized
    }));

    return json({ ok: true, accepted: sanitized.length }, 200, request);
  }
};

function sanitizeRecord(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  if (!REQUIRED_FIELDS.every(field => Object.prototype.hasOwnProperty.call(record, field))) {
    return null;
  }

  const troops = sanitizeTroops(record.troops);
  if (!Object.keys(troops).length) {
    return null;
  }

  const safe = {
    world: String(record.world || '').slice(0, 80),
    option: toInt(record.option, 1, 4),
    duration_s: toInt(record.duration_s, 0, 7 * 24 * 3600),
    troops,
    expected: toInt(record.expected, 0, 100000000),
    actual: toInt(record.actual, 0, 100000000),
    ts: toInt(record.ts, 0, 4102444800)
  };

  if (!safe.world || !safe.option || !safe.duration_s || !safe.ts) {
    return null;
  }
  return safe;
}

function sanitizeTroops(troops) {
  if (!troops || typeof troops !== 'object' || Array.isArray(troops)) {
    return {};
  }

  const allowed = [
    'spear', 'sword', 'axe', 'archer', 'light', 'marcher', 'heavy', 'knight'
  ];
  const safe = {};
  for (const type of allowed) {
    const count = toInt(troops[type], 0, 1000000);
    if (count > 0) {
      safe[type] = count;
    }
  }
  return safe;
}

function toInt(value, min, max) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(min, Math.min(max, number));
}

function json(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '*';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}
