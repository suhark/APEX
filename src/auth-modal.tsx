import React, { useEffect, useRef, useState } from 'react';
import { type SupabaseClient, type User } from '@supabase/supabase-js';
import {
  AlertCircle, ArrowLeft, ArrowRight, CheckCircle2,
  Eye, EyeOff, KeyRound, Lock, Loader2, Mail, X,
} from 'lucide-react';
import { sendOtp, verifyOtp } from './otp-auth';

interface AuthModalProps {
  supabase: SupabaseClient;
  onAuthSuccess: (user: User) => void;
  onClose?: () => void;
}

type Mode = 'signin' | 'signup' | 'reset' | 'otp';

const OTP_RESEND_COOLDOWN = 60;
const OTP_LENGTH = 6;

// ── Individual-digit OTP input component ──────────────────────────────────────
function OtpBoxes({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const focus = (idx: number) => {
    refs.current[Math.max(0, Math.min(OTP_LENGTH - 1, idx))]?.focus();
  };

  const handleKey = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (value[idx]) {
        // clear current
        const next = value.split('');
        next[idx] = '';
        onChange(next.join(''));
      } else if (idx > 0) {
        // move back and clear previous
        const next = value.split('');
        next[idx - 1] = '';
        onChange(next.join(''));
        focus(idx - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault(); focus(idx - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault(); focus(idx + 1);
    }
  };

  const handleChange = (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) return;
    // handle paste — fill all boxes from idx
    const digits = raw.slice(0, OTP_LENGTH - idx);
    const next = value.padEnd(OTP_LENGTH, '').split('');
    for (let i = 0; i < digits.length; i++) next[idx + i] = digits[i];
    const joined = next.join('').slice(0, OTP_LENGTH);
    onChange(joined);
    // move focus to the next empty box or last filled
    const nextFocus = Math.min(idx + digits.length, OTP_LENGTH - 1);
    focus(nextFocus);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    onChange(pasted.padEnd(OTP_LENGTH, '').slice(0, OTP_LENGTH));
    focus(Math.min(pasted.length, OTP_LENGTH - 1));
  };

  return (
    <div className="otp-boxes" onPaste={handlePaste}>
      {Array.from({ length: OTP_LENGTH }).map((_, idx) => (
        <input
          key={idx}
          ref={el => { refs.current[idx] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[idx] ?? ''}
          className={`otp-box${value[idx] ? ' filled' : ''}`}
          disabled={disabled}
          autoComplete="one-time-code"
          onChange={e => handleChange(idx, e)}
          onKeyDown={e => handleKey(idx, e)}
          onFocus={e => e.target.select()}
          aria-label={`Digit ${idx + 1}`}
        />
      ))}
    </div>
  );
}

export function AuthModal({ supabase, onAuthSuccess, onClose }: AuthModalProps) {
  const [mode, setMode]               = useState<Mode>('signin');
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [otpCode, setOtpCode]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  // Pending signup user — kept so we can sign them in after OTP verify
  const pendingUserRef = useRef<User | null>(null);
  const pendingPasswordRef = useRef<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef<number | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setSuccessNotice(null);
    setOtpCode('');
  };

  // Countdown timer for resend button
  useEffect(() => {
    if (resendCooldown <= 0) return;
    cooldownRef.current = window.setInterval(() => {
      setResendCooldown(n => {
        if (n <= 1) { window.clearInterval(cooldownRef.current!); return 0; }
        return n - 1;
      });
    }, 1000);
    return () => { if (cooldownRef.current) window.clearInterval(cooldownRef.current); };
  }, [resendCooldown]);

  // Auto-focus first OTP box when mode switches to otp
  useEffect(() => {
    if (mode === 'otp') {
      setTimeout(() => {
        const first = document.querySelector<HTMLInputElement>('.otp-box');
        first?.focus();
      }, 100);
    }
  }, [mode]);

  // ── Send OTP helper (used on signup + resend) ────────────────────────────
  const requestOtp = async (targetEmail: string) => {
    const result = await sendOtp(targetEmail, 'verify_email');
    if (!result.ok) {
      setError(result.error ?? 'Could not send verification code. Try again.');
      return false;
    }
    setResendCooldown(OTP_RESEND_COOLDOWN);
    return true;
  };

  // ── Forgot password ──────────────────────────────────────────────────────
  const handleReset = async (cleanEmail: string) => {
    setLoading(true);
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}`,
      });
      if (resetErr) throw resetErr;
      setSuccessNotice('Password reset email sent. Check your inbox and follow the link.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Reset request failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Sign in ──────────────────────────────────────────────────────────────
  const handleSignIn = async (cleanEmail: string) => {
    setLoading(true);
    try {
      const { data, error: signInErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password,
      });
      if (signInErr) throw signInErr;
      if (data.user) onAuthSuccess(data.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  // ── Sign up → send OTP FIRST, create account after verification ─────────
  const handleSignUp = async (cleanEmail: string) => {
    setLoading(true);
    try {
      // Don't call supabase.auth.signUp() yet — that sends a Supabase email.
      // Just send our OTP. We create the account AFTER the code is verified.
      const sent = await requestOtp(cleanEmail);
      if (!sent) return; // error already set in requestOtp

      // Store password for use after OTP verify
      pendingPasswordRef.current = password;

      setSuccessNotice(`We sent a 6-digit code to ${cleanEmail}. Enter it below to activate your account.`);
      switchMode('otp');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not send verification code. Try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Verify OTP → then sign in Supabase account ──────────────────────────
  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6) {
      setError('Enter the full 6-digit code.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const pwd = pendingPasswordRef.current ?? password;

      // 1. Verify the OTP code and provision the confirmed user on the server
      const result = await verifyOtp(cleanEmail, otpCode, 'verify_email', pwd);
      if (!result.ok) {
        setError(result.error ?? 'Incorrect code. Please try again.');
        return;
      }

      // 2. Account is confirmed — sign in directly with password
      const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: pwd,
      });

      if (signInErr) {
        // Fallback: If signInWithPassword fails, try signUp as fallback
        const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
          email: cleanEmail,
          password: pwd,
        });
        if (signUpErr) throw signInErr;
        if (signUpData.session && signUpData.user) {
          onAuthSuccess(signUpData.user);
          return;
        }
        throw signInErr;
      }

      if (signInData.user) {
        onAuthSuccess(signInData.user);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Account activation failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Master submit handler ────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);
    const cleanEmail = email.trim().toLowerCase();

    if (mode === 'otp') { await handleVerifyOtp(); return; }
    if (mode === 'reset') { if (!cleanEmail) { setError('Enter your email.'); return; } await handleReset(cleanEmail); return; }
    if (!cleanEmail || !password) { setError('Please enter both email and password.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (mode === 'signin') { await handleSignIn(cleanEmail); return; }
    await handleSignUp(cleanEmail);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-card" onClick={(e) => e.stopPropagation()}>
        {onClose && (
          <button type="button" className="auth-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        )}

        <div className="auth-brand">
          <img src="/apex-logo.png" alt="APEX Trading Lab" className="auth-modal-logo" />
          <span className="auth-brand-subtitle">Algorithmic Execution Terminal</span>
        </div>

        {/* ── Mode header ── */}
        {mode === 'otp' ? (
          <div className="auth-otp-header">
            <button type="button" className="auth-back-btn" onClick={() => switchMode('signup')}>
              <ArrowLeft size={15} />
            </button>
            <div>
              <strong>Verify your email</strong>
              <p>Enter the 6-digit code sent to <b>{email}</b></p>
            </div>
          </div>
        ) : mode === 'reset' ? (
          <div className="auth-otp-header">
            <button type="button" className="auth-back-btn" onClick={() => switchMode('signin')}>
              <ArrowLeft size={15} />
            </button>
            <div>
              <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <KeyRound size={14} /> Reset password
              </strong>
              <p>Enter your email and we'll send a reset link.</p>
            </div>
          </div>
        ) : (
          <div className="auth-tabs">
            <button type="button" className={mode === 'signin' ? 'auth-tab active' : 'auth-tab'} onClick={() => switchMode('signin')}>Sign In</button>
            <button type="button" className={mode === 'signup' ? 'auth-tab active' : 'auth-tab'} onClick={() => switchMode('signup')}>Create Account</button>
          </div>
        )}

        {/* ── Alerts ── */}
        {error && (
          <div className="auth-alert error"><AlertCircle size={15} /><span>{error}</span></div>
        )}
        {successNotice && !error && (
          <div className="auth-alert success"><CheckCircle2 size={15} /><span>{successNotice}</span></div>
        )}

        {/* ── Form ── */}
        <form onSubmit={handleSubmit} className="auth-form" autoComplete="on">

          {/* OTP mode — just the code input */}
          {mode === 'otp' ? (
            <div className="auth-otp-field">
              <OtpBoxes
                value={otpCode}
                onChange={(v) => { setOtpCode(v); setError(null); }}
                disabled={loading}
              />
              <p className="auth-otp-hint">
                Code expires in 10 minutes.{' '}
                {resendCooldown > 0 ? (
                  <span>Resend in {resendCooldown}s</span>
                ) : (
                  <button type="button" className="auth-link-btn secondary-action"
                    onClick={async () => {
                      setError(null);
                      const sent = await requestOtp(email.trim().toLowerCase());
                      if (sent) setSuccessNotice('New code sent — check your inbox.');
                    }}>
                    Resend code
                  </button>
                )}
              </p>
            </div>
          ) : (
            <>
              {/* Email */}
              <label className="auth-label">
                Email Address
                <div className="auth-input-wrap">
                  <Mail size={16} className="auth-input-icon" />
                  <input type="email" placeholder="name@example.com" value={email}
                    onChange={e => setEmail(e.target.value)}
                    autoComplete="email" required disabled={loading} />
                </div>
              </label>

              {/* Password — hidden on reset */}
              {mode !== 'reset' && (
                <label className="auth-label">
                  Password
                  <div className="auth-input-wrap">
                    <Lock size={16} className="auth-input-icon" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder={mode === 'signup' ? 'Create a secure password (6+ chars)' : 'Enter your password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      required disabled={loading} />
                    <button type="button" className="auth-eye-btn" tabIndex={-1}
                      onClick={() => setShowPassword(v => !v)}>
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>
              )}
            </>
          )}

          <button type="submit" className="auth-submit-btn" disabled={loading || (mode === 'otp' && otpCode.length !== 6)}>
            {loading ? (
              <><Loader2 size={16} className="spin" />
                {mode === 'reset' ? 'Sending…' : mode === 'otp' ? 'Verifying…' : mode === 'signin' ? 'Signing in…' : 'Creating account…'}
              </>
            ) : (
              <><span>
                {mode === 'reset' ? 'Send Reset Link' : mode === 'otp' ? 'Verify & Activate' : mode === 'signin' ? 'Sign In to Workspace' : 'Create Free Account'}
              </span><ArrowRight size={16} /></>
            )}
          </button>
        </form>

        {/* ── Footer links ── */}
        <div className="auth-footer">
          {mode === 'otp' ? (
            <p>Wrong email? <button type="button" className="auth-link-btn secondary-action" onClick={() => switchMode('signup')}>Go back</button></p>
          ) : mode === 'reset' ? (
            <p>Remembered it? <button type="button" className="auth-link-btn secondary-action" onClick={() => switchMode('signin')}>Back to sign in</button></p>
          ) : mode === 'signin' ? (
            <p>
              <button type="button" className="auth-link-btn secondary-action" onClick={() => switchMode('reset')}>Forgot password?</button>
              {' · '}
              No account? <button type="button" className="auth-link-btn primary-action" onClick={() => switchMode('signup')}>Create one</button>
            </p>
          ) : (
            <p>Already have an account? <button type="button" className="auth-link-btn secondary-action" onClick={() => switchMode('signin')}>Sign in</button></p>
          )}
        </div>
      </div>
    </div>
  );
}
