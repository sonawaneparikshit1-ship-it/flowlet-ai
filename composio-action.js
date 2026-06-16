import { applyCors, assertAllowedOrigin, assertRateLimit, getSupabaseUser, readBody, requireEnv, sanitizeError, sendJson } from './_shared.js';

const ALLOWED_ACTIONS = new Set([
  'GMAIL_LIST_THREADS'
]);

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return sendJson(req, res, 405, { error: 'Method not allowed' });

  try {
    assertAllowedOrigin(req);
    assertRateLimit(req, 'composio-action', { max: 12, windowMs: 60_000 });

    const user = await getSupabaseUser(req);
    if (!user?.id) return sendJson(req, res, 401, { error: 'Unauthorized' });

    const { action, connectedAccountId, input } = await readBody(req, { maxBytes: 12_000 });
    const targetAction = action || 'GMAIL_LIST_THREADS';
    if (!ALLOWED_ACTIONS.has(targetAction)) {
      return sendJson(req, res, 400, { error: 'Unsupported Composio action' });
    }
    if (input && JSON.stringify(input).length > 8_000) {
      return sendJson(req, res, 413, { error: 'Composio input too large' });
    }

    const apiKey = requireEnv('COMPOSIO_API_KEY');
    const clientAccountId = String(connectedAccountId || '').trim();
    if (clientAccountId && !/^[A-Za-z0-9._:-]{3,160}$/.test(clientAccountId)) {
      return sendJson(req, res, 400, { error: 'Invalid connectedAccountId' });
    }
    const accountId = process.env.COMPOSIO_ACCOUNT_ID
      || (process.env.ALLOW_CLIENT_COMPOSIO_ACCOUNT_ID === 'true' ? clientAccountId : '');
    if (!accountId) return sendJson(req, res, 500, { error: 'Server Composio account binding is not configured' });

    const response = await fetch(`https://backend.composio.dev/api/v2/actions/${targetAction}/execute`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        connectedAccountId: accountId,
        input: input || {}
      })
    });

    const data = await response.json();
    if (!response.ok) return sendJson(req, res, response.status, data);
    return sendJson(req, res, 200, data);
  } catch (error) {
    return sendJson(req, res, error.statusCode || 500, { error: sanitizeError(error) });
  }
}




