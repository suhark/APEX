import { useState } from 'react';
import { AlertCircle, Check, Link2, Loader2, LogOut, ShieldCheck, Unlink, UserPlus, Wallet } from 'lucide-react';
import { type DerivAuthState, type DerivAccount } from './deriv-client';
import { redirectToDerivLogin, redirectToDerivSignup, DERIV_CLIENT_ID } from './deriv-oauth';

const DEFAULT_APP_ID = '34mV1HDCcx9gNO0aCEQMg';

export function DerivConnectionPanel({
  authState,
  account,
  accounts = [],
  onConnect,
  onDisconnect,
  onSwitchAccount,
  isArmed = false,
}: {
  authState: DerivAuthState;
  account: DerivAccount | null;
  accounts?: DerivAccount[];
  onConnect: (token: string, appId: string) => void;
  onDisconnect: () => void;
  onSwitchAccount?: (loginid: string) => void;
  isArmed?: boolean;
}) {
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);

  if (authState === 'connected' && account) {
    const handleSwitch = async (loginid: string) => {
      if (loginid === account.loginid || !onSwitchAccount) return;
      setSwitching(loginid);
      try {
        await onSwitchAccount(loginid);
      } finally {
        setSwitching(null);
      }
    };

    return (
      <div className="deriv-connected">
        <div className="deriv-status-row">
          <div className={`deriv-status-badge ${account.is_virtual ? 'demo' : isArmed ? 'armed' : 'disarmed'}`}>
            {account.is_virtual ? (
              <>
                <Check size={16} />
                <span>Connected · Deriv Demo</span>
              </>
            ) : isArmed ? (
              <>
                <span className="live-pulse" />
                <span>Connected · Deriv Real (ARMED)</span>
              </>
            ) : (
              <>
                <ShieldCheck size={16} />
                <span>Connected · Deriv Real (Safe Mode)</span>
              </>
            )}
          </div>
          <button className="ghost" onClick={onDisconnect}>
            <LogOut size={15} /> Disconnect
          </button>
        </div>

        <div className="deriv-account-info">
          <div className="deriv-account-item">
            <Wallet size={15} />
            <div>
              <span>Active Account</span>
              <b>{account.loginid}</b>
            </div>
          </div>
          <div className="deriv-account-item">
            <div>
              <span>Balance</span>
              <b>{account.currency} {account.balance.toFixed(2)}</b>
            </div>
          </div>
          <div className="deriv-account-item">
            <div>
              <span>Account Type</span>
              <b className={account.is_virtual ? 'demo-tag' : 'live-tag'}>
                {account.is_virtual ? 'Demo (Virtual Funds)' : 'Real (Live Funds)'}
              </b>
            </div>
          </div>
        </div>

        {accounts.length > 1 && (
          <div className="deriv-accounts-section">
            <div className="deriv-accounts-title">
              <span>Linked Accounts ({accounts.length})</span>
              <small>Click to switch active trading account</small>
            </div>
            <div className="deriv-accounts-grid">
              {accounts.map((acc) => {
                const isActive = acc.loginid === account.loginid;
                const isSwitchingThis = switching === acc.loginid;
                return (
                  <button
                    key={acc.loginid}
                    type="button"
                    className={`deriv-account-card ${isActive ? 'active' : ''}`}
                    disabled={isActive || !!switching}
                    onClick={() => void handleSwitch(acc.loginid)}
                  >
                    <div className="account-card-header">
                      <span className={`deriv-acc-badge ${acc.is_virtual ? 'demo' : 'real'}`}>
                        {acc.is_virtual ? 'DEMO' : 'REAL'}
                      </span>
                      {isActive && <span className="active-tag">Active</span>}
                      {isSwitchingThis && <Loader2 size={13} className="spin" />}
                    </div>
                    <strong className="account-card-id">{acc.loginid}</strong>
                    <span className="account-card-bal">{acc.currency} {acc.balance.toFixed(2)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  const connecting = authState === 'connecting' || authState === 'authorizing';
  const hasOAuth = Boolean(DERIV_CLIENT_ID);

  return (
    <div className="deriv-connect">
      <div className="deriv-connect-header">
        <Link2 size={20} />
        <div>
          <h2>Connect your Deriv account</h2>
          <p>Sign in with your Deriv account or use an API token.</p>
        </div>
      </div>

      {/* ── OAuth buttons — shown when client_id is configured ── */}
      {hasOAuth && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <button
              className="primary"
              style={{ flex: 1, fontSize: 13, padding: '11px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
              disabled={connecting}
              onClick={() => void redirectToDerivLogin()}
            >
              {connecting ? <><Loader2 size={15} className="spin" /> Connecting…</> : <><Link2 size={15} /> Log in with Deriv</>}
            </button>
            <button
              className="secondary"
              style={{ flex: 1, fontSize: 13, padding: '11px 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}
              disabled={connecting}
              onClick={() => void redirectToDerivSignup()}
            >
              <UserPlus size={15} /> Sign up
            </button>
          </div>
          <p style={{ fontSize: 10, color: '#718580', textAlign: 'center', margin: '0 0 18px' }}>
            You'll be taken to Deriv to approve access, then brought back automatically.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 16px', color: '#2a3e3a', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            <span style={{ flex: 1, height: 1, background: '#1d2d29' }} />
            <span>or use API token</span>
            <span style={{ flex: 1, height: 1, background: '#1d2d29' }} />
          </div>
        </>
      )}

      {authState === 'error' && (
        <div className="deriv-error">
          <AlertCircle size={16} />
          <span>Could not connect. Verify your API token scopes (Read + Trade) and try again.</span>
        </div>
      )}
      <label className="deriv-token-label">
        Deriv API Token
        <div className="deriv-token-input">
          <input
            type={showToken ? 'text' : 'password'}
            value={token}
            placeholder="Paste your Deriv API token (pat_...)"
            onChange={(e) => setToken(e.target.value)}
            disabled={connecting}
            autoComplete="off"
            name="deriv_api_token_no_fill"
            spellCheck={false}
          />
          <button type="button" className="toggle-visibility" onClick={() => setShowToken(!showToken)}>
            {showToken ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>
      <button
        className={hasOAuth ? 'secondary' : 'primary'}
        style={{ width: '100%' }}
        disabled={!token.trim() || connecting}
        onClick={() => onConnect(token.trim(), DEFAULT_APP_ID)}
      >
        {connecting ? <><Loader2 size={16} className="spin" /> Connecting…</> : <><Link2 size={16} /> Connect with token</>}
      </button>
      <div className="deriv-help">
        <Unlink size={14} />
        <span>
          Tokens can be managed or revoked at{' '}
          <a href="https://app.deriv.com/account/api-token" target="_blank" rel="noopener noreferrer">
            app.deriv.com/account/api-token
          </a>.
        </span>
      </div>
    </div>
  );
}

export function DerivStatusBadge({
  authState,
  account,
  isArmed = false,
}: {
  authState: DerivAuthState;
  account?: DerivAccount | null;
  isArmed?: boolean;
}) {
  if (authState === 'connected') {
    if (!account || account.is_virtual) {
      return (
        <span className="deriv-pill demo">
          <Check size={12} /> Deriv Demo
        </span>
      );
    }
    if (isArmed) {
      return (
        <span className="deriv-pill armed-live">
          <span className="live-pulse" /> Deriv Live · ARMED
        </span>
      );
    }
    return (
      <span className="deriv-pill disarmed">
        <ShieldCheck size={12} /> Deriv Real · Safe Mode
      </span>
    );
  }
  if (authState === 'connecting' || authState === 'authorizing') {
    return (
      <span className="deriv-pill connecting">
        <Loader2 size={12} className="spin" /> Connecting…
      </span>
    );
  }
  return null;
}
