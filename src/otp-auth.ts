/**
 * APEX OTP Auth helpers
 *
 * DORMANT — ready to use but not wired into the login flow yet.
 *
 * To activate:
 *   1. Import sendOtp / verifyOtp in auth-modal.tsx
 *   2. After successful sendOtp, show a 6-digit code input
 *   3. Call verifyOtp with the submitted code
 *   4. On ok:true, proceed with normal Supabase session creation
 *
 * The API endpoints (api/send-otp.ts / api/verify-otp.ts) handle all
 * crypto and DB operations server-side. The Resend API key never reaches
 * the browser.
 */

const BASE = '/api';

export interface OtpResult {
  ok: boolean;
  message?: string;
  error?: string;
}

/**
 * Request a 6-digit OTP to be emailed to the given address.
 * Rate-limited to 1 request per minute per email server-side.
 */
export async function sendOtp(
  email: string,
  purpose: 'login' | 'verify_email' = 'login',
): Promise<OtpResult> {
  try {
    const res = await fetch(`${BASE}/send-otp`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, purpose }),
    });
    return (await res.json()) as OtpResult;
  } catch (e) {
    return { ok: false, error: 'Network error — could not reach verification service.' };
  }
}

/**
 * Verify a 6-digit OTP for the given email.
 * Returns ok:true if correct and not expired/used.
 */
export async function verifyOtp(
  email: string,
  code: string,
  purpose: 'login' | 'verify_email' = 'login',
): Promise<OtpResult> {
  try {
    const res = await fetch(`${BASE}/verify-otp`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, code, purpose }),
    });
    return (await res.json()) as OtpResult;
  } catch (e) {
    return { ok: false, error: 'Network error — could not reach verification service.' };
  }
}
