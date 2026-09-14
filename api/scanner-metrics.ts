import type { VercelRequest, VercelResponse } from '@vercel/node';

type Tick = { quote: number; epoch: number };

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const multiplier = 2 / (period + 1);
  let result = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of values.slice(period)) result = (value - result) * multiplier + result;
  return result;
}

function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gains = 0; let losses = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gains += change; else losses -= change;
  }
  if (losses === 0) return 100;
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
  }
  return 100 - (100 / (1 + averageGain / Math.max(averageLoss, Number.EPSILON)));
}

function buildMetrics(ticks: Tick[]) {
  const quotes = ticks.map((tick) => tick.quote);
  const last = quotes.length ? quotes[quotes.length - 1] : null;
  const ema9 = ema(quotes, 9);
  const ema20 = ema(quotes, 20);
  const rsi14 = rsi(quotes);
  const direction = ema9 !== null && ema20 !== null ? (ema9 >= ema20 ? 'CALL' : 'PUT') : 'NO SIGNAL';
  const gapSeconds = ticks.length > 1 ? Math.max(...ticks.slice(1).map((tick, index) => tick.epoch - ticks[index].epoch)) : 0;
  return { symbol: 'Volatility 75 Index', sample_size: ticks.length, last_quote: last, ema_9: ema9, ema_20: ema20, rsi_14: rsi14, direction, data_gap_seconds: gapSeconds, data_quality: ticks.length >= 100 && gapSeconds <= 10 ? 'READY' : 'INSUFFICIENT' };
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  const ticks = Array.isArray(req.body?.ticks) ? req.body.ticks.filter((tick: Tick) => Number.isFinite(tick.quote) && Number.isFinite(tick.epoch)) : [];
  if (!ticks.length) return res.status(400).json({ error: 'Provide a non-empty ticks array.' });
  return res.status(200).json({ version: 'v1-deterministic-metrics', metrics: buildMetrics(ticks) });
}
