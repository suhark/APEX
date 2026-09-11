/**
 * Vercel serverless function — Deriv OAuth token exchange
 *
 * The browser cannot POST to auth.deriv.com/oauth2/token directly due to CORS.
 * This edge function acts as a same-origin proxy so the exchange happens server-side.
 *
 * POST /api/deriv-token
 * Body: { code, code_verifier, redirect_uri, client_id }
 * Returns: { access_token, expires_in, token_type }
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';

const TOKEN_ENDPOINT = 'https://auth.deriv.com/oauth2/token';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Allow requests from our own domain + localhost dev
  const origin = req.headers.origin ?? '';
  const allowed = [
    'https://apextradinglab.app',
    'http://localhost:5173',
    'http://localhost:4173',
  ];
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { code, code_verifier, redirect_uri, client_id } = req.body ?? {};

  if (!code || !code_verifier || !redirect_uri || !client_id) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id,
    code,
    code_verifier,
    redirect_uri,
  });

  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Token exchange failed', detail: String(err) });
  }
}
