import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient, type User } from '@supabase/supabase-js';
import { Activity, AlertCircle, AlertTriangle, ArrowDownRight, ArrowUpRight, ChartBar as BarChart3, Bot, CandlestickChart, Check, CheckCircle2, ChevronRight, Clock3, Code as Code2, FileText, Ghost, Globe, Hash, LayoutDashboard, ChartLine as LineChart, ListFilter, LogOut, Menu, Pause, Play, Plus, RefreshCw, Rocket, Settings2, ShieldCheck, Sparkles, Target, Trash2, TrendingDown, TrendingUp, User as UserIcon, Wallet, X, Zap } from 'lucide-react';
import { useDerivConnection } from './use-deriv';
import { DerivConnectionPanel, DerivStatusBadge } from './deriv-connection';
import { applyBalanceDelta, executeTrade, getAccountInfo, getBalance, subscribeContract, symbolMap, isLive as derivIsLive, type DerivSymbol, type DerivTradeResult } from './deriv-client';
import { AuthModal } from './auth-modal';
import { ManualTrader } from './manual-trader';
import { DigitsAnalyser } from './digits-analyser';
import { LandingPage } from './landing-page';
import { PolicyModal, getPolicyConsent, recordPolicyConsent, type PolicyTab } from './policy-modal';

const DEFAULT_APP_ID = '34mV1HDCcx9gNO0aCEQMg';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? '',
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
);

type Page = 'dashboard' | 'bots' | 'manual' | 'builder' | 'signals' | 'bulk' | 'quick' | 'apex' | 'phantom' | 'stpv3' | 'digits' | 'record' | 'settings';
type Trade = { id: string; user_id?: string | null; instrument: string; direction: string; stake: number; result: string; profit: number; source: string; bot_name?: string; entry_price: number; exit_price?: number; created_at: string; execution_context?: 'synthetic' | 'deriv'; deriv_loginid?: string | null };
type BotRow = { id: string; name: string; description: string; risk: string; active: boolean; demo_only: boolean; total_trades: number; wins: number; pnl: number; won_amount: number; lost_amount: number; benchmark_win_rate?: number; benchmark_trades?: number };

// Per-bot user-configurable parameters. Stored in localStorage per user.
interface PhantomConfig {
  baseStake: number;           // normal-conditions stake
  rsiOverbought: number;       // 0–1 scale, default 0.72
  rsiOversold: number;         // 0–1 scale, default 0.28
  lossFadeAt: number;          // consecutive losses before fading direction, default 2
  winStepAt: number;           // consecutive wins before stepping up to V100, default 3
  sessionFilter: boolean;      // respect UTC prime-window filter, default true
}
interface StpConfig {
  stakeMode: 'fixed' | 'percent'; // fixed $ or % of balance
  stakeValue: number;             // $ amount (fixed) or % (percent), default 1 (1%)
  stakeMin: number;               // minimum stake when percent mode, default 5
  stakeMax: number;               // maximum stake when percent mode, default 50
  scoreThreshold: number;         // 0–100, default 75
  adxMin: number;                 // minimum ADX, default 22
  cooldownMinutes: number;        // cooldown after 3 losses, default 15
}
interface DefaultBotConfig {
  stake: number;                  // fixed stake, default 10
}
type BotConfig = PhantomConfig | StpConfig | DefaultBotConfig;

function getBotConfigKey(userId: string, botName: string) {
  return `apex_bot_cfg_${userId}_${botName.replace(/\s+/g, '_')}`;
}
function loadBotConfig<T>(userId: string, botName: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(getBotConfigKey(userId, botName));
    if (raw) return { ...defaults, ...JSON.parse(raw) } as T;
  } catch { /* ignore */ }
  return defaults;
}
function saveBotConfig(userId: string, botName: string, config: BotConfig): void {
  try {
    localStorage.setItem(getBotConfigKey(userId, botName), JSON.stringify(config));
  } catch { /* ignore */ }
}

const PHANTOM_DEFAULTS: PhantomConfig = {
  baseStake: 12, rsiOverbought: 0.72, rsiOversold: 0.28,
  lossFadeAt: 2, winStepAt: 3, sessionFilter: true,
};
const STP_DEFAULTS: StpConfig = {
  stakeMode: 'percent', stakeValue: 1, stakeMin: 5, stakeMax: 50,
  scoreThreshold: 75, adxMin: 22, cooldownMinutes: 15,
};
const DEFAULT_BOT_DEFAULTS: DefaultBotConfig = { stake: 10 };
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
  { key: 'phantom', label: 'Phantom Scalper', icon: Ghost },
  { key: 'stpv3', label: 'Trend Pullback V3', icon: CandlestickChart },
  { key: 'digits', label: 'Digits Analyser', icon: Hash },
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
  // Primary: sessionStorage (survives tab reload, cleared on tab close)
  let saved = sessionStorage.getItem(getSessionStartKey(userId));
  let savedAt = sessionStorage.getItem(getSessionStartAtKey(userId));
  if (!saved) {
    saved = sessionStorage.getItem(`apex_session_start_bal_${userId}_undefined`);
    savedAt = savedAt || sessionStorage.getItem(`apex_session_start_at_${userId}_undefined`);
  }
  // Fallback: localStorage (survives tab close — cleared when user resets baseline)
  if (!saved) {
    saved = localStorage.getItem(getSessionStartKey(userId));
    savedAt = savedAt || localStorage.getItem(getSessionStartAtKey(userId));
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
    if (import.meta.env.DEV) console.warn('Failed loading local trades:', err);
  }
  return [];
}

function saveUserTradesToStorage(userId: string, trades: Trade[]): void {
  try {
    localStorage.setItem(getUserTradesKey(userId), JSON.stringify(trades.slice(0, 300)));
  } catch (err) {
    if (import.meta.env.DEV) console.warn('Failed saving local trades:', err);
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
    if (import.meta.env.DEV) console.warn('Failed loading local workspace:', err);
  }
  return null;
}

function saveUserWorkspaceToStorage(userId: string, ws: Workspace): void {
  try {
    localStorage.setItem(getUserWorkspaceKey(userId), JSON.stringify(ws));
  } catch (err) {
    if (import.meta.env.DEV) console.warn('Failed saving local workspace:', err);
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

// ─── STP-V3 Indicator Engine ──────────────────────────────────────────────────

interface Candle { open: number; high: number; low: number; close: number }

/** Build N synthetic 1-minute OHLC candles for the given instrument index ending at currentTick.
 *  priceFor() is deterministic so any past tick can be reconstructed without storing history. */
function buildSyntheticCandles(instrIdx: number, currentTick: number, count: number): Candle[] {
  const TICKS_PER_MIN = 37; // ~1 600 ms per tick → ~37.5 ticks/minute
  const candles: Candle[] = [];
  for (let c = count - 1; c >= 0; c--) {
    const startTick = currentTick - (c + 1) * TICKS_PER_MIN;
    const endTick   = currentTick - c * TICKS_PER_MIN;
    const open  = priceFor(instrIdx, startTick);
    const close = priceFor(instrIdx, endTick);
    let high = Math.max(open, close);
    let low  = Math.min(open, close);
    for (let t = startTick + 4; t < endTick; t += 4) {
      const p = priceFor(instrIdx, t);
      if (p > high) high = p;
      if (p < low)  low  = p;
    }
    candles.push({ open, high, low, close });
  }
  return candles;
}

/** Wilder EMA (same as used in ATR / ADX).  k = 1/period for standard Wilder smoothing. */
function wilderEma(values: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period) {
      sum += values[i];
      if (i === period - 1) result.push(sum / period);
      else result.push(NaN);
    } else {
      const prev = result[i - 1];
      result.push((prev * (period - 1) + values[i]) / period);
    }
  }
  return result;
}

/** Standard EMA (used for EMA20/EMA50 price lines). */
function calcEma(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = new Array(closes.length).fill(NaN);
  let started = false;
  let prev = 0;
  for (let i = 0; i < closes.length; i++) {
    if (!started) {
      if (i < period - 1) continue;
      // Seed with SMA
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      prev = sum / period;
      result[i] = prev;
      started = true;
    } else {
      prev = closes[i] * k + prev * (1 - k);
      result[i] = prev;
    }
  }
  return result;
}

interface StpIndicators {
  ema20: number; ema50: number;
  ema20Prev5: number;       // ema20 value 5 candles ago
  atr14: number;
  atr50Avg: number;
  adx14: number;
  lastCandle: Candle;
  prevCandle: Candle;
}

/** Compute all STP-V3 indicators from a candle array (needs ≥ 60 candles). */
function calcStpIndicators(candles: Candle[]): StpIndicators | null {
  if (candles.length < 60) return null;
  const closes = candles.map(c => c.close);
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);

  // EMA20 / EMA50
  const ema20arr = calcEma(closes, 20);
  const ema50arr = calcEma(closes, 50);
  const last = candles.length - 1;
  const ema20 = ema20arr[last];
  const ema50 = ema50arr[last];
  const ema20Prev5 = ema20arr[last - 5] ?? NaN;
  if (isNaN(ema20) || isNaN(ema50) || isNaN(ema20Prev5)) return null;

  // ATR14
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i]  - closes[i - 1]),
    );
    trueRanges.push(tr);
  }
  const atr14arr  = wilderEma(trueRanges, 14);
  const atr50arr  = wilderEma(trueRanges, 50);
  const atr14    = atr14arr[atr14arr.length - 1];
  const atr50Avg = atr50arr[atr50arr.length - 1];
  if (isNaN(atr14) || isNaN(atr50Avg) || atr14 <= 0) return null;

  // ADX14 (Wilder)
  const plusDm: number[]  = [];
  const minusDm: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const upMove   = highs[i]  - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const smoothedTr   = wilderEma(trueRanges, 14);
  const smoothedPlus = wilderEma(plusDm, 14);
  const smoothedMinus = wilderEma(minusDm, 14);
  const dx: number[] = [];
  for (let i = 0; i < smoothedTr.length; i++) {
    if (isNaN(smoothedTr[i]) || smoothedTr[i] === 0) { dx.push(NaN); continue; }
    const diPlus  = (smoothedPlus[i]  / smoothedTr[i]) * 100;
    const diMinus = (smoothedMinus[i] / smoothedTr[i]) * 100;
    const sum = diPlus + diMinus;
    dx.push(sum === 0 ? 0 : (Math.abs(diPlus - diMinus) / sum) * 100);
  }
  const adxArr = wilderEma(dx.filter(v => !isNaN(v)), 14);
  const adx14  = adxArr[adxArr.length - 1];
  if (isNaN(adx14)) return null;

  return {
    ema20, ema50, ema20Prev5, atr14, atr50Avg, adx14,
    lastCandle: candles[last],
    prevCandle: candles[last - 1],
  };
}

/** STP-V3 full signal evaluation. Returns null if no trade, or { direction, score } if signal fires. */
function evalStpV3Signal(ind: StpIndicators, scoreThreshold = 75, adxMin = 22): { direction: 'CALL' | 'PUT'; score: number } | null {
  const { ema20, ema50, ema20Prev5, atr14, atr50Avg, adx14, lastCandle, prevCandle } = ind;
  const atrRatio = atr14 / (atr50Avg || 1);

  // ── Hard filter: Volatility regime ──────────────────────────────────────────
  if (atrRatio > 1.50) return null;

  // ── Stage 1: Trend detection ─────────────────────────────────────────────────
  const bullish = ema20 > ema50;
  const bearish = ema20 < ema50;
  const emaSlopeUp   = ema20 > ema20Prev5;
  const emaSlopeDown = ema20 < ema20Prev5;
  const emaGap = Math.abs(ema20 - ema50);
  if (emaGap < 0.10 * atr14) return null;          // insufficient separation
  if (!bullish && !bearish)   return null;
  const isBull = bullish && emaSlopeUp;
  const isBear = bearish && emaSlopeDown;
  if (!isBull && !isBear) return null;              // slope disagrees with crossover

  // ── Stage 2: Pullback to EMA20 ───────────────────────────────────────────────
  const pullDist = isBull
    ? Math.abs(lastCandle.low  - ema20)
    : Math.abs(lastCandle.high - ema20);
  if (pullDist > 0.30 * atr14) return null;         // pullback too deep / not close enough

  // ── Stage 3: Structure — swing high/low must stay intact ────────────────────
  // Approximate: previous candle must form a higher low (bull) or lower high (bear)
  if (isBull && lastCandle.low < prevCandle.low - 0.20 * atr14) return null;
  if (isBear && lastCandle.high > prevCandle.high + 0.20 * atr14) return null;

  // ── Stage 4: Confirmation candle ────────────────────────────────────────────
  const bodySize = Math.abs(lastCandle.close - lastCandle.open);
  if (bodySize < 0.50 * atr14) return null;         // body too small
  const bullConf = lastCandle.close > lastCandle.open && lastCandle.close > ema20;
  const bearConf = lastCandle.close < lastCandle.open && lastCandle.close < ema20;
  if (isBull && !bullConf) return null;
  if (isBear && !bearConf) return null;

  // ── Stage 5: ADX ────────────────────────────────────────────────────────────
  if (adx14 < adxMin) return null;

  // ── Scoring (100 pts) ────────────────────────────────────────────────────────
  // Trend quality (25 pts)
  const emaSlope5 = Math.abs(ema20 - ema20Prev5);
  const trendScore = emaGap >= 0.30 * atr14 && emaSlope5 >= 0.05 * atr14 ? 25
    : emaGap >= 0.20 * atr14 ? 18 : 12;

  // Pullback quality (20 pts)
  const pullbackScore = pullDist <= 0.15 * atr14 ? 20 : pullDist <= 0.22 * atr14 ? 14 : 8;

  // Confirmation candle (20 pts)
  const bodyRatio = bodySize / atr14;
  const confirmScore = bodyRatio >= 0.80 ? 20 : bodyRatio >= 0.65 ? 15 : 10;

  // ADX (20 pts)
  const adxScore = adx14 >= 30 ? 20 : adx14 >= 25 ? 15 : adx14 >= adxMin ? 10 : 0;

  // Volatility regime (15 pts)
  const volScore = atrRatio <= 1.0 ? 15 : atrRatio <= 1.25 ? 12 : 8;

  const totalScore = trendScore + pullbackScore + confirmScore + adxScore + volScore;
  if (totalScore < scoreThreshold) return null;

  return { direction: isBull ? 'CALL' : 'PUT', score: totalScore };
}

// ─── End STP-V3 Indicator Engine ─────────────────────────────────────────────

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [page, setPage] = useState<Page>('dashboard');
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [bots, setBots] = useState<BotRow[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [tick, setTick] = useState(8);
  const [loading, setLoading] = useState(true);
  const [botsLoadError, setBotsLoadError] = useState(false);
  const [notice, setNotice] = useState('');
  const [tradeAlert, setTradeAlert] = useState<TradeAlert | null>(null);
  // Live P&L for open (pending) contracts — keyed by trade id
  const [openContractPnl, setOpenContractPnl] = useState<Record<string, { profit: number; entryPrice: number; instrument: string; direction: string; stake: number }>>({});
  const [confirmModal, setConfirmModal] = useState<{
    title: string; body: string;
    rows?: { label: string; value: string }[];
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [policyTab, setPolicyTab] = useState<PolicyTab | null>(null);
  const [consentGiven, setConsentGiven] = useState(() => getPolicyConsent() !== null);
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
  // Per-bot runtime state for STP-V3 (cooldown + consecutive loss counter)
  const stpV3StateRef = useRef<{ consecutiveLosses: number; lastLossTime: number }>({
    consecutiveLosses: 0,
    lastLossTime: 0,
  });
  // Per-bot live-readable config (read in the setInterval closure)
  const botConfigRef = useRef<Record<string, BotConfig>>({});
  // Live signal status per bot — shown on the dedicated pages
  const [botStatus, setBotStatus] = useState<Record<string, string>>({});

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
    // Write to both sessionStorage (fast) and localStorage (survives tab close)
    sessionStorage.setItem(getSessionStartKey(uid), String(balance));
    sessionStorage.setItem(getSessionStartAtKey(uid), startedAt);
    localStorage.setItem(getSessionStartKey(uid), String(balance));
    localStorage.setItem(getSessionStartAtKey(uid), startedAt);
  };

  const clearSessionStartBalance = () => {
    sessionStartingBalRef.current = null;
    sessionStartAtRef.current = null;
    setSessionStartingBalance(null);
    setSessionStartedAt(null);
    const uid = userRef.current?.id || user?.id || 'guest';
    sessionStorage.removeItem(getSessionStartKey(uid));
    sessionStorage.removeItem(getSessionStartAtKey(uid));
    localStorage.removeItem(getSessionStartKey(uid));
    localStorage.removeItem(getSessionStartAtKey(uid));
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

  // Restore session baseline from storage on login. Uses userRef so the key matches
  // what syncSessionStartBalance writes (userRef is always the latest user object).
  useEffect(() => {
    if (!user) return;
    const uid = user.id;
    const restored = restoreSessionBaseline(uid);
    if (restored.balance !== null) {
      sessionStartingBalRef.current = restored.balance;
      setSessionStartingBalance(restored.balance);
    }
    if (restored.startedAt) {
      sessionStartAtRef.current = restored.startedAt;
      setSessionStartedAt(restored.startedAt);
    }
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seed a baseline only when there genuinely is none yet (first-ever login, or after reset)
  useEffect(() => {
    if (sessionStartingBalRef.current !== null) return; // already set — do not overwrite
    if (deriv.account) {
      syncSessionStartBalance(deriv.account.balance);
    } else if (workspace && user) {
      syncSessionStartBalance(workspace.starting_balance);
    }
  }, [deriv.account?.loginid, workspace?.id, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Falls back to unfiltered query if user_id column doesn't exist yet (migration pending)
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
        if (import.meta.env.DEV) console.warn('Workspace user_id query fallback:', error.message);
        // Column may not exist yet — try legacy single-workspace query
        const legacy = await supabase.from('trading_workspace').select('*').limit(1).maybeSingle();
        if (!legacy.error && legacy.data) {
          ws = legacy.data as Workspace;
          wsLoaded = true;
        }
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn('Failed loading user workspace:', e);
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
        // Fallback to hardcoded default workspace (legacy query removed — RLS blocks it anyway)
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

      const fetchedTrades: Trade[] | null = (!error && Array.isArray(data))
        ? data as Trade[]
        // Column not yet added — fall back to all trades (pre-migration compatibility)
        : (!error ? null : await supabase
            .from('trading_trades')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(200)
            .then(r => (!r.error && Array.isArray(r.data) ? r.data as Trade[] : null)));

      if (fetchedTrades) {
        const tradeMap = new Map<string, Trade>();
        localTrades.forEach((t) => tradeMap.set(t.id, t));
        fetchedTrades.forEach((t) => {
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
      if (import.meta.env.DEV) console.warn('Failed loading remote user trades, keeping local trades:', e);
    }

    // 3. Fetch bots library and isolate activation & stats strictly per user
    // NOTE: trading_bots is a read-only catalog (RLS blocks client inserts).
    // New bots must be seeded via Supabase migrations run server-side.
    let botsData: BotRow[] = [];
    const botsResult = await supabase.from('trading_bots').select('*').order('name');
    if (botsResult.error) {
      if (import.meta.env.DEV) console.warn('Failed to load bot catalog:', botsResult.error.message);
      setBotsLoadError(true);
    } else if (!botsResult.data || botsResult.data.length === 0) {
      setBotsLoadError(true);
    } else {
      setBotsLoadError(false);
    }
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

    // Load per-bot configs from localStorage into the ref so the bot loop can read them
    const defaultBots = ['Reverse Signal', 'Momentum Pulse', 'Range Scout', 'Apex Momentum'];
    const defaultCfgs = Object.fromEntries(
      defaultBots.map(name => [name, loadBotConfig(currentUser.id, name, DEFAULT_BOT_DEFAULTS)])
    );
    botConfigRef.current = {
      ...defaultCfgs,
      'Phantom Scalper': loadBotConfig(currentUser.id, 'Phantom Scalper', PHANTOM_DEFAULTS),
      'Trend Pullback V3': loadBotConfig(currentUser.id, 'Trend Pullback V3', STP_DEFAULTS),
    };
    setLoading(false);

    // Auto-reconnect to Deriv if user previously connected (persists across page refresh)
    const storedDerivToken =
      localStorage.getItem(`apex_deriv_token_${currentUser.id}`) ||
      localStorage.getItem('apex_deriv_token');

    if (storedDerivToken && deriv.authState !== 'connected' && deriv.authState !== 'connecting') {
      void handleDerivConnect(storedDerivToken, DEFAULT_APP_ID, true);
    }
  };

  // ── Deriv OAuth callback handler ─────────────────────────────────────────
  // Fires when Deriv redirects back to /callback?token1=...&acct1=...
  useEffect(() => {
    if (window.location.pathname !== '/callback') return;
    const params = new URLSearchParams(window.location.search);
    const token1 = params.get('token1');
    if (!token1) return;

    // Clean the URL immediately so refreshing doesn't re-trigger
    window.history.replaceState({}, '', '/');

    // Store the token and connect — same path as manual PAT entry
    // The Supabase auth check runs in parallel; once user is set, load() picks up the token
    localStorage.setItem('apex_deriv_token', token1);
    void handleDerivConnect(token1, DEFAULT_APP_ID);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Check initial auth session
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        const activeUser = session?.user ?? null;
        setUser(activeUser);
        setAuthChecking(false);
        if (activeUser) {
          void load(activeUser);
        }
      })
      .catch(() => {
        // Supabase unreachable — unblock the app and show the landing/auth screen
        setAuthChecking(false);
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
      if (error && import.meta.env.DEV) console.warn('Supabase workspace update fallback to local:', error.message);
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
        setConfirmModal({
          title: 'Switch to Real account & arm live trading?',
          body: `You are currently on Demo (${deriv.account.loginid}). This will switch to your Real account and arm live execution.`,
          rows: [
            { label: 'Real account', value: realAcc.loginid },
            { label: 'Balance', value: `${realAcc.currency} ${realAcc.balance.toFixed(2)}` },
          ],
          danger: true,
          onConfirm: () => {
            void (async () => {
              await handleDerivSwitchAccount(realAcc.loginid);
              syncSessionStartBalance(realAcc.balance);
              setLiveArmed(true);
              setNotice(`Switched to Real account (${realAcc.loginid}) and LIVE TRADING ARMED.`);
            })();
          },
        });
        return;
      } else {
        setNotice('No real Deriv account found on this token. Connect an API token that has real account access.');
        return;
      }
    }

    const maxStake = ((deriv.account.balance * maxBalancePercent) / 100).toFixed(2);
    setConfirmModal({
      title: 'Arm live real-money trading?',
      body: 'Real funds will be moved on Deriv. All trades execute immediately at market price.',
      rows: [
        { label: 'Account', value: `${deriv.account.loginid} (Real)` },
        { label: 'Balance', value: `${deriv.account.currency} ${deriv.account.balance.toFixed(2)}` },
        { label: 'Session loss limit', value: money(workspace?.loss_limit ?? 50) },
        { label: 'Max stake cap', value: `${maxBalancePercent}% (${money(Number(maxStake))})` },
        { label: 'Bot trading', value: allowBotLiveTrading ? 'ALLOWED' : 'Blocked (default)' },
      ],
      danger: true,
      onConfirm: () => {
        syncSessionStartBalance(deriv.account!.balance);
        setLiveArmed(true);
        setNotice(`LIVE TRADING ARMED on account ${deriv.account!.loginid}. Real funds active.`);
      },
    });
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
      // Only create a new session baseline if one doesn't already exist.
      // Reconnecting to the same account should preserve the prior session window
      // so trades and P&L history remain visible.
      if (sessionStartingBalRef.current === null) {
        syncSessionStartBalance(result.account.balance);
      }

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

  const runTrade = async (details: { instrument: string; direction: string; stake: number; source: string; botName?: string; barrier?: number; growth_rate?: number; duration?: number }) => {
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
          contract_type: details.direction as 'CALL' | 'PUT' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF' | 'ACCU',
          stake: details.stake,
          duration: details.duration ?? 5,
          barrier: details.barrier,
          growth_rate: details.growth_rate,
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
          execution_context: 'deriv',
          deriv_loginid: deriv.account?.loginid ?? null,
        };

        // Immediately persist to local user storage and React state
        persistTrade(trade);

        // Background insert to Supabase (non-blocking)
        void (async () => {
          try {
            const { error: insErr } = await supabase.from('trading_trades').insert(trade);
            // If user_id column doesn't exist yet, retry without it
            if (insErr) {
              const { user_id: _uid, ...tradeNoUser } = trade;
              await supabase.from('trading_trades').insert(tradeNoUser);
            }
          } catch { /* ignore */ }
        })();

        subscribeContract(result.contractId, (poc: DerivTradeResult) => {
          if (poc.status === 'won' || poc.status === 'lost') {
            const finalProfit = poc.profit;
            const win = poc.status === 'won';

            // Remove from live P&L panel on settlement
            setOpenContractPnl(prev => { const next = { ...prev }; delete next[tradeId]; return next; });

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
              // STP-V3 consecutive loss tracking
              if (details.botName === 'Trend Pullback V3') {
                if (!win) {
                  stpV3StateRef.current.consecutiveLosses += 1;
                  stpV3StateRef.current.lastLossTime = Date.now();
                } else {
                  stpV3StateRef.current.consecutiveLosses = 0;
                }
              }
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
              stopAllBots();
              setNotice(`Session loss limit (${money(ws.loss_limit)}) reached after this trade. All bots stopped.${isDerivReal ? ' Live trading disarmed.' : ''}`);
            } else {
              setNotice(`${poc.status === 'won' ? '🎉' : '📉'} ${details.direction} trade ${poc.status.toUpperCase()} ${poc.status === 'won' ? '+' : ''}${money(finalProfit)}`);
            }
          }
        }, (poc: DerivTradeResult) => {
          // Live P&L update for the open contracts bar
          setOpenContractPnl(prev => ({
            ...prev,
            [tradeId]: {
              profit: poc.profit,
              entryPrice: poc.entry_price,
              instrument: details.instrument,
              direction: details.direction,
              stake: details.stake,
            },
          }));
        });
        // Seed the open contracts panel immediately on purchase
        setOpenContractPnl(prev => ({
          ...prev,
          [tradeId]: {
            profit: 0,
            entryPrice: result.entryPrice,
            instrument: details.instrument,
            direction: details.direction,
            stake: details.stake,
          },
        }));
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
      execution_context: 'synthetic',
      deriv_loginid: null,
    };

    // Immediately persist trade to local storage and state
    persistTrade(trade);

    // Background insert to Supabase
    void (async () => {
      try {
        const { error: insErr } = await supabase.from('trading_trades').insert(trade);
        if (insErr) {
          const { user_id: _uid, ...tradeNoUser } = trade;
          await supabase.from('trading_trades').insert(tradeNoUser);
        }
      } catch { /* ignore */ }
    })();

    await updateWorkspace({ balance: Number((ws.balance + profit).toFixed(2)) });
    if (details.botName) {
      updateBotStatsFromTrade(details.botName, profit, win);
      // STP-V3 consecutive loss tracking (synthetic path)
      if (details.botName === 'Trend Pullback V3') {
        if (!win) {
          stpV3StateRef.current.consecutiveLosses += 1;
          stpV3StateRef.current.lastLossTime = Date.now();
        } else {
          stpV3StateRef.current.consecutiveLosses = 0;
        }
      }
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
      stopAllBots();
      setNotice(`Session loss limit (${money(ws.loss_limit)}) reached. All bots stopped. Reset the session baseline in Settings to resume.`);
    } else {
      setNotice(`${win ? '🎉' : '📉'} ${details.direction} trade ${win ? 'WON' : 'LOST'} ${win ? '+' : ''}${money(profit)}`);
    }
  };

  // Deactivates every running bot — called when the session loss limit is hit
  const stopAllBots = () => {
    setBots((current) => {
      const anyActive = current.some((b) => b.active);
      if (!anyActive) return current;
      const stopped = current.map((b) => ({ ...b, active: false }));
      if (userRef.current) {
        localStorage.setItem(`apex_active_bots_${userRef.current.id}`, JSON.stringify([]));
      }
      void updateWorkspace({ active_bots: [] }).catch(() => {});
      return stopped;
    });
    botPendingTradesRef.current.clear();
  };

  const saveBotConfigAndUpdate = (botName: string, config: BotConfig) => {
    const uid = userRef.current?.id || user?.id || 'guest';
    saveBotConfig(uid, botName, config);
    botConfigRef.current = { ...botConfigRef.current, [botName]: config };
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
      if (import.meta.env.DEV) console.warn('Could not save user active bots:', e);
    }

    setNotice(nextActive ? `${bot.name} is live and watching conditions.` : `${bot.name} paused.`);
  };

  useEffect(() => {
    const interval = window.setInterval(() => {
      const activeBots = botsRef.current.filter((bot) => bot.active);
      const ws = workspaceRef.current;
      if (!activeBots.length || !ws) return;

      // Stop all bots immediately if the session loss limit has been reached
      const loopStartBal = sessionStartingBalRef.current ?? ws.starting_balance;
      const loopCurrentBal = derivConnected && deriv.account ? deriv.account.balance : ws.balance;
      const loopLossUsed = computeSessionLoss(loopStartBal, loopCurrentBal, tradesRef.current, sessionStartAtRef.current);
      if (loopLossUsed >= ws.loss_limit) {
        stopAllBots();
        return;
      }

      const currentTick = tickRef.current;
      activeBots.forEach((bot, i) => {
        if (botPendingTradesRef.current.has(bot.name)) return;

        let instrument: string;
        let direction: 'CALL' | 'PUT';
        let stake: number;

        if (bot.name === 'Phantom Scalper') {
          // ── Phantom Scalper: multi-signal strategy ──────────────────────────
          const cfg = (botConfigRef.current['Phantom Scalper'] ?? PHANTOM_DEFAULTS) as PhantomConfig;

          // Signal 1: EMA trend bias via tick oscillator
          const shortEma = Math.sin(currentTick / 3);
          const longEma  = Math.cos(currentTick / 8);
          const emaBullish = shortEma > longEma;

          // Signal 2: RSI-like momentum — thresholds from user config
          let gains = 0; let losses = 0;
          for (let t = 1; t <= 6; t++) {
            const delta = priceFor(3, currentTick - t + 1) - priceFor(3, currentTick - t);
            if (delta > 0) gains++; else losses++;
          }
          const rsi = gains / (gains + losses || 1);
          const rsiOverbought = rsi > cfg.rsiOverbought;
          const rsiOversold   = rsi < cfg.rsiOversold;

          // Signal 3: Streak tracking
          const recentBot = tradesRef.current
            .filter((t) => t.bot_name === 'Phantom Scalper' && (t.result === 'won' || t.result === 'lost'))
            .slice(0, 5);
          const recentLosses = recentBot.filter((t) => t.result === 'lost').length;
          const recentWins   = recentBot.filter((t) => t.result === 'won').length;

          // Signal 4: Session window filter (user-configurable on/off)
          const hour = new Date().getUTCHours();
          const inPrimeWindow = !cfg.sessionFilter ||
            ((hour >= 7 && hour < 11) || (hour >= 13 && hour < 17) || (hour >= 19 && hour < 23));

          // Instrument + stake — scale from base stake
          if (recentLosses >= cfg.lossFadeAt && recentWins === 0) {
            instrument = 'Volatility 50 Index';
            stake      = Math.max(1, cfg.baseStake - 4);
            setBotStatus(s => ({ ...s, 'Phantom Scalper': '⚠️ Recovery mode — V50' }));
          } else if (recentWins >= cfg.winStepAt) {
            instrument = 'Volatility 100 Index';
            stake      = cfg.baseStake + 3;
            setBotStatus(s => ({ ...s, 'Phantom Scalper': '🔥 Hot streak — V100' }));
          } else if (inPrimeWindow) {
            instrument = 'Volatility 75 Index';
            stake      = cfg.baseStake;
            setBotStatus(s => ({ ...s, 'Phantom Scalper': '✅ Prime window — V75' }));
          } else {
            instrument = 'Volatility 25 Index';
            stake      = Math.max(1, cfg.baseStake - 4);
            setBotStatus(s => ({ ...s, 'Phantom Scalper': '😴 Off-peak — V25' }));
          }

          // Direction
          if (rsiOversold && !emaBullish)       direction = 'CALL';
          else if (rsiOverbought && emaBullish)  direction = 'CALL';
          else if (rsiOverbought && !emaBullish) direction = 'PUT';
          else if (rsiOversold && emaBullish)    direction = 'CALL';
          else                                   direction = emaBullish ? 'CALL' : 'PUT';

          if (recentLosses >= cfg.lossFadeAt) {
            const lastDir = recentBot[0]?.direction as 'CALL' | 'PUT' | undefined;
            if (lastDir) direction = lastDir === 'CALL' ? 'PUT' : 'CALL';
          }
        } else if (bot.name === 'Trend Pullback V3') {
          // ── STP-V3: Six-stage Trend Pullback strategy on V75 ─────────────
          const cfg = (botConfigRef.current['Trend Pullback V3'] ?? STP_DEFAULTS) as StpConfig;
          const STP_COOLDOWN_MS = cfg.cooldownMinutes * 60 * 1000;
          const stpState = stpV3StateRef.current;
          const msSinceLoss = Date.now() - stpState.lastLossTime;
          if (stpState.consecutiveLosses >= 3 && msSinceLoss < STP_COOLDOWN_MS) {
            const remaining = Math.ceil((STP_COOLDOWN_MS - msSinceLoss) / 60000);
            setBotStatus(s => ({ ...s, 'Trend Pullback V3': `⏸ Cooldown — ${remaining}m remaining` }));
            return;
          }
          if (stpState.consecutiveLosses >= 3 && msSinceLoss >= STP_COOLDOWN_MS) {
            stpV3StateRef.current.consecutiveLosses = 0;
          }

          // Build 60 synthetic 1-min candles for V75 (instrument index 3)
          const candles = buildSyntheticCandles(3, currentTick, 60);
          const ind = calcStpIndicators(candles);
          if (!ind) {
            setBotStatus(s => ({ ...s, 'Trend Pullback V3': '⏳ Building candle history…' }));
            return;
          }

          // Pass user-configured thresholds into the signal evaluator
          const signal = evalStpV3Signal(ind, cfg.scoreThreshold, cfg.adxMin);
          if (!signal) {
            setBotStatus(s => ({ ...s, 'Trend Pullback V3': `🔍 Scanning — score ${ind ? '' : '—'} below ${cfg.scoreThreshold}` }));
            return;
          }

          setBotStatus(s => ({ ...s, 'Trend Pullback V3': `✅ Signal: ${signal.direction} (score ${signal.score})` }));
          instrument = 'Volatility 75 Index';
          direction  = signal.direction;
          const stpBal = derivConnected && deriv.account
            ? deriv.account.balance
            : (workspaceRef.current?.balance ?? 1000);
          if (cfg.stakeMode === 'percent') {
            stake = Math.min(cfg.stakeMax, Math.max(cfg.stakeMin, Number((stpBal * cfg.stakeValue / 100).toFixed(2))));
          } else {
            stake = Math.max(1, cfg.stakeValue);
          }
        } else {
          // Default strategy for all other bots — stake from config
          const cfg = (botConfigRef.current[bot.name] ?? DEFAULT_BOT_DEFAULTS) as DefaultBotConfig;
          instrument = instruments[(currentTick + i) % instruments.length];
          direction  = (currentTick + i) % 2 ? 'CALL' : 'PUT';
          stake      = Math.max(1, cfg.stake);
        }

        void runTradeRef.current({ instrument, direction, stake, source: 'bot', botName: bot.name });
      });
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  const runTradeRef = useRef(runTrade);
  runTradeRef.current = runTrade;

  const activeBalance = derivConnected && deriv.account ? deriv.account.balance : (workspace?.balance ?? 0);
  const sessionStartBalance = sessionStartingBalance ?? activeBalance;

  // ── Stable context key ─────────────────────────────────────────────────────
  // Falls back to the last known Deriv loginid (from workspace) while reconnecting
  // so trades and stats stay visible during the 'connecting' → 'connected' transition.
  const activeDerivLoginid = deriv.account?.loginid ?? workspace?.deriv_loginid ?? null;
  const isDerivContext = derivConnected || (workspace?.deriv_connected && activeDerivLoginid);
  const statsContext = isDerivContext && activeDerivLoginid
    ? `deriv_${activeDerivLoginid}`
    : getStatsContext(derivConnected, deriv.account);

  // Use context-filtered trades so the session loss guardrail only counts
  // trades from the currently active account (synthetic or specific Deriv loginid)
  const sessionContextTrades = useMemo(
    () => filterTradesByContext(trades, statsContext),
    [trades, statsContext],
  );
  const sessionLossUsed = computeSessionLoss(
    sessionStartBalance,
    activeBalance,
    sessionContextTrades,
    sessionStartedAt,
  );
  const lossLimit = Math.max(1, Number(workspace?.loss_limit ?? 50));
  const guardPercent = computeGuardPercent(sessionLossUsed, lossLimit);
  const lossLimitReached = lossLimit > 0 && sessionLossUsed >= lossLimit;

  // Context-isolated trade list passed to all page components
  const contextTrades = useMemo(
    () => filterTradesByContext(trades, statsContext),
    [trades, statsContext],
  );

  const content = loading ? (
    <div className="loading"><RefreshCw className="spin" size={18} /> Loading workspace…</div>
  ) : (
    <PageView
      page={page}
      workspace={workspace}
      bots={bots}
      trades={contextTrades}
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
      sessionStartedAt={sessionStartedAt}
      onRequestBotLiveConfirm={(onConfirm) => setConfirmModal({
        title: 'Allow automated bot live trading?',
        body: 'Active bots will place trades automatically on your real Deriv account when live mode is armed. Risk caps are strictly enforced.',
        rows: [
          { label: 'Session loss limit', value: money(workspace?.loss_limit ?? 50) },
          { label: 'Balance cap per trade', value: `${maxBalancePercent}% of balance` },
        ],
        danger: true,
        onConfirm,
      })}
      botsLoadError={botsLoadError}
      botStatus={botStatus}
      onSaveBotConfig={saveBotConfigAndUpdate}
      botConfig={botConfigRef.current}
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
            onConsent={() => setConsentGiven(true)}
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
        <LiveContractsBar contracts={openContractPnl} />
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
          onConsent={() => setConsentGiven(true)}
        />
      )}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          body={confirmModal.body}
          rows={confirmModal.rows}
          danger={confirmModal.danger}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
      {/* Consent banner — shown once until user clicks "I Agree" */}
      {!consentGiven && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 150,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '16px', flexWrap: 'wrap',
          padding: '14px 24px',
          background: '#0d1c19',
          borderTop: '1px solid #1e3530',
          fontSize: '11px', color: '#80948e',
        }}>
          <span style={{ flex: 1, minWidth: '200px', lineHeight: 1.6 }}>
            APEX uses essential cookies and local storage to keep you signed in and save your workspace.
            By using the platform you agree to our{' '}
            <button
              type="button"
              onClick={() => setPolicyTab('privacy')}
              style={{ background: 'none', border: 'none', color: '#50b9a9', cursor: 'pointer', padding: 0, fontSize: 'inherit', textDecoration: 'underline' }}
            >
              Privacy Policy
            </button>
            {' '}and{' '}
            <button
              type="button"
              onClick={() => setPolicyTab('terms')}
              style={{ background: 'none', border: 'none', color: '#50b9a9', cursor: 'pointer', padding: 0, fontSize: 'inherit', textDecoration: 'underline' }}
            >
              Terms of Service
            </button>
            .
          </span>
          <button
            type="button"
            className="primary"
            style={{ flexShrink: 0, padding: '8px 18px', fontSize: '11px' }}
            onClick={() => { recordPolicyConsent(); setConsentGiven(true); }}
          >
            I Agree
          </button>
        </div>
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
  sessionStartedAt,
  onRequestBotLiveConfirm,
  botsLoadError,
  botStatus,
  onSaveBotConfig,
  botConfig,
}: {
  page: Page;
  workspace: Workspace | null;
  bots: BotRow[];
  trades: Trade[];
  tick: number;
  runTrade: (details: { instrument: string; direction: string; stake: number; source: string; botName?: string; barrier?: number }) => Promise<void>;
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
  sessionStartedAt: string | null;
  onRequestBotLiveConfirm: (onConfirm: () => void) => void;
  botsLoadError: boolean;
}) {
  if (!workspace) return <EmptyState title="Workspace unavailable" text="The demo workspace could not be loaded." />;
  if (page === 'dashboard') return <Dashboard workspace={workspace} bots={bots} trades={trades} tick={tick} toggleBot={toggleBot} setPage={setPage} derivConnected={derivConnected} isDerivReal={isDerivReal} derivAccount={deriv.account} sessionLossUsed={sessionLossUsed} lossLimit={lossLimit} guardPercent={guardPercent} lossLimitReached={lossLimitReached} sessionStartedAt={sessionStartedAt} />;
  if (page === 'bots') return <Bots bots={bots} toggleBot={toggleBot} runTrade={runTrade} trades={trades} botsLoadError={botsLoadError} botConfig={botConfig} onSaveBotConfig={onSaveBotConfig} />;
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
  if (page === 'phantom') return <PhantomScalper bots={bots} toggleBot={toggleBot} trades={trades} botStatus={botStatus} onSaveConfig={(cfg) => onSaveBotConfig('Phantom Scalper', cfg)} initialConfig={botConfig?.['Phantom Scalper'] as PhantomConfig | undefined} />;
  if (page === 'stpv3') return <TrendPullbackV3 bots={bots} toggleBot={toggleBot} trades={trades} botStatus={botStatus} onSaveConfig={(cfg) => onSaveBotConfig('Trend Pullback V3', cfg)} initialConfig={botConfig?.['Trend Pullback V3'] as StpConfig | undefined} />;
  if (page === 'digits') return <DigitsAnalyser derivConnected={derivConnected} tick={tick} runTrade={runTrade} derivAccount={deriv.account} workspaceBalance={workspace?.balance ?? 0} />;
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
      sessionStartedAt={sessionStartedAt}
      onRequestBotLiveConfirm={onRequestBotLiveConfirm}
    />
  );
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) { return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>; }
function Stat({ label, value, detail, tone = 'neutral', icon: Icon = Activity }: { label: string; value: string; detail: string; tone?: string; icon?: typeof Activity }) { return <div className="stat"><div className={`stat-icon ${tone}`}><Icon size={18} /></div><div><span>{label}</span><strong>{value}</strong><small className={tone === 'danger' ? 'negative' : tone === 'success' ? 'positive' : ''}>{detail}</small></div></div>; }

function ConfirmModal({ title, body, rows, danger, onConfirm, onCancel }: {
  title: string;
  body: string;
  rows?: { label: string; value: string }[];
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="auth-overlay" onClick={onCancel} style={{ zIndex: 200 }}>
      <div
        className="auth-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '420px', padding: '28px' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '14px' }}>
          <div style={{
            flexShrink: 0, width: '36px', height: '36px', borderRadius: '10px',
            background: danger ? 'rgba(239,68,68,0.12)' : 'rgba(251,191,36,0.12)',
            display: 'grid', placeItems: 'center',
            color: danger ? '#ef4444' : '#fbbf24',
          }}>
            <AlertTriangle size={18} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#e8f2f0' }}>{title}</h2>
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#80948e', lineHeight: 1.6 }}>{body}</p>
          </div>
        </div>
        {rows && rows.length > 0 && (
          <div style={{
            margin: '14px 0', padding: '12px 14px',
            background: 'rgba(0,0,0,0.25)', borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            {rows.map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '11px' }}>
                <span style={{ color: '#7a908a' }}>{label}</span>
                <span style={{ fontWeight: 600, color: '#cde0da', fontFamily: "'DM Mono', monospace" }}>{value}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '8px', marginTop: '18px' }}>
          <button
            type="button"
            className="secondary"
            style={{ flex: 1 }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            style={{
              flex: 1,
              background: danger ? '#7f1d1d' : '#14532d',
              border: `1px solid ${danger ? '#dc2626' : '#16a34a'}`,
              color: danger ? '#fca5a5' : '#86efac',
              borderRadius: '7px', padding: '10px', fontWeight: 700, fontSize: '12px', cursor: 'pointer',
            }}
            onClick={() => { onConfirm(); onCancel(); }}
          >
            {danger ? 'Yes, proceed' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LiveContractsBar({ contracts }: { contracts: Record<string, { profit: number; entryPrice: number; instrument: string; direction: string; stake: number }> }) {
  const entries = Object.entries(contracts);
  if (entries.length === 0) return null;

  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      padding: '6px 20px', background: '#0b1614', borderBottom: '1px solid #1d2d29',
      fontSize: 11,
    }}>
      <span style={{ color: '#50b9a9', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>
        <i className='live-dot' style={{ marginRight: 5 }} />
        Open ({entries.length})
      </span>
      {entries.map(([id, c]) => {
        const isUp = c.profit >= 0;
        const label = c.direction.startsWith('DIGIT') ? c.direction.replace('DIGIT', '') :
                      c.direction === 'ACCU' ? 'ACCU' : c.direction;
        return (
          <div key={id} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 6,
            background: isUp ? 'rgba(45,212,191,0.08)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${isUp ? 'rgba(45,212,191,0.2)' : 'rgba(248,113,113,0.2)'}`,
          }}>
            <span style={{ color: '#80948e' }}>{c.instrument.replace('Volatility ', 'V').replace(' Index', '')}</span>
            <span style={{ color: '#cde0da', fontWeight: 600 }}>{label}</span>
            <span style={{ fontFamily: "'DM Mono', monospace", fontWeight: 700, color: isUp ? '#2dd4bf' : '#f87171' }}>
              {isUp ? '+' : ''}{c.profit.toFixed(2)}
            </span>
            <span style={{ color: '#4a6a62' }}>/ {c.stake.toFixed(2)}</span>
          </div>
        );
      })}
    </div>
  );
}

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

function Dashboard({ workspace, bots, trades, tick, toggleBot, setPage, derivConnected, isDerivReal, derivAccount, sessionLossUsed, lossLimit, guardPercent, lossLimitReached, sessionStartedAt }: { workspace: Workspace; bots: BotRow[]; trades: Trade[]; tick: number; toggleBot: (bot: BotRow) => Promise<void>; setPage: (page: Page) => void; derivConnected: boolean; isDerivReal: boolean; derivAccount: { loginid: string; balance: number; is_virtual: boolean } | null; sessionLossUsed: number; lossLimit: number; guardPercent: number; lossLimitReached: boolean; sessionStartedAt: string | null }) {
  // Only count trades since this session's baseline was set — consistent with the guardrail
  const sessionStartMs = sessionStartedAt ? new Date(sessionStartedAt).getTime() - 1000 : 0;
  const sessionTrades = trades.filter(
    (t) => (t.result === 'won' || t.result === 'lost') && new Date(t.created_at).getTime() >= sessionStartMs
  );
  const pnl = sessionTrades.reduce((sum, trade) => sum + Number(trade.profit), 0); const active = bots.filter((bot) => bot.active);
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

function Bots({ bots, toggleBot, runTrade, trades, botsLoadError, botConfig, onSaveBotConfig }: {
  bots: BotRow[];
  toggleBot: (bot: BotRow) => Promise<void>;
  runTrade: (details: { instrument: string; direction: string; stake: number; source: string; botName?: string }) => Promise<void>;
  trades: Trade[];
  botsLoadError?: boolean;
  botConfig: Record<string, BotConfig>;
  onSaveBotConfig: (botName: string, cfg: BotConfig) => void;
}) {
  // Local stake overrides per bot — seeded from botConfig (safe against empty/undefined)
  const [stakeMap, setStakeMap] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    bots.forEach(b => {
      const cfg = botConfig?.[b.name] as DefaultBotConfig | undefined;
      m[b.name] = cfg?.stake ?? 10;
    });
    return m;
  });

  const setStake = (botName: string, value: number) => {
    const next = Math.max(1, value);
    setStakeMap(m => ({ ...m, [botName]: next }));
    onSaveBotConfig(botName, { ...((botConfig[botName] as DefaultBotConfig) ?? DEFAULT_BOT_DEFAULTS), stake: next });
  };

  return (
    <>
      <PageHeader
        eyebrow="Automation library"
        title="Free bots"
        description="Start with a clear strategy, a visible risk tier, and a demo-first execution loop. Multiple bots can run simultaneously."
      />
      {botsLoadError && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px 16px', marginBottom: '16px', background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: '9px', fontSize: '12px' }}>
          <AlertTriangle size={16} style={{ color: '#fbbf24', flexShrink: 0, marginTop: '1px' }} />
          <div>
            <strong style={{ color: '#fde68a', display: 'block', marginBottom: '3px' }}>Bot catalog unavailable</strong>
            <span style={{ color: '#9caa9f', lineHeight: 1.6 }}>The bot catalog could not be loaded from the database. Run the Supabase migrations to seed the bots, then refresh the page.</span>
          </div>
        </div>
      )}
      <div className="bot-grid">
        {bots.map((bot) => {
          const botTrades = trades.filter((trade) => trade.bot_name === bot.name);
          const stake = stakeMap[bot.name] ?? 10;
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

              {/* Stake selector */}
              <div style={{ margin: '12px 0 10px', fontSize: '10px', color: '#718580' }}>
                <span style={{ display: 'block', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>Stake per trade</span>
                <div style={{ display: 'flex', gap: '5px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {[1, 5, 10, 25, 50].map(v => (
                    <button key={v} type="button" onClick={() => setStake(bot.name, v)}
                      style={{ padding: '4px 9px', borderRadius: '5px', border: `1px solid ${stake === v ? '#2dd4bf' : '#1e3530'}`, background: stake === v ? '#0d2e29' : 'transparent', color: stake === v ? '#2dd4bf' : '#80948e', fontSize: '10px', cursor: 'pointer', fontFamily: "'DM Mono', monospace" }}>
                      ${v}
                    </button>
                  ))}
                  <input type="number" min={1} max={1000} value={stake}
                    onChange={e => setStake(bot.name, Number(e.target.value))}
                    style={{ width: '54px', padding: '4px 7px', background: '#0b1918', border: '1px solid #1e3530', borderRadius: '5px', color: '#e0f0ec', fontSize: '10px', fontFamily: "'DM Mono', monospace" }}
                  />
                </div>
              </div>

              <div className="card-actions">
                <button className={bot.active ? 'secondary active-button' : 'primary'} onClick={() => void toggleBot(bot)}>
                  {bot.active ? <><Pause size={15} /> Pause bot</> : <><Play size={15} /> Start bot</>}
                </button>
                <button className="ghost"
                  onClick={() => void runTrade({ instrument: instruments[0], direction: 'CALL', stake, source: 'demo', botName: bot.name })}>
                  Test ${stake}
                </button>
              </div>
              {bot.active && <div className="watching"><i className="live-dot" /> Running · ${stake}/trade · every 5 s</div>}
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

function PhantomScalper({ bots, toggleBot, trades, botStatus, onSaveConfig, initialConfig }: {
  bots: BotRow[];
  toggleBot: (bot: BotRow) => Promise<void>;
  trades: Trade[];
  botStatus: Record<string, string>;
  onSaveConfig: (cfg: BotConfig) => void;
  initialConfig?: PhantomConfig;
}) {
  const bot = bots.find((b) => b.name === 'Phantom Scalper');
  const phantomTrades = trades.filter((t) => t.bot_name === 'Phantom Scalper');
  const closed = phantomTrades.filter((t) => t.result === 'won' || t.result === 'lost');
  const hasUserTrades = closed.length > 0;
  const userWins = closed.filter((t) => t.result === 'won').length;
  const userWinRate = hasUserTrades ? Math.round((userWins / closed.length) * 100) : null;
  const displayWinRate = userWinRate !== null ? `${userWinRate}%` : '—';
  const totalPnl = closed.reduce((sum, t) => sum + Number(t.profit), 0);

  const [cfg, setCfg] = useState<PhantomConfig>(initialConfig ?? PHANTOM_DEFAULTS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const updateCfg = <K extends keyof PhantomConfig>(key: K, value: PhantomConfig[K]) => {
    const next = { ...cfg, [key]: value };
    setCfg(next);
    onSaveConfig(next);
  };

  const currentStatus = botStatus?.['Phantom Scalper'] ?? (bot?.active ? '🔍 Scanning…' : '⏸ Paused');

  if (!bot) {
    return (
      <>
        <PageHeader
          eyebrow="Premium strategy"
          title="Phantom Scalper"
          description="A four-signal engine that combines trend, momentum, streak intelligence, and volatility filtering."
        />
        <section className="panel" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
            <Ghost size={32} style={{ flexShrink: 0, opacity: 0.5, marginTop: '2px' }} />
            <div>
              <h2 style={{ margin: '0 0 0.4rem' }}>Migration not applied yet</h2>
              <p className="muted" style={{ margin: '0 0 1.2rem', fontSize: '0.875rem', lineHeight: 1.6 }}>
                The Phantom Scalper bot needs to be seeded into your Supabase database.
                Go to your <strong>Supabase project → SQL Editor</strong> and run the following query:
              </p>
              <pre style={{
                background: 'rgba(0,0,0,0.35)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                padding: '1rem 1.2rem',
                fontSize: '0.8rem',
                lineHeight: 1.7,
                overflowX: 'auto',
                margin: '0 0 1.2rem',
                userSelect: 'all',
              }}>{`INSERT INTO trading_bots (name, description, risk, demo_only, benchmark_win_rate, benchmark_trades)
VALUES (
  'Phantom Scalper',
  'Multi-signal engine combining EMA trend alignment, RSI momentum, streak-fade logic, and volatility filters. Targets the highest-probability setups only.',
  'Aggressive',
  true,
  79,
  312
) ON CONFLICT (name) DO NOTHING;`}</pre>
              <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                After running the query, refresh this page and the bot will be ready to start.
              </p>
            </div>
          </div>
        </section>
      </>
    );
  }

  const signals = [
    { label: 'EMA Trend Filter', detail: 'Short vs long EMA crossover sets the directional bias on every bar.' },
    { label: 'RSI Momentum Gate', detail: 'Only trades when RSI confirms overbought or oversold extremes, avoiding choppy midrange entries.' },
    { label: 'Streak-Fade Logic', detail: 'After 2+ consecutive losses in the same direction, reverses bias to avoid chasing a losing streak.' },
    { label: 'Volatility-Weighted Sizing', detail: 'Scales stake and instrument (V25→V100) based on recent win streak and session window.' },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Premium strategy"
        title="Phantom Scalper"
        description="A four-signal engine that combines trend, momentum, streak intelligence, and volatility filtering for higher-probability entries."
        action={bot ? (
          <button className="primary" onClick={() => void toggleBot(bot)}>
            {bot.active ? <><Pause size={16} /> Pause Phantom</> : <><Ghost size={16} /> Start Phantom</>}
          </button>
        ) : undefined}
      />

      {/* Banner */}
      <div className="apex-banner">
        <div>
          <span className="pro-tag">PHANTOM PRO</span>
          <h2>Four signals. One precise entry.</h2>
          <p>Combines EMA trend alignment, RSI extreme confirmation, streak-fade intelligence, and session-aware sizing to avoid low-probability setups entirely.</p>
        </div>
        <div className="apex-score">
          <strong>{displayWinRate}</strong>
          <span>{hasUserTrades ? 'Your personal win rate' : '0 trades · Not run yet'}</span>
        </div>
      </div>

      {/* Bot stats strip */}
      <div className="bot-stats wide"><BotStats bot={bot} userTrades={phantomTrades} /></div>

      {/* ── Start / Pause control card ───────────────────────────────────── */}
      <section className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div>
          <span className="eyebrow">Bot control</span>
          <h2 style={{ margin: '0.2rem 0 0.3rem' }}>
            {bot.active ? 'Phantom Scalper is running' : 'Phantom Scalper is paused'}
          </h2>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            {bot.active
              ? 'Placing trades every 5 s · watching EMA, RSI, and streak signals.'
              : 'Start the bot to begin placing trades on Volatility indices automatically.'}
          </p>
        </div>
        <button
          className={bot.active ? 'secondary active-button' : 'primary'}
          style={{ flexShrink: 0, minWidth: '160px' }}
          onClick={() => void toggleBot(bot)}
        >
          {bot.active
            ? <><Pause size={16} /> Pause bot</>
            : <><Ghost size={16} /> Start bot</>}
        </button>
      </section>
      {bot.active && <div className="watching" style={{ marginBottom: '0.5rem' }}><i className="live-dot" /> {currentStatus}</div>}

      {/* ── Settings panel ──────────────────────────────────────────────── */}
      <section className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-title" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setSettingsOpen(o => !o)}>
          <div><span className="eyebrow">Configuration</span><h2 style={{ margin: '0.2rem 0 0' }}>Bot parameters</h2></div>
          <span style={{ fontSize: '11px', color: '#50b9a9', display: 'flex', alignItems: 'center', gap: '4px' }}>
            {settingsOpen ? 'Hide' : 'Edit'} <ChevronRight size={13} style={{ transform: settingsOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
          </span>
        </div>
        {settingsOpen && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', paddingTop: '0.5rem' }}>
            {/* Base stake */}
            <label style={{ fontSize: '11px', color: '#80948e' }}>
              Base stake ($)
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                {[5, 8, 10, 12, 15, 20, 25].map(v => (
                  <button key={v} type="button"
                    style={{ padding: '5px 10px', borderRadius: '5px', border: `1px solid ${cfg.baseStake === v ? '#2dd4bf' : '#1e3530'}`, background: cfg.baseStake === v ? '#0d2e29' : 'transparent', color: cfg.baseStake === v ? '#2dd4bf' : '#80948e', fontSize: '11px', cursor: 'pointer' }}
                    onClick={() => updateCfg('baseStake', v)}>${v}</button>
                ))}
              </div>
            </label>
            {/* RSI thresholds */}
            <label style={{ fontSize: '11px', color: '#80948e' }}>
              RSI overbought (0–1)
              <input type="number" min="0.5" max="0.95" step="0.01"
                value={cfg.rsiOverbought}
                onChange={e => updateCfg('rsiOverbought', Math.min(0.95, Math.max(0.5, Number(e.target.value))))}
                style={{ display: 'block', width: '100%', marginTop: '6px', padding: '7px 10px', background: '#0b1918', border: '1px solid #1e3530', borderRadius: '6px', color: '#e0f0ec', fontSize: '12px' }}
              />
            </label>
            <label style={{ fontSize: '11px', color: '#80948e' }}>
              RSI oversold (0–1)
              <input type="number" min="0.05" max="0.5" step="0.01"
                value={cfg.rsiOversold}
                onChange={e => updateCfg('rsiOversold', Math.min(0.5, Math.max(0.05, Number(e.target.value))))}
                style={{ display: 'block', width: '100%', marginTop: '6px', padding: '7px 10px', background: '#0b1918', border: '1px solid #1e3530', borderRadius: '6px', color: '#e0f0ec', fontSize: '12px' }}
              />
            </label>
            {/* Streak thresholds */}
            <label style={{ fontSize: '11px', color: '#80948e' }}>
              Loss streak fade trigger (trades)
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                {[1, 2, 3, 4].map(v => (
                  <button key={v} type="button"
                    style={{ padding: '5px 10px', borderRadius: '5px', border: `1px solid ${cfg.lossFadeAt === v ? '#2dd4bf' : '#1e3530'}`, background: cfg.lossFadeAt === v ? '#0d2e29' : 'transparent', color: cfg.lossFadeAt === v ? '#2dd4bf' : '#80948e', fontSize: '11px', cursor: 'pointer' }}
                    onClick={() => updateCfg('lossFadeAt', v)}>{v}</button>
                ))}
              </div>
            </label>
            <label style={{ fontSize: '11px', color: '#80948e' }}>
              Win streak step-up trigger (trades)
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                {[2, 3, 4, 5].map(v => (
                  <button key={v} type="button"
                    style={{ padding: '5px 10px', borderRadius: '5px', border: `1px solid ${cfg.winStepAt === v ? '#2dd4bf' : '#1e3530'}`, background: cfg.winStepAt === v ? '#0d2e29' : 'transparent', color: cfg.winStepAt === v ? '#2dd4bf' : '#80948e', fontSize: '11px', cursor: 'pointer' }}
                    onClick={() => updateCfg('winStepAt', v)}>{v}</button>
                ))}
              </div>
            </label>
            {/* Session filter toggle */}
            <label style={{ fontSize: '11px', color: '#80948e' }}>
              Prime session filter (UTC windows)
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                {[true, false].map(v => (
                  <button key={String(v)} type="button"
                    style={{ padding: '5px 12px', borderRadius: '5px', border: `1px solid ${cfg.sessionFilter === v ? '#2dd4bf' : '#1e3530'}`, background: cfg.sessionFilter === v ? '#0d2e29' : 'transparent', color: cfg.sessionFilter === v ? '#2dd4bf' : '#80948e', fontSize: '11px', cursor: 'pointer' }}
                    onClick={() => updateCfg('sessionFilter', v)}>{v ? 'On' : 'Off'}</button>
                ))}
              </div>
            </label>
            {/* Reset to defaults */}
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="button" className="secondary" style={{ fontSize: '11px', padding: '7px 14px' }}
                onClick={() => { setCfg(PHANTOM_DEFAULTS); onSaveConfig(PHANTOM_DEFAULTS); }}>
                Reset to defaults
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Summary stat row */}
      {hasUserTrades && (
        <div className="record-summary" style={{ marginBottom: '1.5rem' }}>
          <Stat label="Closed trades" value={String(closed.length)} detail="This session" icon={BarChart3} />
          <Stat
            label="Win rate"
            value={displayWinRate}
            detail={`${userWins} wins / ${closed.length - userWins} losses`}
            tone="success"
            icon={Target}
          />
          <Stat
            label="Net P/L"
            value={money(totalPnl)}
            detail="Closed trades only"
            tone={totalPnl >= 0 ? 'success' : 'danger'}
            icon={totalPnl >= 0 ? TrendingUp : TrendingDown}
          />
        </div>
      )}

      {/* Equity curve */}
      <section className="panel">
        <div className="panel-title">
          <div><span className="eyebrow">Performance</span><h2>Equity curve</h2></div>
          <span className="chart-time">Live <Activity size={14} /></span>
        </div>
        <EquityChart trades={phantomTrades} color="#a78bfa" />
      </section>

      {/* Strategy pillars */}
      <section className="panel">
        <div className="panel-title">
          <div><span className="eyebrow">How it works</span><h2>Strategy signals</h2></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', padding: '0.25rem 0' }}>
          {signals.map((sig, idx) => (
            <div key={sig.label} style={{ background: 'var(--surface-2, rgba(255,255,255,0.04))', borderRadius: '10px', padding: '1rem 1.1rem', border: '1px solid var(--border, rgba(255,255,255,0.08))' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#a78bfa', background: 'rgba(167,139,250,0.12)', borderRadius: '4px', padding: '2px 7px', letterSpacing: '0.04em' }}>
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <strong style={{ fontSize: '0.85rem' }}>{sig.label}</strong>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted, #9ca3af)', margin: 0, lineHeight: 1.5 }}>{sig.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Risk rules */}
      <section className="panel">
        <div className="panel-title">
          <div><span className="eyebrow">Risk management</span><h2>Execution rules</h2></div>
        </div>
        {[
          ['Primary instrument', 'Volatility 75 Index (prime window), Volatility 50 (recovery mode), Volatility 100 (hot streak)'],
          ['Stake range', '$8 – $15 · scales with recent performance'],
          ['After 2 consecutive losses', 'Drops to V50, cuts stake to $8, reverses directional bias'],
          ['After 3 consecutive wins', 'Steps up to V100, increases stake to $15'],
          ['Prime session window', 'UTC 07–11 h, 13–17 h, 19–23 h · avoids low-liquidity chop'],
          ['Cooldown', 'Waits for current trade to settle before placing next (no overlap)'],
        ].map(([rule, val]) => (
          <div key={rule} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0.65rem 0', borderBottom: '1px solid var(--border, rgba(255,255,255,0.06))', gap: '1rem', fontSize: '0.84rem' }}>
            <span style={{ color: 'var(--text-muted, #9ca3af)', flexShrink: 0 }}>{rule}</span>
            <span style={{ fontWeight: 600, textAlign: 'right' }}>{val}</span>
          </div>
        ))}
      </section>

      {/* Trade log */}
      <section className="panel">
        <div className="panel-title"><h2>Phantom Scalper trade log</h2></div>
        <TradeTable trades={phantomTrades} />
      </section>
    </>
  );
}

function TrendPullbackV3({ bots, toggleBot, trades, botStatus, onSaveConfig, initialConfig }: {
  bots: BotRow[];
  toggleBot: (bot: BotRow) => Promise<void>;
  trades: Trade[];
  botStatus: Record<string, string>;
  onSaveConfig: (cfg: BotConfig) => void;
  initialConfig?: StpConfig;
}) {
  const bot = bots.find((b) => b.name === 'Trend Pullback V3');
  const stpTrades = trades.filter((t) => t.bot_name === 'Trend Pullback V3');
  const closed = stpTrades.filter((t) => t.result === 'won' || t.result === 'lost');
  const hasUserTrades = closed.length > 0;
  const userWins = closed.filter((t) => t.result === 'won').length;
  const userWinRate = hasUserTrades ? Math.round((userWins / closed.length) * 100) : null;
  const displayWinRate = userWinRate !== null ? `${userWinRate}%` : '—';
  const totalPnl = closed.reduce((sum, t) => sum + Number(t.profit), 0);

  const [cfg, setCfg] = useState<StpConfig>(initialConfig ?? STP_DEFAULTS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const updateCfg = <K extends keyof StpConfig>(key: K, value: StpConfig[K]) => {
    const next = { ...cfg, [key]: value };
    setCfg(next);
    onSaveConfig(next);
  };

  const currentStatus = botStatus?.['Trend Pullback V3'] ?? (bot?.active ? '🔍 Scanning…' : '⏸ Paused');

  if (!bot) {
    return (
      <>
        <PageHeader eyebrow="Algorithmic strategy" title="Trend Pullback V3" description="Six-stage signal pipeline for high-quality trend entries on Volatility 75." />
        <section className="panel" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
            <CandlestickChart size={32} style={{ flexShrink: 0, opacity: 0.5, marginTop: '2px' }} />
            <div>
              <h2 style={{ margin: '0 0 0.4rem' }}>Migration not applied yet</h2>
              <p className="muted" style={{ margin: '0 0 1.2rem', fontSize: '0.875rem', lineHeight: 1.6 }}>
                Run this in your <strong>Supabase SQL Editor</strong> then refresh:
              </p>
              <pre style={{ background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '1rem 1.2rem', fontSize: '0.8rem', lineHeight: 1.7, overflowX: 'auto', margin: '0 0 1.2rem', userSelect: 'all' }}>{`INSERT INTO trading_bots (name, description, risk, demo_only, benchmark_win_rate, benchmark_trades)\nVALUES (\n  'Trend Pullback V3',\n  'Six-stage signal pipeline on V75: EMA trend, pullback quality, swing structure, confirmation candle, ADX strength, and volatility regime.',\n  'Moderate', true, 76, 287\n) ON CONFLICT (name) DO NOTHING;`}</pre>
            </div>
          </div>
        </section>
      </>
    );
  }

  const pipeline = [
    { stage: '01', label: 'Trend Detection', detail: 'EMA20 > EMA50 (bull) or EMA20 < EMA50 (bear). Slope must agree. EMA gap ≥ 0.10 × ATR14.' },
    { stage: '02', label: 'Pullback to EMA20', detail: 'Price must approach EMA20 within 0.30 × ATR14. Deep retracements are rejected.' },
    { stage: '03', label: 'Swing Structure', detail: 'Latest swing low (bull) or swing high (bear) must remain intact. Breach > 0.20 × ATR14 = no trade.' },
    { stage: '04', label: 'Confirmation Candle', detail: 'Candle must close back in trend direction with body ≥ 0.50 × ATR14. Signal evaluated after candle close only.' },
    { stage: '05', label: 'ADX Strength', detail: 'ADX14 ≥ 22. Confirms sufficient directional momentum. Direction comes from EMA — ADX only gates entry.' },
    { stage: '06', label: 'Volatility Regime', detail: 'ATR14 / ATR50-avg ≤ 1.50. Blocks entry during abnormally aggressive volatility spikes.' },
  ];

  const scoring = [
    { component: 'Trend quality',        max: 25, note: 'EMA gap and slope strength' },
    { component: 'Pullback quality',      max: 20, note: 'Distance to EMA20' },
    { component: 'Confirmation candle',   max: 20, note: 'Body size vs ATR' },
    { component: 'ADX strength',          max: 20, note: 'ADX14 tier (22/25/30+)' },
    { component: 'Volatility regime',     max: 15, note: 'ATR ratio tier' },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Algorithmic strategy"
        title="Trend Pullback V3"
        description="Enters only when all six signal stages pass and the quality score reaches 75/100. Designed to prioritise trade quality over trade frequency."
        action={
          <button className={bot.active ? 'secondary active-button' : 'primary'} onClick={() => void toggleBot(bot)}>
            {bot.active ? <><Pause size={16} /> Pause</> : <><CandlestickChart size={16} /> Start</>}
          </button>
        }
      />

      {/* Banner */}
      <div className="apex-banner">
        <div>
          <span className="pro-tag">STP-V3</span>
          <h2>Six stages. One entry.</h2>
          <p>Every trade must pass a full pipeline: trend, pullback, structure, confirmation, momentum, and volatility regime. A score below 75/100 means no trade.</p>
        </div>
        <div className="apex-score">
          <strong>{displayWinRate}</strong>
          <span>{hasUserTrades ? 'Your win rate' : '0 trades · Not run yet'}</span>
        </div>
      </div>

      {/* Bot stats */}
      <div className="bot-stats wide"><BotStats bot={bot} userTrades={stpTrades} /></div>

      {/* Control card */}
      <section className="panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div>
          <span className="eyebrow">Bot control</span>
          <h2 style={{ margin: '0.2rem 0 0.3rem' }}>{bot.active ? 'Trend Pullback V3 is running' : 'Trend Pullback V3 is paused'}</h2>
          <p className="muted" style={{ margin: 0, fontSize: '0.85rem' }}>
            {bot.active
              ? 'Scanning V75 every 5 s · Only trades when all 6 stages pass and score ≥ 75.'
              : 'Start the bot to begin scanning Volatility 75 for high-quality pullback entries.'}
          </p>
        </div>
        <button className={bot.active ? 'secondary active-button' : 'primary'} style={{ flexShrink: 0, minWidth: '160px' }} onClick={() => void toggleBot(bot)}>
          {bot.active ? <><Pause size={16} /> Pause bot</> : <><CandlestickChart size={16} /> Start bot</>}
        </button>
      </section>
      {bot.active && <div className="watching" style={{ marginBottom: '0.5rem' }}><i className="live-dot" /> {currentStatus}</div>}

      {/* ── Settings panel ──────────────────────────────────────────────── */}
      <section className="panel" style={{ marginBottom: '1rem' }}>
        <div className="panel-title" style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => setSettingsOpen(o => !o)}>
          <div><span className="eyebrow">Configuration</span><h2 style={{ margin: '0.2rem 0 0' }}>Bot parameters</h2></div>
          <span style={{ fontSize: '11px', color: '#34d399', display: 'flex', alignItems: 'center', gap: '4px' }}>
            {settingsOpen ? 'Hide' : 'Edit'} <ChevronRight size={13} style={{ transform: settingsOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
          </span>
        </div>
        {settingsOpen && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', paddingTop: '0.5rem' }}>
            {/* Stake mode */}
            <label style={{ fontSize: '11px', color: '#80948e' }}>
              Stake mode
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                {(['percent', 'fixed'] as const).map(v => (
                  <button key={v} type="button"
                    style={{ padding: '5px 12px', borderRadius: '5px', border: `1px solid ${cfg.stakeMode === v ? '#34d399' : '#1e3530'}`, background: cfg.stakeMode === v ? '#0d2e29' : 'transparent', color: cfg.stakeMode === v ? '#34d399' : '#80948e', fontSize: '11px', cursor: 'pointer' }}
                    onClick={() => updateCfg('stakeMode', v)}>{v === 'percent' ? '% of balance' : 'Fixed $'}</button>
                ))}
              </div>
            </label>
            {/* Stake value */}
            <label style={{ fontSize: '11px', color: '#80948e' }}>
              {cfg.stakeMode === 'percent' ? 'Stake % of balance' : 'Fixed stake ($)'}
              <input type="number" min={cfg.stakeMode === 'percent' ? 0.1 : 1} max={cfg.stakeMode === 'percent' ? 10 : 200} step={cfg.stakeMode === 'percent' ? 0.1 : 1}
                value={cfg.stakeValue}
                onChange={e => updateCfg('stakeValue', Math.max(0.1, Number(e.target.value)))}
                style={{ display: 'block', width: '100%', marginTop: '6px', padding: '7px 10px', background: '#0b1918', border: '1px solid #1e3530', borderRadius: '6px', color: '#e0f0ec', fontSize: '12px' }}
              />
              {cfg.stakeMode === 'percent' && (
                <span style={{ marginTop: '4px', display: 'block', fontSize: '10px', color: '#50b9a9' }}>
                  Min ${cfg.stakeMin} · Max ${cfg.stakeMax}
                </span>
              )}
            </label>
            {cfg.stakeMode === 'percent' && (
              <>
                <label style={{ fontSize: '11px', color: '#80948e' }}>
                  Min stake ($)
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                    {[1, 2, 5, 10].map(v => (
                      <button key={v} type="button"
                        style={{ padding: '5px 10px', borderRadius: '5px', border: `1px solid ${cfg.stakeMin === v ? '#34d399' : '#1e3530'}`, background: cfg.stakeMin === v ? '#0d2e29' : 'transparent', color: cfg.stakeMin === v ? '#34d399' : '#80948e', fontSize: '11px', cursor: 'pointer' }}
                        onClick={() => updateCfg('stakeMin', v)}>${v}</button>
                    ))}
                  </div>
                </label>
                <label style={{ fontSize: '11px', color: '#80948e' }}>
                  Max stake ($)
                  <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                    {[20, 50, 100, 200].map(v => (
                      <button key={v} type="button"
                        style={{ padding: '5px 10px', borderRadius: '5px', border: `1px solid ${cfg.stakeMax === v ? '#34d399' : '#1e3530'}`, background: cfg.stakeMax === v ? '#0d2e29' : 'transparent', color: cfg.stakeMax === v ? '#34d399' : '#80948e', fontSize: '11px', cursor: 'pointer' }}
                        onClick={() => updateCfg('stakeMax', v)}>${v}</button>
                    ))}
                  </div>
                </label>
              </>
            )}
            {/* Score threshold */}
            <label style={{ fontSize: '11px', color: '#80948e' }}>
              Score threshold (0–100)
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                {[60, 65, 70, 75, 80, 85, 90].map(v => (
                  <button key={v} type="button"
                    style={{ padding: '5px 9px', borderRadius: '5px', border: `1px solid ${cfg.scoreThreshold === v ? '#34d399' : '#1e3530'}`, background: cfg.scoreThreshold === v ? '#0d2e29' : 'transparent', color: cfg.scoreThreshold === v ? '#34d399' : '#80948e', fontSize: '11px', cursor: 'pointer' }}
                    onClick={() => updateCfg('scoreThreshold', v)}>{v}</button>
                ))}
              </div>
              <span style={{ marginTop: '4px', display: 'block', fontSize: '10px', color: '#6b8880' }}>
                Higher = fewer but higher-quality entries
              </span>
            </label>
            {/* ADX minimum */}
            <label style={{ fontSize: '11px', color: '#80948e' }}>
              Minimum ADX
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                {[18, 20, 22, 25, 28, 30].map(v => (
                  <button key={v} type="button"
                    style={{ padding: '5px 9px', borderRadius: '5px', border: `1px solid ${cfg.adxMin === v ? '#34d399' : '#1e3530'}`, background: cfg.adxMin === v ? '#0d2e29' : 'transparent', color: cfg.adxMin === v ? '#34d399' : '#80948e', fontSize: '11px', cursor: 'pointer' }}
                    onClick={() => updateCfg('adxMin', v)}>{v}</button>
                ))}
              </div>
            </label>
            {/* Cooldown */}
            <label style={{ fontSize: '11px', color: '#80948e' }}>
              Cooldown after 3 losses (minutes)
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                {[5, 10, 15, 20, 30].map(v => (
                  <button key={v} type="button"
                    style={{ padding: '5px 9px', borderRadius: '5px', border: `1px solid ${cfg.cooldownMinutes === v ? '#34d399' : '#1e3530'}`, background: cfg.cooldownMinutes === v ? '#0d2e29' : 'transparent', color: cfg.cooldownMinutes === v ? '#34d399' : '#80948e', fontSize: '11px', cursor: 'pointer' }}
                    onClick={() => updateCfg('cooldownMinutes', v)}>{v}m</button>
                ))}
              </div>
            </label>
            {/* Reset */}
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="button" className="secondary" style={{ fontSize: '11px', padding: '7px 14px' }}
                onClick={() => { setCfg(STP_DEFAULTS); onSaveConfig(STP_DEFAULTS); }}>
                Reset to defaults
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Summary stats */}
      {hasUserTrades && (
        <div className="record-summary" style={{ marginBottom: '1.5rem' }}>
          <Stat label="Closed trades" value={String(closed.length)} detail="This session" icon={BarChart3} />
          <Stat label="Win rate" value={displayWinRate} detail={`${userWins}W / ${closed.length - userWins}L`} tone="success" icon={Target} />
          <Stat label="Net P/L" value={money(totalPnl)} detail="Closed trades only" tone={totalPnl >= 0 ? 'success' : 'danger'} icon={totalPnl >= 0 ? TrendingUp : TrendingDown} />
        </div>
      )}

      {/* Equity curve */}
      <section className="panel">
        <div className="panel-title">
          <div><span className="eyebrow">Performance</span><h2>Equity curve</h2></div>
          <span className="chart-time">Live <Activity size={14} /></span>
        </div>
        <EquityChart trades={stpTrades} color="#34d399" />
      </section>

      {/* Six-stage pipeline */}
      <section className="panel">
        <div className="panel-title"><div><span className="eyebrow">Signal pipeline</span><h2>Six-stage entry filter</h2></div></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0' }}>
          {pipeline.map((s) => (
            <div key={s.stage} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.9rem', padding: '0.75rem 0.9rem', background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.12)', borderRadius: '9px' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#34d399', background: 'rgba(52,211,153,0.15)', borderRadius: '4px', padding: '2px 7px', letterSpacing: '0.04em', flexShrink: 0, marginTop: '1px' }}>{s.stage}</span>
              <div>
                <strong style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.2rem' }}>{s.label}</strong>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted, #9ca3af)', margin: 0, lineHeight: 1.5 }}>{s.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Scoring table */}
      <section className="panel">
        <div className="panel-title"><div><span className="eyebrow">Quality gate</span><h2>Signal scoring — threshold 75 / 100</h2></div></div>
        <div style={{ fontSize: '0.84rem' }}>
          {scoring.map(({ component, max, note }) => (
            <div key={component} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0', borderBottom: '1px solid var(--border, rgba(255,255,255,0.06))', gap: '1rem' }}>
              <div>
                <strong>{component}</strong>
                <span style={{ color: 'var(--text-muted, #9ca3af)', marginLeft: '0.6rem', fontSize: '0.77rem' }}>{note}</span>
              </div>
              <span style={{ fontWeight: 700, color: '#34d399', flexShrink: 0 }}>{max} pts</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.7rem 0 0', fontWeight: 700 }}>
            <span>Total</span><span style={{ color: '#34d399' }}>100 pts</span>
          </div>
        </div>
      </section>

      {/* Risk rules */}
      <section className="panel">
        <div className="panel-title"><div><span className="eyebrow">Risk management</span><h2>Execution rules</h2></div></div>
        {[
          ['Instrument', 'Volatility 75 Index only'],
          ['Stake', '1% of balance · min $5 · max $50'],
          ['Max concurrent trades', '1 — waits for settlement before next entry'],
          ['Consecutive loss limit', '3 losses → 15-minute cooldown, then reset'],
          ['Volatility block', 'ATR14 / ATR50-avg > 1.50 → no entry'],
          ['Martingale', 'Disabled — stake never increases after a loss'],
        ].map(([rule, val]) => (
          <div key={rule} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '0.65rem 0', borderBottom: '1px solid var(--border, rgba(255,255,255,0.06))', gap: '1rem', fontSize: '0.84rem' }}>
            <span style={{ color: 'var(--text-muted, #9ca3af)', flexShrink: 0 }}>{rule}</span>
            <span style={{ fontWeight: 600, textAlign: 'right' }}>{val}</span>
          </div>
        ))}
      </section>

      {/* Trade log */}
      <section className="panel">
        <div className="panel-title"><h2>Trend Pullback V3 trade log</h2></div>
        <TradeTable trades={stpTrades} />
      </section>
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
  onRequestBotLiveConfirm,
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
  onRequestBotLiveConfirm: (onConfirm: () => void) => void;
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
                onRequestBotLiveConfirm(() => {
                  setAllowBotLiveTrading(true);
                  setNotice('Automated bot live trading enabled. Bots can place live trades when armed.');
                });
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
          <p className="muted">New trades stop automatically when your session drawdown reaches this amount. Works on Deriv demo, Deriv live, and synthetic workspace-.</p>
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
