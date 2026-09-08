import React, { useState } from 'react';
import { X, Shield, FileText, AlertTriangle, ExternalLink } from 'lucide-react';

export type PolicyTab = 'privacy' | 'terms' | 'risk';

interface PolicyModalProps {
  initialTab?: PolicyTab;
  onClose: () => void;
}

export function PolicyModal({ initialTab = 'privacy', onClose }: PolicyModalProps) {
  const [activeTab, setActiveTab] = useState<PolicyTab>(initialTab);

  return (
    <div className="auth-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="policy-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="policy-modal-header">
          <div className="policy-tabs">
            <button
              type="button"
              className={`policy-tab-btn ${activeTab === 'privacy' ? 'active' : ''}`}
              onClick={() => setActiveTab('privacy')}
            >
              <Shield size={15} /> Privacy Policy
            </button>
            <button
              type="button"
              className={`policy-tab-btn ${activeTab === 'terms' ? 'active' : ''}`}
              onClick={() => setActiveTab('terms')}
            >
              <FileText size={15} /> Terms of Service
            </button>
            <button
              type="button"
              className={`policy-tab-btn ${activeTab === 'risk' ? 'active' : ''}`}
              onClick={() => setActiveTab('risk')}
            >
              <AlertTriangle size={15} /> Risk Disclosure
            </button>
          </div>
          <button
            type="button"
            className="policy-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="policy-modal-body">
          {activeTab === 'privacy' && (
            <div className="policy-content">
              <h2>Privacy Policy</h2>
              <p className="policy-updated">Last updated: September 2026</p>

              <section>
                <h3>1. Information We Collect</h3>
                <p>
                  APEX collects only the minimum information necessary to provide the trading terminal:
                </p>
                <ul>
                  <li><strong>Account Credentials:</strong> Your email address and encrypted password managed securely through Supabase Authentication.</li>
                  <li><strong>Trading Preferences:</strong> Saved risk limits, strategy parameters, and workspace configurations stored in your isolated user database row.</li>
                  <li><strong>Deriv API Tokens:</strong> Your personal Deriv API token is stored securely in your browser&apos;s local storage and used directly over encrypted WebSockets (WSS) to communicate with Deriv&apos;s servers. Your token is never logged, sold, or shared with third parties.</li>
                </ul>
              </section>

              <section>
                <h3>2. How We Use Information</h3>
                <p>We process your data strictly to:</p>
                <ul>
                  <li>Provide real-time market data rendering and algorithmic trade management.</li>
                  <li>Maintain your personal trade history ledger and performance analytics.</li>
                  <li>Enforce automated risk limits (session loss limit guardrails) on your behalf.</li>
                </ul>
              </section>

              <section>
                <h3>3. Data Protection and Security</h3>
                <p>
                  All database tables are protected by PostgreSQL Row-Level Security (RLS), ensuring that your workspace, active bot states, and executed trades are accessible exclusively by your authenticated session.
                </p>
              </section>

              <section>
                <h3>4. Third-Party Integrations</h3>
                <p>
                  APEX interfaces with Deriv (Deriv Ltd.) via their official WebSocket API. When you trade live, order instructions travel directly between your client and Deriv&apos;s gateway. Review <a href="https://deriv.com/terms-and-conditions" target="_blank" rel="noopener noreferrer">Deriv&apos;s Terms &amp; Privacy Policy <ExternalLink size={12} /></a> for information on their handling of live financial accounts.
                </p>
              </section>
            </div>
          )}

          {activeTab === 'terms' && (
            <div className="policy-content">
              <h2>Terms of Service</h2>
              <p className="policy-updated">Last updated: September 2026</p>

              <section>
                <h3>1. Acceptance of Terms</h3>
                <p>
                  By accessing or using APEX (&quot;the Platform&quot;), you agree to comply with and be bound by these Terms of Service. If you do not agree, you must not use the Platform.
                </p>
              </section>

              <section>
                <h3>2. Software Description &amp; Non-Custodial Nature</h3>
                <p>
                  APEX is an algorithmic trading interface and analytical lab for synthetic volatility markets. APEX is <strong>non-custodial</strong>: we do not hold, manage, or custody user deposits, fiat currency, or cryptocurrency. All live account deposits, balances, and withdrawals reside exclusively in your personal account with Deriv.
                </p>
              </section>

              <section>
                <h3>3. User Responsibility for Automated Execution</h3>
                <p>
                  Automated bots and algorithmic trading rules execute trade orders based on pre-set parameters and real-time market ticks. You maintain sole responsibility for:
                </p>
                <ul>
                  <li>Configuring appropriate stake sizes, duration ticks, and session loss limits.</li>
                  <li>Monitoring your active bot executions and network connectivity.</li>
                  <li>Ensuring live trading is disarmed when stepping away from the terminal.</li>
                </ul>
              </section>

              <section>
                <h3>4. Demo First Principle</h3>
                <p>
                  APEX operates in Demo (Virtual Funds) mode by default. Live trading execution requires intentional, explicit user arming (&quot;Arm Live Trading&quot;) and is automatically disarmed on disconnection, account switching, or session loss-limit trigger.
                </p>
              </section>
            </div>
          )}

          {activeTab === 'risk' && (
            <div className="policy-content">
              <div className="risk-callout-box">
                <AlertTriangle size={24} className="risk-icon" />
                <div>
                  <strong>High Risk Financial Warning</strong>
                  <p>Trading synthetic volatility indices, contracts for difference (CFDs), and digital options involves significant risk of loss and is not suitable for all investors.</p>
                </div>
              </div>

              <h2>Risk Disclosure Notice</h2>
              <p className="policy-updated">Last updated: September 2026</p>

              <section>
                <h3>1. Nature of Synthetic Volatility Indices</h3>
                <p>
                  Synthetic volatility indices are engineered financial contracts generated by cryptographically secure random number generators. They simulate constant volatility (e.g., Volatility 10, 25, 75, 100) 24 hours a day, 7 days a week, and are not tied to real-world underlying physical assets or central bank policies.
                </p>
              </section>

              <section>
                <h3>2. Potential for Complete Loss</h3>
                <p>
                  Digital options contracts (Rise / Fall) are speculative financial instruments. In binary outcomes, an incorrect direction or equals condition will result in the loss of the entire stake placed on that contract. You should never trade with capital you cannot afford to lose.
                </p>
              </section>

              <section>
                <h3>3. No Guarantee of Past Performance</h3>
                <p>
                  Backtest figures, platform win rate benchmarks, and historical equity curves presented in the terminal are for educational and analytical comparison only. Historical performance does not guarantee future results or continuous profitability.
                </p>
              </section>

              <section>
                <h3>4. System, Execution, and Network Risks</h3>
                <p>
                  Algorithmic trading depends on continuous internet connectivity and real-time WebSocket frames. Network latency, socket disconnects, or client-side delays can affect tick arrival times. APEX provides automatic circuit-breakers (Loss Limits) and keep-alive ping mechanisms, but cannot guarantee zero network downtime.
                </p>
              </section>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="policy-modal-footer">
          <button type="button" className="primary" onClick={onClose}>
            I Understand &amp; Agree
          </button>
        </div>
      </div>
    </div>
  );
}
