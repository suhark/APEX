import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const SYMBOL = 'Volatility 75 Index';
const SYMBOL_CODE = 'R_75';
const WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=34mV1HDCcx9gNO0aCEQMg';

async function checkDeriv() {
  const WebSocketCtor = globalThis.WebSocket;
  if (!WebSocketCtor) return { ok: false, stage: 'websocket', error: 'WebSocket is unavailable in this runtime.' };
  return new Promise<Record<string, unknown>>((resolve) => {
    const started = Date.now();
    const socket = new WebSocketCtor(WS_URL);
    const timeout = setTimeout(() => { socket.close(); resolve({ ok: false, stage: 'timeout', error: 'Deriv did not respond within 8 seconds.' }); }, 8000);
    socket.onopen = () => socket.send(JSON.stringify({ ticks_history: SYMBOL_CODE, count: 10, end: 'latest', style: 'ticks' }));
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        clearTimeout(timeout); socket.close();
        if (payload.error) resolve({ ok: false, stage: 'deriv-response', error: payload.error.message, deriv_code: payload.error.code, elapsed_ms: Date.now() - started });
        else resolve({ ok: Boolean(payload.history?.prices?.length), stage: 'complete', ticks: payload.history?.prices?.length ?? 0, elapsed_ms: Date.now() - started });
      } catch (error) { clearTimeout(timeout); socket.close(); resolve({ ok: false, stage: 'parse', error: String(error) }); }
    };
    socket.onerror = () => { clearTimeout(timeout); socket.close(); resolve({ ok: false, stage: 'websocket-error', error: 'Deriv WebSocket emitted an error.' }); };
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ error: 'Method not allowed' }); }
  const result: Record<string, unknown> = {
    ok: true,
    checked_at: new Date().toISOString(),
    runtime: 'vercel-serverless',
    env: {
      supabase_url: Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL),
      service_role_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      ingest_key: Boolean(process.env.SCANNER_INGEST_KEY),
    },
  };

  try {
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!url || !key) result.supabase = { ok: false, stage: 'config', error: 'Missing Supabase server credentials.' };
    else {
      const supabase = createClient(url, key, { auth: { persistSession: false } });
      const query = await supabase.from('market_opportunities').select('id,symbol,status,expires_at').eq('symbol', SYMBOL).order('expires_at', { ascending: false }).limit(5);
      result.supabase = query.error ? { ok: false, stage: 'query', error: query.error.message, code: query.error.code, details: query.error.details } : { ok: true, rows_found: query.data?.length ?? 0, rows: query.data ?? [] };
    }
  } catch (error) { result.supabase = { ok: false, stage: 'exception', error: String(error) }; }

  result.deriv = await checkDeriv();
  const supabaseFailed = (result.supabase as { ok?: boolean } | undefined)?.ok === false;
  const derivFailed = (result.deriv as { ok?: boolean } | undefined)?.ok === false;
  result.ok = !supabaseFailed && !derivFailed;
  return res.status(result.ok ? 200 : 502).json(result);
}
