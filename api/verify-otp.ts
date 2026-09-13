/**
 * POST /api/verify-otp
 *
 * Checks the submitted OTP against the hashed value in Supabase.
 * Returns { ok: true } on success, error otherwise.
 * Limits failed attempts to 5 per code before permanently invalidating it.
 *
 * Body: { email: string; code: string; purpose?: 'login' | 'verify_email' }
 * Response 200: { ok: true; message: string }
 * Response 4xx: { ok: false; error: string }
 *
 * DORMANT — not wired to login flow yet.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const ALLOWED_ORIGINS = [
  'https://apextradinglab.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
];

const MAX_ATTEMPTS = 5;

function setCors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin ?? '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (setCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { email, code, purpose = 'login' } = req.body as {
    email?: string; code?: string; purpose?: string;
  };

  if (!email || !code) {
    return res.status(400).json({ ok: false, error: 'Email and code are required.' });
  }

  const normalised = email.trim().toLowerCase();
  const submitted  = code.trim().replace(/\s/g, '');

  if (!/^\d{6}$/.test(submitted)) {
    return res.status(400).json({ ok: false, error: 'Code must be 6 digits.' });
  }

  // ── Init Supabase with service role ───────────────────────────────────────
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, error: 'Server misconfiguration.' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // ── Find the most recent valid code for this email+purpose ────────────────
  const { data: rows, error: fetchErr } = await supabase
    .from('otp_codes')
    .select('id, code, expires_at, attempts, used')
    .eq('email', normalised)
    .eq('purpose', purpose)
    .eq('used', false)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1);

  if (fetchErr) {
    console.error('[verify-otp] DB error:', fetchErr.message);
    return res.status(500).json({ ok: false, error: 'Database error.' });
  }

  if (!rows || rows.length === 0) {
    return res.status(400).json({ ok: false, error: 'No valid code found. Request a new one.' });
  }

  const record = rows[0];

  // Check attempt limit
  if (record.attempts >= MAX_ATTEMPTS) {
    await supabase.from('otp_codes').update({ used: true }).eq('id', record.id);
    return res.status(429).json({ ok: false, error: 'Too many failed attempts. Request a new code.' });
  }

  // Constant-time comparison to prevent timing attacks
  const expected = record.code;
  const actual   = hashOtp(submitted);

  if (actual !== expected) {
    // Increment failed attempts
    await supabase
      .from('otp_codes')
      .update({ attempts: record.attempts + 1 })
      .eq('id', record.id);

    const remaining = MAX_ATTEMPTS - record.attempts - 1;
    return res.status(400).json({
      ok: false,
      error: `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
    });
  }

  // ── Success — mark as used ────────────────────────────────────────────────
  await supabase.from('otp_codes').update({ used: true }).eq('id', record.id);

  // Clean up old expired codes for this email
  await supabase
    .from('otp_codes')
    .delete()
    .eq('email', normalised)
    .lt('expires_at', new Date().toISOString());

  return res.status(200).json({ ok: true, message: 'Code verified successfully.' });
}
