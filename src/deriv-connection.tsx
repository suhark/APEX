import { useState } from 'react';
import { AlertCircle, Check, Link2, Loader2, LogOut, ShieldCheck, Unlink, Wallet } from 'lucide-react';
import { type DerivAuthState, type DerivAccount } from './deriv-client';

const DEFAULT_APP_ID = '34khJS0KsSP29i9G8kCiJ';

export function DerivConnectionPanel({
  authState,
  account,
  onConnect,
  onDisconnect,
}: {
  authState: DerivAuthState;
  account: DerivAccount | null;
  onConnect: (token: string, appId: string) => void;
  onDisconnect: () => void;
}) {
  const [token, setToken] = useState('');
  const [appId, setAppId] = useState(DEFAULT_APP_ID);
  const [showToken, setShowToken] = useState(false);

  if (authState === 'connected' && account) {
    return (
      <div className="deriv-connected">
        <div className="deriv-status-row">
          <div className="deriv-status-badge connected">
            <ShieldCheck size={16} />
            <span>Connected to Deriv</span>
          </div>
          <button className="ghost" onClick={onDisconnect}>
            <LogOut size={15} /> Disconnect
          </button>
        </div>
        <div className="deriv-account-info">
          <div className="deriv-account-item">
            <Wallet size={15} />
            <div>
              <span>Account</span>
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
              <span>Type</span>
              <b className={account.is_virtual ? 'demo-tag' : 'live-tag'}>
                {account.is_virtual ? 'Demo (Virtual)' : 'Real'}
              </b>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const connecting = authState === 'connecting' || authState === 'authorizing';

  return (
    <div className="deriv-connect">
      <div className="deriv-connect-header">
        <Link2 size={20} />
        <div>
          <h2>Connect your Deriv account</h2>
          <p>Link a Deriv account to execute real trades. You can use a demo or real Deriv account.</p>
        </div>
      </div>
      {authState === 'error' && (
        <div className="deriv-error">
          <AlertCircle size={16} />
          <span>Could not connect. Check your API token and App ID, then try again.</span>
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
          />
          <button type="button" className="toggle-visibility" onClick={() => setShowToken(!showToken)}>
            {showToken ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>
      <label className="deriv-token-label">
        Deriv App ID
        <div className="deriv-token-input">
          <input
            type="text"
            value={appId}
            placeholder="Your registered Deriv App ID"
            onChange={(e) => setAppId(e.target.value)}
            disabled={connecting}
          />
        </div>
      </label>
      <button
        className="primary"
        disabled={!token.trim() || !appId.trim() || connecting}
        onClick={() => onConnect(token.trim(), appId.trim())}
      >
        {connecting ? <><Loader2 size={16} className="spin" /> Connecting…</> : <><Link2 size={16} /> Connect to Deriv</>}
      </button>
      <div className="deriv-help">
        <Unlink size={14} />
        <span>
          Get your API token from{' '}
          <a href="https://app.deriv.com/account/api-token" target="_blank" rel="noopener noreferrer">
            Deriv API Token settings
          </a>
          . Enable the <b>Read</b>, <b>Trade</b>, and <b>Trading information</b> scopes. Register your app at{' '}
          <a href="https://developers.deriv.com" target="_blank" rel="noopener noreferrer">
            developers.deriv.com
          </a>
          .
        </span>
      </div>
    </div>
  );
}

export function DerivStatusBadge({ authState }: { authState: DerivAuthState }) {
  if (authState === 'connected') {
    return (
      <span className="deriv-pill connected">
        <Check size={12} /> Deriv Live
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
