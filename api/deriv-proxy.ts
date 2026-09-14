import type { VercelRequest, VercelResponse } from '@vercel/node';

const DERIV_URL = 'https://api.derivws.com';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const symbol = String(req.query.symbol ?? 'R_75');
  const count = Math.min(500, Math.max(20, Number(req.query.count ?? 120)));
  if (!/^[A-Z0-9_]+$/.test(symbol)) return res.status(400).json({ error: 'Invalid symbol.' });

  try {
    const response = await fetch(`${DERIV_URL}/trading/v1/market-data/history?symbol=${encodeURIComponent(symbol)}&count=${count}`, { signal: AbortSignal.timeout(7000) });
    const body = await response.text();
    res.setHeader('Cache-Control', 'no-store');
    if (!response.ok) return res.status(502).json({ error: 'Deriv market-data request failed.', status: response.status, detail: body.slice(0, 500) });
    return res.status(200).json(JSON.parse(body));
  } catch (error) {
    return res.status(502).json({ error: 'Unable to retrieve Deriv market data.', detail: error instanceof Error ? error.message : String(error) });
  }
}
