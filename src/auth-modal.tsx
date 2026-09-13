import React, { useState } from 'react';
import { type SupabaseClient, type User } from '@supabase/supabase-js';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Lock, Loader2, Mail, X } from 'lucide-react';

interface AuthModalProps {
  supabase: SupabaseClient;
  onAuthSuccess: (user: User) => void;
  onClose?: () => void;
}

export function AuthModal({ supabase, onAuthSuccess, onClose }: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const switchMode = (next: 'signin' | 'signup' | 'reset') => {
    setMode(next);
    setError(null);
    setSuccessNotice(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);

    const cleanEmail = email.trim();

    // ── Forgot-password flow ─────────────────────────────────────────────
    if (mode === 'reset') {
      if (!cleanEmail) {
        setError('Please enter your email address.');
        return;
      }
      setLoading(true);
      try {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: `${window.location.origin}`,
        });
        if (resetError) throw resetError;
        setSuccessNotice('Password reset email sent. Check your inbox and follow the link to set a new password.');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Reset request failed';
        setError(message);
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Sign-in / sign-up ────────────────────────────────────────────────
    if (!cleanEmail || !password) {
      setError('Please enter both email and password.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signin') {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        });
        if (signInError) throw signInError;
        if (data.user) onAuthSuccess(data.user);
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });
        if (signUpError) throw signUpError;
        if (data.user && data.session) {
          onAuthSuccess(data.user);
        } else if (data.user && !data.session) {
          setSuccessNotice('Account created! Check your email inbox to confirm your address, then sign in.');
          switchMode('signin');
          setPassword('');
        }
      }
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Authentication failed';
      // Supabase free-tier email rate limit — translate to a user-friendly message
      const isRateLimit = /rate.?limit|too.?many|email.?rate|over_email_send_rate/i.test(raw);
      const message = isRateLimit
        ? 'Too many sign-up attempts from this email address. Please wait a few minutes and try again — or sign in if you already have an account.'
        : raw;
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-card" onClick={(e) => e.stopPropagation()}>
        {onClose && (
          <button type="button" className="auth-close-btn" onClick={onClose} aria-label="Back to overview">
            <X size={18} />
          </button>
        )}

        <div className="auth-brand">
          <img src="/apex-logo.png" alt="APEX Trading Lab" className="auth-modal-logo" />
          <span className="auth-brand-subtitle">Algorithmic Execution Terminal</span>
        </div>

        {/* Tabs — hidden on reset screen */}
        {mode !== 'reset' && (
          <div className="auth-tabs">
            <button
              type="button"
              className={mode === 'signin' ? 'auth-tab active' : 'auth-tab'}
              onClick={() => switchMode('signin')}
            >
              Sign In
            </button>
            <button
              type="button"
              className={mode === 'signup' ? 'auth-tab active' : 'auth-tab'}
              onClick={() => switchMode('signup')}
            >
              Create Account
            </button>
          </div>
        )}

        {/* Reset-mode header */}
        {mode === 'reset' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '4px 0 18px' }}>
            <button
              type="button"
              onClick={() => switchMode('signin')}
              style={{ background: 'none', border: 'none', color: '#50b9a9', cursor: 'pointer', padding: 0, display: 'flex' }}
              aria-label="Back to sign in"
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '2px' }}>
                <KeyRound size={15} style={{ color: '#50b9a9' }} />
                <strong style={{ fontSize: '13px', color: '#e0f0ec' }}>Reset password</strong>
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: '#7a908a' }}>
                Enter your email and we'll send a reset link.
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="auth-alert error">
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {successNotice && (
          <div className="auth-alert success">
            <CheckCircle2 size={16} />
            <span>{successNotice}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form" autoComplete="on">
          <label className="auth-label">
            Email Address
            <div className="auth-input-wrap">
              <Mail size={16} className="auth-input-icon" />
              <input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={loading}
              />
            </div>
          </label>

          {mode !== 'reset' && (
            <label className="auth-label">
              Password
              <div className="auth-input-wrap">
                <Lock size={16} className="auth-input-icon" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder={mode === 'signup' ? 'Create a secure password (6+ chars)' : 'Enter your password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  className="auth-eye-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
          )}

          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading ? (
              <>
                <Loader2 size={16} className="spin" />
                {mode === 'reset' ? 'Sending reset link…' : mode === 'signin' ? 'Signing in…' : 'Creating account…'}
              </>
            ) : (
              <>
                <span>
                  {mode === 'reset' ? 'Send Reset Link' : mode === 'signin' ? 'Sign In to Workspace' : 'Create Free Account'}
                </span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          {mode === 'reset' ? (
            <p>
              Remembered it?{' '}
              <button type="button" className="auth-link-btn" onClick={() => switchMode('signin')}>
                Back to sign in
              </button>
            </p>
          ) : mode === 'signin' ? (
            <p>
              <button type="button" className="auth-link-btn" onClick={() => switchMode('reset')}>
                Forgot your password?
              </button>
              {' · '}
              Don't have an account?{' '}
              <button type="button" className="auth-link-btn" onClick={() => switchMode('signup')}>
                Create one here
              </button>
            </p>
          ) : (
            <p>
              Already have an account?{' '}
              <button type="button" className="auth-link-btn" onClick={() => switchMode('signin')}>
                Sign in here
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
