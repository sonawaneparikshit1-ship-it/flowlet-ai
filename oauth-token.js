import { applyCors, assertAllowedOrigin, assertRateLimit, getSupabaseUser, publicConnectionResponse, readBody, requireEnv, sanitizeError, sanitizeRedirectUrl, sendJson, storeIntegrationConnection } from './_shared.js';

const ALLOWED_PROVIDERS = new Set(['slack', 'hubspot', 'discord', 'salesforce', 'notion']);

function envName(provider, key) {
  return `${provider.toUpperCase()}_${key}`;
}

function providerConfig(provider) {
  const configs = {
    slack: {
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      clientId: envName('slack', 'CLIENT_ID'),
      clientSecret: envName('slack', 'CLIENT_SECRET'),
      body: ({ clientId, clientSecret, code, redirectUri }) => ({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
      })
    },
    hubspot: {
      tokenUrl: 'https://api.hubapi.com/oauth/v1/token',
      clientId: envName('hubspot', 'CLIENT_ID'),
      clientSecret: envName('hubspot', 'CLIENT_SECRET'),
      body: ({ clientId, clientSecret, code, redirectUri }) => ({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
      })
    },
    discord: {
      tokenUrl: 'https://discord.com/api/oauth2/token',
      clientId: envName('discord', 'CLIENT_ID'),
      clientSecret: envName('discord', 'CLIENT_SECRET'),
      body: ({ clientId, clientSecret, code, redirectUri }) => ({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
      })
    },
    salesforce: {
      tokenUrl: 'https://login.salesforce.com/services/oauth2/token',
      clientId: envName('sf', 'CLIENT_ID'),
      clientSecret: envName('sf', 'CLIENT_SECRET'),
      body: ({ clientId, clientSecret, code, redirectUri }) => ({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri
      })
    }
  };

  return configs[provider];
}

async function exchangeNotion(code, redirectUri) {
  const clientId = requireEnv('NOTION_CLIENT_ID');
  const clientSecret = requireEnv('NOTION_CLIENT_SECRET');
  const response = await fetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    })
  });
  return { response, data: await response.json() };
}

async function exchangeFormProvider(provider, code, redirectUri) {
  const config = providerConfig(provider);
  if (!config) throw Object.assign(new Error('Unsupported provider'), { statusCode: 400 });

  const clientId = requireEnv(config.clientId);
  const clientSecret = requireEnv(config.clientSecret);
  const body = config.body({
    clientId,
    clientSecret,
    code,
    redirectUri
  });
  const params = new URLSearchParams(body);

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  return { response, data: await response.json() };
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return sendJson(req, res, 405, { error: 'Method not allowed' });

  try {
    assertAllowedOrigin(req);
    assertRateLimit(req, 'oauth-token', { max: 12, windowMs: 60_000 });

    const user = await getSupabaseUser(req);
    if (!user?.id) return sendJson(req, res, 401, { error: 'Unauthorized' });

    const { provider, code, redirectUri } = await readBody(req, { maxBytes: 8_000 });
    if (!provider || !code) return sendJson(req, res, 400, { error: 'provider and code are required' });

    const normalizedProvider = String(provider).toLowerCase();
    if (!ALLOWED_PROVIDERS.has(normalizedProvider)) {
      return sendJson(req, res, 400, { error: 'Unsupported provider' });
    }
    if (String(code).length > 2048 || /\s/.test(String(code))) {
      return sendJson(req, res, 400, { error: 'Invalid OAuth code' });
    }
    const defaultRedirect = process.env[envName(normalizedProvider === 'salesforce' ? 'sf' : normalizedProvider, 'REDIRECT_URI')]
      || process.env.APP_URL;
    const safeRedirectUri = sanitizeRedirectUrl(redirectUri, defaultRedirect);
    const result = normalizedProvider === 'notion'
      ? await exchangeNotion(code, safeRedirectUri)
      : await exchangeFormProvider(normalizedProvider, code, safeRedirectUri);

    const { response, data } = result;
    const providerFailed = normalizedProvider === 'slack' ? data.ok === false : !data.access_token;
    if (!response.ok || providerFailed) {
      return sendJson(req, res, response.status || 400, {
        error: data.error_description || data.error || data.message || 'OAuth token exchange failed'
      });
    }

    const connectionId = await storeIntegrationConnection(req, normalizedProvider, data, { redirectUri: safeRedirectUri });
    return sendJson(req, res, 200, publicConnectionResponse(normalizedProvider, data, connectionId));
  } catch (error) {
    return sendJson(req, res, error.statusCode || 500, { error: sanitizeError(error) });
  }
}
