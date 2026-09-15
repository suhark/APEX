import React, { useState } from 'react';
import { PolicyModal, type PolicyTab } from './policy-modal';

interface LandingPageProps {
  onOpenAuth: () => void;
  onExploreDemo?: () => void;
}

const FEATURES = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="1" fill="currentColor" />
      </svg>
    ),
    label: 'Market Scanner',
    desc: 'Find high-probability opportunities in real time.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="12" width="4" height="9" rx="1" /><rect x="10" y="7" width="4" height="14" rx="1" /><rect x="17" y="3" width="4" height="18" rx="1" />
      </svg>
    ),
    label: 'Analysis Tools',
    desc: 'Deep market insights and statistical analysis.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
    label: 'Automation',
    desc: 'Run your strategy 24/7, hands-free.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 9h20" /><path d="M7 5v4" /><path d="M17 5v4" />
        <path d="M6 15h4" /><path d="M14 15h4" />
      </svg>
    ),
    label: 'Trade Basket',
    desc: 'Execute multiple setups with one click.',
  },
];

export function LandingPage({ onOpenAuth }: LandingPageProps) {
  const [policyTab, setPolicyTab] = useState<PolicyTab | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [contactStatus, setContactStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [contactError, setContactError] = useState('');

  const openContact = () => {
    setContactOpen(true);
    setContactStatus('idle');
    setContactError('');
  };

  const submitContact = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setContactStatus('sending');
    setContactError('');
    const form = new FormData(formElement);
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
      formElement.reset();
      setContactStatus('sent');
    } catch (error) {
      setContactError(error instanceof Error ? error.message : 'Unable to send. Please try again.');
      setContactStatus('error');
    }
  };

  return (
    <div className="lp-root">
      {/* Nav */}
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <a href="#" className="lp-nav-brand" aria-label="APEX Trading Lab Home">
            <img src="/apex-logo.png" alt="APEX Trading Lab" className="lp-logo" />
          </a>

          <div className="lp-nav-right">
            <button type="button" className="lp-contact-btn" onClick={openContact}>
              Contact
            </button>
            <button type="button" className="lp-cta-btn" onClick={onOpenAuth}>
              Get Started
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          {/* Left: Copy */}
          <div className="lp-hero-copy">
            <p className="lp-eyebrow">TRADE SMARTER</p>
            <h1 className="lp-headline">
              Data-Driven<br />
              Synthetic Trading<br />
              <span className="lp-headline-accent">Made Simple.</span>
            </h1>
            <p className="lp-sub">
              Real-time market scanner, powerful analysis tools,
              and automation — all in one platform.
            </p>

            <div className="lp-actions">
              <button type="button" className="lp-start-btn" onClick={onOpenAuth}>
                Start Trading <span className="lp-arrow">→</span>
              </button>
              <button type="button" className="lp-ghost-btn" onClick={onOpenAuth}>
                Explore Tools
              </button>
            </div>
          </div>

          {/* Right: Hero Visual */}
          <div className="lp-hero-visual">
            <img
              src="/apex-hero-visual.png"
              alt="APEX Trading Platform"
              className="lp-hero-img"
            />
          </div>
        </div>

        {/* Feature strip */}
        <div className="lp-features" id="features">
          {FEATURES.map((f) => (
            <div className="lp-feature-item" key={f.label}>
              <span className="lp-feature-icon">{f.icon}</span>
              <div className="lp-feature-text">
                <strong>{f.label}</strong>
                <span>{f.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Minimal Footer */}
      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <span className="lp-footer-copy">© 2026 APEX Trading Lab</span>
          <div className="lp-footer-links">
            <button type="button" onClick={() => setPolicyTab('privacy')}>Privacy</button>
            <button type="button" onClick={() => setPolicyTab('terms')}>Terms</button>
            <button type="button" onClick={() => setPolicyTab('risk')}>Risk Disclosure</button>
            <button type="button" onClick={openContact}>Support</button>
          </div>
        </div>
      </footer>

      {/* Contact Modal */}
      {contactOpen && (
        <div
          className="lp-modal-overlay"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setContactOpen(false); }}
        >
          <section className="lp-modal" role="dialog" aria-modal="true" aria-labelledby="lp-contact-title">
            <button type="button" className="lp-modal-close" aria-label="Close" onClick={() => setContactOpen(false)}>×</button>
            <p className="lp-modal-eyebrow">GET IN TOUCH</p>
            <h2 id="lp-contact-title">Contact Support</h2>
            <p className="lp-modal-sub">Send us a message and we'll reply to your email directly.</p>

            {contactStatus === 'sent' ? (
              <div className="lp-contact-success">
                ✓ Message sent — we'll get back to you shortly.
              </div>
            ) : (
              <form onSubmit={submitContact} className="lp-contact-form">
                <label>
                  Name
                  <input name="name" required autoComplete="name" placeholder="Your name" />
                </label>
                <label>
                  Email
                  <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
                </label>
                <label>
                  Subject
                  <input name="subject" maxLength={150} placeholder="How can we help?" />
                </label>
                <label>
                  Message
                  <textarea name="message" required maxLength={10000} rows={5} placeholder="Describe your issue or feedback…" />
                </label>
                <button
                  className="lp-start-btn"
                  type="submit"
                  disabled={contactStatus === 'sending'}
                  style={{ alignSelf: 'flex-start' }}
                >
                  {contactStatus === 'sending' ? 'Sending…' : 'Send message'}
                </button>
                {contactStatus === 'error' && (
                  <small className="lp-contact-error">
                    {contactError || 'Unable to send your message. Please try again.'}{' '}
                    If this continues, email{' '}
                    <a href="mailto:support@apextradinglab.app">support@apextradinglab.app</a>.
                  </small>
                )}
              </form>
            )}
          </section>
        </div>
      )}

      {policyTab && (
        <PolicyModal
          initialTab={policyTab}
          onClose={() => setPolicyTab(null)}
        />
      )}
    </div>
  );
}
