/**
 * POST /api/send-otp
 *
 * Generates a 6-digit OTP, hashes it with SHA-256, stores it in Supabase
 * otp_codes table with a 10-minute expiry, then sends the code to the user
 * via Resend from noreply@apextradinglab.app.
 *
 * Body: { email: string; purpose?: 'login' | 'verify_email' }
 * Response 200: { ok: true; message: string }
 * Response 4xx/5xx: { ok: false; error: string }
 *
 * DORMANT — not wired to login flow yet. Enable by calling this from the
 * frontend auth modal when you're ready to require email verification.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { createHash, randomInt } from 'crypto';

// ── CORS helpers ──────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://apextradinglab.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
];

function setCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin ?? '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

// ── Crypto helper ─────────────────────────────────────────────────────────────
function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

// ── Rate limiting (in-memory, per cold start — good enough for low traffic) ───
const recentRequests = new Map<string, number>();

function isRateLimited(email: string): boolean {
  const now = Date.now();
  const last = recentRequests.get(email) ?? 0;
  if (now - last < 60_000) return true; // 1 request per minute per email
  recentRequests.set(email, now);
  return false;
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (setCors(req, res)) return;

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { email, purpose = 'login' } = req.body as { email?: string; purpose?: string };

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'Valid email is required.' });
  }

  const normalised = email.trim().toLowerCase();

  if (isRateLimited(normalised)) {
    return res.status(429).json({ ok: false, error: 'Please wait 60 seconds before requesting another code.' });
  }

  // ── Initialise clients ────────────────────────────────────────────────────
  const supabaseUrl  = process.env.SUPABASE_URL  ?? process.env.VITE_SUPABASE_URL  ?? '';
  const supabaseKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const resendKey    = process.env.RESEND_API_KEY ?? '';

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, error: 'Server misconfiguration: missing Supabase credentials.' });
  }
  if (!resendKey) {
    return res.status(500).json({ ok: false, error: 'Server misconfiguration: missing email service key.' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const resend   = new Resend(resendKey);

  // ── Generate OTP ──────────────────────────────────────────────────────────
  const code    = String(randomInt(100_000, 999_999)); // 6-digit
  const hashed  = hashOtp(code);
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // +10 min

  // Invalidate any previous unused codes for this email+purpose
  await supabase
    .from('otp_codes')
    .update({ used: true })
    .eq('email', normalised)
    .eq('purpose', purpose)
    .eq('used', false);

  // Insert new code
  const { error: insertErr } = await supabase.from('otp_codes').insert({
    email:      normalised,
    code:       hashed,
    purpose,
    expires_at: expires,
  });

  if (insertErr) {
    console.error('[send-otp] DB insert error:', insertErr.message);
    return res.status(500).json({ ok: false, error: 'Could not save verification code.' });
  }

  // ── Send email via Resend ─────────────────────────────────────────────────
  const { error: emailErr } = await resend.emails.send({
    from:    'APEX Trading Lab <noreply@apextradinglab.app>',
    to:      normalised,
    subject: 'Your APEX verification code',
    html: `
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>APEX Verification Code</title></head>
      <body style="margin:0;padding:0;background:#08100f;font-family:'Segoe UI',sans-serif;">
        <div style="max-width:440px;margin:40px auto;background:#0d1a18;border:1px solid #1e3530;border-radius:12px;padding:32px;">
          <img src="https://apextradinglab.app/apex-logo.png" alt="APEX Trading Lab"
               style="height:36px;margin-bottom:24px;display:block;" />
          <h2 style="color:#f4f7f7;font-size:20px;margin:0 0 8px;">Verification code</h2>
          <p style="color:#80948e;font-size:13px;margin:0 0 24px;line-height:1.6;">
            Use the code below to ${purpose === 'login' ? 'sign in to' : 'verify your email for'} APEX Trading Lab.
            It expires in <strong style="color:#f4f7f7;">10 minutes</strong>.
          </p>
          <div style="background:#071110;border:1px solid #2dd4bf40;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
            <span style="font-size:36px;font-weight:800;letter-spacing:0.18em;color:#2dd4bf;font-family:'Courier New',monospace;">
              ${code}
            </span>
          </div>
          <p style="color:#4a6a62;font-size:11px;margin:0;line-height:1.5;">
            If you didn't request this code, you can safely ignore this email.
            Never share this code with anyone.
          </p>
        </div>
      </body>
      </html>
    `,
  });

  if (emailErr) {
    console.error('[send-otp] Resend error:', emailErr.message);
    return res.status(500).json({ ok: false, error: 'Could not send verification email.' });
  }

  return res.status(200).json({
    ok: true,
    message: `Verification code sent to ${normalised}. Check your inbox.`,
  });
}
