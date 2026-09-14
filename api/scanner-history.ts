import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  // Placeholder until compact signal outcomes are persisted in Supabase.
  return res.status(200).json({
    version: 'v1-research-fixture',
    rows: [],
    message: 'No validated signal history is available yet. The scanner will remain conservative until outcomes are persisted.',
  });
}
