export type DerivSymbol = '1HZ10V' | '1HZ25V' | '1HZ50V' | '1HZ75V' | '1HZ100V';

export type DerivAuthState = 'disconnected' | 'connecting' | 'authorizing' | 'connected' | 'error';

export interface DerivAccount {
  loginid: string;
  currency: string;
  balance: number;
  is_virtual: boolean;
  token?: string;
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
let availableAccounts: DerivAccount[] = [];
let pingInterval: number | null = null;
let reconnectTimer: number | null = null;
let isManualDisconnect = false;

function startKeepAlive() {
  stopKeepAlive();
  pingInterval = window.setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      send({ ping: 1 }).catch(() => {});
    }
  }, 25000);
}

function stopKeepAlive() {
  if (pingInterval !== null) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

function handleSocketClose() {
  ws = null;
  stopKeepAlive();
  setAuthState('disconnected');
  setAccountInfo(null);

  if (!isManualDisconnect && authToken && appId) {
    if (reconnectTimer === null) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (!isManualDisconnect && authToken && appId && authState === 'disconnected') {
          console.log('[Deriv WebSocket] Reconnecting after connection drop…');
          authorize(authToken, appId).catch((err) => {
            console.warn('[Deriv WebSocket] Auto-reconnect failed:', err);
          });
        }
      }, 3000);
    }
  }
}

function attachSocket(socket: WebSocket) {
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.close();
    ws = null;
  }
  ws = socket;
  ws.onmessage = handleMessage;
  ws.onclose = handleSocketClose;
  startKeepAlive();
}

const stateListeners = new Set<(state: DerivAuthState) => void>();
const accountListeners = new Set<(account: DerivAccount | null) => void>();
const availableAccountsListeners = new Set<(accounts: DerivAccount[]) => void>();

export function getAuthState() { return authState; }
export function getAccountInfo() { return accountInfo; }
export function getAvailableAccounts() { return availableAccounts; }

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

export function onAvailableAccountsChange(cb: (accounts: DerivAccount[]) => void) {
  availableAccountsListeners.add(cb);
  cb(availableAccounts);
  return () => { availableAccountsListeners.delete(cb); };
}

function setAuthState(state: DerivAuthState) {
  authState = state;
  stateListeners.forEach((cb) => cb(state));
}

function setAccountInfo(account: DerivAccount | null) {
  accountInfo = account;
  accountListeners.forEach((cb) => cb(account));
}

export function applyBalanceDelta(delta: number) {
  if (!accountInfo) return;
  const nextBalance = Number((accountInfo.balance + delta).toFixed(2));
  const updated = { ...accountInfo, balance: nextBalance };
  setAccountInfo(updated);
  if (availableAccounts.length > 0) {
    setAvailableAccounts(
      availableAccounts.map((account) =>
        account.loginid === updated.loginid ? { ...account, balance: nextBalance } : account
      )
    );
  }
}

function setAvailableAccounts(accounts: DerivAccount[]) {
  availableAccounts = accounts;
  availableAccountsListeners.forEach((cb) => cb(accounts));
}

export function isAccountVirtual(account: Record<string, unknown>, id?: string): boolean {
  const loginid = String(id ?? account.id ?? account.loginid ?? account.account_id ?? '').toUpperCase();
  if (loginid.startsWith('VR')) return true;
  if (account.is_virtual === true || account.is_virtual === 1 || account.is_virtual === '1') return true;
  if (account.is_virtual === false || account.is_virtual === 0 || account.is_virtual === '0') return false;
  const type = String(account.account_type ?? account.type ?? '').toLowerCase();
  if (type === 'demo' || type === 'virtual') return true;
  if (type === 'real') return false;
  if (loginid.length >= 2 && !loginid.startsWith('VR')) return false;
  return false;
}

function isPatToken(token: string): boolean {
  return token.startsWith('pat_');
}

function isLegacyAppId(id: string): boolean {
  return /^\d+$/.test(id);
}

async function getOptionsAccounts(token: string, app: string): Promise<DerivAccount[]> {
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
  return accounts.map((a: Record<string, unknown>) => {
    const id = String(a.id ?? a.loginid ?? a.account_id ?? '');
    const isVirtual = isAccountVirtual(a, id);
    return {
      loginid: id,
      currency: String(a.currency ?? 'USD'),
      balance: Number(a.balance ?? 0),
      is_virtual: isVirtual,
    };
  });
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

  if (data.msg_type === 'ping' || data.ping === 'pong') {
    if (pendingReq) {
      pendingReq.resolve(data);
      pending.delete(data.req_id);
    }
    return;
  }

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
    const cid = Number(poc.contract_id);
    const cb = contractCallbacks.get(cid);
    if (cb) {
      const isFinished =
        poc.status === 'won' ||
        poc.status === 'lost' ||
        poc.is_sold === 1 ||
        poc.is_sold === true ||
        poc.is_expired === 1 ||
        poc.is_settleable === 1;

      let status: 'open' | 'won' | 'lost' = 'open';
      if (isFinished) {
        if (poc.status === 'won') status = 'won';
        else if (poc.status === 'lost') status = 'lost';
        else {
          const profit = Number(poc.profit ?? 0);
          status = profit >= 0 ? 'won' : 'lost';
        }
      }

      cb({
        contract_id: cid,
        buy_price: Number(poc.buy_price ?? 0),
        entry_price: Number(poc.entry_spot ?? 0),
        status,
        payout: Number(poc.payout ?? 0),
        profit: Number(poc.profit ?? 0),
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
  isManualDisconnect = false;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  authToken = token;
  appId = app;
  setAuthState('connecting');

  try {
    if (isPatToken(token) || !isLegacyAppId(app)) {
      // PAT flow: REST -> OTP -> Options WebSocket
      const accounts = await getOptionsAccounts(token, app);
      setAvailableAccounts(accounts);

      // Default to Demo account for safety if available, otherwise first account
      const demoAccount = accounts.find((a) => a.is_virtual);
      const selectedAccount = demoAccount || accounts[0];

      const wsUrl = await getOtpWebSocketUrl(token, app, selectedAccount.loginid);
      const socket = await connectWs(wsUrl);
      attachSocket(socket);

      setAuthState('connected');
      setAccountInfo(selectedAccount);

      // Subscribe to balance updates
      void send({ balance: 1, subscribe: 1 }).catch(() => {});

      return selectedAccount;
    } else {
      // Legacy flow: authorize via WebSocket
      const url = `wss://ws.derivws.com/websockets/v2?app_id=${app}`;
      const socket = await connectWs(url);
      attachSocket(socket);

      setAuthState('authorizing');
      const data = await send<{
        authorize?: {
          loginid: string;
          currency: string;
          balance: number;
          is_virtual: boolean | number;
          account_list?: Array<Record<string, unknown>>;
        };
        error?: { message: string };
      }>({ authorize: token });

      if (data.authorize) {
        const primaryVirtual = isAccountVirtual(data.authorize as Record<string, unknown>, data.authorize.loginid);
        const primaryAccount: DerivAccount = {
          loginid: data.authorize.loginid,
          currency: data.authorize.currency,
          balance: Number(data.authorize.balance ?? 0),
          is_virtual: primaryVirtual,
        };

        let accountsList: DerivAccount[] = [primaryAccount];
        if (Array.isArray(data.authorize.account_list) && data.authorize.account_list.length > 0) {
          accountsList = data.authorize.account_list.map((raw) => {
            const lid = String(raw.loginid ?? raw.id ?? '');
            const isVirt = isAccountVirtual(raw, lid);
            return {
              loginid: lid,
              currency: String(raw.currency ?? 'USD'),
              balance: lid === primaryAccount.loginid ? primaryAccount.balance : 0,
              is_virtual: isVirt,
            };
          });
          if (!accountsList.some((a) => a.loginid === primaryAccount.loginid)) {
            accountsList.unshift(primaryAccount);
          }
        }

        setAvailableAccounts(accountsList);
        setAuthState('connected');
        setAccountInfo(primaryAccount);

        void send({ balance: 1, subscribe: 1 }).catch(() => {});
        return primaryAccount;
      }
      setAuthState('error');
      throw data.error?.message ?? 'Authorization failed';
    }
  } catch (err) {
    setAuthState('error');
    throw err;
  }
}

export async function switchAccount(loginid: string): Promise<DerivAccount> {
  const target = availableAccounts.find((a) => a.loginid === loginid);
  if (!target) throw new Error(`Account ${loginid} not found`);
  if (!authToken || !appId) throw new Error('Deriv is not connected');

  if (isPatToken(authToken) || !isLegacyAppId(appId)) {
    const wsUrl = await getOtpWebSocketUrl(authToken, appId, target.loginid);
    const socket = await connectWs(wsUrl);
    attachSocket(socket);

    setAccountInfo(target);
    contractCallbacks.clear();
    void send({ balance: 1, subscribe: 1 }).catch(() => {});
    return target;
  } else {
    setAccountInfo(target);
    return target;
  }
}

export function disconnect() {
  isManualDisconnect = true;
  stopKeepAlive();
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  authToken = null;
  appId = null;
  setAuthState('disconnected');
  setAccountInfo(null);
  setAvailableAccounts([]);
  tickCallbacks.clear();
  contractCallbacks.clear();
  pending.clear();
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
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
    currency: accountInfo?.currency || 'USD',
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

export function subscribeContract(contractId: number, cb: (result: DerivTradeResult) => void): () => void {
  const normalizedId = Number(contractId);
  let resolved = false;
  let pollInterval: number | null = null;
  let safetyTimeout: number | null = null;

  const processPoc = (poc: Record<string, unknown>) => {
    if (resolved) return;
    const isFinished =
      poc.status === 'won' ||
      poc.status === 'lost' ||
      poc.is_sold === 1 ||
      poc.is_sold === true ||
      poc.is_expired === 1 ||
      poc.is_settleable === 1;

    let status: 'open' | 'won' | 'lost' = 'open';
    if (isFinished) {
      if (poc.status === 'won') status = 'won';
      else if (poc.status === 'lost') status = 'lost';
      else {
        const profit = Number(poc.profit ?? 0);
        status = profit >= 0 ? 'won' : 'lost';
      }
    }

    const tradeResult: DerivTradeResult = {
      contract_id: normalizedId,
      buy_price: Number(poc.buy_price ?? 0),
      entry_price: Number(poc.entry_spot ?? 0),
      status,
      payout: Number(poc.payout ?? 0),
      profit: Number(poc.profit ?? 0),
    };

    if (status === 'won' || status === 'lost') {
      resolved = true;
      if (pollInterval) clearInterval(pollInterval);
      if (safetyTimeout) clearTimeout(safetyTimeout);
      contractCallbacks.delete(normalizedId);
      // Refresh balance after contract settles
      void send({ balance: 1 }).catch(() => {});
      cb(tradeResult);
    }
  };

  contractCallbacks.set(normalizedId, (res: DerivTradeResult) => {
    if (res.status === 'won' || res.status === 'lost') {
      if (!resolved) {
        resolved = true;
        if (pollInterval) clearInterval(pollInterval);
        if (safetyTimeout) clearTimeout(safetyTimeout);
        contractCallbacks.delete(normalizedId);
        void send({ balance: 1 }).catch(() => {});
        cb(res);
      }
    }
  });

  // 1. Send subscription
  send<{ proposal_open_contract?: Record<string, unknown> }>({
    proposal_open_contract: 1,
    contract_id: normalizedId,
    subscribe: 1,
  })
    .then((res) => {
      if (res?.proposal_open_contract) {
        processPoc(res.proposal_open_contract);
      }
    })
    .catch(() => {});

  // 2. Active 1.2-second polling to ensure we never miss completion
  pollInterval = window.setInterval(async () => {
    if (resolved || !ws || ws.readyState !== WebSocket.OPEN) {
      if (pollInterval) clearInterval(pollInterval);
      return;
    }
    try {
      const data = await send<{ proposal_open_contract?: Record<string, unknown> }>({
        proposal_open_contract: 1,
        contract_id: normalizedId,
      });
      if (data?.proposal_open_contract) {
        processPoc(data.proposal_open_contract);
      }
    } catch {}
  }, 1200);

  // 3. Safety timeout after 18 seconds
  safetyTimeout = window.setTimeout(async () => {
    if (resolved) return;
    if (pollInterval) clearInterval(pollInterval);
    try {
      const data = await send<{ proposal_open_contract?: Record<string, unknown> }>({
        proposal_open_contract: 1,
        contract_id: normalizedId,
      });
      if (data?.proposal_open_contract) {
        processPoc(data.proposal_open_contract);
      }
    } catch {}
  }, 18000);

  return () => {
    resolved = true;
    if (pollInterval) clearInterval(pollInterval);
    if (safetyTimeout) clearTimeout(safetyTimeout);
    contractCallbacks.delete(normalizedId);
  };
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

export function isConnected(): boolean {
  return authState === 'connected';
}

export function isRealAccount(): boolean {
  return authState === 'connected' && !!accountInfo && !accountInfo.is_virtual;
}

export function isLive(): boolean {
  return authState === 'connected' && !!accountInfo && !accountInfo.is_virtual;
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
