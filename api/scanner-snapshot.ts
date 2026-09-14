import type { VercelRequest, VercelResponse } from '@vercel/node';

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

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    version: 'v1-research-fixture',
    generated_at: new Date().toISOString(),
    scope: { symbols: [SYMBOL], contract_types: ['CALL', 'PUT'], durations: CONFIGS },
    rows: buildSnapshot(),
  });
}
