export type DerivSymbol = '1HZ10V' | '1HZ25V' | '1HZ50V' | '1HZ75V' | '1HZ100V';

export type DerivAuthState = 'disconnected' | 'connecting' | 'authorizing' | 'connected' | 'error';

export interface DerivAccount {
  loginid: string;
  currency: string;
  balance: number;
  is_virtual: boolean;
}

export interface DerivTick {
  symbol: string;
  quote: number;
  epoch: number;
}

export interface DerivTradeResult {
  contract_id: number;
  buy_price: number;
  entry_price: number;
  status: 'open' | 'won' | 'lost';
  payout: number;
  profit: number;
}

export interface DerivProposal {
  id: string;
  ask_price: number;
  payout: number;
  spot: number;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: string) => void;
};

let ws: WebSocket | null = null;
let reqId = 1;
const pending = new Map<number, PendingRequest>();
const tickCallbacks = new Map<string, (tick: DerivTick) => void>();
const contractCallbacks = new Map<number, (result: DerivTradeResult) => void>();
let authState: DerivAuthState = 'disconnected';
let authToken: string | null = null;
let appId: string | null = null;
let accountInfo: DerivAccount | null = null;
const stateListeners = new Set<(state: DerivAuthState) => void>();
const accountListeners = new Set<(account: DerivAccount | null) => void>();

export function getAuthState() { return authState; }
export function getAccountInfo() { return accountInfo; }

export function onAuthStateChange(cb: (state: DerivAuthState) => void) {
  stateListeners.add(cb);
  cb(authState);
  return () => { stateListeners.delete(cb); };
}

export function onAccountChange(cb: (account: DerivAccount | null) => void) {
  accountListeners.add(cb);
  cb(accountInfo);
  return () => { accountListeners.delete(cb); };
}

function setAuthState(state: DerivAuthState) {
  authState = state;
  stateListeners.forEach((cb) => cb(state));
}

function setAccountInfo(account: DerivAccount | null) {
  accountInfo = account;
  accountListeners.forEach((cb) => cb(account));
}

function isPatToken(token: string): boolean {
  return token.startsWith('pat_');
}

function isLegacyAppId(id: string): boolean {
  return /^\d+$/.test(id);
}

async function getOptionsAccounts(token: string, app: string): Promise<{ id: string; currency: string; balance: number; is_virtual: boolean; account_type: string }[]> {
  const response = await fetch('https://api.derivws.com/trading/v1/options/accounts', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Deriv-App-ID': app,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to get accounts (${response.status})${text ? ': ' + text : ''}`);
  }
  const data = await response.json();
  const accounts = data.data ?? data.accounts ?? [];
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error('No trading accounts found for this token');
  }
  return accounts.map((a: Record<string, unknown>) => ({
    id: String(a.id ?? a.loginid ?? a.account_id ?? ''),
    currency: String(a.currency ?? 'USD'),
    balance: Number(a.balance ?? 0),
    is_virtual: Boolean(a.is_virtual ?? a.demo ?? (a.account_type === 'demo')),
    account_type: String(a.account_type ?? 'demo'),
  }));
}

async function getOtpWebSocketUrl(token: string, app: string, accountId: string): Promise<string> {
  const response = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${accountId}/otp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Deriv-App-ID': app,
      'Content-Type': 'application/json',
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to get WebSocket URL (${response.status})${text ? ': ' + text : ''}`);
  }
  const data = await response.json();
  const url = data.data?.url ?? data.url;
  if (!url) throw new Error('No WebSocket URL in OTP response');
  return String(url);
}

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    try {
      const socket = new WebSocket(url);
      const timeout = setTimeout(() => {
        reject(new Error('WebSocket connection timed out'));
      }, 15000);
      socket.onopen = () => {
        clearTimeout(timeout);
        socket.onopen = null;
        socket.onerror = null;
        resolve(socket);
      };
      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('WebSocket connection failed'));
      };
    } catch {
      reject(new Error('Could not open WebSocket'));
    }
  });
}

function handleMessage(event: MessageEvent) {
  const data = JSON.parse(event.data as string);
  const pendingReq = data.req_id ? pending.get(data.req_id) : null;

  if (data.error) {
    if (pendingReq) {
      pendingReq.reject(data.error.message);
      pending.delete(data.req_id);
    }
    return;
  }

  if (pendingReq) {
    pendingReq.resolve(data);
    pending.delete(data.req_id);
  }

  if (data.msg_type === 'balance' && data.balance) {
    if (accountInfo) {
      const updated = { ...accountInfo, balance: data.balance.balance, currency: data.balance.currency ?? accountInfo.currency };
      setAccountInfo(updated);
    }
  }

  if (data.msg_type === 'tick' && data.tick) {
    const cb = tickCallbacks.get(data.tick.symbol);
    if (cb) cb({ symbol: data.tick.symbol, quote: data.tick.quote, epoch: data.tick.epoch });
  }

  if (data.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
    const poc = data.proposal_open_contract;
    const cb = contractCallbacks.get(poc.contract_id);
    if (cb) {
      const status = poc.is_sold ? (poc.status === 'won' ? 'won' : 'lost') : 'open';
      cb({
        contract_id: poc.contract_id,
        buy_price: poc.buy_price,
        entry_price: poc.entry_spot ?? 0,
        status,
        payout: poc.payout ?? 0,
        profit: poc.profit ?? 0,
      });
    }
  }
}

async function send<T = unknown>(payload: Record<string, unknown>): Promise<T> {
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket not connected');
  const id = reqId++;
  const message = { ...payload, req_id: id };
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    ws!.send(JSON.stringify(message));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject('Request timed out');
      }
    }, 15000);
  });
}

export async function authorize(token: string, app: string): Promise<DerivAccount> {
  authToken = token;
  appId = app;
  setAuthState('connecting');

  try {
    if (isPatToken(token) || !isLegacyAppId(app)) {
      // PAT flow: REST -> OTP -> Options WebSocket
      const accounts = await getOptionsAccounts(token, app);
      const account = accounts[0];
      const wsUrl = await getOtpWebSocketUrl(token, app, account.id);

      const socket = await connectWs(wsUrl);
      if (ws) { ws.close(); ws = null; }
      ws = socket;
      ws.onmessage = handleMessage;
      ws.onclose = () => {
        ws = null;
        setAuthState('disconnected');
        setAccountInfo(null);
      };

      setAuthState('connected');
      const derivAccount: DerivAccount = {
        loginid: account.id,
        currency: account.currency,
        balance: account.balance,
        is_virtual: account.is_virtual,
      };
      setAccountInfo(derivAccount);

      // Subscribe to balance updates
      void send({ balance: 1, subscribe: 1 }).catch(() => {});

      return derivAccount;
    } else {
      // Legacy flow: authorize via WebSocket
      const url = `wss://ws.derivws.com/websockets/v2?app_id=${app}`;
      const socket = await connectWs(url);
      if (ws) { ws.close(); ws = null; }
      ws = socket;
      ws.onmessage = handleMessage;
      ws.onclose = () => {
        ws = null;
        setAuthState('disconnected');
        setAccountInfo(null);
      };

      setAuthState('authorizing');
      const data = await send<{ authorize?: { loginid: string; currency: string; balance: number; is_virtual: boolean }; error?: { message: string } }>({ authorize: token });
      if (data.authorize) {
        setAuthState('connected');
        const account: DerivAccount = {
          loginid: data.authorize.loginid,
          currency: data.authorize.currency,
          balance: data.authorize.balance,
          is_virtual: data.authorize.is_virtual,
        };
        setAccountInfo(account);
        return account;
      }
      setAuthState('error');
      throw data.error?.message ?? 'Authorization failed';
    }
  } catch (err) {
    setAuthState('error');
    throw err;
  }
}

export function disconnect() {
  authToken = null;
  appId = null;
  setAuthState('disconnected');
  setAccountInfo(null);
  tickCallbacks.clear();
  contractCallbacks.clear();
  pending.clear();
  if (ws) {
    ws.close();
    ws = null;
  }
}

export async function getProposal(params: {
  symbol: DerivSymbol;
  contract_type: 'CALL' | 'PUT';
  stake: number;
  duration: number;
}): Promise<DerivProposal> {
  const payload: Record<string, unknown> = {
    proposal: 1,
    amount: params.stake,
    basis: 'stake',
    contract_type: params.contract_type,
    currency: 'USD',
    duration: params.duration,
    duration_unit: 't',
    symbol: params.symbol,
  };
  // Options API requires underlying_symbol instead of symbol
  if (authToken && isPatToken(authToken)) {
    payload.underlying_symbol = params.symbol;
    delete payload.symbol;
  }
  const data = await send<{ proposal?: { id: string; ask_price: number; payout: number; spot: number }; error?: { message: string } }>(payload);
  if (data.proposal) return { id: data.proposal.id, ask_price: data.proposal.ask_price, payout: data.proposal.payout, spot: data.proposal.spot };
  throw data.error?.message ?? 'Could not get proposal';
}

export async function buyContract(proposalId: string, price: number): Promise<{ contract_id: number; buy_price: number }> {
  const data = await send<{ buy?: { contract_id: number; buy_price: number }; error?: { message: string } }>({
    buy: proposalId,
    price,
  });
  if (data.buy) return { contract_id: data.buy.contract_id, buy_price: data.buy.buy_price };
  throw data.error?.message ?? 'Buy failed';
}

export async function subscribeContract(contractId: number, cb: (result: DerivTradeResult) => void): Promise<void> {
  contractCallbacks.set(contractId, cb);
  await send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
}

export async function executeTrade(params: {
  symbol: DerivSymbol;
  contract_type: 'CALL' | 'PUT';
  stake: number;
  duration: number;
}): Promise<{ proposal: DerivProposal; contractId: number; buyPrice: number; entryPrice: number }> {
  const proposal = await getProposal(params);
  const buy = await buyContract(proposal.id, proposal.ask_price);
  return { proposal, contractId: buy.contract_id, buyPrice: buy.buy_price, entryPrice: proposal.spot };
}

export function subscribeTicks(symbol: DerivSymbol, cb: (tick: DerivTick) => void): () => void {
  tickCallbacks.set(symbol, cb);
  void send({ ticks: symbol, subscribe: 1 });
  return () => {
    tickCallbacks.delete(symbol);
    void send({ forget_all: 'ticks' });
  };
}

export function getBalance(): number {
  return accountInfo?.balance ?? 0;
}

export function isLive(): boolean {
  return authState === 'connected' && !!authToken;
}

export const symbolMap: Record<string, DerivSymbol> = {
  'Volatility 10 Index': '1HZ10V',
  'Volatility 25 Index': '1HZ25V',
  'Volatility 50 Index': '1HZ50V',
  'Volatility 75 Index': '1HZ75V',
  'Volatility 100 Index': '1HZ100V',
};

export const reverseSymbolMap: Record<string, string> = Object.fromEntries(
  Object.entries(symbolMap).map(([k, v]) => [v, k]),
);
