import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SYMBOL = 'Volatility 75 Index';
const DERIV_SYMBOL = 'R_75';
const DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=34mV1HDCcx9gNO0aCEQMg';
const durations = [5, 10, 15];
type Tick = { quote: number; epoch: number };

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let result = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of values.slice(period)) result = (value - result) * multiplier + result;
  return result;
}

function buildRows(ticks: Tick[]) {
  const quotes = ticks.map((tick) => tick.quote);
  const latest = quotes.at(-1) ?? 0;
  const previous = quotes.at(-2) ?? latest;
  const fast = ema(quotes, 9);
  const slow = ema(quotes, 20);
  const direction = fast !== null && slow !== null && fast < slow ? 'PUT' : 'CALL';
  const movement = previous ? Math.abs(latest - previous) / previous : 0;
  const quality = ticks.length >= 100 ? 10 : Math.round((ticks.length / 100) * 10);
  return durations.map((duration, index) => {
    const probability = Math.min(0.7, Math.max(0.3, 0.5 + (fast !== null && slow !== null && fast !== slow ? 0.025 : 0) + Math.min(0.04, movement * 6) - index * 0.01));
    const breakEven = 0.55;
    const edge = probability - breakEven;
    return { symbol: SYMBOL, market_family: 'Volatility', contract_type: direction, direction, duration, duration_unit: 't', score: Math.min(100, Math.round(quality * 6 + (fast !== null && slow !== null ? 20 : 0) + Math.min(20, movement * 5000))), estimated_probability: probability, confidence_lower: Math.max(0.3, probability - (ticks.length >= 100 ? 0.04 : 0.12)), break_even_probability: breakEven, edge, status: ticks.length < 100 ? 'NO SIGNAL' : edge >= 0.05 ? 'QUALIFIED' : edge > 0 ? 'WATCH' : 'NO SIGNAL', sample_size: ticks.length, breakdown: { technical: fast !== null && slow !== null ? 18 : 0, statistical: 0, validation: 0, economics: Math.round(edge * 100), data: quality }, model_version: 'v1-ema9-20', validation_version: 'unvalidated', expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString() };
  });
}

async function fetchTicks(): Promise<Tick[]> {
  const WebSocketCtor = globalThis.WebSocket;
  if (!WebSocketCtor) throw new Error('WebSocket is unavailable in this runtime');
  return new Promise((resolve, reject) => {
    const socket = new WebSocketCtor(DERIV_WS_URL);
    const timeout = setTimeout(() => { socket.close(); reject(new Error('Deriv request timed out')); }, 8000);
    socket.onopen = () => socket.send(JSON.stringify({ ticks_history: DERIV_SYMBOL, count: 120, end: 'latest', style: 'ticks' }));
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.error) throw new Error(payload.error.message);
        if (!payload.history?.prices) return;
        clearTimeout(timeout); socket.close();
        const times = payload.history.times ?? [];
        resolve(payload.history.prices.map((quote: number, index: number) => ({ quote: Number(quote), epoch: Number(times[index]) })));
      } catch (error) { clearTimeout(timeout); socket.close(); reject(error); }
    };
    socket.onerror = () => { clearTimeout(timeout); socket.close(); reject(new Error('Unable to connect to Deriv WebSocket from Vercel. Live collection requires a persistent worker or external scheduler.')); };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const trace = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  res.setHeader('X-Scanner-Trace', trace);
  if (req.method !== 'POST') return res.status(405).json({ ok: false, trace, error: 'Method not allowed' });
  const configuredKey = process.env.SCANNER_INGEST_KEY;
  const suppliedKey = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? req.headers['x-scanner-key'];
  if (!configuredKey || suppliedKey !== configuredKey) return res.status(401).json({ ok: false, trace, error: 'Unauthorized scanner run. Send Authorization: Bearer <SCANNER_INGEST_KEY>.' });

  try {
    const rows = buildRows(await fetchTicks());
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!url || !serviceKey) return res.status(500).json({ ok: false, trace, error: 'Supabase server credentials are not configured.' });
    const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await supabase.from('market_opportunities').upsert(rows, { onConflict: 'symbol,contract_type,duration,duration_unit,model_version' }).select('id,symbol,contract_type,duration,status,score,expires_at');
    if (error) return res.status(502).json({ ok: false, trace, error: 'Could not persist scanner run.', detail: error.message, code: error.code, hint: error.hint });
    return res.status(200).json({ ok: true, trace, version: 'v1-live-persisted', sample_size: rows[0]?.sample_size ?? 0, rows: data ?? [] });
  } catch (error) { return res.status(502).json({ ok: false, trace, error: error instanceof Error ? error.message : 'Scanner run failed.' }); }
}
