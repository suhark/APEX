import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

type ScannerRow = {
  symbol: string;
  market_family: string;
  contract_type: 'CALL' | 'PUT';
  duration: number;
  duration_unit: 't';
  score: number;
  estimated_probability: number;
  confidence_lower: number;
  break_even_probability: number;
  edge: number;
  status: 'QUALIFIED' | 'WATCH' | 'NO SIGNAL';
  sample_size: number;
  breakdown: { technical: number; statistical: number; validation: number; economics: number; data: number };
};

const CONFIGS = [5, 10, 15];
const SYMBOL = 'Volatility 75 Index';
const DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=34mV1HDCcx9gNO0aCEQMg';
const DERIV_SYMBOL = 'R_75';

function buildSnapshot(): ScannerRow[] {
  return CONFIGS.map((duration, index) => {
    const probability = [0.62, 0.56, 0.51][index];
    const breakEven = 0.55;
    const edge = probability - breakEven;
    return {
      symbol: SYMBOL,
      market_family: 'Volatility',
      contract_type: index === 2 ? 'PUT' : 'CALL',
      duration,
      duration_unit: 't',
      score: [78, 54, 29][index],
      estimated_probability: probability,
      confidence_lower: [0.58, 0.53, 0.49][index],
      break_even_probability: breakEven,
      edge,
      status: edge >= 0.05 ? 'QUALIFIED' : edge > 0 ? 'WATCH' : 'NO SIGNAL',
      sample_size: 1840,
      breakdown: { technical: 16, statistical: 19, validation: 18, economics: 16, data: 9 },
    };
  });
}

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function fetchLiveTicks(count = 120): Promise<{ quote: number; epoch: number }[]> {
  const WebSocketCtor = globalThis.WebSocket;
  if (!WebSocketCtor) throw new Error('WebSocket is unavailable in this runtime');
  return new Promise((resolve, reject) => {
    const socket = new WebSocketCtor(DERIV_WS_URL);
    const ticks: { quote: number; epoch: number }[] = [];
    const timeout = setTimeout(() => { socket.close(); reject(new Error('Deriv tick request timed out')); }, 8000);
    socket.onopen = () => socket.send(JSON.stringify({ ticks_history: DERIV_SYMBOL, count, end: 'latest', style: 'ticks' }));
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload.error) { clearTimeout(timeout); socket.close(); reject(new Error(payload.error.message)); return; }
        if (payload.history?.prices) {
          const times = payload.history.times ?? [];
          ticks.push(...payload.history.prices.map((quote: number, index: number) => ({ quote: Number(quote), epoch: Number(times[index]) })));
          clearTimeout(timeout); socket.close(); resolve(ticks);
        }
      } catch (error) { clearTimeout(timeout); socket.close(); reject(error); }
    };
    socket.onerror = () => { clearTimeout(timeout); socket.close(); reject(new Error('Unable to connect to Deriv')); };
  });
}

function buildLiveSnapshot(ticks: { quote: number; epoch: number }[]): ScannerRow[] {
  const latest = ticks.at(-1)?.quote ?? 0;
  const previous = ticks.at(-2)?.quote ?? latest;
  const direction = latest >= previous ? 'CALL' : 'PUT';
  const movement = previous ? Math.abs(latest - previous) / previous : 0;
  const dataQuality = Math.min(10, Math.round((ticks.length / 120) * 10));
  return CONFIGS.map((duration, index) => {
    const probability = Math.min(0.7, Math.max(0.3, 0.5 + movement * 8 + (index === 0 ? 0.02 : 0)));
    const breakEven = 0.55;
    const edge = probability - breakEven;
    return { symbol: SYMBOL, market_family: 'Volatility', contract_type: direction, duration, duration_unit: 't', score: Math.round(dataQuality * 5 + Math.min(40, movement * 10000)), estimated_probability: probability, confidence_lower: Math.max(0.3, probability - 0.04), break_even_probability: breakEven, edge, status: ticks.length < 100 ? 'NO SIGNAL' : edge >= 0.05 ? 'QUALIFIED' : edge > 0 ? 'WATCH' : 'NO SIGNAL', sample_size: ticks.length, breakdown: { technical: Math.round(movement * 10000), statistical: 0, validation: 0, economics: Math.round(edge * 100), data: dataQuality } };
  });
}

async function loadPersistedRows(): Promise<ScannerRow[] | null> {
  if (!supabaseUrl || !supabaseServiceKey) return null;
  const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('market_opportunities')
    .select('symbol,market_family,contract_type,duration,duration_unit,score,estimated_probability,confidence_lower,break_even_probability,edge,status,sample_size,breakdown')
    .eq('symbol', SYMBOL)
    .gt('expires_at', new Date().toISOString())
    .order('score', { ascending: false });
  if (error || !data?.length) return null;
  return data as ScannerRow[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const rows = await loadPersistedRows();
    if (rows) return res.status(200).json({ version: 'v1-supabase', generated_at: new Date().toISOString(), scope: { symbols: [SYMBOL], contract_types: ['CALL', 'PUT'], durations: CONFIGS }, rows });
    const ticks = await fetchLiveTicks();
    return res.status(200).json({
      version: 'v1-live-deriv',
      generated_at: new Date().toISOString(),
      scope: { symbols: [SYMBOL], contract_types: ['CALL', 'PUT'], durations: CONFIGS },
      rows: buildLiveSnapshot(ticks),
    });

  } catch (error) {
    console.error('[scanner-snapshot] live/persistence read failed:', error);
    return res.status(200).json({
      version: 'v1-research-fixture',
      generated_at: new Date().toISOString(),
      warning: 'Live Deriv and persisted opportunity data were unavailable; showing fallback fixture data.',
      scope: { symbols: [SYMBOL], contract_types: ['CALL', 'PUT'], durations: CONFIGS },
      rows: buildSnapshot(),
      warning: 'Persisted opportunities unavailable; showing conservative fixture data.',
    });
  }
}
