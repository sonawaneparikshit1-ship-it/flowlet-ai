import { applyCors, assertAllowedOrigin, sendJson } from './_shared.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return sendJson(req, res, 405, { error: 'Method not allowed' });

  try {
    assertAllowedOrigin(req);
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

    if (!supabaseUrl || !supabaseAnonKey || supabaseAnonKey === 'replace_me') {
      return sendJson(req, res, 500, { error: 'Public auth config is not set on server' });
    }

    return sendJson(req, res, 200, {
      supabaseUrl,
      supabaseAnonKey
    });
  } catch (error) {
    return sendJson(req, res, error.statusCode || 500, {
      error: error.statusCode && error.statusCode < 500 ? error.message : 'Server error'
    });
  }
}
