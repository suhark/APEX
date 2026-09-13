/**
 * GET /api/test-email?to=you@example.com
 *
 * Smoke-test endpoint — sends a test email via Resend to confirm the
 * integration is working. Remove or restrict this before production use.
 *
 * DORMANT — safe to leave deployed, just don't publicise the URL.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Resend } from 'resend';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow from localhost during development
  const host = req.headers.host ?? '';
  const isLocal = host.startsWith('localhost') || host.startsWith('127.');

  if (!isLocal && req.method !== 'GET') {
    return res.status(403).json({ ok: false, error: 'Not available in production.' });
  }

  const to = (req.query.to as string) ?? '';
  if (!to || !to.includes('@')) {
    return res.status(400).json({ ok: false, error: 'Provide ?to=your@email.com' });
  }

  const resendKey = process.env.RESEND_API_KEY ?? '';
  if (!resendKey) {
    return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not set in environment.' });
  }

  const resend = new Resend(resendKey);

  const { data, error } = await resend.emails.send({
    from:    'APEX Trading Lab <noreply@apextradinglab.app>',
    to,
    subject: 'APEX email test ✅',
    html: `
      <div style="font-family:sans-serif;background:#08100f;color:#f4f7f7;padding:32px;border-radius:12px;max-width:400px;margin:0 auto;">
        <h2 style="color:#2dd4bf;">It works! 🎉</h2>
        <p>Your Resend + APEX email setup is working correctly.</p>
        <p style="color:#4a6a62;font-size:12px;">Sent from noreply@apextradinglab.app via Resend</p>
      </div>
    `,
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message, detail: error });
  }

  return res.status(200).json({ ok: true, message: `Test email sent to ${to}`, id: data?.id });
}
