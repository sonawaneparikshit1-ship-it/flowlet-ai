const rateLimitBuckets = globalThis.__flowletRateLimitBuckets || new Map();
globalThis.__flowletRateLimitBuckets = rateLimitBuckets;

function allowedOrigins() {
  const fromEnv = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (fromEnv.length > 0) return fromEnv;

  const defaults = new Set();
  if (process.env.APP_URL) {
    try {
      defaults.add(new URL(process.env.APP_URL).origin);
    } catch {
      // Ignore invalid APP_URL values and fall back to localhost defaults.
    }
  }
  defaults.add('http://localhost:3000');
  defaults.add('http://127.0.0.1:3000');
  return Array.from(defaults);
}

export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');
}

export function applyCors(req, res) {
  applySecurityHeaders(res);
  const origins = allowedOrigins();
  const requestOrigin = req?.headers?.origin;
  const allowOrigin = requestOrigin && origins.includes(requestOrigin)
    ? requestOrigin
    : origins[0];

  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

export function sendJson(req, res, status, payload) {
  applyCors(req, res);
  return res.status(status).json(payload);
}

export function assertAllowedOrigin(req) {
  const origins = allowedOrigins();
  const origin = req.headers.origin;
  if (!origin) return;

  if (!origins.includes(origin)) {
    const err = new Error('Origin not allowed');
    err.statusCode = 403;
    throw err;
  }
}

export function sanitizeRedirectUrl(url, fallbackUrl) {
  const target = String(url || '').trim() || String(fallbackUrl || '').trim();
  if (!target) {
    const err = new Error('Missing redirect URL');
    err.statusCode = 400;
    throw err;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    const err = new Error('Invalid redirect URL');
    err.statusCode = 400;
    throw err;
  }

  const protocol = parsed.protocol.toLowerCase();
  const isLocalHttp = protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  if (protocol !== 'https:' && !isLocalHttp) {
    const err = new Error('Redirect URL must use HTTPS');
    err.statusCode = 400;
    throw err;
  }

  const origins = allowedOrigins();
  if (!origins.includes(parsed.origin)) {
    const err = new Error('Redirect URL origin is not allowed');
    err.statusCode = 400;
    throw err;
  }

  return parsed.toString();
}

export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

export function assertRateLimit(req, keyPrefix = 'default', options = {}) {
  const windowMs = Number(options.windowMs || process.env.RATE_LIMIT_WINDOW_MS || 60_000);
  const max = Number(options.max || process.env.RATE_LIMIT_MAX || 30);
  const now = Date.now();
  const key = `${keyPrefix}:${getClientIp(req)}`;
  const current = rateLimitBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  current.count += 1;
  if (current.count > max) {
    const err = new Error('Too many requests. Please wait and try again.');
    err.statusCode = 429;
    throw err;
  }
}

export async function readBody(req, options = {}) {
  const maxBytes = Number(options.maxBytes || 64_000);
  if (req.body && typeof req.body === 'object') {
    if (JSON.stringify(req.body).length > maxBytes) {
      const err = new Error('Request body too large');
      err.statusCode = 413;
      throw err;
    }
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    if (req.body.length > maxBytes) {
      const err = new Error('Request body too large');
      err.statusCode = 413;
      throw err;
    }
    return JSON.parse(req.body);
  }
  return {};
}

export function requireEnv(name) {
  const value = process.env[name];
  if (!value || value === 'replace_me') {
    const err = new Error(`Missing server env var: ${name}`);
    err.statusCode = 500;
    throw err;
  }
  return value;
}

export function sanitizeError(error) {
  if (error.statusCode && error.statusCode < 500) return error.message;
  if (error.message && error.message.startsWith('Missing server env var:')) return error.message;
  return 'Server error';
}

export function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length > 4096 || /\s/.test(token)) return '';
  return token;
}

export async function getSupabaseUser(req) {
  const token = getBearerToken(req);
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!token || !supabaseUrl || !anonKey) return null;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) return null;
  return response.json();
}

export async function storeIntegrationConnection(req, provider, tokenData, metadata = {}) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  const user = await getSupabaseUser(req);
  if (!user?.id) return null;

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
    : null;
  const { access_token, refresh_token, id_token, ...tokenMetadata } = tokenData;

  const row = {
    user_id: user.id,
    provider,
    access_token: tokenData.access_token || null,
    refresh_token: tokenData.refresh_token || null,
    token_type: tokenData.token_type || null,
    scope: tokenData.scope || metadata.scope || null,
    expires_at: expiresAt,
    oauth_response: tokenMetadata,
    metadata,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const response = await fetch(`${supabaseUrl}/rest/v1/integration_connections?on_conflict=user_id,provider`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify(row)
  });

  if (!response.ok) {
    console.error('Supabase connection storage failed:', await response.text());
    return null;
  }

  const rows = await response.json();
  return rows?.[0]?.id || null;
}

export function publicConnectionResponse(provider, tokenData, connectionId) {
  return {
    connected: true,
    provider,
    connectionId,
    ok: tokenData.ok,
    team: tokenData.team,
    authed_user: tokenData.authed_user ? { id: tokenData.authed_user.id } : undefined,
    accountId: tokenData.accountId || tokenData.connectedAccountId || undefined
  };
}
