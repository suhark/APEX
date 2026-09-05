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

function getWs(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(ws);
  if (ws && ws.readyState === WebSocket.CONNECTING) {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (ws && ws.readyState === WebSocket.OPEN) resolve(ws);
        else if (ws && ws.readyState === WebSocket.CLOSED) reject('WebSocket closed');
        else setTimeout(check, 100);
      };
      check();
    });
  }
  return new Promise((resolve, reject) => {
    try {
      ws = new WebSocket('wss://ws.derivws.com/websockets/v2?app_id=1089');
      ws.onopen = () => { resolve(ws!); };
      ws.onclose = () => {
        ws = null;
        setAuthState('disconnected');
        setAccountInfo(null);
      };
      ws.onerror = () => {
        if (ws) ws.close();
        reject('WebSocket connection failed');
      };
      ws.onmessage = handleMessage;
    } catch {
      reject('Could not open WebSocket');
    }
  });
}

function handleMessage(event: MessageEvent) {
  const data = JSON.parse(event.data as string);
  const pendingReq = data.req_id ? pending.get(data.req_id) : null;

  if (data.error) {
    if (pendingReq) {
      pending.reject(data.error.message);
      pending.delete(data.req_id);
    }
    return;
  }

  if (pendingReq) {
    pendingReq.resolve(data);
    pending.delete(data.req_id);
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
  const socket = await getWs();
  const id = reqId++;
  const message = { ...payload, req_id: id };
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    socket.send(JSON.stringify(message));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject('Request timed out');
      }
    }, 15000);
  });
}

export async function authorize(token: string): Promise<DerivAccount> {
  authToken = token;
  setAuthState('connecting');
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

export function disconnect() {
  authToken = null;
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
  const data = await send<{ proposal?: { id: string; ask_price: number; payout: number; spot: number }; error?: { message: string } }>({
    proposal: 1,
    amount: params.stake,
    basis: 'stake',
    contract_type: params.contract_type,
    currency: 'USD',
    duration: params.duration,
    duration_unit: 't',
    symbol: params.symbol,
  });
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
