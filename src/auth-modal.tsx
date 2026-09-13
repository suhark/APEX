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

// How long in seconds the user must wait before requesting a new code
const OTP_RESEND_COOLDOWN = 60;

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
  // Resend cooldown
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef<number | null>(null);
  // OTP input refs for auto-focus
  const otpRef = useRef<HTMLInputElement>(null);

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

  // Auto-focus OTP input when mode switches to otp
  useEffect(() => {
    if (mode === 'otp') {
      setTimeout(() => otpRef.current?.focus(), 100);
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

  // ── Sign up → send OTP ───────────────────────────────────────────────────
  const handleSignUp = async (cleanEmail: string) => {
    setLoading(true);
    try {
      // Create the Supabase account. Email confirmation is disabled in the
      // Supabase dashboard (Authentication → Settings → "Enable email confirmations"
      // turned OFF) so the account is immediately active but unverified.
      const { data, error: signUpErr } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { emailRedirectTo: undefined }, // suppress Supabase's own email
      });

      if (signUpErr) throw signUpErr;

      // Store the created user for after OTP verification
      pendingUserRef.current = data.user ?? null;

      // Send our own OTP via Resend
      const sent = await requestOtp(cleanEmail);
      if (!sent) return; // error already set in requestOtp

      setSuccessNotice(`We sent a 6-digit code to ${cleanEmail}. Enter it below to activate your account.`);
      switchMode('otp');
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Registration failed';
      const isRateLimit = /rate.?limit|too.?many|over_email_send_rate/i.test(raw);
      setError(isRateLimit
        ? 'Account creation is temporarily limited. Please try again in a few minutes.'
        : raw);
    } finally {
      setLoading(false);
    }
  };

  // ── Verify OTP ───────────────────────────────────────────────────────────
  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6) {
      setError('Enter the full 6-digit code.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await verifyOtp(email.trim().toLowerCase(), otpCode, 'verify_email');
      if (!result.ok) {
        setError(result.error ?? 'Incorrect code. Please try again.');
        return;
      }
      // OTP verified — the Supabase session should already exist from signUp
      // If we have the pending user object, use it directly
      if (pendingUserRef.current) {
        onAuthSuccess(pendingUserRef.current);
        return;
      }
      // Fallback: try to get the current session
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData.session?.user) {
        onAuthSuccess(sessionData.session.user);
        return;
      }
      // Session expired — ask user to sign in
      setSuccessNotice('Email verified! Sign in with your password to continue.');
      switchMode('signin');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Verification failed');
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

  // ── OTP digit auto-format ────────────────────────────────────────────────
  const handleOtpChange = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 6);
    setOtpCode(digits);
    setError(null);
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
              <input
                ref={otpRef}
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="000000"
                value={otpCode}
                onChange={e => handleOtpChange(e.target.value)}
                className="auth-otp-input"
                disabled={loading}
                autoComplete="one-time-code"
              />
              <p className="auth-otp-hint">
                Code expires in 10 minutes.{' '}
                {resendCooldown > 0 ? (
                  <span>Resend in {resendCooldown}s</span>
                ) : (
                  <button type="button" className="auth-link-btn"
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
            <p>Wrong email? <button type="button" className="auth-link-btn" onClick={() => switchMode('signup')}>Go back</button></p>
          ) : mode === 'reset' ? (
            <p>Remembered it? <button type="button" className="auth-link-btn" onClick={() => switchMode('signin')}>Back to sign in</button></p>
          ) : mode === 'signin' ? (
            <p>
              <button type="button" className="auth-link-btn" onClick={() => switchMode('reset')}>Forgot password?</button>
              {' · '}
              No account? <button type="button" className="auth-link-btn" onClick={() => switchMode('signup')}>Create one</button>
            </p>
          ) : (
            <p>Already have an account? <button type="button" className="auth-link-btn" onClick={() => switchMode('signin')}>Sign in</button></p>
          )}
        </div>
      </div>
    </div>
  );
}
