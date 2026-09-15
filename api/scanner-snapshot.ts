import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type ScannerRow = { symbol: string; market_family: string; contract_type: 'CALL' | 'PUT'; duration: number; duration_unit: 't'; score: number; estimated_probability: number; confidence_lower: number; break_even_probability: number; edge: number; status: 'QUALIFIED' | 'WATCH' | 'NO SIGNAL'; sample_size: number; breakdown: { technical: number; statistical: number; validation: number; economics: number; data: number } };
const CONFIGS = [5, 10, 15]; const SYMBOL = 'Volatility 75 Index';
function fixture(): ScannerRow[] { return CONFIGS.map((duration, index) => { const probability = [0.62, 0.56, 0.51][index]; const edge = probability - 0.55; return { symbol: SYMBOL, market_family: 'Volatility', contract_type: index === 2 ? 'PUT' : 'CALL', duration, duration_unit: 't', score: [78, 54, 29][index], estimated_probability: probability, confidence_lower: [0.58, 0.53, 0.49][index], break_even_probability: 0.55, edge, status: edge >= 0.05 ? 'QUALIFIED' : edge > 0 ? 'WATCH' : 'NO SIGNAL', sample_size: 1840, breakdown: { technical: 16, statistical: 19, validation: 18, economics: 16, data: 9 } }; }); }
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  res.setHeader('Cache-Control', 'no-store');
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''; const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) return res.status(200).json({ version: 'v1-research-fixture', generated_at: new Date().toISOString(), warning: 'Supabase server credentials are not configured.', rows: fixture() });
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await supabase.from('market_opportunities').select('symbol,market_family,contract_type,duration,duration_unit,score,estimated_probability,confidence_lower,break_even_probability,edge,status,sample_size,breakdown').eq('symbol', SYMBOL).gt('expires_at', new Date().toISOString()).order('score', { ascending: false });
    if (error) throw error;
    return res.status(200).json({ version: data?.length ? 'v1-supabase' : 'v1-research-fixture', generated_at: new Date().toISOString(), warning: data?.length ? undefined : 'No active persisted opportunities yet.', rows: data?.length ? data : fixture() });
  } catch (error) { console.error('[scanner-snapshot]', error); return res.status(200).json({ version: 'v1-research-fixture', generated_at: new Date().toISOString(), warning: 'Persisted opportunities unavailable; live browser data is required for dynamic analysis.', rows: fixture() }); }
}
