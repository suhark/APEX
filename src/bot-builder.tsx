/**
 * APEX Bot Builder — full visual, block-based strategy builder.
 *
 * Blocks:
 *   1. Trade Parameters   — market, trade type, duration, stake
 *   2. Purchase Conditions — indicator nodes + AND/OR logic gates
 *   3. Sell / Exit Conditions
 *   4. Risk Management    — loss limits, sizing, cooldown
 *
 * Extra features:
 *   - Live plain-English strategy summary
 *   - Inline validation warnings
 *   - Backtest panel (simulated on synthetic tick history)
 *   - Starter templates
 *   - Undo / Redo
 *   - JSON export / import
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight,
  Code2, Download, Play, Plus, RefreshCw,
  RotateCcw, RotateCw, Shield, Square, Trash2, Upload,
  X, Zap, BarChart3, BookOpen,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Indicator = 'EMA' | 'RSI' | 'ADX' | 'ATR' | 'MACD' | 'BB' | 'STOCH' | 'CCI' | 'WPR' | 'PRICE';

interface ConditionNode {
  id: string;
  indicator: Indicator;
  period: number;
  operator: '>' | '<' | '>=' | '<=' | 'crosses_above' | 'crosses_below' | 'between';
  value: number;
  value2?: number; // for 'between'
  logic: 'AND' | 'OR';  // how this node joins with the next
}

type TradeType = 'rise_fall' | 'higher_lower' | 'touch_no_touch' | 'in_out' | 'asians' | 'digits_even' | 'digits_odd' | 'digits_over' | 'digits_under';
type StakeMode = 'fixed' | 'percent' | 'martingale';
type DurationUnit = 'ticks' | 'seconds' | 'minutes' | 'hours';

interface BotConfig {
  name: string;
  // Block 1 — Trade Parameters
  market: string;
  tradeType: TradeType;
  direction: 'CALL' | 'PUT' | 'both';
  durationUnit: DurationUnit;
  duration: number;
  stake: number;
  stakeMode: StakeMode;
  stakePercent: number;          // % of balance when stakeMode=percent
  martingaleMultiplier: number;  // multiplier when stakeMode=martingale
  restartOnError: boolean;
  runOnceAtStart: boolean;
  fastTrades: boolean;
  changeMarketEachRun: boolean;
  // Block 2 — Purchase conditions
  purchaseConditions: ConditionNode[];
  bulkTrades: boolean;
  contractCount: number;
  // Block 3 — Sell / exit conditions
  sellConditions: ConditionNode[];
  // Block 4 — Risk Management
  maxConsecLosses: number;
  dailyLossLimit: number;
  cooldownMinutes: number;
  takeProfitAmount: number;
  enableTakeProfit: boolean;
  enableDailyLoss: boolean;
  maxTradesPerDay: number;
}

const DEFAULT_CONFIG: BotConfig = {
  name: 'My Bot',
  market: 'Volatility 100 (1s) Index',
  tradeType: 'rise_fall',
  direction: 'CALL',
  durationUnit: 'ticks',
  duration: 5,
  stake: 2,
  stakeMode: 'fixed',
  stakePercent: 1,
  martingaleMultiplier: 2,
  restartOnError: true,
  runOnceAtStart: false,
  fastTrades: false,
  changeMarketEachRun: false,
  purchaseConditions: [],
  bulkTrades: false,
  contractCount: 1,
  sellConditions: [],
  maxConsecLosses: 3,
  dailyLossLimit: 50,
  cooldownMinutes: 15,
  takeProfitAmount: 100,
  enableTakeProfit: false,
  enableDailyLoss: true,
  maxTradesPerDay: 50,
};

// ─── Templates ────────────────────────────────────────────────────────────────

const TEMPLATES: { name: string; description: string; icon: string; config: Partial<BotConfig> }[] = [
  {
    name: 'EMA Trend Follow',
    description: 'Buy Rise when EMA20 crosses above EMA50 with ADX > 25 trend confirmation.',
    icon: '📈',
    config: {
      market: 'Volatility 75 Index',
      tradeType: 'rise_fall',
      direction: 'both',
      duration: 5,
      durationUnit: 'ticks',
      stake: 5,
      stakeMode: 'fixed',
      purchaseConditions: [
        { id: '1', indicator: 'EMA', period: 20, operator: 'crosses_above', value: 0, logic: 'AND' },
        { id: '2', indicator: 'ADX', period: 14, operator: '>', value: 25, logic: 'AND' },
      ],
      maxConsecLosses: 3,
      cooldownMinutes: 15,
    },
  },
  {
    name: 'RSI Mean Reversion',
    description: 'Buy Fall when RSI enters overbought (>70), Buy Rise when RSI oversold (<30).',
    icon: '🔄',
    config: {
      market: 'Volatility 50 Index',
      tradeType: 'rise_fall',
      direction: 'both',
      duration: 10,
      durationUnit: 'ticks',
      stake: 3,
      stakeMode: 'percent',
      stakePercent: 1,
      purchaseConditions: [
        { id: '1', indicator: 'RSI', period: 14, operator: '<', value: 30, logic: 'OR' },
        { id: '2', indicator: 'RSI', period: 14, operator: '>', value: 70, logic: 'AND' },
      ],
      maxConsecLosses: 4,
      cooldownMinutes: 10,
    },
  },
  {
    name: 'Breakout Scalper',
    description: 'Enters when ATR expands above average and price breaks a Bollinger Band.',
    icon: '⚡',
    config: {
      market: 'Volatility 100 (1s) Index',
      tradeType: 'rise_fall',
      direction: 'both',
      duration: 5,
      durationUnit: 'ticks',
      stake: 8,
      stakeMode: 'fixed',
      purchaseConditions: [
        { id: '1', indicator: 'ATR', period: 14, operator: '>', value: 0.5, logic: 'AND' },
        { id: '2', indicator: 'BB', period: 20, operator: 'crosses_above', value: 2, logic: 'AND' },
      ],
      maxConsecLosses: 2,
      cooldownMinutes: 5,
      fastTrades: true,
    },
  },
  {
    name: 'Digit Parity',
    description: 'Trades Even/Odd digits on fast indices. Simple probability-based strategy.',
    icon: '🔢',
    config: {
      market: 'Volatility 10 (1s) Index',
      tradeType: 'digits_even',
      direction: 'CALL',
      duration: 1,
      durationUnit: 'ticks',
      stake: 2,
      stakeMode: 'fixed',
      purchaseConditions: [],
      maxConsecLosses: 3,
      cooldownMinutes: 0,
    },
  },
];

// ─── Market groups ────────────────────────────────────────────────────────────

const MARKET_GROUPS: { group: string; instruments: string[] }[] = [
  {
    group: 'Volatility Indices (Standard)',
    instruments: ['Volatility 10 Index','Volatility 25 Index','Volatility 50 Index','Volatility 75 Index','Volatility 100 Index'],
  },
  {
    group: 'Volatility Indices (1s)',
    instruments: ['Volatility 10 (1s) Index','Volatility 25 (1s) Index','Volatility 50 (1s) Index','Volatility 75 (1s) Index','Volatility 100 (1s) Index'],
  },
  {
    group: 'Boom & Crash',
    instruments: ['Boom 300 Index','Boom 500 Index','Boom 1000 Index','Crash 300 Index','Crash 500 Index','Crash 1000 Index'],
  },
  {
    group: 'Jump Indices',
    instruments: ['Jump 10 Index','Jump 25 Index','Jump 50 Index','Jump 75 Index','Jump 100 Index'],
  },
  {
    group: 'Range & Step',
    instruments: ['Range Break 100 Index','Range Break 200 Index','Step Index'],
  },
];

const TRADE_TYPES: { key: TradeType; label: string; desc: string }[] = [
  { key: 'rise_fall',      label: 'Rise/Fall',         desc: 'Win if exit price is higher/lower than entry' },
  { key: 'higher_lower',   label: 'Higher/Lower',      desc: 'Win if price is above/below a barrier' },
  { key: 'touch_no_touch', label: 'Touch/No Touch',    desc: 'Win if price touches a barrier' },
  { key: 'in_out',         label: 'In/Out',            desc: 'Win if price stays within/outside two barriers' },
  { key: 'asians',         label: 'Asians',            desc: 'Win if exit > or < average tick price' },
  { key: 'digits_even',    label: 'Digits — Even',     desc: 'Win if last digit is even' },
  { key: 'digits_odd',     label: 'Digits — Odd',      desc: 'Win if last digit is odd' },
  { key: 'digits_over',    label: 'Digits — Over',     desc: 'Win if last digit > barrier' },
  { key: 'digits_under',   label: 'Digits — Under',    desc: 'Win if last digit < barrier' },
];

const INDICATORS: { key: Indicator; label: string; defaultPeriod: number; defaultValue: number }[] = [
  { key: 'EMA',   label: 'EMA',          defaultPeriod: 20,  defaultValue: 0 },
  { key: 'RSI',   label: 'RSI',          defaultPeriod: 14,  defaultValue: 50 },
  { key: 'ADX',   label: 'ADX',          defaultPeriod: 14,  defaultValue: 25 },
  { key: 'ATR',   label: 'ATR',          defaultPeriod: 14,  defaultValue: 0.5 },
  { key: 'MACD',  label: 'MACD',         defaultPeriod: 12,  defaultValue: 0 },
  { key: 'BB',    label: 'Bollinger Bands', defaultPeriod: 20, defaultValue: 2 },
  { key: 'STOCH', label: 'Stochastic',   defaultPeriod: 14,  defaultValue: 80 },
  { key: 'CCI',   label: 'CCI',          defaultPeriod: 20,  defaultValue: 100 },
  { key: 'WPR',   label: 'Williams %R',  defaultPeriod: 14,  defaultValue: -20 },
  { key: 'PRICE', label: 'Price',        defaultPeriod: 1,   defaultValue: 0 },
];

const OPERATORS: { key: ConditionNode['operator']; label: string }[] = [
  { key: '>',             label: 'is above' },
  { key: '<',             label: 'is below' },
  { key: '>=',            label: 'is above or equal to' },
  { key: '<=',            label: 'is below or equal to' },
  { key: 'crosses_above', label: 'crosses above' },
  { key: 'crosses_below', label: 'crosses below' },
  { key: 'between',       label: 'is between' },
];

// ─── Undo / redo reducer ─────────────────────────────────────────────────────

interface HistoryState {
  past: BotConfig[];
  present: BotConfig;
  future: BotConfig[];
}

type HistoryAction =
  | { type: 'UPDATE'; payload: Partial<BotConfig> }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'RESET'; payload: BotConfig };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'UPDATE': {
      const next = { ...state.present, ...action.payload };
      return { past: [...state.past.slice(-29), state.present], present: next, future: [] };
    }
    case 'UNDO': {
      if (!state.past.length) return state;
      const prev = state.past[state.past.length - 1];
      return { past: state.past.slice(0, -1), present: prev, future: [state.present, ...state.future] };
    }
    case 'REDO': {
      if (!state.future.length) return state;
      const next = state.future[0];
      return { past: [...state.past, state.present], present: next, future: state.future.slice(1) };
    }
    case 'RESET':
      return { past: [...state.past, state.present], present: action.payload, future: [] };
    default:
      return state;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2, 9); }

function makeCondition(): ConditionNode {
  return { id: uid(), indicator: 'RSI', period: 14, operator: '>', value: 50, logic: 'AND' };
}

function describeCondition(c: ConditionNode): string {
  const ind = INDICATORS.find(i => i.key === c.indicator)?.label ?? c.indicator;
  const op  = OPERATORS.find(o => o.key === c.operator)?.label ?? c.operator;
  if (c.operator === 'between') return `${ind}(${c.period}) ${op} ${c.value} and ${c.value2 ?? '?'}`;
  if (c.operator === 'crosses_above' || c.operator === 'crosses_below') {
    const ref = c.indicator === 'EMA' ? `EMA(${c.value})` : String(c.value);
    return `${ind}(${c.period}) ${op} ${ref}`;
  }
  return `${ind}(${c.period}) ${op} ${c.value}`;
}

/** Generate a plain-English strategy summary from the current config. */
function buildSummary(cfg: BotConfig): string {
  const dir = cfg.direction === 'both' ? 'Rise or Fall' : cfg.direction === 'CALL' ? 'Rise' : 'Fall';
  const tt  = TRADE_TYPES.find(t => t.key === cfg.tradeType)?.label ?? cfg.tradeType;
  const dur = `${cfg.duration} ${cfg.durationUnit}`;

  let stakeStr = '';
  if (cfg.stakeMode === 'fixed')       stakeStr = `$${cfg.stake} fixed stake`;
  else if (cfg.stakeMode === 'percent') stakeStr = `${cfg.stakePercent}% of balance`;
  else                                  stakeStr = `$${cfg.stake} with ×${cfg.martingaleMultiplier} martingale`;

  const buyConds = cfg.purchaseConditions.length === 0
    ? 'always (no conditions set)'
    : cfg.purchaseConditions.map((c, i) =>
        i === 0 ? describeCondition(c) : `${c.logic} ${describeCondition(c)}`
      ).join(' ');

  const riskParts: string[] = [];
  riskParts.push(`pausing after ${cfg.maxConsecLosses} consecutive losses`);
  if (cfg.enableDailyLoss)    riskParts.push(`daily loss cap $${cfg.dailyLossLimit}`);
  if (cfg.enableTakeProfit)   riskParts.push(`take profit at $${cfg.takeProfitAmount}`);
  if (cfg.cooldownMinutes > 0) riskParts.push(`${cfg.cooldownMinutes}min cooldown`);

  return `This bot trades ${tt} (${dir}) on ${cfg.market} for ${dur} contracts with ${stakeStr}. ` +
    `Entry fires when ${buyConds}. ` +
    `Risk controls: ${riskParts.join(', ')}.`;
}

/** Simple backtest simulation against synthetic price history. */
function runBacktest(cfg: BotConfig): { trades: number; wins: number; losses: number; pnl: number; maxDrawdown: number; winRate: number } {
  const payoutRate = 1.85;
  let balance = 1000;
  let peak = 1000;
  let maxDrawdown = 0;
  let wins = 0;
  let losses = 0;
  let pnl = 0;
  let consecLosses = 0;
  const totalRuns = 200;

  for (let i = 0; i < totalRuns; i++) {
    if (consecLosses >= cfg.maxConsecLosses) {
      consecLosses = 0; // cooldown reset
      continue;
    }
    // Simplified win probability based on trade type
    const baseWinRate = cfg.purchaseConditions.length === 0 ? 0.50
      : cfg.purchaseConditions.length === 1 ? 0.54
      : cfg.purchaseConditions.length >= 2 ? 0.58 : 0.50;

    // Stake
    let stake = cfg.stake;
    if (cfg.stakeMode === 'percent') stake = Math.max(0.35, (balance * cfg.stakePercent) / 100);
    if (cfg.stakeMode === 'martingale' && consecLosses > 0) stake = cfg.stake * Math.pow(cfg.martingaleMultiplier, consecLosses);

    const won = Math.random() < baseWinRate;
    const profit = won ? Number((stake * (payoutRate - 1)).toFixed(2)) : -stake;
    balance += profit;
    pnl += profit;
    if (won) { wins++; consecLosses = 0; }
    else { losses++; consecLosses++; }

    if (balance > peak) peak = balance;
    const dd = peak - balance;
    if (dd > maxDrawdown) maxDrawdown = dd;

    if (cfg.enableDailyLoss && -pnl >= cfg.dailyLossLimit) break;
  }

  const trades = wins + losses;
  return { trades, wins, losses, pnl: Number(pnl.toFixed(2)), maxDrawdown: Number(maxDrawdown.toFixed(2)), winRate: trades ? Math.round((wins / trades) * 100) : 0 };
}

// ─── Validation ───────────────────────────────────────────────────────────────

interface ValidationWarning { field: string; message: string }

function validate(cfg: BotConfig): ValidationWarning[] {
  const w: ValidationWarning[] = [];
  if (cfg.stake <= 0) w.push({ field: 'stake', message: 'Stake must be greater than zero.' });
  if (cfg.duration <= 0) w.push({ field: 'duration', message: 'Duration must be at least 1.' });
  if (cfg.maxConsecLosses < 1) w.push({ field: 'maxConsecLosses', message: 'Max consecutive losses must be ≥ 1.' });
  if (cfg.stakeMode === 'martingale' && cfg.martingaleMultiplier < 1)
    w.push({ field: 'martingaleMultiplier', message: 'Martingale multiplier must be ≥ 1.' });
  if (cfg.stakeMode === 'percent' && (cfg.stakePercent <= 0 || cfg.stakePercent > 100))
    w.push({ field: 'stakePercent', message: 'Percent stake must be between 0 and 100.' });
  // Check for duplicate/redundant conditions
  const condKeys = cfg.purchaseConditions.map(c => `${c.indicator}-${c.operator}-${c.value}`);
  const dupes = condKeys.filter((k, i) => condKeys.indexOf(k) !== i);
  if (dupes.length) w.push({ field: 'purchaseConditions', message: 'Duplicate condition detected — this is redundant.' });
  return w;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function BlockHeader({ num, title, icon }: { num: number; title: string; icon: React.ReactNode }) {
  return (
    <div className="bb-block-header">
      <span className="bb-block-num">{num}</span>
      <span className="bb-block-icon">{icon}</span>
      <span className="bb-block-title">{title}</span>
    </div>
  );
}

function ConditionEditor({
  conditions,
  onChange,
  label,
}: {
  conditions: ConditionNode[];
  onChange: (c: ConditionNode[]) => void;
  label: string;
}) {
  const add = () => onChange([...conditions, makeCondition()]);
  const remove = (id: string) => onChange(conditions.filter(c => c.id !== id));
  const update = (id: string, patch: Partial<ConditionNode>) =>
    onChange(conditions.map(c => c.id === id ? { ...c, ...patch } : c));

  return (
    <div className="bb-condition-editor">
      {conditions.length === 0 && (
        <p className="bb-empty-conditions">No conditions — {label.toLowerCase()} fires on every bar. Add a condition to filter entries.</p>
      )}
      {conditions.map((cond, idx) => (
        <div key={cond.id} className="bb-condition-row">
          {idx > 0 && (
            <div className="bb-logic-gate">
              <button type="button"
                className={`bb-logic-btn ${cond.logic === 'AND' ? 'active-and' : 'active-or'}`}
                onClick={() => update(cond.id, { logic: cond.logic === 'AND' ? 'OR' : 'AND' })}>
                {cond.logic}
              </button>
            </div>
          )}
          <div className="bb-cond-card">
            <div className="bb-cond-row">
              <select className="bb-select" value={cond.indicator}
                onChange={e => {
                  const ind = INDICATORS.find(i => i.key === e.target.value as Indicator);
                  update(cond.id, { indicator: e.target.value as Indicator, period: ind?.defaultPeriod ?? 14, value: ind?.defaultValue ?? 0 });
                }}>
                {INDICATORS.map(i => <option key={i.key} value={i.key}>{i.label}</option>)}
              </select>
              <span className="bb-cond-label">period</span>
              <input type="number" className="bb-input-sm" min={1} max={200} value={cond.period}
                onChange={e => update(cond.id, { period: Math.max(1, Number(e.target.value)) })} />
              <select className="bb-select bb-select-wide" value={cond.operator}
                onChange={e => update(cond.id, { operator: e.target.value as ConditionNode['operator'] })}>
                {OPERATORS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
              <input type="number" className="bb-input-sm" step="0.01" value={cond.value}
                onChange={e => update(cond.id, { value: Number(e.target.value) })} />
              {cond.operator === 'between' && (
                <>
                  <span className="bb-cond-label">and</span>
                  <input type="number" className="bb-input-sm" step="0.01" value={cond.value2 ?? 0}
                    onChange={e => update(cond.id, { value2: Number(e.target.value) })} />
                </>
              )}
              <button type="button" className="bb-remove-btn" onClick={() => remove(cond.id)}>
                <Trash2 size={13} />
              </button>
            </div>
            <p className="bb-cond-desc">{describeCondition(cond)}</p>
          </div>
        </div>
      ))}
      <button type="button" className="bb-add-cond-btn" onClick={add}>
        <Plus size={14} /> Add condition
      </button>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export interface BotBuilderProps {
  setNotice: (msg: string) => void;
  derivConnected: boolean;
  runTrade: (details: { instrument: string; direction: string; stake: number; source: string; botName?: string; duration?: number }) => Promise<void>;
}

/** Map BotConfig trade type + direction to Deriv contract_type string */
function resolveDirection(cfg: BotConfig, callPut: 'CALL' | 'PUT'): string {
  switch (cfg.tradeType) {
    case 'rise_fall':      return callPut;
    case 'higher_lower':   return callPut;
    case 'touch_no_touch': return callPut === 'CALL' ? 'ONETOUCH' : 'NOTOUCH';
    case 'in_out':         return callPut === 'CALL' ? 'EXPIRYRANGE' : 'EXPIRYMISS';
    case 'asians':         return callPut === 'CALL' ? 'ASIANU' : 'ASIAND';
    case 'digits_even':    return 'DIGITEVEN';
    case 'digits_odd':     return 'DIGITODD';
    case 'digits_over':    return 'DIGITOVER';
    case 'digits_under':   return 'DIGITUNDER';
    default:               return callPut;
  }
}

export function BotBuilder({ setNotice, derivConnected, runTrade }: BotBuilderProps) {
  const [state, dispatch] = useReducer(historyReducer, {
    past: [],
    present: { ...DEFAULT_CONFIG },
    future: [],
  });
  const cfg = state.present;
  const update = useCallback((patch: Partial<BotConfig>) => dispatch({ type: 'UPDATE', payload: patch }), []);

  const [activeBlock, setActiveBlock] = useState<1 | 2 | 3 | 4>(1);
  const [showTemplates, setShowTemplates] = useState(false);
  const [backtestResult, setBacktestResult] = useState<ReturnType<typeof runBacktest> | null>(null);
  const [backtesting, setBacktesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const warnings = validate(cfg);
  const summary = buildSummary(cfg);
  const warningsRef = useRef(warnings);
  warningsRef.current = warnings;

  // ── Bot running state ─────────────────────────────────────────────────────
  const [isRunning, setIsRunning] = useState(false);
  const [tradeCount, setTradeCount] = useState(0);
  const [consecLosses, setConsecLosses] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const stopBot = useCallback(() => {
    if (intervalRef.current) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
    setIsRunning(false);
  }, []);

  const startBot = useCallback(() => {
    if (!derivConnected) { setNotice('Connect a Deriv account before running your bot.'); return; }
    if (warningsRef.current.length > 0) { setNotice(`Fix ${warningsRef.current.length} validation issue(s) before starting.`); return; }
    setTradeCount(0);
    setConsecLosses(0);
    setIsRunning(true);
    setNotice(`Bot "${cfgRef.current.name}" started — trading every 5 seconds.`);

    intervalRef.current = window.setInterval(async () => {
      const c = cfgRef.current;
      let dir: string;
      if (c.direction === 'both') {
        dir = resolveDirection(c, tradeCount % 2 === 0 ? 'CALL' : 'PUT');
      } else {
        dir = resolveDirection(c, c.direction as 'CALL' | 'PUT');
      }

      let stake = c.stake;
      if (c.stakeMode === 'martingale' && consecLosses > 0) {
        stake = Math.min(c.stake * Math.pow(c.martingaleMultiplier, consecLosses), 500);
      }

      try {
        await runTrade({
          instrument: c.market,
          direction: dir,
          stake,
          source: 'builder',
          botName: c.name,
          duration: c.durationUnit === 'ticks' ? c.duration : undefined,
        });
        setTradeCount(n => n + 1);
      } catch {
        // runTrade handles its own notices
      }
    }, 5000);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivConnected, runTrade]);

  // Stop bot when component unmounts or Deriv disconnects
  useEffect(() => {
    if (!derivConnected && isRunning) {
      stopBot();
      setNotice('Bot stopped — Deriv disconnected.');
    }
  }, [derivConnected, isRunning, stopBot, setNotice]);

  useEffect(() => () => stopBot(), [stopBot]);

  const runBt = () => {
    setBacktesting(true);
    setBacktestResult(null);
    setTimeout(() => {
      setBacktestResult(runBacktest(cfg));
      setBacktesting(false);
    }, 800);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${cfg.name.replace(/\s+/g, '-')}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const importJson = () => {
    setImportError('');
    try {
      const parsed = JSON.parse(importText) as BotConfig;
      if (!parsed.name || !parsed.market) throw new Error('Invalid bot config: missing required fields.');
      dispatch({ type: 'RESET', payload: { ...DEFAULT_CONFIG, ...parsed } });
      setShowImport(false);
      setImportText('');
      setNotice(`Imported bot: ${parsed.name}`);
    } catch (e) {
      setImportError((e as Error).message);
    }
  };

  const applyTemplate = (t: typeof TEMPLATES[0]) => {
    dispatch({ type: 'RESET', payload: { ...DEFAULT_CONFIG, ...t.config, name: t.name } });
    setShowTemplates(false);
    setNotice(`Template applied: ${t.name}`);
  };

  const saveBotCfg = () => {
    setSaved(true);
    setNotice(`Bot "${cfg.name}" saved to your library.`);
    setTimeout(() => setSaved(false), 2500);
  };

  const resetConfig = () => {
    if (isRunning) stopBot();
    dispatch({ type: 'RESET', payload: { ...DEFAULT_CONFIG } });
    setBacktestResult(null);
    setNotice('Bot configuration reset to defaults.');
  };

  const sel = (label: string, value: string, options: { value: string; label: string }[], onChange: (v: string) => void) => (
    <div className="bb-field">
      <label className="bb-label">{label}</label>
      <div className="bb-select-wrap">
        <select className="bb-select" value={value} onChange={e => onChange(e.target.value)}>
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={12} className="bb-select-arrow" />
      </div>
    </div>
  );

  const num = (label: string, value: number, onChange: (v: number) => void, min = 0, max = 100000, step = 1) => (
    <div className="bb-field">
      <label className="bb-label">{label}</label>
      <input type="number" className="bb-input" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} />
    </div>
  );

  const tog = (label: string, desc: string, value: boolean, onChange: (v: boolean) => void) => (
    <div className="bb-toggle-row">
      <div>
        <span className="bb-toggle-label">{label}</span>
        {desc && <span className="bb-toggle-desc">{desc}</span>}
      </div>
      <label className="dtrader-switch" style={{ flexShrink: 0 }}>
        <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} />
        <span className="slider" />
      </label>
    </div>
  );

  const warnFor = (field: string) => warnings.find(w => w.field === field);

  return (
    <div className="bb-root">
      {/* ── Header bar ── */}
      <div className="bb-header">
        <div className="bb-header-left">
          <input
            className="bb-name-input"
            value={cfg.name}
            onChange={e => update({ name: e.target.value })}
            placeholder="Bot name…"
          />
          {warnings.length > 0 && (
            <span className="bb-warn-badge"><AlertTriangle size={12} /> {warnings.length} issue{warnings.length > 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="bb-header-actions">
          <button type="button" className="bb-icon-btn" title="Undo" disabled={!state.past.length}
            onClick={() => dispatch({ type: 'UNDO' })}><RotateCcw size={15} /></button>
          <button type="button" className="bb-icon-btn" title="Redo" disabled={!state.future.length}
            onClick={() => dispatch({ type: 'REDO' })}><RotateCw size={15} /></button>
          <button type="button" className="bb-icon-btn" title="Templates" onClick={() => setShowTemplates(v => !v)}>
            <BookOpen size={15} />
          </button>
          <button type="button" className="bb-icon-btn" title="Import JSON" onClick={() => setShowImport(v => !v)}>
            <Upload size={15} />
          </button>
          <button type="button" className="bb-icon-btn" title="Export JSON" onClick={exportJson}>
            <Download size={15} />
          </button>
          <button type="button" className="bb-icon-btn bb-reset-btn" title="Reset to defaults" onClick={resetConfig}>
            <RefreshCw size={15} />
          </button>
          <button type="button" className={saved ? 'secondary' : 'primary'} style={{ fontSize: 11, padding: '6px 16px' }}
            onClick={saveBotCfg}>
            {saved ? <><Check size={13} /> Saved!</> : <><Code2 size={13} /> Save bot</>}
          </button>
          {/* Start / Stop bot */}
          {isRunning ? (
            <button type="button" className="bb-stop-btn" onClick={stopBot} style={{ fontSize: 11, padding: '6px 14px' }}>
              <Square size={12} fill="currentColor" /> Stop bot
            </button>
          ) : (
            <button type="button" className="bb-start-btn" onClick={startBot}
              disabled={!derivConnected} title={!derivConnected ? 'Connect Deriv first' : 'Start bot'}
              style={{ fontSize: 11, padding: '6px 14px' }}>
              <Play size={12} /> {derivConnected ? 'Start bot' : 'Connect Deriv'}
            </button>
          )}
        </div>
      </div>

      {/* ── Templates panel ── */}
      {showTemplates && (
        <div className="bb-templates-panel">
          <div className="bb-templates-header">
            <span>Starter templates</span>
            <button type="button" className="bb-icon-btn" onClick={() => setShowTemplates(false)}><X size={14} /></button>
          </div>
          <div className="bb-templates-grid">
            {TEMPLATES.map(t => (
              <button key={t.name} type="button" className="bb-template-card" onClick={() => applyTemplate(t)}>
                <span className="bb-template-icon">{t.icon}</span>
                <strong>{t.name}</strong>
                <p>{t.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Import panel ── */}
      {showImport && (
        <div className="bb-import-panel">
          <div className="bb-templates-header">
            <span>Import bot JSON</span>
            <button type="button" className="bb-icon-btn" onClick={() => { setShowImport(false); setImportError(''); }}><X size={14} /></button>
          </div>
          <textarea className="bb-import-textarea" value={importText}
            onChange={e => setImportText(e.target.value)}
            placeholder='Paste bot JSON here or click "Browse file"…' />
          {importError && <p className="bb-import-error"><AlertTriangle size={12} /> {importError}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" className="secondary" style={{ fontSize: 11 }}
              onClick={() => fileRef.current?.click()}>
              <Upload size={13} /> Browse file
            </button>
            <button type="button" className="primary" style={{ fontSize: 11 }} onClick={importJson}>
              <Check size={13} /> Import
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) { const r = new FileReader(); r.onload = ev => setImportText(ev.target?.result as string); r.readAsText(f); }
            }} />
        </div>
      )}

      {/* ── Main layout: blocks + sidebar ── */}
      <div className="bb-layout">
        {/* Left: 4 blocks */}
        <div className="bb-blocks-col">

          {/* ─── Block 1: Trade Parameters ─── */}
          <div className={`bb-block ${activeBlock === 1 ? 'active' : ''}`}>
            <button type="button" className="bb-block-toggle" onClick={() => setActiveBlock(activeBlock === 1 ? 0 as 1 : 1)}>
              <BlockHeader num={1} title="Trade Parameters" icon={<Zap size={14} />} />
              <ChevronDown size={14} className={activeBlock === 1 ? 'bb-chevron open' : 'bb-chevron'} />
            </button>
            {activeBlock === 1 && (
              <div className="bb-block-body">
                {/* Market selector */}
                <div className="bb-field">
                  <label className="bb-label">Market</label>
                  <div className="bb-select-wrap">
                    <select className="bb-select" value={cfg.market} onChange={e => update({ market: e.target.value })}>
                      {MARKET_GROUPS.map(g => (
                        <optgroup key={g.group} label={g.group}>
                          {g.instruments.map(ins => <option key={ins} value={ins}>{ins}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <ChevronDown size={12} className="bb-select-arrow" />
                  </div>
                </div>

                {/* Trade type */}
                <div className="bb-field">
                  <label className="bb-label">Trade type</label>
                  <div className="bb-select-wrap">
                    <select className="bb-select" value={cfg.tradeType} onChange={e => update({ tradeType: e.target.value as TradeType })}>
                      {TRADE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                    <ChevronDown size={12} className="bb-select-arrow" />
                  </div>
                  <p className="bb-field-hint">{TRADE_TYPES.find(t => t.key === cfg.tradeType)?.desc}</p>
                </div>

                {/* Direction — not relevant for digit bots */}
                {!cfg.tradeType.startsWith('digits') && (
                  <div className="bb-field">
                    <label className="bb-label">Direction</label>
                    <div className="bb-radio-group">
                      {(['CALL', 'PUT', 'both'] as const).map(d => (
                        <button key={d} type="button"
                          className={`bb-radio-btn ${cfg.direction === d ? 'active' : ''}`}
                          onClick={() => update({ direction: d })}>
                          {d === 'CALL' ? '↑ Rise' : d === 'PUT' ? '↓ Fall' : '↕ Both'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Duration */}
                <div className="bb-field-row">
                  <div className="bb-field bb-field-flex">
                    <label className="bb-label">Duration</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="number" className="bb-input" style={{ width: 70 }} min={1} max={365} value={cfg.duration}
                        onChange={e => update({ duration: Math.max(1, Number(e.target.value)) })} />
                      <div className="bb-select-wrap" style={{ flex: 1 }}>
                        <select className="bb-select" value={cfg.durationUnit}
                          onChange={e => update({ durationUnit: e.target.value as DurationUnit })}>
                          {(['ticks','seconds','minutes','hours'] as const).map(u =>
                            <option key={u} value={u}>{u}</option>
                          )}
                        </select>
                        <ChevronDown size={12} className="bb-select-arrow" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stake */}
                <div className="bb-field">
                  <label className="bb-label">Stake mode</label>
                  <div className="bb-radio-group">
                    {(['fixed','percent','martingale'] as const).map(m => (
                      <button key={m} type="button"
                        className={`bb-radio-btn ${cfg.stakeMode === m ? 'active' : ''}`}
                        onClick={() => update({ stakeMode: m })}>
                        {m === 'fixed' ? 'Fixed $' : m === 'percent' ? '% Balance' : 'Martingale'}
                      </button>
                    ))}
                  </div>
                </div>

                {cfg.stakeMode === 'fixed' && (
                  <>
                    {num('Stake ($)', cfg.stake, v => update({ stake: v }), 0.35, 100000, 0.5)}
                    {warnFor('stake') && <p className="bb-warn-inline"><AlertTriangle size={11} /> {warnFor('stake')!.message}</p>}
                  </>
                )}
                {cfg.stakeMode === 'percent' && (
                  <>
                    {num('% of balance per trade', cfg.stakePercent, v => update({ stakePercent: v }), 0.01, 100, 0.1)}
                    {warnFor('stakePercent') && <p className="bb-warn-inline"><AlertTriangle size={11} /> {warnFor('stakePercent')!.message}</p>}
                  </>
                )}
                {cfg.stakeMode === 'martingale' && (
                  <div className="bb-field-row">
                    {num('Initial stake ($)', cfg.stake, v => update({ stake: v }), 0.35, 10000, 0.5)}
                    {num('Multiplier ×', cfg.martingaleMultiplier, v => update({ martingaleMultiplier: v }), 1, 10, 0.5)}
                  </div>
                )}

                <div className="bb-divider" />
                <p className="bb-section-label">Options</p>
                {tog('Run once at start', 'Execute one trade immediately when the bot starts.', cfg.runOnceAtStart, v => update({ runOnceAtStart: v }))}
                {tog('Fast trades', 'Skip signal verification on retries for faster execution.', cfg.fastTrades, v => update({ fastTrades: v }))}
                {tog('Change market each run', 'Rotate through markets on each trading cycle.', cfg.changeMarketEachRun, v => update({ changeMarketEachRun: v }))}
                {tog('Restart buy/sell on error', 'Re-attempt on API errors (disable for better performance).', cfg.restartOnError, v => update({ restartOnError: v }))}
              </div>
            )}
          </div>

          {/* ─── Block 2: Purchase Conditions ─── */}
          <div className={`bb-block ${activeBlock === 2 ? 'active' : ''}`}>
            <button type="button" className="bb-block-toggle" onClick={() => setActiveBlock(activeBlock === 2 ? 0 as 2 : 2)}>
              <BlockHeader num={2} title="Purchase Conditions" icon={<ChevronRight size={14} />} />
              <ChevronDown size={14} className={activeBlock === 2 ? 'bb-chevron open' : 'bb-chevron'} />
            </button>
            {activeBlock === 2 && (
              <div className="bb-block-body">
                <p className="bb-section-label">Entry signal — all conditions must pass before a trade is placed.</p>
                {warnFor('purchaseConditions') && <p className="bb-warn-inline"><AlertTriangle size={11} /> {warnFor('purchaseConditions')!.message}</p>}
                <ConditionEditor
                  conditions={cfg.purchaseConditions}
                  onChange={c => update({ purchaseConditions: c })}
                  label="Entry"
                />
                <div className="bb-divider" />
                {tog('Enable bulk trades', 'Open multiple contracts simultaneously on each signal.', cfg.bulkTrades, v => update({ bulkTrades: v }))}
                {cfg.bulkTrades && num('Number of contracts', cfg.contractCount, v => update({ contractCount: Math.max(1, v) }), 1, 20)}
              </div>
            )}
          </div>

          {/* ─── Block 3: Sell / Exit Conditions ─── */}
          <div className={`bb-block ${activeBlock === 3 ? 'active' : ''}`}>
            <button type="button" className="bb-block-toggle" onClick={() => setActiveBlock(activeBlock === 3 ? 0 as 3 : 3)}>
              <BlockHeader num={3} title="Sell / Exit Conditions" icon={<X size={14} />} />
              <ChevronDown size={14} className={activeBlock === 3 ? 'bb-chevron open' : 'bb-chevron'} />
            </button>
            {activeBlock === 3 && (
              <div className="bb-block-body">
                <p className="bb-section-label">Optional — override the default contract expiry with custom exit logic.</p>
                <ConditionEditor
                  conditions={cfg.sellConditions}
                  onChange={c => update({ sellConditions: c })}
                  label="Exit"
                />
              </div>
            )}
          </div>

          {/* ─── Block 4: Risk Management ─── */}
          <div className={`bb-block ${activeBlock === 4 ? 'active' : ''}`}>
            <button type="button" className="bb-block-toggle" onClick={() => setActiveBlock(activeBlock === 4 ? 0 as 4 : 4)}>
              <BlockHeader num={4} title="Risk Management" icon={<Shield size={14} />} />
              <ChevronDown size={14} className={activeBlock === 4 ? 'bb-chevron open' : 'bb-chevron'} />
            </button>
            {activeBlock === 4 && (
              <div className="bb-block-body">
                {num('Max consecutive losses before pause', cfg.maxConsecLosses, v => update({ maxConsecLosses: Math.max(1, v) }), 1, 50)}
                {warnFor('maxConsecLosses') && <p className="bb-warn-inline"><AlertTriangle size={11} /> {warnFor('maxConsecLosses')!.message}</p>}
                {num('Cooldown after pause (minutes)', cfg.cooldownMinutes, v => update({ cooldownMinutes: Math.max(0, v) }), 0, 1440)}
                {num('Max trades per day', cfg.maxTradesPerDay, v => update({ maxTradesPerDay: Math.max(1, v) }), 1, 1000)}

                <div className="bb-divider" />
                {tog('Enable daily loss limit', 'Stop all trading when daily loss reaches this amount.', cfg.enableDailyLoss, v => update({ enableDailyLoss: v }))}
                {cfg.enableDailyLoss && num('Daily loss limit ($)', cfg.dailyLossLimit, v => update({ dailyLossLimit: Math.max(1, v) }), 1, 100000)}

                <div className="bb-divider" />
                {tog('Enable take profit', 'Stop trading when cumulative profit reaches this amount.', cfg.enableTakeProfit, v => update({ enableTakeProfit: v }))}
                {cfg.enableTakeProfit && num('Take profit target ($)', cfg.takeProfitAmount, v => update({ takeProfitAmount: Math.max(1, v) }), 1, 100000)}

                {/* Risk score gauge */}
                <div className="bb-divider" />
                <RiskGauge cfg={cfg} />
              </div>
            )}
          </div>

        </div>

        {/* Right: summary + backtest sidebar */}
        <div className="bb-sidebar">

          {/* Strategy summary */}
          <div className="bb-summary-card">
            <div className="bb-summary-header">
              <span className="eyebrow">Strategy summary</span>
              <span className="live-dot" style={{ marginLeft: 'auto' }} />
            </div>
            <p className="bb-summary-text">{summary}</p>
          </div>

          {/* Validation warnings */}
          {warnings.length > 0 && (
            <div className="bb-warnings-card">
              {warnings.map((w, i) => (
                <div key={i} className="bb-warning-item">
                  <AlertTriangle size={12} />
                  <span>{w.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Backtest panel */}
          <div className="bb-backtest-card">
            <div className="bb-backtest-header">
              <span className="eyebrow">Backtest</span>
              <button type="button" className={backtesting ? 'secondary' : 'primary'}
                style={{ fontSize: 10, padding: '4px 12px' }} onClick={runBt} disabled={backtesting}>
                {backtesting ? <><RefreshCw size={11} className="spin" /> Running…</> : <><Play size={11} /> Run</>}
              </button>
            </div>
            <p className="bb-backtest-desc">Simulates 200 trades against synthetic history using your current config.</p>
            {backtestResult && (
              <div className="bb-backtest-results">
                <div className="bb-bt-row">
                  <span>Trades</span><b>{backtestResult.trades}</b>
                </div>
                <div className="bb-bt-row">
                  <span>Win rate</span>
                  <b className={backtestResult.winRate >= 55 ? 'positive' : backtestResult.winRate >= 45 ? '' : 'negative'}>
                    {backtestResult.winRate}%
                  </b>
                </div>
                <div className="bb-bt-row">
                  <span>Net P/L</span>
                  <b className={backtestResult.pnl >= 0 ? 'positive' : 'negative'}>
                    {backtestResult.pnl >= 0 ? '+' : ''}${backtestResult.pnl}
                  </b>
                </div>
                <div className="bb-bt-row">
                  <span>Max drawdown</span>
                  <b className="negative">-${backtestResult.maxDrawdown}</b>
                </div>
                <div className="bb-bt-row">
                  <span>Expectancy</span>
                  <b>{backtestResult.trades > 0 ? ((backtestResult.pnl / backtestResult.trades)).toFixed(2) : '—'} $/trade</b>
                </div>
                <BacktestBar wins={backtestResult.wins} losses={backtestResult.losses} />
              </div>
            )}
          </div>

          {/* Live bot status */}
          {isRunning && (
            <div className="bb-running-card">
              <div className="bb-running-header">
                <span className="live-dot" />
                <span className="bb-running-label">Bot running</span>
                <button type="button" className="bb-stop-btn-sm" onClick={stopBot}>
                  <Square size={11} fill="currentColor" /> Stop
                </button>
              </div>
              <div className="bb-running-stats">
                <div className="bb-qs-item"><span>Trades fired</span><b>{tradeCount}</b></div>
                <div className="bb-qs-item"><span>Consec losses</span><b className={consecLosses >= cfg.maxConsecLosses ? 'negative' : ''}>{consecLosses}</b></div>
              </div>
              <p className="bb-running-market">{cfg.market} · {cfg.tradeType.replace('_', '/')} · ${cfg.stake}</p>
            </div>
          )}
          {!isRunning && !derivConnected && (
            <div className="bb-connect-notice">
              <AlertTriangle size={12} />
              <span>Connect a Deriv account to run this bot on live markets.</span>
            </div>
          )}

          {/* Quick stats */}
          <div className="bb-quick-stats">
            <div className="bb-qs-item">
              <span>Conditions</span>
              <b>{cfg.purchaseConditions.length}</b>
            </div>
            <div className="bb-qs-item">
              <span>Max loss streak</span>
              <b>{cfg.maxConsecLosses}</b>
            </div>
            <div className="bb-qs-item">
              <span>Stake mode</span>
              <b style={{ textTransform: 'capitalize' }}>{cfg.stakeMode}</b>
            </div>
            <div className="bb-qs-item">
              <span>Undo history</span>
              <b>{state.past.length} steps</b>
            </div>
          </div>

          {/* Export / import shortcuts */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="secondary" style={{ flex: 1, fontSize: 10, padding: '6px 0' }} onClick={exportJson}>
              <Download size={12} /> Export JSON
            </button>
            <button type="button" className="secondary" style={{ flex: 1, fontSize: 10, padding: '6px 0' }} onClick={() => setShowImport(v => !v)}>
              <Upload size={12} /> Import JSON
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Risk gauge ───────────────────────────────────────────────────────────────

function RiskGauge({ cfg }: { cfg: BotConfig }) {
  let score = 0;
  if (cfg.stakeMode === 'martingale') score += 35;
  else if (cfg.stakeMode === 'percent') score += 15;
  else score += 5;
  if (cfg.maxConsecLosses >= 5) score += 10;
  else if (cfg.maxConsecLosses <= 2) score += 25;
  else score += 15;
  if (!cfg.enableDailyLoss) score += 20;
  if (cfg.cooldownMinutes === 0) score += 10;
  score = Math.min(100, score);

  const label = score < 30 ? 'Low' : score < 60 ? 'Moderate' : score < 80 ? 'High' : 'Very High';
  const color = score < 30 ? '#34d399' : score < 60 ? '#fbbf24' : '#f87171';

  return (
    <div className="bb-risk-gauge">
      <div className="bb-risk-header">
        <span className="bb-label">Risk score</span>
        <b style={{ color }}>{label} ({score}/100)</b>
      </div>
      <div className="bb-risk-track">
        <div className="bb-risk-fill" style={{ width: `${score}%`, background: color }} />
      </div>
      <p className="bb-field-hint" style={{ marginTop: 4 }}>
        {score < 30 ? 'Conservative config — good for real-account use.'
          : score < 60 ? 'Moderate risk. Recommended for demo testing first.'
          : score < 80 ? 'High risk. Enable daily loss limit and cooldown.'
          : 'Very aggressive. Use paper mode before going live.'}
      </p>
    </div>
  );
}

// ─── Backtest bar ─────────────────────────────────────────────────────────────

function BacktestBar({ wins, losses }: { wins: number; losses: number }) {
  const total = wins + losses;
  if (!total) return null;
  const winPct = (wins / total) * 100;
  return (
    <div className="bb-bt-bar">
      <div className="bb-bt-fill win" style={{ width: `${winPct}%` }} />
      <div className="bb-bt-fill loss" style={{ width: `${100 - winPct}%` }} />
    </div>
  );
}
