import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient, type User } from '@supabase/supabase-js';
import { Activity, AlertCircle, AlertTriangle, ArrowDownRight, ArrowUpRight, ChartBar as BarChart3, Bot, Check, CheckCircle2, ChevronRight, Clock3, Code as Code2, FileText, Globe, LayoutDashboard, ChartLine as LineChart, ListFilter, LogOut, Menu, Pause, Play, Plus, RefreshCw, Rocket, Settings2, ShieldCheck, Sparkles, Target, Trash2, TrendingDown, TrendingUp, User as UserIcon, Wallet, X, Zap } from 'lucide-react';
import { useDerivConnection } from './use-deriv';
import { DerivConnectionPanel, DerivStatusBadge } from './deriv-connection';
import { applyBalanceDelta, executeTrade, getAccountInfo, getBalance, subscribeContract, symbolMap, isLive as derivIsLive, type DerivSymbol, type DerivTradeResult } from './deriv-client';
import { AuthModal } from './auth-modal';
import { ManualTrader } from './manual-trader';
import { LandingPage } from './landing-page';
import { PolicyModal, type PolicyTab } from './policy-modal';

const DEFAULT_APP_ID = '34khJS0KsSP29i9G8kCiJ';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? '',
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
);

type Page = 'dashboard' | 'bots' | 'manual' | 'builder' | 'signals' | 'bulk' | 'quick' | 'apex' | 'record' | 'settings';
type Trade = { id: string; user_id?: string | null; instrument: string; direction: string; stake: number; result: string; profit: number; source: string; bot_name?: string; entry_price: number; exit_price?: number; created_at: string; execution_context?: 'synthetic' | 'deriv'; deriv_loginid?: string | null };
type BotRow = { id: string; name: string; description: string; risk: string; active: boolean; demo_only: boolean; total_trades: number; wins: number; pnl: number; won_amount: number; lost_amount: number; benchmark_win_rate?: number; benchmark_trades?: number };
type Workspace = { id: string; user_id?: string | null; mode: string; balance: number; starting_balance: number; loss_limit: number; deriv_connected?: boolean; deriv_loginid?: string | null; deriv_is_virtual?: boolean | null; deriv_balance?: number | null; active_bots?: string[] | null };

type TradeAlert = {
  id: number;
  status: 'won' | 'lost';
  direction: string;
  instrument: string;
  profit: number;
  stake: number;
  botName?: string;
  accountType: 'Demo' | 'Real';
  sessionLossAfter?: number;
};

const instruments = ['Volatility 10 Index', 'Volatility 25 Index', 'Volatility 50 Index', 'Volatility 75 Index', 'Volatility 100 Index'];
const nav: { key: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { key: 'bots', label: 'Free Bots', icon: Bot },
  { key: 'manual', label: 'Manual Trader', icon: Target }, { key: 'builder', label: 'Bot Builder', icon: Code2 },
  { key: 'signals', label: 'Signal AI', icon: Sparkles }, { key: 'bulk', label: 'Bulk Trader', icon: ListFilter },
  { key: 'quick', label: 'Quick Bot', icon: Zap }, { key: 'apex', label: 'Apex Bot', icon: Rocket },
  { key: 'record', label: 'Track Record', icon: LineChart }, { key: 'settings', label: 'Settings', icon: Settings2 },
];

function priceFor(index: number, tick: number) { return Number((100 + Math.sin((tick + index * 7) / 4) * 2.5 + Math.cos((tick + index) / 8) * 1.4).toFixed(2)); }
function money(value: number) { return `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`; }
function timeAgo(date: string) { const minutes = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000)); return minutes < 1 ? 'just now' : `${minutes}m ago`; }
function getStatsContext(derivConnected: boolean, account: { loginid: string } | null): string {
  if (derivConnected && account) return `deriv_${account.loginid}`;
  return 'synthetic';
}

function getStatsContextLabel(context: string, derivConnected: boolean, account: { loginid: string; is_virtual?: boolean } | null): string {
  if (context.startsWith('deriv_') && account) {
    return `${account.is_virtual ? 'Deriv Demo' : 'Deriv Real'} (${account.loginid})`;
  }
  if (context.startsWith('deriv_')) return `Deriv (${context.replace('deriv_', '')})`;
  return derivConnected ? 'Synthetic (archived)' : 'Synthetic workspace';
}

function inferTradeContext(trade: Trade): string {
  if (trade.execution_context === 'deriv') {
    return trade.deriv_loginid ? `deriv_${trade.deriv_loginid}` : 'deriv_unknown';
  }
  if (trade.execution_context === 'synthetic') return 'synthetic';
  if (trade.id.startsWith('deriv_')) {
    return trade.deriv_loginid ? `deriv_${trade.deriv_loginid}` : 'deriv_unknown';
  }
  return 'synthetic';
}

function filterTradesByContext(trades: Trade[], context: string): Trade[] {
  return trades.filter((trade) => {
    const tradeContext = inferTradeContext(trade);
    if (context === 'synthetic') return tradeContext === 'synthetic';
    if (context.startsWith('deriv_')) {
      return tradeContext === context || tradeContext === 'deriv_unknown';
    }
    return tradeContext === context;
  });
}

function getSessionStartKey(userId: string) { return `apex_session_start_bal_${userId}`; }
function getSessionStartAtKey(userId: string) { return `apex_session_start_at_${userId}`; }

function restoreSessionBaseline(userId: string) {
  let saved = sessionStorage.getItem(getSessionStartKey(userId));
  let savedAt = sessionStorage.getItem(getSessionStartAtKey(userId));
  if (!saved) {
    saved = sessionStorage.getItem(`apex_session_start_bal_${userId}_undefined`);
    savedAt = savedAt || sessionStorage.getItem(`apex_session_start_at_${userId}_undefined`);
  }
  return {
    balance: saved && !Number.isNaN(Number(saved)) ? Number(saved) : null,
    startedAt: savedAt || null,
  };
}

function computeSessionLoss(
  sessionStart: number,
  currentBalance: number,
  trades: Trade[] = [],
  sessionStartedAt: string | null = null,
) {
  const balanceLoss = Math.max(0, Number((sessionStart - currentBalance).toFixed(2)));
  if (!sessionStartedAt) return balanceLoss;

  const startMs = new Date(sessionStartedAt).getTime();
  const sessionTrades = trades.filter(
    (trade) =>
      (trade.result === 'won' || trade.result === 'lost') &&
      new Date(trade.created_at).getTime() >= startMs - 1000,
  );
  if (sessionTrades.length === 0) return balanceLoss;

  const netPnl = sessionTrades.reduce((sum, trade) => sum + Number(trade.profit || 0), 0);
  const tradeDrawdown = Math.max(0, Number((-netPnl).toFixed(2)));
  return Math.max(balanceLoss, tradeDrawdown);
}

function resolveSessionStartBalance(
  sessionStartingBalance: number | null,
  sessionStartingBalRef: number | null,
  derivConnected: boolean,
  workspace: Workspace | null,
  activeBalance: number,
) {
  if (sessionStartingBalance !== null) return sessionStartingBalance;
  if (sessionStartingBalRef !== null) return sessionStartingBalRef;
  if (derivConnected) return activeBalance;
  return workspace?.starting_balance ?? activeBalance;
}
function computeGuardPercent(used: number, limit: number) { if (limit <= 0) return 0; return Math.min(100, (used / limit) * 100); }

// ============================================================================
// Robust Multi-Layer Local Storage Helpers (Guarantees Stats Never Get Lost)
// ============================================================================
function getUserTradesKey(userId: string): string {
  return `apex_trades_${userId}`;
}

function loadUserTradesFromStorage(userId: string): Trade[] {
  try {
    const raw = localStorage.getItem(getUserTradesKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('Failed loading local trades:', err);
  }
  return [];
}

function saveUserTradesToStorage(userId: string, trades: Trade[]): void {
  try {
    localStorage.setItem(getUserTradesKey(userId), JSON.stringify(trades.slice(0, 300)));
  } catch (err) {
    console.warn('Failed saving local trades:', err);
  }
}

function getUserWorkspaceKey(userId: string): string {
  return `apex_workspace_${userId}`;
}

function loadUserWorkspaceFromStorage(userId: string): Partial<Workspace> | null {
  try {
    const raw = localStorage.getItem(getUserWorkspaceKey(userId));
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.warn('Failed loading local workspace:', err);
  }
  return null;
}

function saveUserWorkspaceToStorage(userId: string, ws: Workspace): void {
  try {
    localStorage.setItem(getUserWorkspaceKey(userId), JSON.stringify(ws));
  } catch (err) {
    console.warn('Failed saving local workspace:', err);
  }
}

function getUserSettingsKey(userId: string): string {
  return `apex_settings_${userId}`;
}

function loadUserSettings(userId: string): { allowBotLiveTrading?: boolean; maxBalancePercent?: number } {
  try {
    const raw = localStorage.getItem(getUserSettingsKey(userId));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveUserSettings(userId: string, settings: { allowBotLiveTrading: boolean; maxBalancePercent: number }): void {
  try {
    localStorage.setItem(getUserSettingsKey(userId), JSON.stringify(settings));
  } catch { /* ignore */ }
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [page, setPage] = useState<Page>('dashboard');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [bots, setBots] = useState<BotRow[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tick, setTick] = useState(8);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [tradeAlert, setTradeAlert] = useState<TradeAlert | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [policyTab, setPolicyTab] = useState<PolicyTab | null>(null);
  const deriv = useDerivConnection();

  // Prevent background scrolling when mobile sidebar is open
  useEffect(() => {
    if (mobileNav) {
      const orig = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = orig;
      };
    }
  }, [mobileNav]);

  const derivConnected = deriv.authState === 'connected' && deriv.account !== null;
  const isDerivReal = derivConnected && !deriv.account?.is_virtual;
  const isDerivDemo = derivConnected && Boolean(deriv.account?.is_virtual);
  const linkedRealAccount = deriv.accounts.find((a) => !a.is_virtual);
  const linkedDemoAccount = deriv.accounts.find((a) => a.is_virtual);
  const botPendingTradesRef = useRef<Set<string>>(new Set());

  // Safety & Arming controls
  const [liveArmed, setLiveArmed] = useState(false);
  const [allowBotLiveTrading, setAllowBotLiveTradingState] = useState(false);
  const [maxBalancePercent, setMaxBalancePercentState] = useState(2);
  const sessionStartingBalRef = useRef<number | null>(null);
  const sessionStartAtRef = useRef<string | null>(null);
  const [sessionStartingBalance, setSessionStartingBalance] = useState<number | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);

  const syncSessionStartBalance = (balance: number) => {
    const startedAt = new Date().toISOString();
    sessionStartingBalRef.current = balance;
    sessionStartAtRef.current = startedAt;
    setSessionStartingBalance(balance);
    setSessionStartedAt(startedAt);
    const uid = userRef.current?.id || user?.id || 'guest';
    sessionStorage.setItem(getSessionStartKey(uid), String(balance));
    sessionStorage.setItem(getSessionStartAtKey(uid), startedAt);
  };

  const clearSessionStartBalance = () => {
    sessionStartingBalRef.current = null;
    sessionStartAtRef.current = null;
    setSessionStartingBalance(null);
    setSessionStartedAt(null);
    const uid = userRef.current?.id || user?.id || 'guest';
    sessionStorage.removeItem(getSessionStartKey(uid));
    sessionStorage.removeItem(getSessionStartAtKey(uid));
  };

  const resetSessionBaseline = () => {
    const baseline = deriv.account?.balance ?? workspace?.balance ?? workspace?.starting_balance ?? 0;
    syncSessionStartBalance(baseline);
    setNotice(`Session baseline reset to ${money(baseline)}. Loss counter cleared.`);
  };

  const setAllowBotLiveTrading = (allowed: boolean) => {
    setAllowBotLiveTradingState(allowed);
    if (userRef.current) {
      saveUserSettings(userRef.current.id, { allowBotLiveTrading: allowed, maxBalancePercent });
    }
  };

  const setMaxBalancePercent = (percent: number) => {
    setMaxBalancePercentState(percent);
    if (userRef.current) {
      saveUserSettings(userRef.current.id, { allowBotLiveTrading, maxBalancePercent: percent });
    }
  };

  // Auto-disarm live execution if disconnected or switched to Demo
  useEffect(() => {
    if (!derivConnected || isDerivDemo) {
      setLiveArmed(false);
    }
  }, [derivConnected, isDerivDemo]);

  // Track session starting balance for loss limit calculations (restored from sessionStorage across refresh)
  useEffect(() => {
    const uid = user?.id || 'guest';
    const restored = restoreSessionBaseline(uid);
    if (restored.balance !== null) {
      sessionStartingBalRef.current = restored.balance;
      setSessionStartingBalance(restored.balance);
    }
    if (restored.startedAt) {
      sessionStartAtRef.current = restored.startedAt;
      setSessionStartedAt(restored.startedAt);
    }
  }, [user]);

  useEffect(() => {
    if (deriv.account) {
      if (sessionStartingBalRef.current === null) {
        syncSessionStartBalance(deriv.account.balance);
      }
    } else if (workspace) {
      if (sessionStartingBalRef.current === null) {
        syncSessionStartBalance(workspace.starting_balance);
      }
    }
  }, [deriv.account, workspace, user]);

  const userRef = useRef<User | null>(null);
  userRef.current = user;

  // Immediate trade store updater
  const persistTrade = (newTrade: Trade) => {
    setTrades((prev) => {
      const next = [newTrade, ...prev.filter((t) => t.id !== newTrade.id)];
      const uid = userRef.current?.id || user?.id || 'guest';
      saveUserTradesToStorage(uid, next);
      return next;
    });
  };

  const updatePersistedTrade = (tradeId: string, patch: Partial<Trade>) => {
    setTrades((prev) => {
      const next = prev.map((t) => (t.id === tradeId ? { ...t, ...patch } : t));
      const uid = userRef.current?.id || user?.id || 'guest';
      saveUserTradesToStorage(uid, next);
      return next;
    });
  };

  const updateBotStatsFromTrade = (botName: string, profit: number, isWin: boolean) => {
    setBots((current) =>
      current.map((bot) => {
        if (bot.name !== botName) return bot;
        return {
          ...bot,
          total_trades: bot.total_trades + 1,
          wins: bot.wins + (isWin ? 1 : 0),
          pnl: Number((bot.pnl + profit).toFixed(2)),
          won_amount: Number((bot.won_amount + (isWin ? profit : 0)).toFixed(2)),
          lost_amount: Number((bot.lost_amount + (isWin ? 0 : Math.abs(profit))).toFixed(2)),
        };
      })
    );
  };

  const load = async (activeUser?: User | null) => {
    const currentUser = activeUser !== undefined ? activeUser : userRef.current;
    if (!currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);

    // 0. Load persisted user settings
    const userSettings = loadUserSettings(currentUser.id);
    if (userSettings.allowBotLiveTrading !== undefined) {
      setAllowBotLiveTradingState(userSettings.allowBotLiveTrading);
    }
    if (userSettings.maxBalancePercent !== undefined) {
      setMaxBalancePercentState(userSettings.maxBalancePercent);
    }

    let ws: Workspace | null = null;
    let wsLoaded = false;
    const localWs = loadUserWorkspaceFromStorage(currentUser.id);

    // 1. Fetch user-specific workspace
    try {
      const { data, error } = await supabase
        .from('trading_workspace')
        .select('*')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (!error && data) {
        ws = data as Workspace;
        wsLoaded = true;
      } else if (!error && !data) {
        // Create new isolated workspace for user
        const initWs = {
          user_id: currentUser.id,
          mode: 'demo',
          balance: 10000,
          starting_balance: 10000,
          loss_limit: 50,
        };
        const createResult = await supabase
          .from('trading_workspace')
          .insert(initWs)
          .select()
          .maybeSingle();

        if (!createResult.error && createResult.data) {
          ws = createResult.data as Workspace;
          wsLoaded = true;
        }
      } else if (error) {
        console.warn('Workspace user_id query fallback:', error.message);
      }
    } catch (e) {
      console.warn('Failed loading user workspace:', e);
    }

    if (!wsLoaded) {
      if (localWs) {
        ws = {
          id: localWs.id || `ws_${currentUser.id}`,
          user_id: currentUser.id,
          mode: localWs.mode || 'demo',
          balance: localWs.balance ?? 10000,
          starting_balance: localWs.starting_balance ?? 10000,
          loss_limit: localWs.loss_limit ?? 50,
          active_bots: localWs.active_bots || [],
        };
        wsLoaded = true;
      } else {
        // Fallback to legacy single workspace if migration not yet run
        const legacyWs = await supabase.from('trading_workspace').select('*').limit(1).maybeSingle();
        if (legacyWs.data) {
          ws = legacyWs.data as Workspace;
        } else {
          ws = {
            id: `ws_${currentUser.id}`,
            user_id: currentUser.id,
            mode: 'demo',
            balance: 10000,
            starting_balance: 10000,
            loss_limit: 50,
          };
        }
      }
    }

    if (localWs && ws) {
      ws = {
        ...ws,
        balance: localWs.balance ?? ws.balance,
        starting_balance: localWs.starting_balance ?? ws.starting_balance,
        loss_limit: localWs.loss_limit ?? ws.loss_limit,
      };
    }

    // 2. Load user-isolated trades (local storage first, merged with Supabase)
    const localTrades = loadUserTradesFromStorage(currentUser.id);
    let tradesData: Trade[] = localTrades;

    try {
      const { data, error } = await supabase
        .from('trading_trades')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(200);

      if (!error && data && Array.isArray(data)) {
        const tradeMap = new Map<string, Trade>();
        localTrades.forEach((t) => tradeMap.set(t.id, t));
        (data as Trade[]).forEach((t) => {
          const existing = tradeMap.get(t.id);
          if (!existing || existing.result === 'pending') {
            tradeMap.set(t.id, t);
          }
        });
        tradesData = Array.from(tradeMap.values()).sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        saveUserTradesToStorage(currentUser.id, tradesData);
      }
    } catch (e) {
      console.warn('Failed loading remote user trades, keeping local trades:', e);
    }

    // 3. Fetch bots library and isolate activation & stats strictly per user
    let botsData: BotRow[] = [];
    const botsResult = await supabase.from('trading_bots').select('*').order('name');
    if (botsResult.data) {
      let userActiveBots: string[] = [];
      const cached = localStorage.getItem(`apex_active_bots_${currentUser.id}`);
      if (cached) {
        try { userActiveBots = JSON.parse(cached); } catch { /* ignore */ }
      }
      if (userActiveBots.length === 0 && ws?.active_bots && Array.isArray(ws.active_bots)) {
        userActiveBots = ws.active_bots;
      }

      botsData = (botsResult.data as BotRow[]).map((bot) => {
        const userBotTrades = tradesData.filter(
          (t) => t.bot_name === bot.name && (t.result === 'won' || t.result === 'lost')
        );
        const botWins = userBotTrades.filter((t) => t.result === 'won').length;
        const wonAmount = userBotTrades
          .filter((t) => t.profit > 0)
          .reduce((sum, t) => sum + Number(t.profit || 0), 0);
        const lostAmount = userBotTrades
          .filter((t) => t.profit < 0)
          .reduce((sum, t) => sum + Math.abs(Number(t.profit || 0)), 0);
        const botPnl = userBotTrades.reduce((sum, t) => sum + Number(t.profit || 0), 0);

        return {
          ...bot,
          total_trades: userBotTrades.length,
          wins: botWins,
          pnl: Number(botPnl.toFixed(2)),
          won_amount: Number(wonAmount.toFixed(2)),
          lost_amount: Number(lostAmount.toFixed(2)),
          active: userActiveBots.includes(bot.name),
        };
      });
    }

    if (ws) {
      setWorkspace(ws);
      saveUserWorkspaceToStorage(currentUser.id, ws);
    }
    setBots(botsData);
    setTrades(tradesData);
    setLoading(false);

    // Auto-reconnect to Deriv if user previously connected (persists across page refresh)
    const storedDerivToken =
      localStorage.getItem(`apex_deriv_token_${currentUser.id}`) ||
      localStorage.getItem('apex_deriv_token');

    if (storedDerivToken && deriv.authState !== 'connected' && deriv.authState !== 'connecting') {
      void handleDerivConnect(storedDerivToken, DEFAULT_APP_ID, true);
    }
  };

  useEffect(() => {
    // Check initial auth session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const activeUser = session?.user ?? null;
      setUser(activeUser);
      setAuthChecking(false);
      if (activeUser) {
        void load(activeUser);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const activeUser = session?.user ?? null;
      setUser(activeUser);
      setAuthChecking(false);
      if (activeUser) {
        void load(activeUser);
      } else {
        setWorkspace(null);
        setTrades([]);
      }
    });

    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => { const interval = window.setInterval(() => setTick((value) => value + 1), 1600); return () => window.clearInterval(interval); }, []);
  useEffect(() => { if (!notice) return; const timeout = window.setTimeout(() => setNotice(''), 4000); return () => window.clearTimeout(timeout); }, [notice]);
  useEffect(() => { if (!tradeAlert) return; const timeout = window.setTimeout(() => setTradeAlert(null), 6000); return () => window.clearTimeout(timeout); }, [tradeAlert]);

  const updateWorkspace = async (changes: Partial<Workspace>) => {
    if (!workspace) return;
    const next = { ...workspace, ...changes };
    setWorkspace(next);
    if (userRef.current) {
      saveUserWorkspaceToStorage(userRef.current.id, next);
    }
    try {
      const { error } = await supabase.from('trading_workspace').update(changes).eq('id', workspace.id);
      if (error) console.warn('Supabase workspace update fallback to local:', error.message);
    } catch { /* ignore */ }
  };

  const armLiveTrading = () => {
    if (!deriv.account) {
      setNotice('Cannot arm live trading: You must be connected to Deriv.');
      return;
    }

    if (isDerivDemo) {
      const realAcc = deriv.accounts.find((a) => !a.is_virtual);
      if (realAcc) {
        const switchAndArm = window.confirm(
          `You are currently trading on Demo (${deriv.account.loginid}).\n\n` +
          `Switch to your Real account (${realAcc.loginid} · ${realAcc.currency} ${realAcc.balance.toFixed(2)}) and ARM live trading?`
        );
        if (switchAndArm) {
          void (async () => {
            await handleDerivSwitchAccount(realAcc.loginid);
            syncSessionStartBalance(realAcc.balance);
            setLiveArmed(true);
            setNotice(`Switched to Real account (${realAcc.loginid}) and LIVE TRADING ARMED.`);
          })();
        }
        return;
      } else {
        setNotice('No real Deriv account found on this token. Connect an API token that has real account access.');
        return;
      }
    }

    const maxStake = ((deriv.account.balance * maxBalancePercent) / 100).toFixed(2);
    const confirmed = window.confirm(
      `ARM LIVE REAL-MONEY TRADING?\n\n` +
      `Account: ${deriv.account.loginid} (Real Funds)\n` +
      `Balance: ${deriv.account.currency} ${deriv.account.balance.toFixed(2)}\n` +
      `Session Loss Limit: ${money(workspace?.loss_limit ?? 50)}\n` +
      `Max Stake Cap: ${maxBalancePercent}% (${money(Number(maxStake))})\n` +
      `Automated Bot Trading: ${allowBotLiveTrading ? 'ALLOWED' : 'BLOCKED (Default)'}\n\n` +
      `Real money will be moved on Deriv. Do you wish to proceed?`
    );
    if (confirmed) {
      syncSessionStartBalance(deriv.account.balance);
      setLiveArmed(true);
      setNotice(`LIVE TRADING ARMED on account ${deriv.account.loginid}. Real funds active.`);
    }
  };

  const disarmLiveTrading = () => {
    setLiveArmed(false);
    setNotice('Live trading disarmed. Switched to safe mode.');
  };

  const handleDerivConnect = async (token: string, _appId?: string, isAutoReconnect = false) => {
    if (!isAutoReconnect) setNotice('Connecting to Deriv…');
    setLiveArmed(false); // ALWAYS start in safe demo mode!
    // Always use owner's registered App ID to route commissions
    const result = await deriv.connect(token, DEFAULT_APP_ID);
    if (result.ok && result.account) {
      if (userRef.current) {
        localStorage.setItem(`apex_deriv_token_${userRef.current.id}`, token);
      }
      localStorage.setItem('apex_deriv_token', token);
      syncSessionStartBalance(result.account.balance);

      if (!isAutoReconnect) {
        // CRITICAL SAFETY: Stop running bots for this user
        if (userRef.current) {
          localStorage.setItem(`apex_active_bots_${userRef.current.id}`, '[]');
        }
        setBots((current) => current.map((b) => ({ ...b, active: false })));
        botPendingTradesRef.current.clear();
      }

      await updateWorkspace({
        deriv_connected: true,
        deriv_loginid: result.account.loginid,
        deriv_is_virtual: result.account.is_virtual,
        deriv_balance: result.account.balance,
        ...(!isAutoReconnect ? { active_bots: [] } : {}),
      });

      if (!isAutoReconnect) {
        setNotice(`Connected to Deriv (${result.account.loginid}) [${result.account.is_virtual ? 'Demo' : 'Real'}]. All active bots have been stopped for safety — you can restart them manually.`);
      }
    } else {
      if (!isAutoReconnect) {
        setNotice(`Could not connect: ${result.error ?? 'Unknown error'}. Check your API token.`);
      } else {
        if (userRef.current) {
          localStorage.removeItem(`apex_deriv_token_${userRef.current.id}`);
        }
        localStorage.removeItem('apex_deriv_token');
      }
    }
  };

  const handleDerivSwitchAccount = async (loginid: string) => {
    setLiveArmed(false); // Always disarm on switch!
    setNotice(`Switching to account ${loginid}…`);
    const result = await deriv.switchAccount(loginid);
    if (result.ok && result.account) {
      syncSessionStartBalance(result.account.balance);
      await updateWorkspace({
        deriv_loginid: result.account.loginid,
        deriv_is_virtual: result.account.is_virtual,
        deriv_balance: result.account.balance,
      });
      setNotice(`Switched to ${result.account.is_virtual ? 'Demo' : 'Real'} account (${result.account.loginid}). Live trading is disarmed.`);
    } else {
      setNotice(`Could not switch account: ${result.error ?? 'Unknown error'}`);
    }
  };

  const handleDerivDisconnect = () => {
    setLiveArmed(false);
    deriv.disconnect();
    clearSessionStartBalance();
    if (userRef.current) {
      localStorage.removeItem(`apex_deriv_token_${userRef.current.id}`);
    }
    localStorage.removeItem('apex_deriv_token');
    void updateWorkspace({ deriv_connected: false, deriv_loginid: null, deriv_is_virtual: null, deriv_balance: null });
    setNotice('Disconnected from Deriv. Switched to demo mode.');
  };

  const handleSignOut = async () => {
    if (derivConnected) {
      deriv.disconnect();
    }
    setLiveArmed(false);
    clearSessionStartBalance();
    if (userRef.current) {
      localStorage.removeItem(`apex_deriv_token_${userRef.current.id}`);
    }
    localStorage.removeItem('apex_deriv_token');
    await supabase.auth.signOut();
    setUser(null);
    setWorkspace(null);
    setTrades([]);
    setNotice('Signed out successfully.');
  };

  const liveArmedRef = useRef(liveArmed);
  const allowBotLiveRef = useRef(allowBotLiveTrading);
  const maxBalancePercentRef = useRef(maxBalancePercent);
  const workspaceRef = useRef(workspace);
  const botsRef = useRef(bots);
  const tradesRef = useRef(trades);
  const tickRef = useRef(tick);

  workspaceRef.current = workspace;
  botsRef.current = bots;
  tradesRef.current = trades;
  tickRef.current = tick;
  liveArmedRef.current = liveArmed;
  allowBotLiveRef.current = allowBotLiveTrading;
  maxBalancePercentRef.current = maxBalancePercent;

  const runTrade = async (details: { instrument: string; direction: string; stake: number; source: string; botName?: string }) => {
    if (!workspace) return;
    const ws = workspaceRef.current;
    if (!ws) return;

    if (details.botName && botPendingTradesRef.current.has(details.botName)) {
      return;
    }

    const isBot = details.source === 'bot' || details.source === 'quick_bot' || details.source === 'bulk' || Boolean(details.botName);
    const currentlyArmed = liveArmedRef.current;
    const botLiveAllowed = allowBotLiveRef.current;
    const maxPercent = maxBalancePercentRef.current;

    const sessionStartBal = sessionStartingBalRef.current ?? (derivConnected && deriv.account ? deriv.account.balance : ws.starting_balance);
    const sessionCurrentBal = derivConnected && deriv.account ? deriv.account.balance : ws.balance;
    const sessionLossUsed = computeSessionLoss(
      sessionStartBal,
      sessionCurrentBal,
      tradesRef.current,
      sessionStartAtRef.current,
    );
    if (sessionLossUsed >= ws.loss_limit) {
      if (isDerivReal && currentlyArmed) setLiveArmed(false);
      setNotice(`Trading blocked: Session loss limit of ${money(ws.loss_limit)} reached (${money(sessionLossUsed)} lost this session).`);
      return;
    }

    if (derivConnected && deriv.account) {
      // Safety checks for REAL accounts:
      if (isDerivReal) {
        if (!currentlyArmed) {
          if (isBot) {
            setNotice('Bot trading on real account is disarmed for safety. Switch to Demo account to test bots.');
          } else {
            setNotice('Live execution is disarmed. Arm live trading in Topbar or Settings to place real trades.');
          }
          return;
        }

        if (isBot && !botLiveAllowed) {
          setNotice('Automated bot live trading is blocked by default. Enable in Settings if you want bots to trade real money.');
          return;
        }

        // Stake cap (% of balance)
        const maxAllowedStake = Math.max(1, Number(((deriv.account.balance * maxPercent) / 100).toFixed(2)));
        if (details.stake > maxAllowedStake) {
          setNotice(`Trade blocked: Stake (${money(details.stake)}) exceeds maximum allowed risk cap of ${maxPercent}% of balance (${money(maxAllowedStake)}).`);
          return;
        }
      }

      // Check stake validity
      if (details.stake <= 0 || details.stake > deriv.account.balance) {
        setNotice('Stake must be greater than zero and within your Deriv balance.');
        return;
      }

      const symbol = symbolMap[details.instrument];
      if (!symbol) { setNotice('Unknown instrument for Deriv.'); return; }

      if (details.botName) {
        botPendingTradesRef.current.add(details.botName);
      }

      try {
        const result = await executeTrade({
          symbol: symbol as DerivSymbol,
          contract_type: details.direction as 'CALL' | 'PUT',
          stake: details.stake,
          duration: 5,
        });

        const tradeId = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `deriv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const trade: Trade = {
          id: tradeId,
          user_id: userRef.current?.id ?? null,
          instrument: details.instrument,
          direction: details.direction,
          stake: details.stake,
          result: 'pending',
          profit: 0,
          source: details.source,
          bot_name: details.botName,
          entry_price: result.entryPrice,
          exit_price: undefined,
          created_at: new Date().toISOString(),
        };

        // Immediately persist to local user storage and React state
        persistTrade(trade);

        // Background insert to Supabase (non-blocking)
        void (async () => {
          try {
            const { error: insErr } = await supabase.from('trading_trades').insert(trade);
            if (insErr) {
              const { user_id, ...tradeWithoutUser } = trade;
              await supabase.from('trading_trades').insert(tradeWithoutUser);
            }
          } catch { /* ignore */ }
        })();

        subscribeContract(result.contractId, (poc: DerivTradeResult) => {
          if (poc.status === 'won' || poc.status === 'lost') {
            const finalProfit = poc.profit;
            const win = poc.status === 'won';

            // Update persistent trade store and React state
            updatePersistedTrade(tradeId, {
              result: poc.status,
              profit: finalProfit,
              exit_price: poc.entry_price,
            });

            // Update Supabase in background
            void (async () => {
              try {
                await supabase.from('trading_trades').update({
                  result: poc.status,
                  profit: finalProfit,
                  exit_price: poc.entry_price,
                }).eq('id', tradeId);
              } catch { /* ignore */ }
            })();

            if (details.botName) {
              botPendingTradesRef.current.delete(details.botName);
              updateBotStatsFromTrade(details.botName, finalProfit, win);
            }

            applyBalanceDelta(finalProfit);

            const postBal = (deriv.account?.balance ?? 0) + finalProfit;
            const postStart = sessionStartingBalRef.current ?? postBal;
            const settledTrades = tradesRef.current.map((trade) =>
              trade.id === tradeId
                ? { ...trade, result: poc.status, profit: finalProfit }
                : trade
            );
            const postLoss = computeSessionLoss(
              postStart,
              postBal,
              settledTrades,
              sessionStartAtRef.current,
            );

            setTradeAlert({
              id: Date.now(),
              status: poc.status,
              direction: details.direction,
              instrument: details.instrument,
              profit: finalProfit,
              stake: details.stake,
              botName: details.botName,
              accountType: deriv.account?.is_virtual ? 'Demo' : 'Real',
              sessionLossAfter: postLoss,
            });
            if (postLoss >= ws.loss_limit) {
              if (isDerivReal) setLiveArmed(false);
              setNotice(`Session loss limit (${money(ws.loss_limit)}) reached after this trade. ${isDerivReal ? 'Live trading disarmed.' : 'New trades blocked until you reset the session baseline.'}`);
            } else {
              setNotice(`${poc.status === 'won' ? '🎉' : '📉'} ${details.direction} trade ${poc.status.toUpperCase()} ${poc.status === 'won' ? '+' : ''}${money(finalProfit)}`);
            }
          }
        });
        setNotice(`${details.direction} contract purchased on Deriv (${deriv.account.loginid} · ${deriv.account.is_virtual ? 'Demo' : 'Real'}). Waiting for result…`);
      } catch (err) {
        if (details.botName) botPendingTradesRef.current.delete(details.botName);
        setNotice(`Deriv trade failed: ${err}`);
      }
      return;
    }

    // Fallback: Synthetic simulation when Deriv is not connected
    if (details.stake <= 0 || details.stake > ws.balance) { setNotice('Stake must be greater than zero and within your balance.'); return; }
    const index = instruments.indexOf(details.instrument);
    const entry = priceFor(Math.max(index, 0), tick);
    const win = Math.random() > 0.42;
    const profit = Number((details.stake * (win ? 0.78 : -1)).toFixed(2));
    const exit = Number((entry + (win ? (details.direction === 'CALL' ? 1 : -1) : (details.direction === 'CALL' ? -1 : 1)) * (0.3 + Math.random() * 1.5)).toFixed(2));
    
    const tradeId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const trade: Trade = {
      id: tradeId,
      user_id: userRef.current?.id ?? null,
      instrument: details.instrument,
      direction: details.direction,
      stake: details.stake,
      result: win ? 'won' : 'lost',
      profit,
      source: details.source,
      bot_name: details.botName,
      entry_price: entry,
      exit_price: exit,
      created_at: new Date().toISOString(),
    };

    // Immediately persist trade to local storage and state
    persistTrade(trade);

    // Background insert to Supabase
    void (async () => {
      try {
        const { error: insErr } = await supabase.from('trading_trades').insert(trade);
        if (insErr) {
          const { user_id, ...tradeWithoutUser } = trade;
          await supabase.from('trading_trades').insert(tradeWithoutUser);
        }
      } catch { /* ignore */ }
    })();

    await updateWorkspace({ balance: Number((ws.balance + profit).toFixed(2)) });
    if (details.botName) {
      updateBotStatsFromTrade(details.botName, profit, win);
    }
    const newBalance = Number((ws.balance + profit).toFixed(2));
    const settledTrades = [trade, ...tradesRef.current.filter((item) => item.id !== trade.id)];
    const postLoss = computeSessionLoss(
      sessionStartBal,
      newBalance,
      settledTrades,
      sessionStartAtRef.current,
    );
    setTradeAlert({
      id: Date.now(),
      status: win ? 'won' : 'lost',
      direction: details.direction,
      instrument: details.instrument,
      profit,
      stake: details.stake,
      botName: details.botName,
      accountType: 'Demo',
      sessionLossAfter: postLoss,
    });
    if (postLoss >= ws.loss_limit) {
      setNotice(`Session loss limit (${money(ws.loss_limit)}) reached. New trades blocked until you reset the session baseline in Settings.`);
    } else {
      setNotice(`${win ? '🎉' : '📉'} ${details.direction} trade ${win ? 'WON' : 'LOST'} ${win ? '+' : ''}${money(profit)}`);
    }
  };
  const toggleBot = async (bot: BotRow) => {
    const nextActive = !bot.active;
    const nextBots = bots.map((item) => (item.id === bot.id ? { ...item, active: nextActive } : item));
    setBots(nextBots);

    const activeBotNames = nextBots.filter((b) => b.active).map((b) => b.name);
    if (userRef.current) {
      localStorage.setItem(`apex_active_bots_${userRef.current.id}`, JSON.stringify(activeBotNames));
    }

    try {
      await updateWorkspace({ active_bots: activeBotNames });
    } catch (e) {
      console.warn('Could not save user active bots:', e);
    }

    setNotice(nextActive ? `${bot.name} is live and watching conditions.` : `${bot.name} paused.`);
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      const activeBots = botsRef.current.filter((bot) => bot.active);
      const ws = workspaceRef.current;
      if (!activeBots.length || !ws) return;
      const currentTick = tickRef.current;
      activeBots.forEach((bot, i) => {
        if (botPendingTradesRef.current.has(bot.name)) return;
        void runTradeRef.current({
          instrument: instruments[(currentTick + i) % instruments.length],
          direction: (currentTick + i) % 2 ? 'CALL' : 'PUT',
          stake: 10,
          source: 'bot',
          botName: bot.name,
        });
      });
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  const runTradeRef = useRef(runTrade);
  runTradeRef.current = runTrade;

  const activeBalance = derivConnected && deriv.account ? deriv.account.balance : (workspace?.balance ?? 0);
  const sessionStartBalance = sessionStartingBalance ?? activeBalance;
  const sessionLossUsed = computeSessionLoss(
    sessionStartBalance,
    activeBalance,
    trades,
    sessionStartedAt,
  );
  const lossLimit = Math.max(1, Number(workspace?.loss_limit ?? 50));
  const guardPercent = computeGuardPercent(sessionLossUsed, lossLimit);
  const lossLimitReached = lossLimit > 0 && sessionLossUsed >= lossLimit;

  const content = loading ? (
    <div className="loading"><RefreshCw className="spin" size={18} /> Loading workspace…</div>
  ) : (
    <PageView
      page={page}
      workspace={workspace}
      bots={bots}
      trades={trades}
      tick={tick}
      runTrade={runTrade}
      toggleBot={toggleBot}
      updateWorkspace={updateWorkspace}
      setPage={setPage}
      setNotice={setNotice}
      deriv={deriv}
      onDerivConnect={handleDerivConnect}
      onDerivDisconnect={handleDerivDisconnect}
      onDerivSwitchAccount={handleDerivSwitchAccount}
      derivConnected={derivConnected}
      isDerivReal={isDerivReal}
      isDerivDemo={isDerivDemo}
      liveArmed={liveArmed}
      armLiveTrading={armLiveTrading}
      disarmLiveTrading={disarmLiveTrading}
      allowBotLiveTrading={allowBotLiveTrading}
      setAllowBotLiveTrading={setAllowBotLiveTrading}
      maxBalancePercent={maxBalancePercent}
      setMaxBalancePercent={setMaxBalancePercent}
      sessionLossUsed={sessionLossUsed}
      lossLimit={lossLimit}
      guardPercent={guardPercent}
      lossLimitReached={lossLimitReached}
      resetSessionBaseline={resetSessionBaseline}
    />
  );

  if (authChecking) {
    return (
      <div className="auth-loading-screen">
        <img
          src="/apex-logo.png"
          alt="APEX Trading Lab"
          className="auth-loading-logo"
        />
        <p>Initializing APEX Trading Lab…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <LandingPage
          onOpenAuth={() => setShowAuthModal(true)}
          onExploreDemo={() => setShowAuthModal(true)}
        />
        {showAuthModal && (
          <AuthModal
            supabase={supabase}
            onAuthSuccess={(authedUser) => {
              setUser(authedUser);
              setShowAuthModal(false);
              void load(authedUser);
            }}
            onClose={() => setShowAuthModal(false)}
          />
        )}
        {policyTab && (
          <PolicyModal
            initialTab={policyTab}
            onClose={() => setPolicyTab(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className="app-shell">
      <aside className={mobileNav ? 'sidebar open' : 'sidebar'}>
        <div className="brand">
          <img
            src="/apex-logo.png"
            alt="APEX Trading Lab"
            className="sidebar-brand-logo"
          />
        </div>
        <div className="workspace-chip">
          <span className="live-dot" />{' '}
          {derivConnected ? (isDerivReal ? (liveArmed ? 'Deriv Live (ARMED)' : 'Deriv Real (Safe)') : 'Deriv Demo') : 'Synthetic workspace'}{' '}
          <b>{derivConnected ? (isDerivReal ? (liveArmed ? 'LIVE' : 'SAFE') : 'DEMO') : 'DEMO'}</b>
        </div>
        <nav>
          {nav.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={page === key ? 'nav-item active' : 'nav-item'}
              onClick={() => { setPage(key); setMobileNav(false); }}
            >
              <Icon size={17} />{label}{key === 'apex' && <span className="pro">PRO</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="guard">
            <ShieldCheck size={17} />
            <div>
              <b>{lossLimitReached ? 'Limit reached' : 'Loss guard active'}</b>
              <span>{money(sessionLossUsed)} / {money(lossLimit)} session loss</span>
            </div>
          </div>
          {derivConnected && (
            <button className="mini-settings disconnect" onClick={handleDerivDisconnect}>
              <LogOut size={16} /> Disconnect Deriv
            </button>
          )}
          <button className="mini-settings" onClick={() => setPage('settings')}>
            <Settings2 size={16} /> Workspace settings
          </button>
          <button className="mini-settings" onClick={() => setPolicyTab('privacy')}>
            <FileText size={15} /> Policies & Legal
          </button>
          <div className="sidebar-user-section">
            <div className="user-info">
              <div className="user-avatar-dot">
                <UserIcon size={14} />
              </div>
              <div className="user-text">
                <strong>{user.email?.split('@')[0]}</strong>
                <span title={user.email}>{user.email}</span>
              </div>
            </div>
            <button className="mini-settings signout-btn" onClick={() => void handleSignOut()}>
              <LogOut size={15} /> Sign out
            </button>
          </div>
        </div>
      </aside>
      {mobileNav && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileNav(false)}
          aria-hidden="true"
        />
      )}

      <main className="main">
        <header className="topbar">
          <button className="menu-button" onClick={() => setMobileNav(!mobileNav)}>
            <Menu size={20} />
          </button>
          <div className="crumb">
            <span className="crumb-prefix hide-mobile">Workspace <ChevronRight size={14} /></span>
            <b>{nav.find((item) => item.key === page)?.label}</b>
          </div>
          <div className="top-actions">
            {derivConnected && (
              <DerivStatusBadge
                authState={deriv.authState}
                account={deriv.account}
                isArmed={liveArmed}
              />
            )}
            {isDerivReal && (
              <button
                type="button"
                className={`arm-action-btn ${liveArmed ? 'armed' : 'disarmed'}`}
                onClick={liveArmed ? disarmLiveTrading : armLiveTrading}
                title={liveArmed ? 'Click to Disarm live execution' : 'Click to Arm live trading'}
              >
                {liveArmed ? <ShieldCheck size={13} /> : <AlertTriangle size={13} />}
                {liveArmed ? 'ARMED' : 'Arm Trading'}
              </button>
            )}
            {isDerivDemo && linkedRealAccount && (
              <button
                type="button"
                className="arm-action-btn switch-real hide-mobile"
                onClick={() => void handleDerivSwitchAccount(linkedRealAccount.loginid)}
                title={`Switch active trading account to Real (${linkedRealAccount.loginid})`}
              >
                <Wallet size={13} /> Switch to Real ({linkedRealAccount.loginid})
              </button>
            )}
            {deriv.accounts.length > 1 && (
              <div className="topbar-account-switch hide-mobile">
                <Wallet size={12} />
                <select
                  value={deriv.account?.loginid || ''}
                  onChange={(e) => void handleDerivSwitchAccount(e.target.value)}
                >
                  {deriv.accounts.map((acc) => (
                    <option key={acc.loginid} value={acc.loginid}>
                      {acc.loginid} ({acc.is_virtual ? 'Demo' : 'Real'})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {derivConnected && (
              <button
                type="button"
                className="topbar-disconnect-btn hide-mobile"
                onClick={handleDerivDisconnect}
                title="Disconnect Deriv account"
              >
                <LogOut size={13} /> Disconnect
              </button>
            )}
            <button className="refresh hide-mobile" onClick={() => void load()}><RefreshCw size={15} /> Sync</button>
            <div className="topbar-user-pill hide-mobile-compact" title={`Signed in as ${user.email}`}>
              <div className="user-avatar-dot">
                <UserIcon size={13} />
              </div>
              <span className="user-email-text hide-mobile">{user.email?.split('@')[0]}</span>
              <button
                type="button"
                className="topbar-signout-btn hide-mobile"
                onClick={() => void handleSignOut()}
                title="Sign out of APEX"
              >
                <LogOut size={13} />
              </button>
            </div>
            <div className="balance topbar-balance">
              <span className="balance-label hide-mobile">
                {derivConnected ? (isDerivReal ? (liveArmed ? 'Deriv live' : 'Deriv real') : 'Deriv demo') : 'Demo balance'}
              </span>
              <strong>{money(derivConnected ? (deriv.account?.balance ?? 0) : (workspace?.balance ?? 0))}</strong>
            </div>
          </div>
        </header>
        <div className="ticker">
          {instruments.map((instrument, index) => {
            const value = priceFor(index, tick);
            const up = index % 2 === 0 ? tick % 3 !== 0 : tick % 3 === 0;
            return (
              <div className="ticker-item" key={instrument}>
                <span>{instrument.replace(' Index', '')}</span>
                <b>{value.toFixed(2)}</b>
                <em className={up ? 'positive' : 'negative'}>{up ? '+' : '-'}{(0.12 + index * 0.08).toFixed(2)}%</em>
              </div>
            );
          })}
        </div>
        <div className="page-content">
          {notice && <div className="toast"><Check size={16} /> {notice}<button onClick={() => setNotice('')}><X size={14} /></button></div>}
          {content}
        </div>
      </main>
      {tradeAlert && (
        <TradeResultToast
          alert={tradeAlert}
          sessionLossUsed={sessionLossUsed}
          lossLimit={lossLimit}
          onDismiss={() => setTradeAlert(null)}
        />
      )}
      {policyTab && (
        <PolicyModal
          initialTab={policyTab}
          onClose={() => setPolicyTab(null)}
        />
      )}
    </div>
  );
}

function PageView({
  page,
  workspace,
  bots,
  trades,
  tick,
  runTrade,
  toggleBot,
  updateWorkspace,
  setPage,
  setNotice,
  deriv,
  onDerivConnect,
  onDerivDisconnect,
  onDerivSwitchAccount,
  derivConnected,
  isDerivReal,
  isDerivDemo,
  liveArmed,
  armLiveTrading,
  disarmLiveTrading,
  allowBotLiveTrading,
  setAllowBotLiveTrading,
  maxBalancePercent,
  setMaxBalancePercent,
  sessionLossUsed,
  lossLimit,
  guardPercent,
  lossLimitReached,
  resetSessionBaseline,
}: {
  page: Page;
  workspace: Workspace | null;
  bots: BotRow[];
  trades: Trade[];
  tick: number;
  runTrade: (details: { instrument: string; direction: string; stake: number; source: string; botName?: string }) => Promise<void>;
  toggleBot: (bot: BotRow) => Promise<void>;
  updateWorkspace: (changes: Partial<Workspace>) => Promise<void>;
  setPage: (page: Page) => void;
  setNotice: (notice: string) => void;
  deriv: ReturnType<typeof useDerivConnection>;
  onDerivConnect: (token: string, appId: string) => void;
  onDerivDisconnect: () => void;
  onDerivSwitchAccount: (loginid: string) => void;
  derivConnected: boolean;
  isDerivReal: boolean;
  isDerivDemo: boolean;
  liveArmed: boolean;
  armLiveTrading: () => void;
  disarmLiveTrading: () => void;
  allowBotLiveTrading: boolean;
  setAllowBotLiveTrading: (allowed: boolean) => void;
  maxBalancePercent: number;
  setMaxBalancePercent: (percent: number) => void;
  sessionLossUsed: number;
  lossLimit: number;
  guardPercent: number;
  lossLimitReached: boolean;
  resetSessionBaseline: () => void;
}) {
  if (!workspace) return <EmptyState title="Workspace unavailable" text="The demo workspace could not be loaded." />;
  if (page === 'dashboard') return <Dashboard workspace={workspace} bots={bots} trades={trades} tick={tick} toggleBot={toggleBot} setPage={setPage} derivConnected={derivConnected} isDerivReal={isDerivReal} derivAccount={deriv.account} sessionLossUsed={sessionLossUsed} lossLimit={lossLimit} guardPercent={guardPercent} lossLimitReached={lossLimitReached} />;
  if (page === 'bots') return <Bots bots={bots} toggleBot={toggleBot} runTrade={runTrade} trades={trades} />;
  if (page === 'manual') {
    return (
      <ManualTrader
        tick={tick}
        runTrade={runTrade}
        derivConnected={derivConnected}
        isDerivReal={isDerivReal}
        derivAccount={deriv.account}
        workspaceBalance={workspace.balance}
        onSwitchAccount={onDerivSwitchAccount}
        linkedRealAccount={deriv.accounts.find((a) => !a.is_virtual)}
        linkedDemoAccount={deriv.accounts.find((a) => a.is_virtual)}
      />
    );
  }
  if (page === 'builder') return <Builder setNotice={setNotice} />;
  if (page === 'signals') return <Signals tick={tick} runTrade={runTrade} />;
  if (page === 'bulk') return <Bulk tick={tick} runTrade={runTrade} />;
  if (page === 'quick') return <Quick tick={tick} runTrade={runTrade} />;
  if (page === 'apex') return <Apex bots={bots} toggleBot={toggleBot} trades={trades} />;
  if (page === 'record') return <Record trades={trades} />;
  return (
    <Settings
      workspace={workspace}
      updateWorkspace={updateWorkspace}
      setNotice={setNotice}
      deriv={deriv}
      onDerivConnect={onDerivConnect}
      onDerivDisconnect={onDerivDisconnect}
      onDerivSwitchAccount={onDerivSwitchAccount}
      derivConnected={derivConnected}
      isDerivReal={isDerivReal}
      isDerivDemo={isDerivDemo}
      liveArmed={liveArmed}
      armLiveTrading={armLiveTrading}
      disarmLiveTrading={disarmLiveTrading}
      allowBotLiveTrading={allowBotLiveTrading}
      setAllowBotLiveTrading={setAllowBotLiveTrading}
      maxBalancePercent={maxBalancePercent}
      setMaxBalancePercent={setMaxBalancePercent}
      sessionLossUsed={sessionLossUsed}
      lossLimit={lossLimit}
      guardPercent={guardPercent}
      lossLimitReached={lossLimitReached}
      resetSessionBaseline={resetSessionBaseline}
    />
  );
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>; }
function Stat({ label, value, detail, tone = 'neutral', icon: Icon = Activity }: { label: string; value: string; detail: string; tone?: string; icon?: typeof Activity }) { return <div className="stat"><div className={`stat-icon ${tone}`}><Icon size={18} /></div><div><span>{label}</span><strong>{value}</strong><small className={tone === 'danger' ? 'negative' : tone === 'success' ? 'positive' : ''}>{detail}</small></div></div>; }

function TradeResultToast({
  alert,
  sessionLossUsed,
  lossLimit,
  onDismiss,
}: {
  alert: TradeAlert;
  sessionLossUsed: number;
  lossLimit: number;
  onDismiss: () => void;
}) {
  const isWin = alert.status === 'won';
  const displayLoss = alert.sessionLossAfter ?? sessionLossUsed;
  const guardPercent = computeGuardPercent(displayLoss, lossLimit);
  const instrument = alert.instrument.replace('Volatility ', 'Vol ').replace(' Index', '');
  const source = alert.botName ?? 'Manual';

  return (
    <div className={`trade-result-toast ${alert.status}`} role="alert">
      <div className="trade-result-toast-main">
        {isWin ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
        <span className={`trade-result-toast-pnl ${alert.status}`}>
          {isWin ? 'Won' : 'Lost'} {isWin ? '+' : ''}{money(alert.profit)}
        </span>
        <span className="trade-result-toast-meta">
          {alert.direction} · {instrument} · Stake {money(alert.stake)} · {alert.accountType} · {source}
        </span>
        <button type="button" className="trade-result-toast-close" onClick={onDismiss} aria-label="Dismiss">
          <X size={12} />
        </button>
      </div>
      <div className="trade-result-toast-foot">
        <span>Loss guard {money(displayLoss)}/{money(lossLimit)}</span>
        <div className={`trade-result-toast-bar ${guardPercent >= 75 ? 'warning' : ''} ${displayLoss >= lossLimit ? 'danger' : ''}`}>
          <span style={{ width: `${guardPercent}%` }} />
        </div>
      </div>
    </div>
  );
}

function LossGuardRail({
  sessionLossUsed,
  lossLimit,
  guardPercent,
  lossLimitReached,
  onAdjust,
}: {
  sessionLossUsed: number;
  lossLimit: number;
  guardPercent: number;
  lossLimitReached: boolean;
  onAdjust?: () => void;
}) {
  const remaining = Math.max(0, lossLimit - sessionLossUsed);
  return (
    <>
      <div className={`guard-value ${lossLimitReached ? 'limit-reached' : ''}`}>
        <strong>{money(sessionLossUsed)}</strong>
        <span>of {money(lossLimit)} session loss</span>
      </div>
      <div className={`progress ${lossLimitReached ? 'danger' : guardPercent >= 75 ? 'warning' : ''}`}>
        <span style={{ width: `${guardPercent}%` }} />
      </div>
      <div className="guard-footer">
        <span>
          <i className={`live-dot ${lossLimitReached ? 'danger-dot' : ''}`} />
          {lossLimitReached ? 'Limit reached — trades blocked' : `${money(remaining)} remaining`}
        </span>
        {onAdjust && (
          <button type="button" className="text-button" onClick={onAdjust}>
            Adjust limit <ChevronRight size={15} />
          </button>
        )}
      </div>
      <div className="guard-note">
        {lossLimitReached
          ? 'Reset your session baseline in Settings to start fresh, or raise the limit.'
          : 'New trades pause automatically when the session loss limit is reached.'}
      </div>
    </>
  );
}

function Dashboard({ workspace, bots, trades, tick, toggleBot, setPage, derivConnected, isDerivReal, derivAccount, sessionLossUsed, lossLimit, guardPercent, lossLimitReached }: { workspace: Workspace; bots: BotRow[]; trades: Trade[]; tick: number; toggleBot: (bot: BotRow) => Promise<void>; setPage: (page: Page) => void; derivConnected: boolean; isDerivReal: boolean; derivAccount: { loginid: string; balance: number; is_virtual: boolean } | null; sessionLossUsed: number; lossLimit: number; guardPercent: number; lossLimitReached: boolean }) {
  const pnl = trades.reduce((sum, trade) => sum + Number(trade.profit), 0); const active = bots.filter((bot) => bot.active);
  const balanceValue = derivConnected && derivAccount ? derivAccount.balance : workspace.balance;
  const balanceLabel = derivConnected && derivAccount ? (isDerivReal ? 'Deriv live account' : 'Deriv demo account') : (workspace.mode === 'demo' ? 'Demo account' : 'Live account');
  const headerDesc = derivConnected ? (isDerivReal ? "You're connected to a real Deriv account. Trades will execute with real funds." : "You're connected to a Deriv demo account. Trades execute on Deriv with virtual funds.") : "Your synthetic trading workspace is running smoothly. Review your guardrails before you deploy.";
  return <><PageHeader eyebrow="Overview / Today" title="Good morning, trader." description={headerDesc} action={<button className="primary" onClick={() => setPage('manual')}><Plus size={16} /> New trade</button>} /><div className="stats-grid"><Stat label="Available balance" value={money(balanceValue)} detail={balanceLabel} tone="success" icon={Wallet} /><Stat label="Session P/L" value={money(pnl)} detail={`${trades.filter((trade) => trade.profit > 0).length} winning trades`} tone={pnl >= 0 ? 'success' : 'danger'} icon={pnl >= 0 ? TrendingUp : TrendingDown} /><Stat label="Active bots" value={String(active.length)} detail={`${bots.length} in library`} icon={Bot} /><Stat label="Market status" value="Open" detail={derivConnected ? "Deriv feeds online" : "Synthetic feeds online"} tone="success" icon={Activity} /></div><div className="grid-2"><section className="panel"><div className="panel-title"><div><span className="eyebrow">Live automation</span><h2>Active bots</h2></div><button className="text-button" onClick={() => setPage('bots')}>View library <ChevronRight size={15} /></button></div>{active.length ? active.map((bot) => {
    const botTrades = trades.filter((trade) => trade.bot_name === bot.name);
    const closed = botTrades.filter((t) => t.result === 'won' || t.result === 'lost');
    const hasTrades = closed.length > 0;
    const wins = closed.filter((t) => t.result === 'won').length;
    const winRate = hasTrades ? Math.round((wins / closed.length) * 100) : 0;
    const botPnl = closed.reduce((sum, t) => sum + Number(t.profit), 0);
    return <div className="bot-row" key={bot.id}><div className="bot-avatar"><Bot size={18} /></div><div className="bot-copy"><strong>{bot.name}</strong><span><i className="live-dot" /> {bot.active ? 'Running — trading every 5s' : 'Paused'}</span></div><div className="bot-metric"><span>{hasTrades ? `${winRate}% win · ${closed.length} trades` : '0 trades · Not run yet'}</span><b className={botPnl > 0 ? 'positive' : botPnl < 0 ? 'negative' : 'muted'}>{money(botPnl)}</b></div><button className="icon-button" onClick={() => void toggleBot(bot)}><Pause size={16} /></button></div>;
  }) : <EmptyState title="No active bots" text="Activate a free bot and it will watch synthetic markets for you." action={<button className="secondary" onClick={() => setPage('bots')}>Browse free bots</button>} />}</section><section className="panel guard-panel"><div className="panel-title"><div><span className="eyebrow">Risk controls</span><h2>Loss-limit guardrail</h2></div><ShieldCheck className={lossLimitReached ? 'danger-icon' : 'success-icon'} size={22} /></div><LossGuardRail sessionLossUsed={sessionLossUsed} lossLimit={lossLimit} guardPercent={guardPercent} lossLimitReached={lossLimitReached} onAdjust={() => setPage('settings')} /></section></div><section className="panel"><div className="panel-title"><div><span className="eyebrow">Performance</span><h2>Equity curve</h2></div><button className="text-button" onClick={() => setPage('record')}>Full track record <ChevronRight size={15} /></button></div><EquityChart trades={trades} /></section><section className="panel"><div className="panel-title"><div><span className="eyebrow">Latest activity</span><h2>Trade history</h2></div></div><TradeTable trades={trades.slice(0, 5)} /></section></>;
}

function BotStats({ bot, userTrades }: { bot: BotRow; userTrades: Trade[] }) {
  const closedUserTrades = userTrades.filter((t) => t.result === 'won' || t.result === 'lost');
  const hasUserTrades = closedUserTrades.length > 0;

  if (!hasUserTrades) {
    return (
      <div className="bot-stats-container">
        <div className="bot-stats-badge personal not-run">
          <UserIcon size={11} /> Your Track Record · 0 Trades Run
        </div>
        <div className="bot-stats">
          <div className="bot-stat"><span>Your trades</span><b>0</b></div>
          <div className="bot-stat"><span>Wins</span><b>0</b></div>
          <div className="bot-stat"><span>Losses</span><b>0</b></div>
          <div className="bot-stat"><span>Win rate</span><b className="muted">—</b></div>
          <div className="bot-stat"><span>Net P/L</span><b>$0.00</b></div>
          <div className="bot-stat"><span>Expected risk</span><b>{bot.risk}</b></div>
        </div>
      </div>
    );
  }

  const total = closedUserTrades.length;
  const wins = closedUserTrades.filter((t) => t.result === 'won').length;
  const losses = total - wins;
  const winRate = Math.round((wins / total) * 100);
  const wonAmount = closedUserTrades.filter((t) => t.profit > 0).reduce((sum, t) => sum + Number(t.profit), 0);
  const lostAmount = closedUserTrades.filter((t) => t.profit < 0).reduce((sum, t) => sum + Math.abs(Number(t.profit)), 0);

  return (
    <div className="bot-stats-container">
      <div className="bot-stats-badge personal">
        <UserIcon size={11} /> Your Track Record ({total} {total === 1 ? 'trade' : 'trades'})
      </div>
      <div className="bot-stats">
        <div className="bot-stat"><span>Trades</span><b>{total}</b></div>
        <div className="bot-stat"><span>Wins</span><b className="positive">{wins}</b></div>
        <div className="bot-stat"><span>Losses</span><b className="negative">{losses}</b></div>
        <div className="bot-stat"><span>Win rate</span><b className={winRate >= 50 ? 'positive' : 'negative'}>{winRate}%</b></div>
        <div className="bot-stat"><span>Won</span><b className="positive">{money(wonAmount)}</b></div>
        <div className="bot-stat"><span>Lost</span><b className="negative">{money(lostAmount)}</b></div>
      </div>
    </div>
  );
}

function EquityChart({
  trades,
  color = '#2dd4bf',
  compact = false,
}: {
  trades: Trade[];
  color?: string;
  compact?: boolean;
}) {
  const [rangeFilter, setRangeFilter] = useState<'all' | '50' | '20' | '10'>('all');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // If compact, always use all trades. If not compact, slice according to rangeFilter
  const activeTrades = useMemo(() => {
    if (compact || rangeFilter === 'all') return trades;
    const count = parseInt(rangeFilter, 10);
    return trades.slice(0, count);
  }, [trades, compact, rangeFilter]);

  // chronological order (oldest first, newest last)
  const chronological = useMemo(() => [...activeTrades].reverse(), [activeTrades]);

  // Performance analytics
  const stats = useMemo(() => {
    if (!chronological.length) return null;

    let cumulative = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let wins = 0;
    let losses = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let streak = 0;
    let bestStreak = 0;

    const dataPoints = chronological.map((trade, i) => {
      const p = Number(trade.profit);
      cumulative += p;
      if (cumulative > peak) peak = cumulative;
      const dd = peak - cumulative;
      if (dd > maxDrawdown) maxDrawdown = dd;

      if (p > 0) {
        wins++;
        grossProfit += p;
        streak = streak > 0 ? streak + 1 : 1;
        if (streak > bestStreak) bestStreak = streak;
      } else if (p < 0) {
        losses++;
        grossLoss += Math.abs(p);
        streak = 0;
      }

      return {
        index: i + 1,
        trade,
        profit: p,
        cumulative: Number(cumulative.toFixed(2)),
        peak: Number(peak.toFixed(2)),
        drawdown: Number(dd.toFixed(2)),
      };
    });

    const netProfit = Number(cumulative.toFixed(2));
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 'MAX' : '1.0';
    const winRate = Math.round((wins / chronological.length) * 100);

    return {
      dataPoints,
      netProfit,
      peak: Number(peak.toFixed(2)),
      maxDrawdown: Number(maxDrawdown.toFixed(2)),
      profitFactor,
      winRate,
      bestStreak,
      wins,
      losses,
      total: chronological.length,
    };
  }, [chronological]);

  if (!trades.length || !stats || !stats.dataPoints.length) {
    return <EmptyState title="No trades yet" text="The equity curve will appear once trades are recorded." />;
  }

  // Find min and max for chart scaling
  const points = stats.dataPoints;
  const values = points.map((p) => p.cumulative);
  let minVal = Math.min(0, ...values);
  let maxVal = Math.max(0, ...values);
  const pad = (maxVal - minVal) * 0.18 || 5;
  minVal = Number((minVal - pad).toFixed(2));
  maxVal = Number((maxVal + pad).toFixed(2));
  const range = maxVal - minVal || 1;

  // SVG coordinate space: 0 0 100 56
  const coords = points.map((pt, i) => {
    const x = (i / Math.max(1, points.length - 1)) * 96 + 2;
    const y = 50 - ((pt.cumulative - minVal) / range) * 44;
    return { ...pt, x, y };
  });

  const pathStr = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
  const firstX = coords[0].x.toFixed(2);
  const lastX = coords[coords.length - 1].x.toFixed(2);

  // Break-even (0 line) position
  const zeroY = 50 - ((0 - minVal) / range) * 44;
  const hasZeroLine = minVal < 0 && maxVal > 0;

  // Peak and Min points
  const peakPt = coords.reduce((max, pt) => (pt.cumulative > max.cumulative ? pt : max), coords[0]);
  const minPt = coords.reduce((min, pt) => (pt.cumulative < min.cumulative ? pt : min), coords[0]);
  const lastPt = coords[coords.length - 1];

  const hoveredPt = hoverIndex !== null && coords[hoverIndex] ? coords[hoverIndex] : null;

  const gid = `eq-${(color || '2dd4bf').replace('#', '')}-${compact ? 'c' : 'f'}`;
  const strokeColor = stats.netProfit >= 0 ? color : '#f43f5e';

  // Format price helper
  const fmt = (v: number) => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`;

  if (compact) {
    return (
      <div className="price-chart compact-chart">
        <svg viewBox="0 0 100 56" preserveAspectRatio="none" className="equity-svg">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.25" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`2,55 ${coords.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')} ${lastX},55`} fill={`url(#${gid})`} />
          <path
            d={pathStr}
            fill="none"
            stroke={strokeColor}
            strokeWidth="1.2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={lastPt.x} cy={lastPt.y} r="0.9" fill={strokeColor} stroke="#ffffff" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="chart-labels">
          <span>Start</span>
          <span>{stats.total} trades ({stats.winRate}% win)</span>
          <span className={stats.netProfit >= 0 ? 'positive' : 'negative'}>{fmt(stats.netProfit)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="enhanced-equity-container">
      {/* Performance Analytics Stats Strip */}
      <div className="equity-stats-bar">
        <div className="equity-stat-item">
          <span className="eq-stat-label">Net P/L</span>
          <strong className={`eq-stat-val ${stats.netProfit >= 0 ? 'positive' : 'negative'}`}>
            {stats.netProfit >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {fmt(stats.netProfit)}
          </strong>
        </div>

        <div className="equity-stat-item">
          <span className="eq-stat-label">Peak (ATH)</span>
          <strong className="eq-stat-val positive">
            +{money(stats.peak)}
          </strong>
        </div>

        <div className="equity-stat-item">
          <span className="eq-stat-label">Max Drawdown</span>
          <strong className={`eq-stat-val ${stats.maxDrawdown > 0 ? 'negative' : 'muted'}`}>
            {stats.maxDrawdown > 0 ? `-${money(stats.maxDrawdown)}` : '$0.00'}
          </strong>
        </div>

        <div className="equity-stat-item">
          <span className="eq-stat-label">Profit Factor</span>
          <strong className="eq-stat-val">
            {stats.profitFactor}x
          </strong>
        </div>

        <div className="equity-stat-item">
          <span className="eq-stat-label">Win Rate</span>
          <strong className={`eq-stat-val ${stats.winRate >= 50 ? 'positive' : 'negative'}`}>
            {stats.winRate}% <small>({stats.wins}W / {stats.losses}L)</small>
          </strong>
        </div>

        <div className="equity-stat-item">
          <span className="eq-stat-label">Best Streak</span>
          <strong className="eq-stat-val highlight">
            <Zap size={13} /> {stats.bestStreak} {stats.bestStreak === 1 ? 'win' : 'wins'}
          </strong>
        </div>

        {trades.length > 10 && (
          <div className="equity-range-selector">
            {(['all', '50', '20', '10'] as const).map((r) => (
              <button
                key={r}
                type="button"
                className={`range-pill ${rangeFilter === r ? 'active' : ''}`}
                onClick={() => setRangeFilter(r)}
              >
                {r === 'all' ? 'All' : `${r}T`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* SVG Interactive Canvas */}
      <div className="equity-chart-wrapper">
        <svg
          viewBox="0 0 100 56"
          preserveAspectRatio="none"
          className="equity-svg"
          onMouseLeave={() => setHoverIndex(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width;
            const targetIdx = Math.round(relX * (coords.length - 1));
            const clamped = Math.max(0, Math.min(coords.length - 1, targetIdx));
            setHoverIndex(clamped);
          }}
        >
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
              <stop offset="70%" stopColor={strokeColor} stopOpacity="0.05" />
              <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Dotted horizontal guidelines */}
          <line x1="2" y1="8" x2="98" y2="8" stroke="#162320" strokeWidth="0.8" vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />
          <line x1="2" y1="48" x2="98" y2="48" stroke="#162320" strokeWidth="0.8" vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />

          {/* Break-even ($0.00) reference baseline */}
          {hasZeroLine && (
            <g className="zero-baseline-group">
              <line
                x1="2"
                y1={zeroY}
                x2="98"
                y2={zeroY}
                stroke="#334155"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                strokeDasharray="3 3"
              />
              <text x="3" y={zeroY - 1.8} fill="#64748b" fontSize="2.4" fontWeight="600" letterSpacing="0.05em">
                BREAK-EVEN ($0.00)
              </text>
            </g>
          )}

          {/* Area Fill */}
          <polygon points={`2,55 ${coords.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')} ${lastX},55`} fill={`url(#${gid})`} />

          {/* Main Equity Trend Line - razor-sharp thin line */}
          <path
            d={pathStr}
            fill="none"
            stroke={strokeColor}
            strokeWidth="1.3"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* All-Time High Marker (Peak) */}
          {stats.peak > 0 && (
            <g className="peak-marker-group">
              <circle
                cx={peakPt.x}
                cy={peakPt.y}
                r="0.8"
                fill="#34d399"
                stroke="#064e3b"
                strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={Math.min(86, Math.max(12, peakPt.x))}
                y={Math.max(5, peakPt.y - 2.5)}
                fill="#34d399"
                fontSize="2.4"
                fontWeight="700"
                textAnchor="middle"
              >
                ▲ ATH {fmt(peakPt.cumulative)}
              </text>
            </g>
          )}

          {/* Low Marker (if in negative territory) */}
          {minPt.cumulative < -1 && (
            <g className="min-marker-group">
              <circle
                cx={minPt.x}
                cy={minPt.y}
                r="0.8"
                fill="#f87171"
                stroke="#450a0a"
                strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={Math.min(86, Math.max(12, minPt.x))}
                y={Math.min(52, minPt.y + 3.8)}
                fill="#f87171"
                fontSize="2.4"
                fontWeight="700"
                textAnchor="middle"
              >
                ▼ LOW {fmt(minPt.cumulative)}
              </text>
            </g>
          )}

          {/* Latest Spot Marker */}
          <circle
            cx={lastPt.x}
            cy={lastPt.y}
            r="1"
            fill={strokeColor}
            stroke="#ffffff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />

          {/* Interactive Hover Crosshair */}
          {hoveredPt && (
            <g className="chart-hover-overlay">
              <line
                x1={hoveredPt.x}
                y1="0"
                x2={hoveredPt.x}
                y2="55"
                stroke="#94a3b8"
                strokeWidth="0.8"
                vectorEffect="non-scaling-stroke"
                strokeDasharray="2 2"
              />
              <circle
                cx={hoveredPt.x}
                cy={hoveredPt.y}
                r="1.4"
                fill="#ffffff"
                stroke={strokeColor}
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
        </svg>

        {/* Floating Tooltip Card */}
        {hoveredPt && (
          <div
            className="equity-tooltip"
            style={{
              left: `${Math.min(82, Math.max(18, (hoveredPt.x / 100) * 100))}%`,
              top: `${Math.max(10, Math.min(75, (hoveredPt.y / 56) * 100 - 15))}%`,
            }}
          >
            <div className="tooltip-header">
              <span>Trade #{hoveredPt.index}</span>
              <strong className={hoveredPt.profit >= 0 ? 'positive' : 'negative'}>
                {hoveredPt.profit >= 0 ? 'WON' : 'LOST'} ({fmt(hoveredPt.profit)})
              </strong>
            </div>
            <div className="tooltip-body">
              <span>{hoveredPt.trade.instrument}</span>
              <b>Equity: {fmt(hoveredPt.cumulative)}</b>
            </div>
          </div>
        )}
      </div>

      {/* Axis Footer Labels */}
      <div className="chart-labels">
        <span>Trade #1 ({timeAgo(chronological[0]?.created_at || new Date().toISOString())})</span>
        <span className="eq-label-mid">
          {stats.total} trades plotted · {stats.winRate}% win rate
        </span>
        <span className={stats.netProfit >= 0 ? 'positive' : 'negative'}>
          Current: {fmt(stats.netProfit)}
        </span>
      </div>
    </div>
  );
}

function Bots({ bots, toggleBot, runTrade, trades }: { bots: BotRow[]; toggleBot: (bot: BotRow) => Promise<void>; runTrade: (details: { instrument: string; direction: string; stake: number; source: string; botName?: string }) => Promise<void>; trades: Trade[] }) {
  return (
    <>
      <PageHeader
        eyebrow="Automation library"
        title="Free bots"
        description="Start with a clear strategy, a visible risk tier, and a demo-first execution loop. Multiple bots can run simultaneously."
      />
      <div className="bot-grid">
        {bots.map((bot) => {
          const botTrades = trades.filter((trade) => trade.bot_name === bot.name);
          return (
            <div className="bot-card" key={bot.id}>
              <div className="card-top">
                <div className="bot-avatar large"><Bot size={21} /></div>
                <span className={`risk ${bot.risk.toLowerCase()}`}>{bot.risk}</span>
              </div>
              <h2>{bot.name}</h2>
              <p>{bot.description}</p>
              <BotStats bot={bot} userTrades={botTrades} />
              {botTrades.length > 0 && (
                <div className="bot-chart-wrap"><EquityChart trades={botTrades} compact /></div>
              )}
              <div className="card-actions">
                <button
                  className={bot.active ? 'secondary active-button' : 'primary'}
                  onClick={() => void toggleBot(bot)}
                >
                  {bot.active ? <><Pause size={15} /> Pause bot</> : <><Play size={15} /> Start bot</>}
                </button>
                <button
                  className="ghost"
                  onClick={() => void runTrade({ instrument: instruments[0], direction: 'CALL', stake: 10, source: 'demo', botName: bot.name })}
                >
                  Test trade
                </button>
              </div>
              {bot.active && <div className="watching"><i className="live-dot" /> Running — placing trades every 5s</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}



function Builder({ setNotice }: { setNotice: (notice: string) => void }) { const [blocks, setBlocks] = useState(['Price crosses moving average', 'Confirm momentum direction']); const options = ['Price crosses moving average', 'RSI leaves oversold zone', 'Three candles agree', 'Volatility is below threshold']; return <><PageHeader eyebrow="No-code strategy lab" title="Bot builder" description="Assemble readable conditions, choose money management, and test the idea in your demo workspace." action={<button className="primary" onClick={() => setNotice('Strategy saved to your bot library.') }><Check size={16} /> Save strategy</button>} /><div className="builder-grid"><section className="panel"><div className="panel-title"><div><span className="eyebrow">When all conditions are true</span><h2>Entry conditions</h2></div><span className="count-badge">{blocks.length} blocks</span></div>{blocks.map((block, index) => <div className="condition" key={`${block}-${index}`}><div className="drag">⋮⋮</div><div><small>Condition {index + 1}</small><strong>{block}</strong></div><button className="icon-button" onClick={() => setBlocks((current) => current.filter((_, item) => item !== index))}><Trash2 size={15} /></button></div>)}<div className="add-blocks">{options.filter((option) => !blocks.includes(option)).map((option) => <button key={option} onClick={() => setBlocks((current) => [...current, option])}><Plus size={14} /> {option}</button>)}</div></section><section className="panel"><span className="eyebrow">Money management</span><h2>Execution rules</h2><label>Stake per trade<div className="input-prefix"><span>$</span><input defaultValue="10" /></div></label><label>Max trades per session<input type="number" defaultValue="8" /></label><label>Direction preference<select defaultValue="Both directions"><option>Both directions</option><option>CALL only</option><option>PUT only</option></select></label><div className="backtest"><div><BarChart3 size={18} /><div><strong>Ready to backtest</strong><span>Use your conditions against synthetic price history.</span></div></div><button className="secondary" onClick={() => setNotice('Backtest complete: 68% win rate across 124 synthetic trades.')}>Run backtest</button></div></section></div></>; }

function Signals({ tick, runTrade }: { tick: number; runTrade: (details: { instrument: string; direction: string; stake: number; source: string }) => Promise<void> }) { const [signal, setSignal] = useState<{ instrument: string; direction: string; confidence: number } | null>(null); const generate = () => setSignal({ instrument: instruments[tick % instruments.length], direction: tick % 2 ? 'CALL' : 'PUT', confidence: 72 + (tick % 20) }); return <><PageHeader eyebrow="Assisted decisions" title="Signal AI" description="Generate a plain-language suggestion, then approve or reject it yourself. Nothing executes without your click." action={<button className="primary" onClick={generate}><Sparkles size={16} /> Generate signal</button>} /><div className="signal-layout"><section className="panel signal-hero"><div className="signal-orb"><Sparkles size={28} /></div><span className="eyebrow">AI market read</span>{signal ? <><h2>{signal.direction} opportunity on {signal.instrument}</h2><p>Momentum is leaning {signal.direction === 'CALL' ? 'upward' : 'downward'} after a confirmed synthetic-index move. The model sees a clean setup, but the final decision stays with you.</p><div className="confidence"><div><span>Confidence</span><b>{signal.confidence}%</b></div><div className="progress"><span style={{ width: `${signal.confidence}%` }} /></div></div><div className="signal-actions"><button className="primary" onClick={() => void runTrade({ instrument: signal.instrument, direction: signal.direction, stake: 10, source: 'signal_ai' })}><Check size={16} /> Approve & execute</button><button className="secondary" onClick={() => setSignal(null)}><X size={16} /> Reject</button></div></> : <><h2>Ask for a fresh signal</h2><p>Generate a read of the current synthetic market, review the reasoning, and decide whether to execute.</p><button className="secondary" onClick={generate}>Generate first signal <ChevronRight size={15} /></button></>}</section><section className="panel"><div className="panel-title"><div><span className="eyebrow">Process</span><h2>How approval works</h2></div></div>{['Market conditions are scanned', 'Signal direction and confidence are shown', 'You approve or reject the trade', 'Execution and result enter the ledger'].map((item, index) => <div className="step" key={item}><span>{String(index + 1).padStart(2, '0')}</span><b>{item}</b><Check size={16} /></div>)}</section></div></>; }

function Bulk({ tick, runTrade }: { tick: number; runTrade: (details: { instrument: string; direction: string; stake: number; source: string }) => Promise<void> }) { const [selected, setSelected] = useState(instruments.slice(0, 3)); const [running, setRunning] = useState(false); const execute = async () => { setRunning(true); for (const instrument of selected) await runTrade({ instrument, direction: tick % 2 ? 'CALL' : 'PUT', stake: 5, source: 'bulk' }); setRunning(false); }; return <><PageHeader eyebrow="Multi-market execution" title="Bulk trader" description="Select a group of instruments and run one strategy across all of them with consistent sizing." action={<button className="primary" disabled={running || !selected.length} onClick={() => void execute()}>{running ? <><RefreshCw className="spin" size={16} /> Running…</> : <><Play size={16} /> Run across {selected.length}</>}</button>} /><div className="bulk-grid"><section className="panel"><div className="panel-title"><div><span className="eyebrow">Market selection</span><h2>Choose instruments</h2></div><button className="text-button" onClick={() => setSelected(selected.length === instruments.length ? [] : instruments)}>Select all</button></div>{instruments.map((instrument, index) => <button className={selected.includes(instrument) ? 'instrument selected' : 'instrument'} key={instrument} onClick={() => setSelected((current) => current.includes(instrument) ? current.filter((item) => item !== instrument) : [...current, instrument])}><div><span className="check-box">{selected.includes(instrument) && <Check size={13} />}</span><b>{instrument}</b></div><span className={index % 2 ? 'negative' : 'positive'}>{index % 2 ? '-0.18%' : '+0.31%'}</span></button>)}</section><section className="panel"><span className="eyebrow">Strategy preview</span><h2>Momentum Pulse</h2><p className="muted">Trades in the current direction when price momentum confirms. Each instrument uses a $5 stake in this demo run.</p><div className="bulk-summary"><div><span>Selected</span><strong>{selected.length}</strong></div><div><span>Total stake</span><strong>{money(selected.length * 5)}</strong></div><div><span>Mode</span><strong>Demo</strong></div></div><div className="guard-note"><ShieldCheck size={16} /> Loss guard applies to every trade in the batch.</div></section></div></>; }

function Quick({ tick, runTrade }: { tick: number; runTrade: (details: { instrument: string; direction: string; stake: number; source: string; botName?: string }) => Promise<void> }) { const presets = [{ name: 'Steady Start', detail: '$5 stake · Conservative', risk: 'Low' }, { name: 'Balanced Pulse', detail: '$10 stake · Moderate', risk: 'Medium' }, { name: 'Fast Momentum', detail: '$25 stake · Aggressive', risk: 'High' }]; return <><PageHeader eyebrow="One-click automation" title="Quick bot" description="Choose a sensible preset and get a bot watching the market in seconds." /><div className="quick-grid">{presets.map((preset, index) => <div className="quick-card" key={preset.name}><div className="quick-icon"><Zap size={20} /></div><span className="risk moderate">{preset.risk} risk</span><h2>{preset.name}</h2><p>{preset.detail}</p><div className="quick-status"><i className="live-dot" /> Ready to start</div><button className="primary full" onClick={() => void runTrade({ instrument: instruments[(tick + index) % instruments.length], direction: index === 1 ? 'PUT' : 'CALL', stake: [5, 10, 25][index], source: 'quick_bot', botName: `Quick · ${preset.name}` })}><Play size={16} /> Start demo run</button></div>)}</div><section className="panel session-panel"><div><span className="eyebrow">Session stats</span><h2>Quick bot runs stay visible</h2><p className="muted">Every result is recorded in the same public ledger so you can see what happened, not just a marketing claim.</p></div><div className="session-stats"><strong>0</strong><span>active quick sessions</span></div></section></>; }

function Apex({ bots, toggleBot, trades }: { bots: BotRow[]; toggleBot: (bot: BotRow) => Promise<void>; trades: Trade[] }) {
  const bot = bots.find((item) => item.name === 'Apex Momentum');
  const apexTrades = trades.filter((trade) => trade.bot_name === 'Apex Momentum');
  const closedApex = apexTrades.filter((t) => t.result === 'won' || t.result === 'lost');
  const hasUserTrades = closedApex.length > 0;
  const userWins = closedApex.filter((t) => t.result === 'won').length;
  const userWinRate = hasUserTrades ? Math.round((userWins / closedApex.length) * 100) : null;
  const displayWinRate = userWinRate !== null ? `${userWinRate}%` : '—';

  return (
    <>
      <PageHeader
        eyebrow="Flagship automation"
        title="Apex bot"
        description="An adaptive synthetic-index strategy with transparent performance and risk controls."
        action={bot ? <button className="primary" onClick={() => void toggleBot(bot)}>{bot.active ? <><Pause size={16} /> Pause Apex</> : <><Rocket size={16} /> Start Apex</>}</button> : undefined}
      />
      <div className="apex-banner">
        <div>
          <span className="pro-tag">APEX PRO</span>
          <h2>Adaptive momentum, clearly explained.</h2>
          <p>Reads momentum, volatility, and reversal pressure together. Position size stays inside your workspace loss guardrail.</p>
        </div>
        <div className="apex-score">
          <strong>{displayWinRate}</strong>
          <span>{hasUserTrades ? 'Your personal win rate' : '0 trades · Not run yet'}</span>
        </div>
      </div>
      {bot && <div className="bot-stats wide"><BotStats bot={bot} userTrades={apexTrades} /></div>}
      <section className="panel">
        <div className="panel-title">
          <div><span className="eyebrow">Performance</span><h2>Equity curve</h2></div>
          <span className="chart-time">Live <Activity size={14} /></span>
        </div>
        <EquityChart trades={apexTrades} color="#f2c576" />
      </section>
      <section className="panel"><div className="panel-title"><h2>Apex trade log</h2></div><TradeTable trades={apexTrades} /></section>
    </>
  );
}

function Record({ trades }: { trades: Trade[] }) { const [filter, setFilter] = useState('all'); const filtered = filter === 'all' ? trades : trades.filter((trade) => trade.result === filter); const total = trades.reduce((sum, trade) => sum + Number(trade.profit), 0); const exportCsv = () => { const csv = ['Instrument,Direction,Stake,Result,P/L,Source,Time', ...trades.map((trade) => [trade.instrument, trade.direction, trade.stake, trade.result, trade.profit, trade.source, trade.created_at].join(','))].join('\n'); const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'apex-track-record.csv'; link.click(); URL.revokeObjectURL(url); }; return <><PageHeader eyebrow="Public performance ledger" title="Track record" description="Every synthetic trade is timestamped and visible. Results cannot be edited after they close." action={<button className="secondary" onClick={exportCsv}><ArrowDownRight size={16} /> Export CSV</button>} /><div className="record-summary"><Stat label="Total trades" value={String(trades.length)} detail="All strategies" icon={BarChart3} /><Stat label="Win rate" value={trades.length ? `${Math.round(trades.filter((trade) => trade.result === 'won').length / trades.length * 100)}%` : '—'} detail="Closed trades" tone="success" icon={Target} /><Stat label="Cumulative P/L" value={money(total)} detail="Across this workspace" tone={total >= 0 ? 'success' : 'danger'} icon={total >= 0 ? TrendingUp : TrendingDown} /></div><section className="panel"><div className="panel-title"><div><span className="eyebrow">Performance</span><h2>Cumulative equity curve</h2></div></div><EquityChart trades={trades} /></section><section className="panel"><div className="panel-title"><h2>All trades</h2><div className="filter-tabs">{['all', 'won', 'lost'].map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div></div><TradeTable trades={filtered} /></section></>; }

function TradeTable({ trades, pageSize = 8 }: { trades: Trade[]; pageSize?: number }) {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(trades.length / pageSize);
  const current = trades.slice(page * pageSize, page * pageSize + pageSize);
  if (!trades.length) return <EmptyState title="No trades yet" text="Your executed trades will appear here with their final result." />;

  // Smart compact pagination: at most 4 items displayed to prevent mobile overflow
  const getPageNumbers = () => {
    if (totalPages <= 3) {
      return Array.from({ length: totalPages }, (_, i) => i);
    }
    const pages: (number | string)[] = [];
    if (page === 0) {
      pages.push(0, 1, '...', totalPages - 1);
    } else if (page === totalPages - 1) {
      pages.push(0, '...', totalPages - 2, totalPages - 1);
    } else {
      pages.push(0, page, '...', totalPages - 1);
    }
    return pages;
  };

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Instrument</th>
              <th>Direction</th>
              <th>Stake</th>
              <th>Result</th>
              <th>P/L</th>
              <th>Source</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {current.map((trade) => (
              <tr key={trade.id}>
                <td><b>{trade.instrument.replace('Volatility ', '')}</b></td>
                <td>
                  <span className={trade.direction === 'CALL' ? 'direction call-text' : 'direction put-text'}>
                    {trade.direction}
                  </span>
                </td>
                <td>{money(Number(trade.stake))}</td>
                <td>
                  <span className={trade.result === 'won' ? 'result won' : trade.result === 'lost' ? 'result lost' : 'result pending'}>
                    {trade.result}
                  </span>
                </td>
                <td className={trade.profit >= 0 ? 'positive' : 'negative'}>{money(Number(trade.profit))}</td>
                <td>{trade.bot_name ?? trade.source.replace('_', ' ')}</td>
                <td className="muted">{timeAgo(trade.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="pagination">
          <span className="page-info">
            Page {page + 1} of {totalPages} <span className="hide-mobile">· {trades.length} trades</span>
          </span>
          <div className="page-buttons">
            <button
              className="page-btn page-nav-btn"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Prev
            </button>
            <div className="page-numbers-group">
              {getPageNumbers().map((p, idx) =>
                typeof p === 'string' ? (
                  <span key={`ellipsis-${idx}`} className="page-ellipsis">…</span>
                ) : (
                  <button
                    key={p}
                    className={page === p ? 'page-btn active' : 'page-btn'}
                    onClick={() => setPage(p)}
                  >
                    {p + 1}
                  </button>
                )
              )}
            </div>
            <button
              className="page-btn page-nav-btn"
              disabled={page === totalPages - 1}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Settings({
  workspace,
  updateWorkspace,
  setNotice,
  deriv,
  onDerivConnect,
  onDerivDisconnect,
  onDerivSwitchAccount,
  derivConnected,
  isDerivReal,
  isDerivDemo,
  liveArmed,
  armLiveTrading,
  disarmLiveTrading,
  allowBotLiveTrading,
  setAllowBotLiveTrading,
  maxBalancePercent,
  setMaxBalancePercent,
  sessionLossUsed,
  lossLimit,
  guardPercent,
  lossLimitReached,
  resetSessionBaseline,
}: {
  workspace: Workspace;
  updateWorkspace: (changes: Partial<Workspace>) => Promise<void>;
  setNotice: (notice: string) => void;
  deriv: ReturnType<typeof useDerivConnection>;
  onDerivConnect: (token: string, appId: string) => void;
  onDerivDisconnect: () => void;
  onDerivSwitchAccount: (loginid: string) => void;
  derivConnected: boolean;
  isDerivReal: boolean;
  isDerivDemo: boolean;
  liveArmed: boolean;
  armLiveTrading: () => void;
  disarmLiveTrading: () => void;
  allowBotLiveTrading: boolean;
  setAllowBotLiveTrading: (allowed: boolean) => void;
  maxBalancePercent: number;
  setMaxBalancePercent: (percent: number) => void;
  sessionLossUsed: number;
  lossLimit: number;
  guardPercent: number;
  lossLimitReached: boolean;
  resetSessionBaseline: () => void;
}) {
  const [limitInput, setLimitInput] = useState(String(Math.max(1, Number(workspace.loss_limit ?? 50))));
  const activeBalance = derivConnected && deriv.account ? deriv.account.balance : workspace.balance;
  const parsedLimit = Math.max(1, Math.min(100000, Number(limitInput) || lossLimit));

  useEffect(() => {
    setLimitInput(String(Math.max(1, Number(workspace.loss_limit ?? 50))));
  }, [workspace.loss_limit]);

  const saveLossLimit = (value: number) => {
    const validated = Math.max(1, Math.min(100000, value));
    setLimitInput(String(validated));
    void updateWorkspace({ loss_limit: validated });
    setNotice(`Session loss limit saved: ${money(validated)}`);
  };

  return (
    <>
      <PageHeader
        eyebrow="Workspace controls"
        title="Settings"
        description="Connect Deriv, switch accounts, configure safety arming, manage your loss limits, and control bot automation."
      />
      <div className="settings-grid">
        <section className="panel deriv-panel">
          <div className="panel-title">
            <div><span className="eyebrow">Deriv connection</span><h2>Linked Deriv Accounts</h2></div>
          </div>
          <DerivConnectionPanel
            authState={deriv.authState}
            account={deriv.account}
            accounts={deriv.accounts}
            onConnect={onDerivConnect}
            onDisconnect={onDerivDisconnect}
            onSwitchAccount={onDerivSwitchAccount}
            isArmed={liveArmed}
          />
        </section>

        <section className="panel">
          <div className="panel-title">
            <div><span className="eyebrow">Live Execution Safety</span><h2>Live Arming Control</h2></div>
            <ShieldCheck className="success-icon" size={22} />
          </div>
          <p className="muted" style={{ marginBottom: '14px' }}>
            For safety, connecting Deriv always leaves live execution disarmed in demo mode until explicitly armed here or in the topbar.
          </p>
          {derivConnected && deriv.accounts.length > 1 && (
            <div className="account-quick-switch-bar" style={{ marginBottom: '14px' }}>
              <span className="muted">Active account: <b>{deriv.account?.loginid}</b> ({deriv.account?.is_virtual ? 'Demo' : 'Real'})</span>
              <div className="account-switch-actions">
                {deriv.accounts.map((acc) => (
                  <button
                    key={acc.loginid}
                    type="button"
                    className={`mini-acc-toggle ${acc.loginid === deriv.account?.loginid ? 'active' : ''}`}
                    disabled={acc.loginid === deriv.account?.loginid}
                    onClick={() => void onDerivSwitchAccount(acc.loginid)}
                  >
                    <span className={`badge-tag ${acc.is_virtual ? 'demo' : 'real'}`}>
                      {acc.is_virtual ? 'DEMO' : 'REAL'}
                    </span>
                    <b>{acc.loginid}</b>
                    <small>{acc.currency} {acc.balance.toFixed(2)}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mode-toggle">
            <button
              type="button"
              className={!liveArmed ? 'selected' : ''}
              onClick={disarmLiveTrading}
            >
              <div>
                <strong>Disarmed (Safe / Demo Mode)</strong>
                <span>Real funds are protected. Virtual or demo execution only.</span>
              </div>
              {!liveArmed && <Check size={17} />}
            </button>
            <button
              type="button"
              className={liveArmed ? 'selected' : ''}
              onClick={() => {
                armLiveTrading();
              }}
            >
              <div>
                <strong>{liveArmed ? 'LIVE EXECUTION ARMED' : isDerivReal ? 'Arm Live Trading' : 'Arm Live (Switch to Real)'}</strong>
                <span>{isDerivReal ? `Real orders execute on ${deriv.account?.loginid}` : (deriv.accounts.find((a) => !a.is_virtual) ? `Click to switch to ${deriv.accounts.find((a) => !a.is_virtual)?.loginid} & arm` : 'Connect a token with real account access')}</span>
              </div>
              {liveArmed && <Check size={17} />}
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-title">
            <div><span className="eyebrow">Automated Trading Safety</span><h2>Bot Live Trading Guard</h2></div>
            <Bot size={22} />
          </div>
          <p className="muted" style={{ marginBottom: '14px' }}>
            Automated live trading is blocked by default. Keep blocked so active bots only trade on Demo without risking real funds.
          </p>
          <div className="mode-toggle">
            <button
              type="button"
              className={!allowBotLiveTrading ? 'selected' : ''}
              onClick={() => {
                setAllowBotLiveTrading(false);
                setNotice('Automated bot live trading blocked. Bots will not trade real funds.');
              }}
            >
              <div>
                <strong>Blocked (Default / Recommended)</strong>
                <span>Active bots will never touch real money.</span>
              </div>
              {!allowBotLiveTrading && <Check size={17} />}
            </button>
            <button
              type="button"
              className={allowBotLiveTrading ? 'selected' : ''}
              onClick={() => {
                const confirmed = window.confirm('ALLOW AUTOMATED BOT LIVE TRADING?\n\nActive bots will place trades automatically on your real Deriv account when live mode is armed.\n\nRisk caps (Session loss limit & balance percentage) will be strictly enforced.\n\nProceed?');
                if (confirmed) {
                  setAllowBotLiveTrading(true);
                  setNotice('Automated bot live trading enabled. Bots can place live trades when armed.');
                }
              }}
            >
              <div>
                <strong>Allow Bot Live Trading</strong>
                <span>Active bots can place live trades when armed.</span>
              </div>
              {allowBotLiveTrading && <Check size={17} />}
            </button>
          </div>
        </section>

        <section className="panel">
          <span className="eyebrow">Risk guardrails</span>
          <h2>Max Risk per Trade (% Balance)</h2>
          <p className="muted">
            Live trade stakes are strictly capped at this percentage of your active account balance.
          </p>
          <div className="stake-row" style={{ marginTop: '12px' }}>
            {[1, 2, 3, 5].map((pct) => (
              <button
                key={pct}
                type="button"
                className={maxBalancePercent === pct ? 'selected' : ''}
                onClick={() => {
                  setMaxBalancePercent(pct);
                  setNotice(`Risk cap set to ${pct}% of balance (${money((activeBalance * pct) / 100)} max stake).`);
                }}
              >
                {pct}% {pct === 2 ? '(Safe)' : ''}
              </button>
            ))}
          </div>
          <div className="guard-note" style={{ marginTop: '14px' }}>
            Current maximum live stake allowed: <b>{money((activeBalance * maxBalancePercent) / 100)}</b> ({maxBalancePercent}% of {money(activeBalance)}).
          </div>
        </section>

        <section className="panel guard-panel">
          <div className="panel-title">
            <div><span className="eyebrow">Risk guardrails</span><h2>Session loss limit</h2></div>
            <ShieldCheck className={lossLimitReached ? 'danger-icon' : 'success-icon'} size={22} />
          </div>
          <p className="muted">New trades stop automatically when your session drawdown reaches this amount. Works on Deriv demo, Deriv live, and synthetic workspace.</p>
          <LossGuardRail
            sessionLossUsed={sessionLossUsed}
            lossLimit={lossLimit}
            guardPercent={guardPercent}
            lossLimitReached={lossLimitReached}
          />
          <div className="loss-limit-controls">
            <label className="field-label" htmlFor="loss-limit-input">Set session loss limit</label>
            <div className="loss-limit-presets">
              {[50, 100, 250, 500, 1000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={parsedLimit === preset ? 'selected' : ''}
                  onClick={() => saveLossLimit(preset)}
                >
                  ${preset.toLocaleString()}
                </button>
              ))}
            </div>
            <div className="input-prefix big">
              <span>$</span>
              <input
                id="loss-limit-input"
                type="number"
                min={1}
                max={100000}
                step={1}
                value={limitInput}
                onChange={(event) => setLimitInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') saveLossLimit(parsedLimit);
                }}
              />
            </div>
            <div className="loss-limit-actions">
              <button
                type="button"
                className="primary"
                onClick={() => saveLossLimit(parsedLimit)}
              >
                Save loss limit
              </button>
              <button type="button" className="secondary" onClick={resetSessionBaseline}>
                <RefreshCw size={16} /> Reset session baseline
              </button>
            </div>
            <div className="guard-note">
              Current session loss: <b>{money(sessionLossUsed)}</b> · {lossLimitReached ? 'Limit reached — trading blocked' : `${money(Math.max(0, parsedLimit - sessionLossUsed))} remaining at this limit`}
            </div>
          </div>
        </section>

        <section className="panel reset-panel">
          <span className="eyebrow">Reset controls</span>
          <h2>Start a clean demo session</h2>
          <p className="muted">Resetting returns the synthetic demo balance to $10,000 and clears the session loss counter. Your track record stays available for review.</p>
          <button
            className="secondary"
            onClick={() => {
              void updateWorkspace({ balance: workspace.starting_balance });
              resetSessionBaseline();
              setNotice('Demo balance reset to $10,000. Session loss counter cleared.');
            }}
          >
            <RefreshCw size={16} /> Reset balance & session
          </button>
        </section>
      </div>
    </>
  );
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) { return <div className="empty"><div className="empty-icon"><Activity size={18} /></div><strong>{title}</strong><span>{text}</span>{action}</div>; }

export default App;
