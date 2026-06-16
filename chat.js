import {
  applyCors,
  assertAllowedOrigin,
  assertRateLimit,
  readBody,
  requireEnv,
  sanitizeError,
  sendJson
} from './_shared.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return sendJson(req, res, 405, { error: 'Method not allowed' });

  try {
    assertAllowedOrigin(req);
    assertRateLimit(req, 'chat', { max: 20, windowMs: 60_000 });

    const { messages, model } = await readBody(req);
    if (!Array.isArray(messages)) return sendJson(req, res, 400, { error: 'messages array is required' });
    if (messages.length > 40) return sendJson(req, res, 400, { error: 'Too many messages' });

    const totalChars = messages.reduce((sum, message) => sum + String(message.content || '').length, 0);
    if (totalChars > 24000) return sendJson(req, res, 400, { error: 'Message too large' });

    const openRouterKey = requireEnv('OPENROUTER_API_KEY');
    let targetModel = String(model || 'openai/gpt-4o-mini');
    if (targetModel.startsWith('meta/')) targetModel = targetModel.replace('meta/', 'meta-llama/');
    const allowedModels = new Set([
      'openai/gpt-4o-mini',
      'meta-llama/llama-3.1-8b-instruct'
    ]);
    if (!allowedModels.has(targetModel)) targetModel = 'openai/gpt-4o-mini';

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'https://flowlet.ai',
        'X-Title': 'Flowlet AI'
      },
      body: JSON.stringify({
        model: targetModel,
        messages,
        temperature: 0.2,
        top_p: 0.7,
        max_tokens: 1400
      })
    });

    const data = await response.json().catch(async () => ({ error: await response.text() }));
    if (!response.ok) return sendJson(req, res, response.status, { error: 'AI provider error' });

    return sendJson(req, res, 200, data);
  } catch (error) {
    return sendJson(req, res, error.statusCode || 500, { error: sanitizeError(error) });
  }
}
