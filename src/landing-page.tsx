import React, { useState, useEffect } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  ChevronDown,
  ChevronUp,
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
import { PolicyModal, type PolicyTab } from './policy-modal';

interface LandingPageProps {
  onOpenAuth: () => void;
  onExploreDemo?: () => void;
}

interface MarketRow {
  symbol: string;
  name: string;
  price: number;
  change: number;
  trend: 'up' | 'down';
  history: number[];
}

const INITIAL_MARKETS: MarketRow[] = [
  {
    symbol: '1HZ10V',
    name: 'Volatility 10 (1s)',
    price: 101.38,
    change: -0.04,
    trend: 'down',
    history: [101.45, 101.44, 101.42, 101.42, 101.38],
  },
  {
    symbol: '1HZ25V',
    name: 'Volatility 25 (1s)',
    price: 98.21,
    change: 0.07,
    trend: 'up',
    history: [98.12, 98.14, 98.15, 98.18, 98.21],
  },
  {
    symbol: '1HZ50V',
    name: 'Volatility 50 (1s)',
    price: 248.89,
    change: 0.0,
    trend: 'down',
    history: [248.95, 248.92, 248.9, 248.9, 248.89],
  },
  {
    symbol: '1HZ75V',
    name: 'Volatility 75 (1s)',
    price: 482.35,
    change: 0.01,
    trend: 'up',
    history: [482.25, 482.28, 482.3, 482.32, 482.35],
  },
  {
    symbol: '1HZ100V',
    name: 'Volatility 100 (1s)',
    price: 929.42,
    change: 0.07,
    trend: 'up',
    history: [929.15, 929.2, 929.28, 929.35, 929.42],
  },
];

const FAQ_DATA = [
  {
    q: 'How does APEX connect to Deriv?',
    a: 'APEX connects directly from your browser to Deriv’s official gateway (wss://ws.derivws.com) using your API token. No trade signals or authorization tokens are routed through third-party servers. Your execution stays strictly between your client and Deriv.',
  },
  {
    q: 'What token scopes do I need to enable?',
    a: 'Only "Read" and "Trade". Do not enable "Admin", "Payments", or "Withdrawals". APEX is non-custodial: it can only read feeds and place contracts you authorize. It cannot withdraw or transfer your capital.',
  },
  {
    q: 'How does the session loss guardrail work?',
    a: 'You choose a hard dollar limit for session drawdown (e.g. $50). If cumulative closed trade losses reach that threshold, APEX disarms live execution and stops active bots automatically so you don’t blow an account during a tilted run.',
  },
  {
    q: 'Can I test bots in demo mode first?',
    a: 'Yes. The workspace is demo-first. You can run manual trades and bots against live synthetic feeds with virtual balances. Live execution is disarmed by default and requires explicit manual arming before any real stake is placed.',
  },
  {
    q: 'Are bot states shared between users?',
    a: 'No. Every user account has an isolated workspace. Turning a bot on or adjusting stake sizes in your account only affects your personal session.',
  },
];

export function LandingPage({ onOpenAuth }: LandingPageProps) {
  const [markets, setMarkets] = useState<MarketRow[]>(INITIAL_MARKETS);
  const [utcTime, setUtcTime] = useState<string>('20:35:45 UTC');
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [policyTab, setPolicyTab] = useState<PolicyTab | null>(null);

  // Live UTC Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setUtcTime(now.toUTCString().slice(17, 25) + ' UTC');
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // Subtle simulated tick feed for the hero monitor table
  useEffect(() => {
    const interval = setInterval(() => {
      setMarkets((prev) =>
        prev.map((m, i) => {
          const delta = (Math.sin(Date.now() / 3000 + i) * 0.15 + (Math.random() - 0.49) * 0.2) * (m.price * 0.0008);
          const nextPrice = Number((m.price + delta).toFixed(2));
          const nextChange = Number((((nextPrice - INITIAL_MARKETS[i].price) / INITIAL_MARKETS[i].price) * 100).toFixed(2));
          const nextTrend = nextChange >= 0 ? 'up' : 'down';
          const nextHistory = [...m.history.slice(-6), nextPrice];
          return {
            ...m,
            price: nextPrice,
            change: nextChange,
            trend: nextTrend,
            history: nextHistory,
          };
        })
      );
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  // Helper to draw clean SVG sparkline
  const renderSparkline = (history: number[], trend: 'up' | 'down') => {
    if (!history || history.length < 2) return null;
    const min = Math.min(...history);
    const max = Math.max(...history);
    const range = max - min || 1;
    const width = 54;
    const height = 18;

    const points = history.map((val, idx) => {
      const x = (idx / (history.length - 1)) * width;
      const y = height - 2 - ((val - min) / range) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const color = trend === 'up' ? '#10b981' : '#ef4444';

    return (
      <svg width={width} height={height} className="sparkline-svg">
        <polyline
          fill="none"
          stroke={color}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points.join(' ')}
        />
      </svg>
    );
  };

  return (
    <div className="terminal-landing">
      {/* Top Status Strip */}
      <div className="top-status-strip">
        <div className="status-container">
          <div className="status-left">
            <span className="status-dot connected" />
            <span className="status-label">connected</span>
            <span className="status-url">wss://ws.derivws.com</span>
          </div>
          <div className="status-right">
            <span className="status-ping">ping 14ms</span>
            <span className="status-time">{utcTime}</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <header className="terminal-nav">
        <div className="nav-container">
          <div className="nav-brand">
            <span className="brand-logo-text">APEX</span>
            <span className="brand-sub-text">TRADING LAB</span>
          </div>

          <nav className="nav-menu">
            <a href="#automation">Automation</a>
            <a href="#markets">Markets</a>
            <a href="#risk-controls">Risk Controls</a>
            <a href="#faq">FAQ</a>
            <button
              type="button"
              className="nav-policy-btn"
              onClick={() => setPolicyTab('privacy')}
            >
              Policies
            </button>
          </nav>

          <button
            type="button"
            className="nav-launch-btn"
            onClick={onOpenAuth}
          >
            Launch Terminal
          </button>
        </div>
      </header>

      {/* Hero Section: Split Asymmetrical Layout */}
      <section className="terminal-hero">
        <div className="hero-container">
          {/* Left Column */}
          <div className="hero-left">
            <h1 className="hero-title">
              Automate synthetic volatility trading with the guardrails built in.
            </h1>
            <p className="hero-desc">
              Run algorithmic strategies against Deriv's synthetic indices, execute manually
              on a live tick chart, and cap what a bad session can cost you before it happens.
            </p>

            <div className="hero-action-row">
              <button
                type="button"
                className="hero-primary-btn"
                onClick={onOpenAuth}
              >
                Start trading now
              </button>
              <a
                href="https://home.deriv.com/dashboard/profile/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="hero-link-btn"
              >
                Get Deriv API token &rarr;
              </a>
            </div>

            <div className="hero-specs-grid">
              <div className="spec-item">
                <span>Sub-100ms execution</span>
              </div>
              <div className="spec-divider" />
              <div className="spec-item">
                <span>Non-custodial, zero fees</span>
              </div>
              <div className="spec-item">
                <span>Direct client-side WSS</span>
              </div>
              <div className="spec-divider" />
              <div className="spec-item">
                <span>Hard loss guardrails</span>
              </div>
            </div>
          </div>

          {/* Right Column: Embedded Live Terminal Monitor */}
          <div className="hero-right" id="markets">
            <div className="market-monitor-card">
              <div className="monitor-header">
                <span className="monitor-title">synthetic volatility indices</span>
                <span className="monitor-badge">1s tick</span>
              </div>

              <div className="monitor-table">
                <div className="monitor-thead">
                  <span className="col-symbol">symbol</span>
                  <span className="col-price">price</span>
                  <span className="col-trend">trend</span>
                  <span className="col-chg">chg</span>
                </div>

                <div className="monitor-tbody">
                  {markets.map((m) => (
                    <div className="monitor-row" key={m.symbol}>
                      <div className="col-symbol">
                        <strong className="symbol-code">{m.symbol}</strong>
                        <span className="symbol-name">{m.name}</span>
                      </div>
                      <div className="col-price font-mono">
                        {m.price.toFixed(2)}
                      </div>
                      <div className="col-trend">
                        {renderSparkline(m.history, m.trend)}
                      </div>
                      <div className={`col-chg font-mono ${m.change >= 0 ? 'text-pos' : 'text-neg'}`}>
                        {m.change >= 0 ? `▲ ${m.change.toFixed(2)}%` : `▼ ${Math.abs(m.change).toFixed(2)}%`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Core Philosophy */}
      <section className="terminal-section" id="automation">
        <div className="section-container">
          <div className="section-lead">
            <h2>Built for strategies you can repeat, not one lucky trade.</h2>
            <p>
              Everything here is scoped to Deriv's synthetic volatility indices — trade the
              chart manually, hand it to a bot, or build your own entry logic without writing code.
            </p>
          </div>

          {/* 3 Real Terminal Architecture Blocks */}
          <div className="philosophy-grid">
            <div className="philosophy-block">
              <div className="block-num">01</div>
              <h3>Automated Strategy Library</h3>
              <p>
                Run Momentum Pulse, Range Scout, and Reverse Signal simultaneously. Each bot runs on
                a dedicated interval loop and evaluates conditions tick-by-tick against real Deriv feeds.
              </p>
              <ul className="block-list">
                <li>Strict per-trade stake controls ($2, $5, $10)</li>
                <li>Isolated user states: activating a bot never affects other accounts</li>
                <li>Zero-state tracking: see your actual win rate, not platform mock stats</li>
              </ul>
            </div>

            <div className="philosophy-block highlight">
              <div className="block-num accent">02</div>
              <h3>Session Loss Guardrails</h3>
              <p>
                The biggest leak in volatility trading is tilt. APEX implements software circuit breakers
                that monitor your cumulative session P/L and disarm live execution instantly.
              </p>
              <ul className="block-list">
                <li>Automatic live trading disarm on loss threshold hit</li>
                <li>Demo-first safety: real trading requires explicit arming</li>
                <li>Instant disarm on switching between Demo and Real accounts</li>
              </ul>
            </div>

            <div className="philosophy-block">
              <div className="block-num">03</div>
              <h3>Direct Client-Side Execution</h3>
              <p>
                Your API token stays inside your browser's encrypted session storage. Trade commands
                travel over secure WebSockets straight to Deriv's gateway with sub-100ms response times.
              </p>
              <ul className="block-list">
                <li>Non-custodial: only Read and Trade scopes required</li>
                <li>Funds never leave your personal Deriv account</li>
                <li>Immutable ledger of every opened and settled contract</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Risk Controls & Circuit Breaker */}
      <section className="terminal-section dark-alt" id="risk-controls">
        <div className="section-container">
          <div className="risk-showcase-box">
            <div className="risk-showcase-content">
              <span className="risk-tag">CIRCUIT BREAKER</span>
              <h2>Stop losses where your rules say, not when emotion dictates.</h2>
              <p>
                Configure a loss guardrail for every session (e.g. $50 or $100). The moment cumulative
                negative delta reaches that limit, APEX cuts execution and pauses all bots immediately.
              </p>
              <div className="risk-stats-strip">
                <div>
                  <small>Execution Safe Mode</small>
                  <strong>Disarmed by Default</strong>
                </div>
                <div>
                  <small>Max Session Drawdown</small>
                  <strong>Hard Capped</strong>
                </div>
                <div>
                  <small>WebSocket Keepalive</small>
                  <strong>25s Heartbeat</strong>
                </div>
              </div>
            </div>

            <div className="risk-showcase-card">
              <div className="circuit-mock">
                <div className="circuit-header">
                  <span>Guardrail Monitor</span>
                  <span className="circuit-status">ARMED</span>
                </div>
                <div className="circuit-metric">
                  <span className="metric-label">Session Loss Ceiling</span>
                  <span className="metric-value font-mono">$50.00</span>
                </div>
                <div className="circuit-metric">
                  <span className="metric-label">Current Drawdown</span>
                  <span className="metric-value font-mono text-neg">-$14.20</span>
                </div>
                <div className="circuit-bar">
                  <div className="circuit-fill" style={{ width: '28.4%' }} />
                </div>
                <span className="circuit-note">
                  Automatic disarm triggers at -$50.00 session drawdown.
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 4: Deriv Quick Connect */}
      <section className="terminal-section">
        <div className="section-container">
          <div className="deriv-connect-card">
            <div className="deriv-connect-info">
              <h2>Connect your Deriv account in 3 steps</h2>
              <p>
                You only need a standard Deriv API token with Read and Trade permissions.
                No third-party registration or payment gateway required.
              </p>
              <div className="deriv-steps-list">
                <div className="step-row">
                  <span className="step-badge">1</span>
                  <span>Open the official <b>Deriv API Tokens</b> page</span>
                </div>
                <div className="step-row">
                  <span className="step-badge">2</span>
                  <span>Name your token (e.g. <code>APEX</code>) and tick <b>Read</b> & <b>Trade</b> scopes</span>
                </div>
                <div className="step-row">
                  <span className="step-badge">3</span>
                  <span>Paste the token into the APEX terminal to start trading</span>
                </div>
              </div>
            </div>

            <div className="deriv-connect-action">
              <a
                href="https://home.deriv.com/dashboard/profile/api-tokens"
                target="_blank"
                rel="noopener noreferrer"
                className="deriv-direct-btn"
              >
                <span>Open Deriv API Tokens</span>
                <ExternalLink size={15} />
              </a>
              <small>Redirects directly to Deriv Dashboard &gt; API Tokens</small>
            </div>
          </div>
        </div>
      </section>

      {/* Section 5: FAQ Accordion */}
      <section className="terminal-section dark-alt" id="faq">
        <div className="section-container faq-narrow">
          <div className="section-lead">
            <h2>Frequently answered questions</h2>
            <p>Direct answers about security, scopes, and execution mechanics.</p>
          </div>

          <div className="faq-list">
            {FAQ_DATA.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={idx}
                  className={`faq-row ${isOpen ? 'open' : ''}`}
                  onClick={() => setOpenFaq(isOpen ? null : idx)}
                >
                  <div className="faq-q">
                    <span>{item.q}</span>
                    <span className="faq-icon">{isOpen ? '−' : '+'}</span>
                  </div>
                  {isOpen && (
                    <div className="faq-a">
                      <p>{item.a}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="terminal-footer">
        <div className="footer-container">
          <div className="footer-top">
            <div className="footer-brand">
              <strong>APEX TRADING LAB</strong>
              <p>Non-custodial algorithmic trading interface for Deriv Synthetic Volatility Indices.</p>
            </div>

            <div className="footer-nav">
              <div className="footer-group">
                <span className="group-title">Terminal</span>
                <a href="#automation">Automation Bots</a>
                <a href="#markets">Synthetic Feeds</a>
                <a href="#risk-controls">Loss Guardrails</a>
              </div>

              <div className="footer-group">
                <span className="group-title">Deriv</span>
                <a
                  href="https://home.deriv.com/dashboard/profile/api-tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  API Tokens Portal &rarr;
                </a>
                <a href="https://deriv.com" target="_blank" rel="noopener noreferrer">
                  Deriv.com &rarr;
                </a>
              </div>

              <div className="footer-group">
                <span className="group-title">Policies</span>
                <button type="button" onClick={() => setPolicyTab('privacy')}>
                  Privacy Policy
                </button>
                <button type="button" onClick={() => setPolicyTab('terms')}>
                  Terms of Service
                </button>
                <button type="button" onClick={() => setPolicyTab('risk')}>
                  Risk Disclosure
                </button>
              </div>
            </div>
          </div>

          <div className="footer-disclaimer">
            <p>
              <b>Risk Warning:</b> Trading synthetic volatility indices and digital contracts carries a high level of risk and may result in the loss of all invested capital. Never trade with money you cannot afford to lose. APEX is a client-side execution terminal and does not provide financial or investment advice.
            </p>
            <span className="footer-copyright">
              © 2026 APEX Trading Lab. All rights reserved.
            </span>
          </div>
        </div>
      </footer>

      {/* Policy Modal Overlay */}
      {policyTab && (
        <PolicyModal
          initialTab={policyTab}
          onClose={() => setPolicyTab(null)}
        />
      )}
    </div>
  );
}
