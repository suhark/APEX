import type { VercelRequest, VercelResponse } from '@vercel/node';

const DERIV_HTTP_URL = 'https://api.derivws.com';
const SYMBOL = 'R_75';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const count = Math.min(500, Math.max(20, Number(req.query.count ?? 120)));
  try {
    const response = await fetch(`${DERIV_HTTP_URL}/trading/v1/options/accounts`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return res.status(502).json({ error: 'Deriv HTTP endpoint returned an error.', status: response.status });
    return res.status(501).json({ error: 'Deriv HTTP history is not available through this endpoint.', detail: `WebSocket history required for ${SYMBOL} and ${count} ticks.` });
  } catch (error) {
    return res.status(502).json({ error: 'Unable to reach Deriv from Vercel.', detail: error instanceof Error ? error.message : String(error) });
  }
}
