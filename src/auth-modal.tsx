import React, { useState } from 'react';
import { type SupabaseClient, type User } from '@supabase/supabase-js';
import { Activity, AlertCircle, CheckCircle2, Eye, EyeOff, Lock, Mail, Loader2, ArrowRight } from 'lucide-react';

interface AuthModalProps {
  supabase: SupabaseClient;
  onAuthSuccess: (user: User) => void;
}

export function AuthModal({ supabase, onAuthSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessNotice(null);

    const cleanEmail = email.trim();
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
        if (data.user) {
          onAuthSuccess(data.user);
        }
      } else {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        });

        if (signUpError) throw signUpError;

        if (data.user && data.session) {
          // Immediately signed in (if email confirmation disabled)
          onAuthSuccess(data.user);
        } else if (data.user && !data.session) {
          // Confirmation required
          setSuccessNotice('Account created! Please check your email inbox to confirm your email, then sign in.');
          setMode('signin');
          setPassword('');
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Authentication failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-overlay">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-mark">
            <Activity size={24} />
          </div>
          <h2>APEX</h2>
          <span>QUANT TRADING PLATFORM</span>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === 'signin' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => {
              setMode('signin');
              setError(null);
              setSuccessNotice(null);
            }}
          >
            Sign In
          </button>
          <button
            type="button"
            className={mode === 'signup' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => {
              setMode('signup');
              setError(null);
              setSuccessNotice(null);
            }}
          >
            Create Account
          </button>
        </div>

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

        <form onSubmit={handleSubmit} className="auth-form" autoComplete="off">
          <label className="auth-label">
            Email Address
            <div className="auth-input-wrap">
              <Mail size={16} className="auth-input-icon" />
              <input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                required
                disabled={loading}
              />
            </div>
          </label>

          <label className="auth-label">
            Password
            <div className="auth-input-wrap">
              <Lock size={16} className="auth-input-icon" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder={mode === 'signup' ? 'Create a secure password (6+ chars)' : 'Enter your password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                disabled={loading}
              />
              <button
                type="button"
                className="auth-eye-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading ? (
              <>
                <Loader2 size={16} className="spin" />
                {mode === 'signin' ? 'Signing in…' : 'Creating account…'}
              </>
            ) : (
              <>
                <span>{mode === 'signin' ? 'Sign In to Workspace' : 'Create Free Account'}</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div className="auth-footer">
          <p>
            {mode === 'signin' ? (
              <>
                Don’t have an account yet?{' '}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => {
                    setMode('signup');
                    setError(null);
                  }}
                >
                  Create one here
                </button>
              </>
            ) : (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  className="auth-link-btn"
                  onClick={() => {
                    setMode('signin');
                    setError(null);
                  }}
                >
                  Sign in here
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
