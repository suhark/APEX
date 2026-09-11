/**
 * Vercel serverless function — Deriv OAuth token exchange proxy
 * Bypasses CORS restriction on auth.deriv.com/oauth2/token
 *
 * POST /api/deriv-token
 * Body JSON: { code, code_verifier, redirect_uri, client_id }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const TOKEN_ENDPOINT = 'https://auth.deriv.com/oauth2/token';

const ALLOWED_ORIGINS = [
  'https://apextradinglab.app',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:5174',
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin ?? '';

  // CORS headers
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://apextradinglab.app');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed — use POST' });
  }

  const { code, code_verifier, redirect_uri, client_id } = req.body ?? {};

  console.log('[deriv-token] Request received', {
    hasCode: !!code,
    hasVerifier: !!code_verifier,
    redirect_uri,
    client_id,
    origin,
  });

  if (!code || !code_verifier || !redirect_uri || !client_id) {
    const missing = [
      !code && 'code',
      !code_verifier && 'code_verifier',
      !redirect_uri && 'redirect_uri',
      !client_id && 'client_id',
    ].filter(Boolean).join(', ');
    console.error('[deriv-token] Missing params:', missing);
    return res.status(400).json({ error: `Missing required parameters: ${missing}` });
  }

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id,
    code,
    code_verifier,
    redirect_uri,
  });

  console.log('[deriv-token] Calling Deriv token endpoint...');

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    const responseText = await response.text();
    console.log('[deriv-token] Deriv response:', response.status, responseText);

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Token exchange failed',
        status: response.status,
        detail: responseText,
      });
    }

    let data: unknown;
    try {
      data = JSON.parse(responseText);
    } catch {
      return res.status(500).json({ error: 'Invalid JSON from Deriv', detail: responseText });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('[deriv-token] Fetch error:', err);
    return res.status(500).json({
      error: 'Failed to reach Deriv token endpoint',
      detail: String(err),
    });
  }
}
