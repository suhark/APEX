/**
 * Deriv OAuth 2.0 + PKCE implementation
 * https://auth.deriv.com/oauth2/auth
 *
 * Uses the Authorization Code flow with PKCE — safe for SPAs
 * because no client_secret is required, only the code_verifier.
 */

const AUTH_ENDPOINT  = 'https://auth.deriv.com/oauth2/auth';
const TOKEN_ENDPOINT = 'https://auth.deriv.com/oauth2/token';

// Your new Deriv OAuth2 client_id — update when you have it
export const DERIV_CLIENT_ID = import.meta.env.VITE_DERIV_CLIENT_ID ?? '';
// Legacy app_id for the WebSocket connection (still needed after token exchange)
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

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Redirect the user to Deriv's OAuth login page.
 * Stores PKCE verifier + state in sessionStorage before redirecting.
 */
export async function redirectToDerivLogin(): Promise<void> {
  const { verifier, challenge } = await generatePKCE();
  const state = generateState();

  sessionStorage.setItem('pkce_code_verifier', verifier);
  sessionStorage.setItem('oauth_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: DERIV_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'trade account_manage payment',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(DERIV_LEGACY_APP_ID ? { app_id: DERIV_LEGACY_APP_ID } : {}),
  });

  window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Redirect the user to Deriv's OAuth sign-up page.
 */
export async function redirectToDerivSignup(): Promise<void> {
  const { verifier, challenge } = await generatePKCE();
  const state = generateState();

  sessionStorage.setItem('pkce_code_verifier', verifier);
  sessionStorage.setItem('oauth_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: DERIV_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'trade account_manage payment',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'registration',
    ...(DERIV_LEGACY_APP_ID ? { app_id: DERIV_LEGACY_APP_ID } : {}),
  });

  window.location.href = `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface OAuthResult {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Handle the /callback redirect from Deriv.
 * Verifies state, exchanges the code for a token using PKCE.
 * Returns the access_token on success, throws on failure.
 */
export async function handleOAuthCallback(): Promise<OAuthResult | null> {
  if (window.location.pathname !== '/callback') return null;

  const params = new URLSearchParams(window.location.search);
  const code  = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  // Clean URL immediately
  window.history.replaceState({}, '', '/');

  if (error) {
    throw new Error(`Deriv OAuth error: ${params.get('error_description') ?? error}`);
  }

  if (!code || !state) return null;

  // Verify CSRF state
  const storedState    = sessionStorage.getItem('oauth_state');
  const codeVerifier   = sessionStorage.getItem('pkce_code_verifier');
  sessionStorage.removeItem('oauth_state');
  sessionStorage.removeItem('pkce_code_verifier');

  if (!storedState || state !== storedState) {
    throw new Error('OAuth state mismatch — possible CSRF attack. Please try again.');
  }

  if (!codeVerifier) {
    throw new Error('PKCE verifier missing. Please try connecting again.');
  }

  // Exchange authorization code for access token
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     DERIV_CLIENT_ID,
    code,
    code_verifier: codeVerifier,
    redirect_uri:  REDIRECT_URI,
  });

  const resp = await fetch(TOKEN_ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const data: OAuthResult = await resp.json();
  return data;
}
