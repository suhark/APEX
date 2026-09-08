import React, { useState } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Cpu,
  ExternalLink,
  Lock,
  Play,
  Shield,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';
import { PolicyModal, PolicyTab } from './policy-modal';

interface LandingPageProps {
  onOpenAuth: () => void;
  onExploreDemo?: () => void;
}

interface FaqItem {
  question: string;
  answer: string;
}

const FAQ_DATA: FaqItem[] = [
  {
    question: 'How does APEX execute trades on my Deriv account?',
    answer:
      'APEX establishes a direct, TLS-encrypted WebSocket connection from your browser to Deriv’s official gateway (wss://ws.derivws.com). When a strategy condition or manual ticket triggers, contract purchase requests execute directly on Deriv with sub-100ms latency without routing through any third-party intermediary servers.',
  },
  {
    question: 'What permissions / scopes are required for my Deriv API token?',
    answer:
      'You only need to grant "Read" and "Trade" scopes. Never grant "Admin", "Payments", or "Withdrawal" permissions. APEX is strictly non-custodial: it cannot deposit, withdraw, or transfer funds. Your money remains securely in your personal Deriv account at all times.',
  },
  {
    question: 'What are Synthetic Volatility Indices?',
    answer:
      'Synthetic Volatility Indices (Volatility 10, 25, 50, 75, 100) are engineered financial markets with constant, verifiable volatility. They run 24 hours a day, 7 days a week, 365 days a year, unaffected by market opening hours, bank holidays, or unpredictable global geopolitical news.',
  },
  {
    question: 'Can I practice with virtual demo funds before trading live?',
    answer:
      'Yes. APEX is designed demo-first. When you launch the workspace, you can trade with virtual funds on synthetic feeds or connect your Deriv Demo account. Live execution is disarmed by default and requires your explicit authorization before placing real-money contracts.',
  },
  {
    question: 'How does the automated Loss-Limit Guardrail protect my capital?',
    answer:
      'The platform monitors your session profit/loss on every tick. If your cumulative session drawdown reaches your pre-configured loss limit (e.g., $50), APEX immediately disarms live execution and cancels active bot loops to prevent emotional over-trading.',
  },
  {
    question: 'Can I run multiple automated bots simultaneously?',
    answer:
      'Yes. You can activate multiple specialized bots (such as Momentum Pulse, Range Scout, and Reverse Signal) across different synthetic volatility pairs. Each bot’s active state is isolated strictly to your user profile.',
  },
];

const SYNTHETIC_MARKETS = [
  { name: 'Volatility 10 (1s)', price: '101.42', change: '+0.18%', up: true },
  { name: 'Volatility 25 (1s)', price: '98.15', change: '+0.32%', up: true },
  { name: 'Volatility 50 (1s)', price: '248.90', change: '-0.14%', up: false },
  { name: 'Volatility 75 (1s)', price: '482.30', change: '+0.45%', up: true },
  { name: 'Volatility 100 (1s)', price: '928.74', change: '-0.21%', up: false },
];

export function LandingPage({ onOpenAuth, onExploreDemo }: LandingPageProps) {
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [activePolicyTab, setActivePolicyTab] = useState<PolicyTab | null>(null);

  const toggleFaq = (index: number) => {
    setOpenFaqIndex(openFaqIndex === index ? null : index);
  };

  return (
    <div className="landing-shell">
      {/* Top Navigation */}
      <header className="landing-nav">
        <div className="landing-nav-inner">
          <div className="landing-brand">
            <div className="brand-mark">
              <Activity size={18} />
            </div>
            <div>
              <strong>APEX</strong>
              <span>TRADING LAB</span>
            </div>
          </div>

          <nav className="landing-links">
            <a href="#features">Automation</a>
            <a href="#markets">Markets</a>
            <a href="#risk-guard">Risk Controls</a>
            <a href="#faq">FAQ</a>
            <button
              type="button"
              className="landing-policy-link"
              onClick={() => setActivePolicyTab('privacy')}
            >
              Policies
            </button>
          </nav>

          <div className="landing-actions">
            <button
              type="button"
              className="primary landing-cta-btn"
              onClick={onOpenAuth}
            >
              Launch Terminal <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="landing-hero">
        <div className="landing-hero-content">
          <div className="landing-tagline">
            <span className="live-dot" /> High-frequency Deriv API WebSocket Terminal
          </div>
          <h1>
            Automate Synthetic Volatility Markets With Institutional Precision
          </h1>
          <p className="landing-subhead">
            Deploy algorithmic trading loops, execute sub-second tick strategies on Deriv,
            and protect your capital with hard session loss-limit circuit breakers.
          </p>

          <div className="landing-hero-btns">
            <button
              type="button"
              className="primary landing-btn-large"
              onClick={onOpenAuth}
            >
              <Play size={16} /> Start Trading Now
            </button>
            <a
              href="https://home.deriv.com/dashboard/profile/api-tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="secondary landing-btn-large deriv-link-outline"
            >
              <ExternalLink size={15} /> Get Deriv API Token
            </a>
          </div>

          <div className="landing-trust-bar">
            <div className="trust-item">
              <Zap size={14} />
              <span>Sub-100ms Execution</span>
            </div>
            <div className="trust-item">
              <ShieldCheck size={14} />
              <span>Non-Custodial · Zero Fees</span>
            </div>
            <div className="trust-item">
              <Lock size={14} />
              <span>Direct Client-Side WSS</span>
            </div>
            <div className="trust-item">
              <ShieldAlert size={14} />
              <span>Hard Loss Guardrails</span>
            </div>
          </div>
        </div>
      </section>

      {/* Live Synthetic Markets Ticker */}
      <section className="landing-ticker-section" id="markets">
        <div className="landing-ticker-strip">
          {SYNTHETIC_MARKETS.map((m) => (
            <div className="landing-ticker-cell" key={m.name}>
              <span className="ticker-inst">{m.name}</span>
              <strong className="ticker-val">{m.price}</strong>
              <span className={`ticker-chg ${m.up ? 'positive' : 'negative'}`}>
                {m.change}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Core Platform Architecture Grid */}
      <section className="landing-section" id="features">
        <div className="landing-container">
          <div className="landing-section-header">
            <h2>Engineered For Consistent Strategy Execution</h2>
            <p>
              Built specifically for Deriv Synthetic Volatility Indices. Trade manually with
              fluent financial spline charts or automate with disciplined execution loops.
            </p>
          </div>

          <div className="landing-grid-3">
            <div className="landing-card">
              <div className="landing-card-icon">
                <Bot size={22} />
              </div>
              <h3>Automated Bot Library</h3>
              <p>
                Deploy pre-built synthetic bots including Momentum Pulse, Range Scout, and
                Reverse Signal. Each bot enforces strict stake limits and independent lifecycle control.
              </p>
              <div className="card-feature-list">
                <span>✓ Multi-bot concurrent execution</span>
                <span>✓ Isolated user activation states</span>
                <span>✓ Independent personal track records</span>
              </div>
            </div>

            <div className="landing-card highlight-card">
              <div className="landing-card-icon accent">
                <Shield size={22} />
              </div>
              <h3>Session Loss Guardrails</h3>
              <p>
                Never suffer runaway drawdowns. Configure your daily or session loss threshold.
                The moment that ceiling is touched, live execution disarms automatically.
              </p>
              <div className="card-feature-list">
                <span>✓ Automated live disarm trigger</span>
                <span>✓ Active contract protection</span>
                <span>✓ Real-time P/L tracking</span>
              </div>
            </div>

            <div className="landing-card">
              <div className="landing-card-icon">
                <Activity size={22} />
              </div>
              <h3>Manual Financial Terminal</h3>
              <p>
                Trade Rise/Fall contracts with razor-thin responsive spline charts, dual crosshairs,
                multi-layer live spot halos, and historical pan scrollback.
              </p>
              <div className="card-feature-list">
                <span>✓ Smooth cubic-bezier tick wave</span>
                <span>✓ Pan back through past market history</span>
                <span>✓ Pinch-to-zoom touch gestures</span>
              </div>
            </div>

            <div className="landing-card">
              <div className="landing-card-icon">
                <Cpu size={22} />
              </div>
              <h3>No-Code Strategy Builder</h3>
              <p>
                Assemble customized entry conditions, moving average crossovers, and RSI logic
                without writing a line of code. Test strategies directly in your virtual sandbox.
              </p>
            </div>

            <div className="landing-card">
              <div className="landing-card-icon">
                <TrendingUp size={22} />
              </div>
              <h3>Public Audit Ledger</h3>
              <p>
                Every synthetic contract executed through APEX is timestamped and recorded
                immutably in your ledger. View cumulative equity curves and win rate stats.
              </p>
            </div>

            <div className="landing-card">
              <div className="landing-card-icon">
                <Wallet size={22} />
              </div>
              <h3>Direct Deriv Integration</h3>
              <p>
                Enter your personal Deriv token with Read and Trade scopes. Your funds stay in
                your Deriv account, and orders execute directly across official WebSockets.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Risk Guard Detail Panel */}
      <section className="landing-section dark-alt" id="risk-guard">
        <div className="landing-container">
          <div className="guard-showcase-panel">
            <div className="guard-showcase-left">
              <div className="guard-badge">
                <ShieldCheck size={14} /> Capital Preservation
              </div>
              <h2>Circuit Breaker Built Into Every Trade</h2>
              <p>
                In synthetic volatility markets, risk management determines longevity. APEX treats
                capital preservation as a core software primitive.
              </p>
              <ul className="guard-points">
                <li>
                  <strong>Demo-First Safe Mode:</strong> All sessions boot with live execution
                  disarmed until explicitly armed by the trader.
                </li>
                <li>
                  <strong>Auto-Disarm on Account Switch:</strong> Switching between Demo and Real
                  accounts instantly disarms live execution.
                </li>
                <li>
                  <strong>Continuous Keep-Alive Ping:</strong> 25-second WebSocket ping keeps your
                  terminal synchronized with Deriv without gateway timeouts.
                </li>
              </ul>
            </div>
            <div className="guard-showcase-right">
              <div className="guard-mock-card">
                <div className="mock-card-header">
                  <span>Guardrail Status</span>
                  <b className="positive">Active (ARMED)</b>
                </div>
                <div className="mock-stat-row">
                  <span>Loss Limit Threshold:</span>
                  <strong>$50.00</strong>
                </div>
                <div className="mock-stat-row">
                  <span>Current Session Drawdown:</span>
                  <span className="negative">-$12.40</span>
                </div>
                <div className="mock-progress-bar">
                  <div className="mock-progress-fill" style={{ width: '24.8%' }} />
                </div>
                <p className="mock-note">
                  Live execution will disarm automatically if drawdown reaches $50.00.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ Accordion Section */}
      <section className="landing-section" id="faq">
        <div className="landing-container faq-container">
          <div className="landing-section-header">
            <h2>Frequently Asked Questions</h2>
            <p>
              Everything you need to know about APEX, Deriv API tokens, and synthetic index trading.
            </p>
          </div>

          <div className="faq-accordion">
            {FAQ_DATA.map((item, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div
                  className={`faq-item ${isOpen ? 'open' : ''}`}
                  key={idx}
                  onClick={() => toggleFaq(idx)}
                >
                  <div className="faq-question">
                    <span>{item.question}</span>
                    {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </div>
                  {isOpen && (
                    <div className="faq-answer">
                      <p>{item.answer}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Bottom CTA Banner */}
      <section className="landing-cta-banner">
        <div className="landing-container">
          <div className="cta-banner-card">
            <h2>Ready To Trade Synthetic Markets With Discipline?</h2>
            <p>
              Create your account in seconds. Test free bots in Demo mode or connect your Deriv API
              token for automated live execution.
            </p>
            <div className="cta-banner-buttons">
              <button
                type="button"
                className="primary landing-btn-large"
                onClick={onOpenAuth}
              >
                Launch APEX Terminal <ArrowRight size={15} />
              </button>
              <a
                href="https://home.deriv.com/dashboard/profile/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="secondary landing-btn-large"
              >
                <ExternalLink size={14} /> Get Deriv API Token
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="landing-container landing-footer-inner">
          <div className="footer-left">
            <div className="landing-brand">
              <div className="brand-mark small">
                <Activity size={15} />
              </div>
              <div>
                <strong>APEX</strong>
                <span>TRADING LAB</span>
              </div>
            </div>
            <p className="footer-desc">
              Algorithmic execution interface for synthetic volatility indices. Direct Deriv
              WebSocket connectivity with client-side loss limit automation.
            </p>
          </div>

          <div className="footer-links-group">
            <div className="footer-col">
              <h4>Platform</h4>
              <a href="#features">Automation Bots</a>
              <a href="#markets">Synthetic Markets</a>
              <a href="#risk-guard">Loss Guardrails</a>
              <a href="#faq">FAQ</a>
            </div>

            <div className="footer-col">
              <h4>Deriv Resources</h4>
              <a
                href="https://home.deriv.com/dashboard/profile/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
              >
                API Tokens Portal <ExternalLink size={11} />
              </a>
              <a
                href="https://deriv.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Deriv Official Site <ExternalLink size={11} />
              </a>
            </div>

            <div className="footer-col">
              <h4>Legal &amp; Risk</h4>
              <button
                type="button"
                className="footer-btn-link"
                onClick={() => setActivePolicyTab('privacy')}
              >
                Privacy Policy
              </button>
              <button
                type="button"
                className="footer-btn-link"
                onClick={() => setActivePolicyTab('terms')}
              >
                Terms of Service
              </button>
              <button
                type="button"
                className="footer-btn-link"
                onClick={() => setActivePolicyTab('risk')}
              >
                Risk Disclosure
              </button>
            </div>
          </div>
        </div>

        <div className="landing-footer-bottom">
          <div className="landing-container">
            <p className="footer-disclaimer">
              <strong>Risk Warning:</strong> Trading synthetic volatility indices and digital options involves substantial risk of loss and is not suitable for all investors. Ensure you fully understand the risks before trading with real capital. APEX is an analytical and execution software tool and does not provide financial investment advice.
            </p>
            <p className="footer-copy">
              © 2026 APEX Trading Lab. All rights reserved.
            </p>
          </div>
        </div>
      </footer>

      {/* Policy Modal */}
      {activePolicyTab && (
        <PolicyModal
          initialTab={activePolicyTab}
          onClose={() => setActivePolicyTab(null)}
        />
      )}
    </div>
  );
}
