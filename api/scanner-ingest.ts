import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SYMBOL = 'Volatility 75 Index';
const allowedStatuses = new Set(['NO SIGNAL', 'WATCH', 'QUALIFIED', 'POSITIVE EDGE', 'STRONG EDGE']);
const allowedContracts = new Set(['CALL', 'PUT', 'OVER', 'UNDER', 'MATCH', 'DIFF', 'EVEN', 'ODD']);

function isAuthorized(req: VercelRequest): boolean {
  const configured = process.env.SCANNER_INGEST_KEY;
  if (!configured) return false;
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? req.headers['x-scanner-key'];
  return supplied === configured;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Unauthorized scanner ingestion request.' });

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) return res.status(500).json({ error: 'Supabase server credentials are not configured.' });

  const input = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (!input.length || input.length > 25) return res.status(400).json({ error: 'Provide between 1 and 25 opportunity rows.' });

  const rows = input.map((row: Record<string, unknown>) => ({
    symbol: String(row.symbol || SYMBOL),
    market_family: String(row.market_family || 'Volatility'),
    contract_type: String(row.contract_type || 'CALL'),
    direction: row.direction ? String(row.direction) : null,
    barrier: row.barrier ? String(row.barrier) : null,
    duration: Number(row.duration),
    duration_unit: String(row.duration_unit || 't'),
    score: Number(row.score),
    estimated_probability: Number(row.estimated_probability),
    confidence_lower: Number(row.confidence_lower),
    break_even_probability: Number(row.break_even_probability),
    edge: Number(row.edge),
    breakdown: row.breakdown && typeof row.breakdown === 'object' ? row.breakdown : {},
    status: String(row.status || 'NO SIGNAL'),
    sample_size: Number(row.sample_size || 0),
    model_version: String(row.model_version || 'v1'),
    validation_version: String(row.validation_version || 'unvalidated'),
    expires_at: row.expires_at ? String(row.expires_at) : new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  }));

  const invalid = rows.find((row) => !allowedContracts.has(row.contract_type) || !allowedStatuses.has(row.status) || !Number.isFinite(row.duration) || !Number.isFinite(row.score) || row.score < 0 || row.score > 100 || !Number.isFinite(row.estimated_probability) || row.estimated_probability < 0 || row.estimated_probability > 1);
  if (invalid) return res.status(400).json({ error: 'One or more rows contain invalid contract, status, duration, score, or probability values.' });

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.from('market_opportunities').upsert(rows, { onConflict: 'symbol,contract_type,duration,duration_unit,model_version' }).select('id,symbol,contract_type,duration,status,expires_at');
  if (error) { console.error('[scanner-ingest] Supabase error:', error); return res.status(502).json({ error: 'Could not persist scanner opportunities.', detail: error.message }); }
  return res.status(200).json({ ok: true, count: data?.length ?? rows.length, rows: data ?? [] });
}
