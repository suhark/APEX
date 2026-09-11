/**
 * Deriv OAuth 2.0 + PKCE implementation
 * Docs: https://auth.deriv.com/oauth2/auth
 */

const AUTH_ENDPOINT = 'https://auth.deriv.com/oauth2/auth';

// client_id = your Deriv OAuth2 app ID (from developers.deriv.com)
export const DERIV_CLIENT_ID = import.meta.env.VITE_DERIV_CLIENT_ID ?? '34mV1HDCcx9gNO0aCEQMg';
// Legacy app_id still needed for WebSocket connection after token exchange
export const DERIV_LEGACY_APP_ID = import.meta.env.VITE_DERIV_APP_ID ?? '34mV1HDCcx9gNO0aCEQMg';

const REDIRECT_URI = window.location.hostname === 'localhost'
  ? `${window.location.origin}/callback`
  : 'https://apextradinglab.app/callback';

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const array = crypto.getRandomValues(new Uint8Array(64));
  const verifier = Array.from(array)
    .map(v => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'[v % 66])
    .join('');

  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return { verifier, challenge };
}

function generateState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Auth redirects ───────────────────────────────────────────────────────────

export async function redirectToDerivLogin(): Promise<void> {
  const { verifier, challenge } = await generatePKCE();
  const state = generateState();

  sessionStorage.setItem('pkce_code_verifier', verifier);
  sessionStorage.setItem('oauth_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: DERIV_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'trade',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(DERIV_LEGACY_APP_ID && DERIV_LEGACY_APP_ID !== DERIV_CLIENT_ID
      ? { app_id: DERIV_LEGACY_APP_ID }
      : {}),
  });

  console.log('[APEX OAuth] Redirecting to Deriv login:', `${AUTH_ENDPOINT}?${params.toString()}`);
  window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
}

export async function redirectToDerivSignup(): Promise<void> {
  const { verifier, challenge } = await generatePKCE();
  const state = generateState();

  sessionStorage.setItem('pkce_code_verifier', verifier);
  sessionStorage.setItem('oauth_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: DERIV_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'trade',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'registration',
    ...(DERIV_LEGACY_APP_ID && DERIV_LEGACY_APP_ID !== DERIV_CLIENT_ID
      ? { app_id: DERIV_LEGACY_APP_ID }
      : {}),
  });

  window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
}

// ─── Callback handler ─────────────────────────────────────────────────────────

export interface OAuthResult {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export async function handleOAuthCallback(): Promise<OAuthResult | null> {
  if (window.location.pathname !== '/callback') return null;

  const params = new URLSearchParams(window.location.search);
  const code  = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  // Clean URL immediately so refresh doesn't re-trigger
  window.history.replaceState({}, '', '/');

  if (error) {
    const desc = params.get('error_description') ?? error;
    console.error('[APEX OAuth] Callback error:', desc);
    throw new Error(`Deriv login failed: ${desc}`);
  }

  if (!code || !state) {
    console.warn('[APEX OAuth] Callback missing code or state');
    return null;
  }

  // Verify CSRF state
  const storedState  = sessionStorage.getItem('oauth_state');
  const codeVerifier = sessionStorage.getItem('pkce_code_verifier');
  sessionStorage.removeItem('oauth_state');
  sessionStorage.removeItem('pkce_code_verifier');

  console.log('[APEX OAuth] State check — stored:', storedState, 'received:', state);

  if (!storedState || state !== storedState) {
    throw new Error('OAuth state mismatch — possible CSRF attack. Please try again.');
  }

  if (!codeVerifier) {
    throw new Error('PKCE code_verifier missing from sessionStorage. Please try again.');
  }

  console.log('[APEX OAuth] Exchanging code for token via /api/deriv-token');
  console.log('[APEX OAuth] client_id:', DERIV_CLIENT_ID, 'redirect_uri:', REDIRECT_URI);

  // Try server-side proxy first (Vercel function)
  let resp: Response;
  try {
    resp = await fetch('/api/deriv-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        code_verifier: codeVerifier,
        redirect_uri: REDIRECT_URI,
        client_id: DERIV_CLIENT_ID,
      }),
    });
  } catch (fetchErr) {
    // /api/deriv-token not available (local dev without Vercel) — try direct
    console.warn('[APEX OAuth] /api/deriv-token unavailable, trying direct:', fetchErr);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: DERIV_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
    });
    resp = await fetch('https://auth.deriv.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  const responseText = await resp.text();
  console.log('[APEX OAuth] Token exchange response:', resp.status, responseText);

  if (!resp.ok) {
    throw new Error(`Token exchange failed (${resp.status}): ${responseText}`);
  }

  let data: OAuthResult;
  try {
    data = JSON.parse(responseText);
  } catch {
    throw new Error(`Invalid token response: ${responseText}`);
  }

  if (!data.access_token) {
    throw new Error(`No access_token in response: ${responseText}`);
  }

  console.log('[APEX OAuth] Token exchange successful, token type:', data.token_type);
  return data;
}
