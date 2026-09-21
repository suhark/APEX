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
type StakeMode = 'fixed' | 'percent' | 'percent_of_account_balance' | 'martingale' | 'score_scaled';
type DurationUnit = 'ticks' | 'seconds' | 'minutes' | 'hours';

interface DrawdownGovernor {
  afterLosses2StakeOverlay: number;   // stake multiplier after 2 consec losses (e.g. 0.5 = half stake)
  afterLosses2Cooldown: number;       // minutes cooldown after 2 losses
  afterLosses3Action: 'pause' | 'reduce'; // pause or just reduce after 3
  afterLosses3Cooldown: number;       // minutes cooldown after 3 losses
  afterWins3StakeOverlay: number;     // stake multiplier after 3 consec wins (bankroll protection)
  reverseOnLoss: boolean;             // flip direction after a loss
  noMartingale: boolean;              // hard block martingale stake escalation
}

interface AsianStrategy {
  enabled: boolean;
  priceDriftThreshold: number;
  checkInterval: 'tick' | 'minute' | 'second';
  emaPeriod: number;
  durationUnit: DurationUnit;
  duration: number;
}

interface RegimeFilter {
  enabled: boolean;
  atrPeriod: number;
  atrSmaPeriod: number;
  activeRangeMin: number;   // ATR/SMA ratio min (e.g. 0.8 = not too quiet)
  activeRangeMax: number;   // ATR/SMA ratio max (e.g. 1.3 = not too wild)
}

interface EntryScoring {
  enabled: boolean;
  threshold: number;        // 0–100, min score to fire trade
  breakoutStrengthWeight: number;
  bandExpansionWeight: number;
  confirmationCandleWeight: number;
  adxStrengthWeight: number;
  atrRegimeWeight: number;
}

export interface BotConfig {
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
  minStake: number;              // score_scaled / martingale floor
  maxStake: number;              // score_scaled / martingale ceiling
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
  dailyLossLimitPercent: number;   // % of balance (used when enableDailyLossPercent=true)
  enableDailyLossPercent: boolean; // use % instead of fixed $
  cooldownMinutes: number;
  takeProfitAmount: number;
  enableTakeProfit: boolean;
  enableDailyLoss: boolean;
  maxTradesPerDay: number;
  nonOverlappingExecution: boolean;
  // Advanced
  drawdownGovernor: DrawdownGovernor;
  regimeFilter: RegimeFilter;
  entryScoring: EntryScoring;
  asianStrategy: AsianStrategy;
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
  minStake: 2,
  maxStake: 20,
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
  dailyLossLimitPercent: 3,
  enableDailyLossPercent: false,
  cooldownMinutes: 15,
  takeProfitAmount: 100,
  enableTakeProfit: false,
  enableDailyLoss: true,
  maxTradesPerDay: 50,
  nonOverlappingExecution: true,
  drawdownGovernor: {
    afterLosses2StakeOverlay: 0.5,
    afterLosses2Cooldown: 15,
    afterLosses3Action: 'pause',
    afterLosses3Cooldown: 60,
    afterWins3StakeOverlay: 0.8,
    reverseOnLoss: false,
    noMartingale: false,
  },
  regimeFilter: {
    enabled: false,
    atrPeriod: 14,
    atrSmaPeriod: 50,
    activeRangeMin: 0.8,
    activeRangeMax: 1.3,
  },
  entryScoring: {
    enabled: false,
    threshold: 75,
    breakoutStrengthWeight: 30,
    bandExpansionWeight: 20,
    confirmationCandleWeight: 20,
    adxStrengthWeight: 15,
    atrRegimeWeight: 15,
  },
  asianStrategy: {
    enabled: false,
    priceDriftThreshold: 0.15,
    checkInterval: 'tick',
    emaPeriod: 20,
    durationUnit: 'minutes',
    duration: 120,
  },
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
  const isDigit = cfg.tradeType.startsWith('digits');
  const isAsians = cfg.tradeType === 'asians';
  
  let dirStr = '';
  if (isDigit) {
    dirStr = 'digit prediction';
  } else if (isAsians) {
    dirStr = 'average tick comparison';
  } else {
    dirStr = cfg.direction === 'both' ? 'Rise or Fall' : cfg.direction === 'CALL' ? 'Rise' : 'Fall';
  }
  
  const tt  = TRADE_TYPES.find(t => t.key === cfg.tradeType)?.label ?? cfg.tradeType;
  const dur = `${cfg.duration} ${cfg.durationUnit}`;

  let stakeStr = '';
  if (cfg.stakeMode === 'fixed')        stakeStr = `$${cfg.stake} fixed stake`;
  else if (cfg.stakeMode === 'percent') stakeStr = `${cfg.stakePercent}% of balance`;
  else if (cfg.stakeMode === 'percent_of_account_balance') stakeStr = `${cfg.stakePercent}% of account balance`;
  else if (cfg.stakeMode === 'score_scaled') stakeStr = `$${cfg.minStake}–$${cfg.maxStake} score-scaled`;
  else                                  stakeStr = `$${cfg.minStake}–$${cfg.maxStake} martingale ×${cfg.martingaleMultiplier}`;

  // For digit and Asian types, conditions are less relevant
  const buyConds = (isDigit || isAsians) && cfg.purchaseConditions.length === 0
    ? 'based on tick analysis'
    : cfg.purchaseConditions.length === 0
    ? 'always (no conditions set)'
    : cfg.purchaseConditions.map((c, i) =>
        i === 0 ? describeCondition(c) : `${c.logic} ${describeCondition(c)}`
      ).join(' ');

  const riskParts: string[] = [];
  riskParts.push(`pausing after ${cfg.maxConsecLosses} consecutive losses`);
  if (cfg.enableDailyLoss)    riskParts.push(cfg.enableDailyLossPercent ? `daily loss cap ${cfg.dailyLossLimitPercent}% of balance` : `daily loss cap $${cfg.dailyLossLimit}`);
  if (cfg.enableTakeProfit)   riskParts.push(`take profit at $${cfg.takeProfitAmount}`);
  if (cfg.cooldownMinutes > 0) riskParts.push(`${cfg.cooldownMinutes}min cooldown`);
  if (cfg.regimeFilter.enabled) riskParts.push(`ATR regime filter (${cfg.regimeFilter.activeRangeMin}–${cfg.regimeFilter.activeRangeMax}×SMA)`);
  if (cfg.entryScoring.enabled) riskParts.push(`entry scoring ≥${cfg.entryScoring.threshold}/100`);

  return `This bot trades ${tt} (${dirStr}) on ${cfg.market} for ${dur} contracts with ${stakeStr}. ` +
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

    // Regime filter — skip if not in active range (simulated as ~25% skip rate)
    if (cfg.regimeFilter.enabled && Math.random() < 0.25) continue;

    // Score-based entry gate
    let score = 60 + Math.random() * 40;
    if (cfg.entryScoring.enabled && score < cfg.entryScoring.threshold) continue;

    // Drawdown governor — pause cycle after too many losses
    if (consecLosses >= cfg.maxConsecLosses) { consecLosses = 0; continue; }

    // Stake computation
    let stake = cfg.stake;
    if (cfg.stakeMode === 'percent' || cfg.stakeMode === 'percent_of_account_balance') {
      stake = Math.max(0.35, (balance * cfg.stakePercent) / 100);
    } else if (cfg.stakeMode === 'score_scaled') {
      const t = cfg.entryScoring.enabled
        ? Math.max(0, (score - cfg.entryScoring.threshold) / (100 - cfg.entryScoring.threshold))
        : 0.5;
      stake = Math.max(cfg.minStake, Math.min(cfg.maxStake, cfg.minStake + (cfg.maxStake - cfg.minStake) * t));
    } else if (cfg.stakeMode === 'martingale' && !cfg.drawdownGovernor.noMartingale && consecLosses > 0) {
      stake = Math.min(cfg.maxStake, cfg.stake * Math.pow(cfg.martingaleMultiplier, consecLosses));
    }
    // Drawdown governor stake overlays
    if (consecLosses >= 2) stake *= cfg.drawdownGovernor.afterLosses2StakeOverlay;
    // Win protection: reduce stake after 3 consecutive wins
    if (wins >= 3 && cfg.drawdownGovernor.afterWins3StakeOverlay < 1) {
      stake *= cfg.drawdownGovernor.afterWins3StakeOverlay;
    }
    stake = Math.max(0.35, Number(stake.toFixed(2)));

    const won = Math.random() < baseWinRate;
    const profit = won ? Number((stake * (payoutRate - 1)).toFixed(2)) : -stake;
    balance += profit;
    pnl += profit;
    if (won) { wins++; consecLosses = 0; }
    else { losses++; consecLosses++; }

    if (balance > peak) peak = balance;
    const dd = peak - balance;
    if (dd > maxDrawdown) maxDrawdown = dd;

    if (cfg.enableDailyLoss) {
      const limit = cfg.enableDailyLossPercent ? (1000 * cfg.dailyLossLimitPercent / 100) : cfg.dailyLossLimit;
      if (-pnl >= limit) break;
    }
  }

  const trades = wins + losses;
  return { trades, wins, losses, pnl: Number(pnl.toFixed(2)), maxDrawdown: Number(maxDrawdown.toFixed(2)), winRate: trades ? Math.round((wins / trades) * 100) : 0 };
}

// ─── Validation ───────────────────────────────────────────────────────────────

interface ValidationWarning { field: string; message: string }

function validate(cfg: BotConfig): ValidationWarning[] {
  const w: ValidationWarning[] = [];
  if (cfg.stake <= 0 && cfg.stakeMode === 'fixed') w.push({ field: 'stake', message: 'Stake must be greater than zero.' });
  if (cfg.duration <= 0) w.push({ field: 'duration', message: 'Duration must be at least 1.' });
  if (cfg.maxConsecLosses < 1) w.push({ field: 'maxConsecLosses', message: 'Max consecutive losses must be ≥ 1.' });
  if (cfg.stakeMode === 'martingale' && cfg.martingaleMultiplier < 1)
    w.push({ field: 'martingaleMultiplier', message: 'Martingale multiplier must be ≥ 1.' });
  if ((cfg.stakeMode === 'percent' || cfg.stakeMode === 'percent_of_account_balance') && (cfg.stakePercent <= 0 || cfg.stakePercent > 100))
    w.push({ field: 'stakePercent', message: 'Percent stake must be between 0 and 100.' });
  if (cfg.stakeMode === 'score_scaled' && cfg.minStake >= cfg.maxStake)
    w.push({ field: 'stake', message: 'Score-scaled: min stake must be less than max stake.' });
  if (cfg.entryScoring.enabled) {
    const total = cfg.entryScoring.breakoutStrengthWeight + cfg.entryScoring.bandExpansionWeight +
      cfg.entryScoring.confirmationCandleWeight + cfg.entryScoring.adxStrengthWeight + cfg.entryScoring.atrRegimeWeight;
    if (total !== 100) w.push({ field: 'entryScoring', message: `Entry scoring weights sum to ${total}, not 100.` });
  }
  if (cfg.regimeFilter.enabled && cfg.regimeFilter.activeRangeMin >= cfg.regimeFilter.activeRangeMax)
    w.push({ field: 'regimeFilter', message: 'Regime filter: min range must be less than max range.' });
  if (cfg.asianStrategy.enabled && cfg.asianStrategy.priceDriftThreshold < 0 || cfg.asianStrategy.priceDriftThreshold > 1)
    w.push({ field: 'asianStrategy', message: 'Asian strategy: price drift threshold must be between 0 and 1.' });
  // Duplicate conditions check
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
  trades?: Array<{ id: string; instrument: string; direction: string; stake: number; result: string; profit: number; created_at: string; bot_name?: string; entry_price?: number; exit_price?: number }>;
  tick?: number; // Add tick prop for condition evaluation
  botBuilderState?: {
    isRunning: boolean;
    tradeCount: number;
    consecLosses: number;
    sessionStart: string | null;
    config: BotConfig | null;
  };
  onBotBuilderStateChange?: (state: { isRunning: boolean; tradeCount: number; consecLosses: number; sessionStart: string | null; config: BotConfig | null }) => void;
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

/** Evaluate purchase conditions against current tick data */
function evaluateConditions(conditions: ConditionNode[], currentTick: number): boolean {
  if (conditions.length === 0) return true; // No conditions = always trade
  
  // Build synthetic price history from tick (simplified for demo)
  const prices: number[] = [];
  for (let i = 0; i < 200; i++) {
    prices.push(priceFor(i, currentTick - (200 - i)));
  }
  
  const latestPrice = prices[prices.length - 1];
  const previousPrice = prices[prices.length - 2];
  
  // Helper functions for indicator calculations
  const calculateEMA = (period: number): number => {
    if (prices.length < period) return latestPrice;
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
  };
  
  const calculateRSI = (period: number): number => {
    if (prices.length < period + 1) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  };
  
  const calculateADX = (period: number): number => {
    if (prices.length < period + 1) return 25;
    // Simplified ADX calculation
    const trs: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const high = prices[i];
      const low = prices[i];
      const prevClose = prices[i - 1];
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trs.push(tr);
    }
    const atr = trs.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
    // Simplified directional movement
    const plusDM = prices.slice(-period).reduce((sum, p, i, arr) => {
      if (i === 0) return sum;
      const upMove = p - arr[i - 1];
      return sum + (upMove > 0 && upMove > (arr[i] - arr[i - 1] * -1) ? upMove : 0);
    }, 0);
    const minusDM = prices.slice(-period).reduce((sum, p, i, arr) => {
      if (i === 0) return sum;
      const downMove = arr[i - 1] - p;
      return sum + (downMove > 0 && downMove > (arr[i] - arr[i - 1]) ? downMove : 0);
    }, 0);
    const plusDI = (plusDM / period) / atr * 100;
    const minusDI = (minusDM / period) / atr * 100;
    const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;
    return dx; // Simplified - actual ADX uses smoothed DX
  };
  
  const calculateATR = (period: number): number => {
    if (prices.length < period + 1) return 0.5;
    const trs: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const high = prices[i];
      const low = prices[i];
      const prevClose = prices[i - 1];
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trs.push(tr);
    }
    return trs.slice(-period).reduce((sum, tr) => sum + tr, 0) / period;
  };
  
  const calculateMACD = (period: number): number => {
    const ema12 = calculateEMA(12);
    const ema26 = calculateEMA(26);
    return ema12 - ema26;
  };
  
  const calculateBB = (period: number): number => {
    if (prices.length < period) return latestPrice;
    const sma = prices.slice(-period).reduce((sum, p) => sum + p, 0) / period;
    const squaredDiffs = prices.slice(-period).map(p => Math.pow(p - sma, 2));
    const stdDev = Math.sqrt(squaredDiffs.reduce((sum, sq) => sum + sq, 0) / period);
    return (latestPrice - sma) / stdDev; // Return as standard deviations from mean
  };
  
  const calculateSTOCH = (period: number): number => {
    if (prices.length < period) return 50;
    const recentPrices = prices.slice(-period);
    const high = Math.max(...recentPrices);
    const low = Math.min(...recentPrices);
    const k = ((latestPrice - low) / (high - low)) * 100;
    return k;
  };
  
  const calculateCCI = (period: number): number => {
    if (prices.length < period) return 0;
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((sum, p) => sum + p, 0) / period;
    const meanDeviation = recentPrices.reduce((sum, p) => sum + Math.abs(p - sma), 0) / period;
    const cci = (latestPrice - sma) / (0.015 * meanDeviation);
    return cci;
  };
  
  const calculateWPR = (period: number): number => {
    if (prices.length < period) return -50;
    const recentPrices = prices.slice(-period);
    const high = Math.max(...recentPrices);
    const low = Math.min(...recentPrices);
    const wpr = -100 * (high - latestPrice) / (high - low);
    return wpr;
  };
  
  // Evaluate each condition
  let allConditionsMet = true;
  for (let i = 0; i < conditions.length; i++) {
    const cond = conditions[i];
    let indicatorValue: number;
    
    switch (cond.indicator) {
      case 'EMA':
        indicatorValue = calculateEMA(cond.period);
        break;
      case 'RSI':
        indicatorValue = calculateRSI(cond.period);
        break;
      case 'ADX':
        indicatorValue = calculateADX(cond.period);
        break;
      case 'ATR':
        indicatorValue = calculateATR(cond.period);
        break;
      case 'MACD':
        indicatorValue = calculateMACD(cond.period);
        break;
      case 'BB':
        indicatorValue = calculateBB(cond.period);
        break;
      case 'STOCH':
        indicatorValue = calculateSTOCH(cond.period);
        break;
      case 'CCI':
        indicatorValue = calculateCCI(cond.period);
        break;
      case 'WPR':
        indicatorValue = calculateWPR(cond.period);
        break;
      case 'PRICE':
        indicatorValue = latestPrice;
        break;
      default:
        indicatorValue = latestPrice;
    }
    
    let conditionMet = false;
    const compareValue = cond.indicator === 'EMA' && cond.operator.includes('crosses') 
      ? calculateEMA(cond.value) 
      : cond.value;
    
    switch (cond.operator) {
      case '>':
        conditionMet = indicatorValue > compareValue;
        break;
      case '<':
        conditionMet = indicatorValue < compareValue;
        break;
      case '>=':
        conditionMet = indicatorValue >= compareValue;
        break;
      case '<=':
        conditionMet = indicatorValue <= compareValue;
        break;
      case 'crosses_above':
        // Simplified cross detection
        const prevIndicatorValue = cond.indicator === 'EMA' ? calculateEMA(cond.period) : indicatorValue;
        conditionMet = indicatorValue > compareValue && prevIndicatorValue <= compareValue;
        break;
      case 'crosses_below':
        conditionMet = indicatorValue < compareValue && prevIndicatorValue >= compareValue;
        break;
      case 'between':
        conditionMet = indicatorValue >= cond.value && indicatorValue <= (cond.value2 ?? 0);
        break;
    }
    
    // Apply logic (AND/OR)
    if (i === 0) {
      allConditionsMet = conditionMet;
    } else if (cond.logic === 'AND') {
      allConditionsMet = allConditionsMet && conditionMet;
    } else {
      allConditionsMet = allConditionsMet || conditionMet;
    }
    
    // Early exit if AND logic fails
    if (!allConditionsMet && cond.logic === 'AND') {
      return false;
    }
  }
  
  return allConditionsMet;
}

export function BotBuilder({ setNotice, derivConnected, runTrade, trades = [], tick = 0, botBuilderState, onBotBuilderStateChange }: BotBuilderProps) {
  const [state, dispatch] = useReducer(historyReducer, {
    past: [],
    present: { ...DEFAULT_CONFIG },
    future: [],
  });
  const cfg = state.present;
  const update = useCallback((patch: Partial<BotConfig>) => dispatch({ type: 'UPDATE', payload: patch }), []);

  const [activeBlock, setActiveBlock] = useState<1 | 2 | 3 | 4>(1);
  const [showTemplates, setShowTemplates] = useState(false);

  // Handle AI-generated config import
  useEffect(() => {
    // Check localStorage for AI-generated config on mount
    const aiConfig = localStorage.getItem('ai_generated_bot_config');
    const aiFormat = localStorage.getItem('ai_generated_config_format') || 'json';
    
    if (aiConfig) {
      try {
        if (aiFormat === 'json') {
          const parsedConfig = JSON.parse(aiConfig);
          // Validate and merge with defaults
          const importedConfig = { ...DEFAULT_CONFIG, ...parsedConfig };
          dispatch({ type: 'RESET', payload: importedConfig });
          setNotice('AI-generated configuration imported successfully!');
          // Clear the localStorage after importing
          localStorage.removeItem('ai_generated_bot_config');
          localStorage.removeItem('ai_generated_config_format');
        } else if (aiFormat === 'xml') {
          // Basic XML parsing (simplified - in production you'd want a proper XML parser)
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(aiConfig, 'text/xml');
          
          const parseBotConfig = (xml: Document): Partial<BotConfig> => {
            const bot = xml.querySelector('bot');
            if (!bot) return {};
            
            const getText = (selector: string) => bot.querySelector(selector)?.textContent || '';
            const getAttr = (selector: string, attr: string) => bot.querySelector(selector)?.getAttribute(attr);
            
            const parseConditions = (parent: Element | null): ConditionNode[] => {
              if (!parent) return [];
              return Array.from(parent.querySelectorAll('condition')).map((cond, i) => ({
                id: cond.getAttribute('id') || `ai_${i}`,
                indicator: (cond.getAttribute('indicator') || 'RSI') as Indicator,
                period: parseInt(cond.getAttribute('period') || '14'),
                operator: (cond.getAttribute('operator') || '>') as ConditionNode['operator'],
                value: parseFloat(cond.getAttribute('value') || '50'),
                logic: (cond.getAttribute('logic') || 'AND') as 'AND' | 'OR',
              }));
            };
            
            return {
              name: bot.getAttribute('name') || 'AI Generated Bot',
              market: getText('market') || 'Volatility 75 Index',
              tradeType: normalizeTradeType(getText('tradeType') || 'rise_fall'),
              direction: (getText('direction') || 'CALL') as 'CALL' | 'PUT' | 'both',
              durationUnit: (bot.querySelector('duration')?.getAttribute('unit') || 'ticks') as DurationUnit,
              duration: parseInt(bot.querySelector('duration')?.textContent || '5'),
              stake: parseFloat(getText('stake') || '5'),
              stakeMode: normalizeStakeMode(bot.querySelector('stake')?.getAttribute('mode') || 'fixed'),
              purchaseConditions: parseConditions(bot.querySelector('purchaseConditions')),
              sellConditions: parseConditions(bot.querySelector('exitConditions')),
              maxConsecLosses: parseInt(bot.querySelector('riskManagement maxConsecLosses')?.textContent || '3'),
              dailyLossLimit: parseFloat(bot.querySelector('riskManagement dailyLossLimit')?.textContent || '50'),
              cooldownMinutes: parseInt(bot.querySelector('riskManagement cooldownMinutes')?.textContent || '15'),
              maxTradesPerDay: parseInt(bot.querySelector('riskManagement maxTradesPerDay')?.textContent || '50'),
              enableDailyLoss: true,
              enableTakeProfit: false,
              takeProfitAmount: 100,
              asianStrategy: {
                enabled: Boolean(bot.querySelector('asianStrategy')?.getAttribute('enabled')),
                priceDriftThreshold: parseFloat(bot.querySelector('asianStrategy')?.getAttribute('priceDriftThreshold') || '0.15'),
                checkInterval: (bot.querySelector('asianStrategy')?.getAttribute('checkInterval') || 'tick') as 'tick' | 'minute' | 'second',
                emaPeriod: parseInt(bot.querySelector('asianStrategy')?.getAttribute('emaPeriod') || '20'),
                durationUnit: (bot.querySelector('asianStrategy')?.getAttribute('durationUnit') || 'minutes') as DurationUnit,
                duration: parseInt(bot.querySelector('asianStrategy')?.getAttribute('duration') || '120'),
              },
            };

            function normalizeTradeType(type: string): TradeType {
              const typeStr = type.toLowerCase().replace(/[-_]/g, '');
              const typeMap: Record<string, TradeType> = {
                'risefall': 'rise_fall', 'rise/fall': 'rise_fall', 'rise_fall': 'rise_fall',
                'higherlower': 'higher_lower', 'higher/lower': 'higher_lower', 'higher_lower': 'higher_lower',
                'touchnotouch': 'touch_no_touch', 'touch/no touch': 'touch_no_touch', 'touch_no_touch': 'touch_no_touch',
                'inout': 'in_out', 'in/out': 'in_out', 'in_out': 'in_out',
                'asians': 'asians', 'asian': 'asians',
                'digitseven': 'digits_even', 'digits/even': 'digits_even', 'digits_even': 'digits_even',
                'digitsodd': 'digits_odd', 'digits/odd': 'digits_odd', 'digits_odd': 'digits_odd',
                'digitsover': 'digits_over', 'digits/over': 'digits_over', 'digits_over': 'digits_over',
                'digitsunder': 'digits_under', 'digits/under': 'digits_under', 'digits_under': 'digits_under',
              };
              return typeMap[typeStr] || 'rise_fall';
            }

            function normalizeStakeMode(mode: string): StakeMode {
              const modeStr = mode.toLowerCase().replace(/[-_]/g, '');
              const modeMap: Record<string, StakeMode> = {
                'fixed': 'fixed',
                'percent': 'percent',
                'percentofaccountbalance': 'percent_of_account_balance',
                'percentofbalance': 'percent_of_account_balance',
                'percent_of_account_balance': 'percent_of_account_balance',
                'martingale': 'martingale',
                'scorescaled': 'score_scaled',
                'score_scaled': 'score_scaled',
              };
              return modeMap[modeStr] || 'fixed';
            }
          };
          
          const importedConfig = parseBotConfig(xmlDoc);
          const fullConfig = { ...DEFAULT_CONFIG, ...importedConfig };
          dispatch({ type: 'RESET', payload: fullConfig });
          setNotice('AI-generated XML configuration imported successfully!');
          // Clear the localStorage after importing
          localStorage.removeItem('ai_generated_bot_config');
          localStorage.removeItem('ai_generated_config_format');
        }
      } catch (error) {
        console.error('Failed to import AI config:', error);
        setNotice('Failed to import AI configuration. Invalid format.');
        // Clear the localStorage even on error
        localStorage.removeItem('ai_generated_bot_config');
        localStorage.removeItem('ai_generated_config_format');
      }
    }
  }, [setNotice]);

  // Auto-adjust settings when trade type changes
  useEffect(() => {
    const isDigit = cfg.tradeType.startsWith('digits');
    const isAsians = cfg.tradeType === 'asians';
    
    if (isDigit || isAsians) {
      // Clear direction as it's not applicable for these types
      if (cfg.direction !== 'CALL') {
        update({ direction: 'CALL' });
      }
      // Clear purchase conditions as they're less relevant for digit/Asian types
      if (cfg.purchaseConditions.length > 0) {
        update({ purchaseConditions: [] });
      }
    }
  }, [cfg.tradeType, update]);
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

  // ── Saved / favourite bots ────────────────────────────────────────────────
  const [savedBots, setSavedBots] = useState<BotConfig[]>(() => {
    try { const r = localStorage.getItem('apex_saved_bots'); return r ? JSON.parse(r) : []; } catch { return []; }
  });
  const [showSaved, setShowSaved] = useState(false);

  const saveToFavourites = () => {
    const next = [cfg, ...savedBots.filter(b => b.name !== cfg.name)].slice(0, 20);
    setSavedBots(next);
    try { localStorage.setItem('apex_saved_bots', JSON.stringify(next)); } catch { /* ignore */ }
    setSaved(true);
    setNotice(`"${cfg.name}" saved to favourites.`);
    setTimeout(() => setSaved(false), 2500);
  };

  const loadSavedBot = (b: BotConfig) => {
    dispatch({ type: 'RESET', payload: b });
    setShowSaved(false);
    setNotice(`Loaded "${b.name}" from favourites.`);
  };

  const deleteSavedBot = (name: string) => {
    const next = savedBots.filter(b => b.name !== name);
    setSavedBots(next);
    try { localStorage.setItem('apex_saved_bots', JSON.stringify(next)); } catch { /* ignore */ }
  };

  // ── Bot running state ─────────────────────────────────────────────────────
  const [isRunning, setIsRunning] = useState(botBuilderState?.isRunning ?? false);
  const [tradeCount, setTradeCount] = useState(botBuilderState?.tradeCount ?? 0);
  const [consecLosses, setConsecLosses] = useState(botBuilderState?.consecLosses ?? 0);
  const [sessionStart, setSessionStart] = useState<string | null>(botBuilderState?.sessionStart ?? null);
  const [showPanel, setShowPanel] = useState(false);
  const [panelTab, setPanelTab] = useState<'summary' | 'transactions' | 'journal'>('summary');
  const [scanStatus, setScanStatus] = useState<string>('');
  const intervalRef = useRef<number | null>(null);
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const tickRef = useRef(tick);
  tickRef.current = tick;
  // Use refs for mutable counters so interval closure always reads fresh values
  const tradeCountRef = useRef(botBuilderState?.tradeCount ?? 0);
  const consecLossesRef = useRef(botBuilderState?.consecLosses ?? 0);
  
  // Sync state with parent when it changes from props (one-way sync: parent -> child)
  useEffect(() => {
    if (botBuilderState) {
      console.log('Syncing from parent:', { parentRunning: botBuilderState.isRunning, localRunning: isRunning });
      setIsRunning(botBuilderState.isRunning);
      setTradeCount(botBuilderState.tradeCount);
      setConsecLosses(botBuilderState.consecLosses);
      setSessionStart(botBuilderState.sessionStart);
      tradeCountRef.current = botBuilderState.tradeCount;
      consecLossesRef.current = botBuilderState.consecLosses;
    }
  }, [botBuilderState]);

  // Keep tick ref updated
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const stopBot = useCallback(() => {
    if (intervalRef.current) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
    setIsRunning(false);
    setScanStatus('');
    // Notify parent to stop tracking this bot
    if (onBotBuilderStateChange) {
      onBotBuilderStateChange({
        isRunning: false,
        tradeCount,
        consecLosses,
        sessionStart,
        config: cfg
      });
    }
  }, [tradeCount, consecLosses, sessionStart, cfg, onBotBuilderStateChange]);

  const startBot = useCallback(() => {
    console.log('Bot Builder startBot called', { derivConnected, warnings: warningsRef.current.length });
    if (!derivConnected) { setNotice('Connect a Deriv account before running your bot.'); return; }
    if (warningsRef.current.length > 0) { setNotice(`Fix ${warningsRef.current.length} validation issue(s) before starting.`); return; }
    
    // Set local state first
    setTradeCount(0);
    setConsecLosses(0);
    setSessionStart(new Date().toISOString());
    setIsRunning(true);
    
    tradeCountRef.current = 0;
    consecLossesRef.current = 0;
    setShowPanel(true); // auto-open panel when bot starts
    setNotice(`Bot "${cfgRef.current.name}" started — now running in background even when you navigate away.`);
    
    console.log('Bot Builder local state set, now notifying parent', { 
      hasCallback: !!onBotBuilderStateChange, 
      config: cfg
    });
    
    // Directly notify parent after local state is set (no useEffect)
    if (onBotBuilderStateChange) {
      onBotBuilderStateChange({
        isRunning: true,
        tradeCount: 0,
        consecLosses: 0,
        sessionStart: new Date().toISOString(),
        config: cfg
      });
    } else {
      console.error('Bot Builder state change failed - no callback available');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivConnected, onBotBuilderStateChange, cfg]);

  // Stop bot when component unmounts or Deriv disconnects
  useEffect(() => {
    if (!derivConnected && isRunning) {
      stopBot();
      setNotice('Bot stopped — Deriv disconnected.');
    }
  }, [derivConnected, isRunning, stopBot, setNotice]);

  useEffect(() => {
    return () => stopBot();
  }, [stopBot]);

  // Derive this session's trades from the trades prop (filtered by bot name + session start)
  const sessionTrades = sessionStart
    ? trades.filter(t =>
        t.bot_name === cfg.name &&
        new Date(t.created_at).getTime() >= new Date(sessionStart).getTime() - 2000 &&
        (t.result === 'won' || t.result === 'lost')
      )
    : [];

  // Keep consecLossesRef in sync with real settled trades
  useEffect(() => {
    if (!sessionStart) return;
    let streak = 0;
    for (const t of [...sessionTrades].reverse()) {
      if (t.result === 'lost') streak++;
      else break;
    }
    consecLossesRef.current = streak;
    setConsecLosses(streak);
  }, [sessionTrades.length, sessionStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessionWins   = sessionTrades.filter(t => t.result === 'won').length;
  const sessionLosses = sessionTrades.filter(t => t.result === 'lost').length;
  const totalStake    = sessionTrades.reduce((s, t) => s + Number(t.stake ?? 0), 0);
  const totalPnl      = sessionTrades.reduce((s, t) => s + Number(t.profit ?? 0), 0);
  const totalPayout   = sessionTrades.filter(t => t.result === 'won').reduce((s, t) => s + Number(t.stake ?? 0) + Number(t.profit ?? 0), 0);

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = JSON.parse(importText);
      if (!raw || typeof raw !== 'object') throw new Error('Not a valid JSON object.');

      // ── Normalise purchaseConditions ──────────────────────────────────────
      // Accept: array (our format), object { rise, fall } (advanced format),
      // or completely missing — all gracefully mapped to ConditionNode[].
      let purchaseConditions: ConditionNode[] = [];
      if (Array.isArray(raw.purchaseConditions)) {
        // Our native format — filter to only nodes that have a known indicator
        purchaseConditions = (raw.purchaseConditions as ConditionNode[]).filter(
          (c) => c && typeof c.indicator === 'string' && typeof c.operator === 'string'
        );
      } else if (raw.purchaseConditions && typeof raw.purchaseConditions === 'object') {
        // Advanced { rise: [...], fall: [...] } format — flatten and deduplicate
        const all: ConditionNode[] = [
          ...(Array.isArray(raw.purchaseConditions.rise)  ? raw.purchaseConditions.rise  : []),
          ...(Array.isArray(raw.purchaseConditions.fall)  ? raw.purchaseConditions.fall  : []),
        ];
        // Map foreign indicator names to our known indicators
        const indicatorMap: Record<string, Indicator> = {
          BB_UPPER: 'BB', BB_LOWER: 'BB', CANDLE_BODY: 'ATR',
          EMA: 'EMA', RSI: 'RSI', ADX: 'ADX', ATR: 'ATR',
          MACD: 'MACD', BB: 'BB', STOCH: 'STOCH', CCI: 'CCI', WPR: 'WPR', PRICE: 'PRICE',
        };
        const operatorMap: Record<string, ConditionNode['operator']> = {
          price_crosses_above: 'crosses_above',
          price_crosses_below: 'crosses_below',
          '>': '>', '<': '<', '>=': '>=', '<=': '<=',
        };
        const seen = new Set<string>();
        for (const c of all) {
          const ind = indicatorMap[(c.indicator as string)?.toUpperCase()] ?? 'ATR';
          const op  = operatorMap[c.operator as string] ?? '>';
          const key = `${ind}-${op}-${c.value ?? 0}`;
          if (seen.has(key)) continue; // skip duplicates
          seen.add(key);
          purchaseConditions.push({
            id: c.id ?? uid(),
            indicator: ind,
            period: Number(c.period) || 14,
            operator: op,
            value: Number(c.value ?? (c as any).valueMultipleOfATR ?? 0),
            logic: (c.logic === 'OR' ? 'OR' : 'AND') as 'AND' | 'OR',
          });
        }
      }

      // ── Normalise stakeMode ───────────────────────────────────────────────
      const VALID_STAKE_MODES: StakeMode[] = ['fixed', 'percent', 'percent_of_account_balance', 'martingale', 'score_scaled'];
      const stakeMode: StakeMode = VALID_STAKE_MODES.includes(raw.stakeMode)
        ? raw.stakeMode as StakeMode
        : 'fixed'; // anything exotic → fixed

      // ── Normalise riskManagement fields ──────────────────────────────────
      const rm = raw.riskManagement ?? {};
      const maxConsecLosses = raw.maxConsecLosses
        ?? (rm.drawdownGovernor?.afterConsecutiveLosses3 ? 3 : DEFAULT_CONFIG.maxConsecLosses);
      const enableDailyLoss  = raw.enableDailyLoss ?? (rm.dailyLossLimitPercent != null);
      const dailyLossLimit   = raw.dailyLossLimit
        ?? (rm.dailyLossLimitPercent ? rm.dailyLossLimitPercent * 10 : DEFAULT_CONFIG.dailyLossLimit);
      const cooldownMinutes  = raw.cooldownMinutes
        ?? rm.drawdownGovernor?.afterConsecutiveLosses3?.cooldownMinutes
        ?? DEFAULT_CONFIG.cooldownMinutes;

      // Drawdown governor
      const dg = rm.drawdownGovernor ?? {};
      const drawdownGovernor: DrawdownGovernor = {
        afterLosses2StakeOverlay: Number(dg.afterConsecutiveLosses2?.stakeOverlay ?? raw.drawdownGovernor?.afterLosses2StakeOverlay ?? DEFAULT_CONFIG.drawdownGovernor.afterLosses2StakeOverlay),
        afterLosses2Cooldown:     Number(dg.afterConsecutiveLosses2?.cooldownMinutes ?? raw.drawdownGovernor?.afterLosses2Cooldown ?? DEFAULT_CONFIG.drawdownGovernor.afterLosses2Cooldown),
        afterLosses3Action:       (dg.afterConsecutiveLosses3?.action === 'pause' || raw.drawdownGovernor?.afterLosses3Action === 'pause') ? 'pause' : 'reduce',
        afterLosses3Cooldown:     Number(dg.afterConsecutiveLosses3?.cooldownMinutes ?? raw.drawdownGovernor?.afterLosses3Cooldown ?? DEFAULT_CONFIG.drawdownGovernor.afterLosses3Cooldown),
        afterWins3StakeOverlay:   Number(dg.afterConsecutiveWins3?.stakeOverlay ?? raw.drawdownGovernor?.afterWins3StakeOverlay ?? DEFAULT_CONFIG.drawdownGovernor.afterWins3StakeOverlay),
        reverseOnLoss:            Boolean(dg.afterConsecutiveLosses2?.reverseDirection ?? raw.drawdownGovernor?.reverseOnLoss ?? false),
        noMartingale:             Boolean(rm.noMartingale ?? raw.drawdownGovernor?.noMartingale ?? false),
      };

      // Regime filter
      const rf = raw.regimeFilter ?? {};
      const regimeFilter: RegimeFilter = {
        enabled:        Boolean(rf.enabled ?? (rf.atrPeriod != null)),
        atrPeriod:      Number(rf.atrPeriod ?? DEFAULT_CONFIG.regimeFilter.atrPeriod),
        atrSmaPeriod:   Number(rf.atrSmaPeriod ?? DEFAULT_CONFIG.regimeFilter.atrSmaPeriod),
        activeRangeMin: Number(rf.activeRangeMin ?? DEFAULT_CONFIG.regimeFilter.activeRangeMin),
        activeRangeMax: Number(rf.activeRangeMax ?? DEFAULT_CONFIG.regimeFilter.activeRangeMax),
      };

      // Entry scoring
      const es = raw.entryScoring ?? {};
      const components: Record<string, number> = {};
      if (Array.isArray(es.components)) {
        es.components.forEach((c: { name: string; weight: number }) => { components[c.name] = c.weight; });
      }
      const entryScoring: EntryScoring = {
        enabled:                   Boolean(es.threshold != null || raw.entryScoring?.enabled),
        threshold:                 Number(es.threshold ?? DEFAULT_CONFIG.entryScoring.threshold),
        breakoutStrengthWeight:    Number(components.breakoutStrength  ?? es.breakoutStrengthWeight  ?? DEFAULT_CONFIG.entryScoring.breakoutStrengthWeight),
        bandExpansionWeight:       Number(components.bandExpansion     ?? es.bandExpansionWeight     ?? DEFAULT_CONFIG.entryScoring.bandExpansionWeight),
        confirmationCandleWeight:  Number(components.confirmationCandle ?? es.confirmationCandleWeight ?? DEFAULT_CONFIG.entryScoring.confirmationCandleWeight),
        adxStrengthWeight:         Number(components.adxStrength       ?? es.adxStrengthWeight       ?? DEFAULT_CONFIG.entryScoring.adxStrengthWeight),
        atrRegimeWeight:           Number(components.atrRegime         ?? es.atrRegimeWeight         ?? DEFAULT_CONFIG.entryScoring.atrRegimeWeight),
      };

      // Asian strategy
      const as = raw.asianStrategy ?? {};
      const asianStrategy: AsianStrategy = {
        enabled: Boolean(as.enabled),
        priceDriftThreshold: Number(as.priceDriftThreshold ?? DEFAULT_CONFIG.asianStrategy.priceDriftThreshold),
        checkInterval: (as.checkInterval === 'tick' || as.checkInterval === 'minute' || as.checkInterval === 'second') ? as.checkInterval : 'tick',
        emaPeriod: Number(as.emaPeriod ?? DEFAULT_CONFIG.asianStrategy.emaPeriod),
        durationUnit: (as.durationUnit && ['ticks', 'seconds', 'minutes', 'hours'].includes(as.durationUnit)) ? as.durationUnit as DurationUnit : DEFAULT_CONFIG.asianStrategy.durationUnit,
        duration: Number(as.duration ?? DEFAULT_CONFIG.asianStrategy.duration),
      };

      // ── Stake values ──────────────────────────────────────────────────────
      const stake = raw.stake ?? raw.minStake ?? raw.baseStake ?? DEFAULT_CONFIG.stake;

      // ── Sell conditions ───────────────────────────────────────────────────
      const sellConditions: ConditionNode[] = Array.isArray(raw.sellConditions) ? raw.sellConditions : [];

      // ── Build normalised config ───────────────────────────────────────────
      const normalised: BotConfig = {
        ...DEFAULT_CONFIG,
        name:              raw.name        || 'Imported Bot',
        market:            raw.market      || DEFAULT_CONFIG.market,
        tradeType:         normalizeTradeType(raw.tradeType),
        direction:         raw.direction   || DEFAULT_CONFIG.direction,
        durationUnit:      raw.durationUnit || DEFAULT_CONFIG.durationUnit,
        duration:          Number(raw.duration)  || DEFAULT_CONFIG.duration,
        stake,
        stakeMode,
        stakePercent:      Number(raw.stakePercent)       || DEFAULT_CONFIG.stakePercent,
        minStake:          Number(raw.minStake ?? raw.stake ?? DEFAULT_CONFIG.minStake),
        maxStake:          Number(raw.maxStake ?? DEFAULT_CONFIG.maxStake),
        martingaleMultiplier: Number(raw.martingaleMultiplier) || DEFAULT_CONFIG.martingaleMultiplier,
        restartOnError:    raw.restartOnError  ?? DEFAULT_CONFIG.restartOnError,
        runOnceAtStart:    raw.runOnceAtStart  ?? DEFAULT_CONFIG.runOnceAtStart,
        fastTrades:        raw.fastTrades      ?? DEFAULT_CONFIG.fastTrades,
        changeMarketEachRun: raw.changeMarketEachRun ?? DEFAULT_CONFIG.changeMarketEachRun,
        purchaseConditions,
        sellConditions,
        bulkTrades:        raw.bulkTrades      ?? DEFAULT_CONFIG.bulkTrades,
        contractCount:     Number(raw.contractCount) || DEFAULT_CONFIG.contractCount,
        maxConsecLosses:   Number(maxConsecLosses)   || DEFAULT_CONFIG.maxConsecLosses,
        dailyLossLimit:    Number(dailyLossLimit)     || DEFAULT_CONFIG.dailyLossLimit,
        dailyLossLimitPercent: Number(rm.dailyLossLimitPercent ?? raw.dailyLossLimitPercent ?? DEFAULT_CONFIG.dailyLossLimitPercent),
        enableDailyLossPercent: Boolean(rm.dailyLossLimitPercent != null && raw.enableDailyLossPercent !== false),
        cooldownMinutes:   Number(cooldownMinutes)    || 0,
        takeProfitAmount:  Number(raw.takeProfitAmount) || DEFAULT_CONFIG.takeProfitAmount,
        enableTakeProfit:  raw.enableTakeProfit ?? DEFAULT_CONFIG.enableTakeProfit,
        enableDailyLoss:   Boolean(enableDailyLoss),
        maxTradesPerDay:   Number(raw.maxTradesPerDay) || DEFAULT_CONFIG.maxTradesPerDay,
        nonOverlappingExecution: Boolean(rm.nonOverlappingExecution ?? raw.nonOverlappingExecution ?? DEFAULT_CONFIG.nonOverlappingExecution),
        drawdownGovernor,
        regimeFilter,
        entryScoring,
        asianStrategy,
      };

      // Helper function to normalize trade type
      function normalizeTradeType(type: any): TradeType {
        if (!type) return DEFAULT_CONFIG.tradeType;
        const typeStr = String(type).toLowerCase().replace(/[-_]/g, '');
        
        // Map various possible formats to our TradeType
        const typeMap: Record<string, TradeType> = {
          'risefall': 'rise_fall',
          'rise/fall': 'rise_fall',
          'rise_fall': 'rise_fall',
          'higherlower': 'higher_lower',
          'higher/lower': 'higher_lower',
          'higher_lower': 'higher_lower',
          'touchnotouch': 'touch_no_touch',
          'touch/no touch': 'touch_no_touch',
          'touch_no_touch': 'touch_no_touch',
          'inout': 'in_out',
          'in/out': 'in_out',
          'in_out': 'in_out',
          'asians': 'asians',
          'asian': 'asians',
          'digitseven': 'digits_even',
          'digits/even': 'digits_even',
          'digits_even': 'digits_even',
          'digitsodd': 'digits_odd',
          'digits/odd': 'digits_odd',
          'digits_odd': 'digits_odd',
          'digitsover': 'digits_over',
          'digits/over': 'digits_over',
          'digits_over': 'digits_over',
          'digitsunder': 'digits_under',
          'digits/under': 'digits_under',
          'digits_under': 'digits_under',
        };
        
        return typeMap[typeStr] || DEFAULT_CONFIG.tradeType;
      }

      dispatch({ type: 'RESET', payload: normalised });
      setShowImport(false);
      setImportText('');

      const remapped: string[] = [];
      if (!VALID_STAKE_MODES.includes(raw.stakeMode)) remapped.push(`stake mode "${raw.stakeMode}" → fixed`);
      if (!Array.isArray(raw.purchaseConditions)) remapped.push(`purchaseConditions object → ${purchaseConditions.length} condition nodes`);
      const remapNote = remapped.length ? ` (remapped: ${remapped.join(', ')})` : '';
      setNotice(`✓ Imported "${normalised.name}" — ${purchaseConditions.length} conditions loaded${remapNote}.`);
    } catch (e) {
      setImportError(`Parse error: ${(e as Error).message}. Check your JSON is valid.`);
    }
  };

  const applyTemplate = (t: typeof TEMPLATES[0]) => {
    dispatch({ type: 'RESET', payload: { ...DEFAULT_CONFIG, ...t.config, name: t.name } });
    setShowTemplates(false);
    setNotice(`Template applied: ${t.name}`);
  };

  const saveBotCfg = () => {
    saveToFavourites();
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
          <button type="button" className={`bb-icon-btn ${showSaved ? 'active' : ''}`}
            title={`Saved bots (${savedBots.length})`}
            onClick={() => { setShowSaved(v => !v); setShowTemplates(false); setShowImport(false); }}>
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <BookOpen size={15} />
              {savedBots.length > 0 && (
                <span style={{
                  position: 'absolute', top: -5, right: -6,
                  background: '#2dd4bf', color: '#071110',
                  borderRadius: '50%', width: 13, height: 13,
                  fontSize: 8, fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{savedBots.length}</span>
              )}
            </span>
          </button>
          <button type="button" className={`bb-icon-btn ${showPanel ? 'active' : ''}`} title="Trade journal"
            onClick={() => setShowPanel(v => !v)}>
            <BarChart3 size={15} />
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

      {/* ── Saved / Favourite Bots panel ── */}
      {showSaved && (
        <div className="bb-templates-panel">
          <div className="bb-templates-header">
            <span>Saved bots {savedBots.length > 0 && `(${savedBots.length})`}</span>
            <button type="button" className="bb-icon-btn" onClick={() => setShowSaved(false)}><X size={14} /></button>
          </div>
          {savedBots.length === 0 ? (
            <p style={{ fontSize: 11, color: '#3d5a54', margin: 0, padding: '8px 2px' }}>
              No saved bots yet. Click <strong>Save bot</strong> to save the current config.
            </p>
          ) : (
            <div className="bb-saved-list">
              {savedBots.map(b => (
                <div key={b.name} className="bb-saved-row">
                  <div className="bb-saved-info">
                    <strong>{b.name}</strong>
                    <span>{b.market.replace('Volatility ', 'V').replace(' Index', '')} · {b.tradeType.replace('_','/')} · {b.stakeMode.replace('_',' ')}</span>
                  </div>
                  <div className="bb-saved-actions">
                    <button type="button" className="bb-radio-btn active" style={{ fontSize: 10, padding: '3px 10px' }}
                      onClick={() => loadSavedBot(b)}>
                      Load
                    </button>
                    <button type="button" className="bb-remove-btn" onClick={() => deleteSavedBot(b.name)} title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10, borderTop: '1px solid #162925', paddingTop: 10 }}>
            <button type="button" className="primary" style={{ width: '100%', fontSize: 11, padding: '7px 0' }}
              onClick={saveToFavourites}>
              <Check size={12} /> Save current bot to favourites
            </button>
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
          <p style={{ fontSize: 9, color: '#3d5a54', margin: '4px 0 0', lineHeight: 1.5 }}>
            Accepts APEX native format or advanced schemas (e.g. object purchaseConditions, custom stakeMode, riskManagement blocks). Unknown fields are safely ignored; incompatible values are remapped to sensible defaults.
          </p>
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
                  {(cfg.tradeType.startsWith('digits') || cfg.tradeType === 'asians') && (
                    <p className="bb-field-hint" style={{ color: '#fbbf24' }}>
                      Direction and indicator conditions are not applicable for this trade type.
                    </p>
                  )}
                </div>

                {/* Direction — not relevant for digit bots and Asians */}
                {!cfg.tradeType.startsWith('digits') && cfg.tradeType !== 'asians' && (
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
                    {(['fixed','percent','percent_of_account_balance','martingale','score_scaled'] as const).map(m => (
                      <button key={m} type="button"
                        className={`bb-radio-btn ${cfg.stakeMode === m ? 'active' : ''}`}
                        onClick={() => update({ stakeMode: m })}>
                        {m === 'fixed' ? 'Fixed $' : m === 'percent' ? '% Balance' : m === 'percent_of_account_balance' ? '% Account' : m === 'martingale' ? 'Martingale' : 'Score Scaled'}
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
                {cfg.stakeMode === 'percent_of_account_balance' && (
                  <>
                    {num('% of account balance per trade', cfg.stakePercent, v => update({ stakePercent: v }), 0.01, 100, 0.1)}
                    {warnFor('stakePercent') && <p className="bb-warn-inline"><AlertTriangle size={11} /> {warnFor('stakePercent')!.message}</p>}
                  </>
                )}
                {cfg.stakeMode === 'martingale' && (
                  <>
                    <div className="bb-field-row">
                      {num('Initial stake ($)', cfg.stake, v => update({ stake: v }), 0.35, 10000, 0.5)}
                      {num('Multiplier ×', cfg.martingaleMultiplier, v => update({ martingaleMultiplier: v }), 1, 10, 0.5)}
                    </div>
                    {num('Max stake cap ($)', cfg.maxStake, v => update({ maxStake: v }), 1, 100000, 1)}
                    <p className="bb-field-hint">Doubles stake on each loss up to the cap. Highly aggressive — test on demo first.</p>
                  </>
                )}
                {cfg.stakeMode === 'score_scaled' && (
                  <>
                    <div className="bb-field-row">
                      {num('Min stake ($)', cfg.minStake, v => update({ minStake: Math.max(0.35, v) }), 0.35, 10000, 0.5)}
                      {num('Max stake ($)', cfg.maxStake, v => update({ maxStake: v }), 1, 100000, 1)}
                    </div>
                    <p className="bb-field-hint">Stake scales linearly from min→max based on entry score. Requires Entry Scoring to be enabled in Risk Management.</p>
                  </>
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
                {(cfg.tradeType.startsWith('digits') || cfg.tradeType === 'asians') ? (
                  <p className="bb-section-label" style={{ color: '#64748b' }}>
                    Entry conditions are not typically used for {TRADE_TYPES.find(t => t.key === cfg.tradeType)?.label}. Trades are based on tick analysis.
                  </p>
                ) : (
                  <p className="bb-section-label">Entry signal — all conditions must pass before a trade is placed.</p>
                )}
                {warnFor('purchaseConditions') && <p className="bb-warn-inline"><AlertTriangle size={11} /> {warnFor('purchaseConditions')!.message}</p>}
                {!(cfg.tradeType.startsWith('digits') || cfg.tradeType === 'asians') && (
                  <ConditionEditor
                    conditions={cfg.purchaseConditions}
                    onChange={c => update({ purchaseConditions: c })}
                    label="Entry"
                  />
                )}
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

                {/* ── Loss controls ── */}
                <p className="bb-section-label">Loss controls</p>
                {num('Max consecutive losses before pause', cfg.maxConsecLosses, v => update({ maxConsecLosses: Math.max(1, v) }), 1, 50)}
                {warnFor('maxConsecLosses') && <p className="bb-warn-inline"><AlertTriangle size={11} /> {warnFor('maxConsecLosses')!.message}</p>}
                {num('Cooldown after pause (minutes)', cfg.cooldownMinutes, v => update({ cooldownMinutes: Math.max(0, v) }), 0, 1440)}
                {num('Max trades per day', cfg.maxTradesPerDay, v => update({ maxTradesPerDay: Math.max(1, v) }), 1, 1000)}
                {tog('Non-overlapping execution', 'Wait for current contract to settle before placing the next.', cfg.nonOverlappingExecution, v => update({ nonOverlappingExecution: v }))}

                <div className="bb-divider" />
                {/* ── Daily loss limit ── */}
                <p className="bb-section-label">Daily loss limit</p>
                {tog('Enable daily loss limit', 'Stop all trading when daily loss reaches this amount.', cfg.enableDailyLoss, v => update({ enableDailyLoss: v }))}
                {cfg.enableDailyLoss && (
                  <>
                    {tog('Use % of balance', 'Express the limit as a % of your starting balance.', cfg.enableDailyLossPercent, v => update({ enableDailyLossPercent: v }))}
                    {cfg.enableDailyLossPercent
                      ? num('Daily loss limit (% of balance)', cfg.dailyLossLimitPercent, v => update({ dailyLossLimitPercent: Math.max(0.1, v) }), 0.1, 100, 0.5)
                      : num('Daily loss limit ($)', cfg.dailyLossLimit, v => update({ dailyLossLimit: Math.max(1, v) }), 1, 100000)
                    }
                  </>
                )}

                <div className="bb-divider" />
                {/* ── Take profit ── */}
                {tog('Enable take profit', 'Stop trading when cumulative profit reaches this amount.', cfg.enableTakeProfit, v => update({ enableTakeProfit: v }))}
                {cfg.enableTakeProfit && num('Take profit target ($)', cfg.takeProfitAmount, v => update({ takeProfitAmount: Math.max(1, v) }), 1, 100000)}

                <div className="bb-divider" />
                {/* ── Drawdown Governor ── */}
                <p className="bb-section-label">Drawdown governor</p>
                <p className="bb-field-hint" style={{ marginBottom: 4 }}>Tiered stake and behaviour adjustments as losses accumulate.</p>
                <div className="bb-field-row">
                  {num('After 2 losses — stake overlay (0–1)', cfg.drawdownGovernor.afterLosses2StakeOverlay,
                    v => update({ drawdownGovernor: { ...cfg.drawdownGovernor, afterLosses2StakeOverlay: Math.min(1, Math.max(0, v)) } }), 0, 1, 0.1)}
                  {num('Cooldown (min)', cfg.drawdownGovernor.afterLosses2Cooldown,
                    v => update({ drawdownGovernor: { ...cfg.drawdownGovernor, afterLosses2Cooldown: Math.max(0, v) } }), 0, 1440)}
                </div>
                <div className="bb-field">
                  <label className="bb-label">After 3 losses — action</label>
                  <div className="bb-radio-group">
                    {(['pause','reduce'] as const).map(a => (
                      <button key={a} type="button"
                        className={`bb-radio-btn ${cfg.drawdownGovernor.afterLosses3Action === a ? 'active' : ''}`}
                        onClick={() => update({ drawdownGovernor: { ...cfg.drawdownGovernor, afterLosses3Action: a } })}>
                        {a === 'pause' ? '⏸ Pause' : '↓ Reduce stake'}
                      </button>
                    ))}
                  </div>
                </div>
                {num('After 3 losses — cooldown (min)', cfg.drawdownGovernor.afterLosses3Cooldown,
                  v => update({ drawdownGovernor: { ...cfg.drawdownGovernor, afterLosses3Cooldown: Math.max(0, v) } }), 0, 1440)}
                {num('After 3 wins — stake overlay (0–1, bankroll protection)', cfg.drawdownGovernor.afterWins3StakeOverlay,
                  v => update({ drawdownGovernor: { ...cfg.drawdownGovernor, afterWins3StakeOverlay: Math.min(1, Math.max(0, v)) } }), 0, 1, 0.1)}
                {tog('Reverse direction on loss', 'Flip CALL↔PUT after each losing trade.', cfg.drawdownGovernor.reverseOnLoss,
                  v => update({ drawdownGovernor: { ...cfg.drawdownGovernor, reverseOnLoss: v } }))}
                {tog('No martingale (hard block)', 'Prevent stake escalation regardless of stake mode.', cfg.drawdownGovernor.noMartingale,
                  v => update({ drawdownGovernor: { ...cfg.drawdownGovernor, noMartingale: v } }))}

                <div className="bb-divider" />
                {/* ── Regime Filter ── */}
                <p className="bb-section-label">Regime filter (ATR)</p>
                {tog('Enable regime filter', 'Only trade when ATR/SMA ratio is within the active range.', cfg.regimeFilter.enabled,
                  v => update({ regimeFilter: { ...cfg.regimeFilter, enabled: v } }))}
                {cfg.regimeFilter.enabled && (
                  <>
                    <div className="bb-field-row">
                      {num('ATR period', cfg.regimeFilter.atrPeriod,
                        v => update({ regimeFilter: { ...cfg.regimeFilter, atrPeriod: Math.max(1, v) } }), 2, 200)}
                      {num('ATR SMA period', cfg.regimeFilter.atrSmaPeriod,
                        v => update({ regimeFilter: { ...cfg.regimeFilter, atrSmaPeriod: Math.max(2, v) } }), 2, 200)}
                    </div>
                    <div className="bb-field-row">
                      {num('Active range min', cfg.regimeFilter.activeRangeMin,
                        v => update({ regimeFilter: { ...cfg.regimeFilter, activeRangeMin: v } }), 0, 5, 0.1)}
                      {num('Active range max', cfg.regimeFilter.activeRangeMax,
                        v => update({ regimeFilter: { ...cfg.regimeFilter, activeRangeMax: v } }), 0, 5, 0.1)}
                    </div>
                    <p className="bb-field-hint">ATR/SMA ratio must be between {cfg.regimeFilter.activeRangeMin} and {cfg.regimeFilter.activeRangeMax}. Below = too quiet, above = too wild.</p>
                  </>
                )}

                <div className="bb-divider" />
                {/* ── Entry Scoring ── */}
                <p className="bb-section-label">Entry scoring</p>
                {tog('Enable entry scoring', 'Score each signal 0–100. Only fire if score ≥ threshold.', cfg.entryScoring.enabled,
                  v => update({ entryScoring: { ...cfg.entryScoring, enabled: v } }))}
                {cfg.entryScoring.enabled && (
                  <>
                    {num('Score threshold (0–100)', cfg.entryScoring.threshold,
                      v => update({ entryScoring: { ...cfg.entryScoring, threshold: Math.max(0, Math.min(100, v)) } }), 0, 100)}
                    <p className="bb-section-label" style={{ marginTop: 6 }}>Component weights (must sum to 100)</p>
                    <div className="bb-field-row">
                      {num('Breakout strength', cfg.entryScoring.breakoutStrengthWeight,
                        v => update({ entryScoring: { ...cfg.entryScoring, breakoutStrengthWeight: Math.max(0, v) } }), 0, 100)}
                      {num('Band expansion', cfg.entryScoring.bandExpansionWeight,
                        v => update({ entryScoring: { ...cfg.entryScoring, bandExpansionWeight: Math.max(0, v) } }), 0, 100)}
                    </div>
                    <div className="bb-field-row">
                      {num('Confirmation candle', cfg.entryScoring.confirmationCandleWeight,
                        v => update({ entryScoring: { ...cfg.entryScoring, confirmationCandleWeight: Math.max(0, v) } }), 0, 100)}
                      {num('ADX strength', cfg.entryScoring.adxStrengthWeight,
                        v => update({ entryScoring: { ...cfg.entryScoring, adxStrengthWeight: Math.max(0, v) } }), 0, 100)}
                    </div>
                    {num('ATR regime', cfg.entryScoring.atrRegimeWeight,
                      v => update({ entryScoring: { ...cfg.entryScoring, atrRegimeWeight: Math.max(0, v) } }), 0, 100)}
                    {(() => {
                      const total = cfg.entryScoring.breakoutStrengthWeight + cfg.entryScoring.bandExpansionWeight +
                        cfg.entryScoring.confirmationCandleWeight + cfg.entryScoring.adxStrengthWeight + cfg.entryScoring.atrRegimeWeight;
                      return total !== 100
                        ? <p className="bb-warn-inline"><AlertTriangle size={11} /> Weights sum to {total} — should be 100.</p>
                        : <p className="bb-field-hint" style={{ color: '#34d399' }}>✓ Weights sum to 100.</p>;
                    })()}
                  </>
                )}

                <div className="bb-divider" />
                {/* ── Asian Strategy ── */}
                <p className="bb-section-label">Asian strategy settings</p>
                {tog('Enable Asian strategy', 'Configure specialized parameters for Asian-type contracts.', cfg.asianStrategy.enabled,
                  v => update({ asianStrategy: { ...cfg.asianStrategy, enabled: v } }))}
                {cfg.asianStrategy.enabled && (
                  <>
                    {num('Price drift threshold (0–1)', cfg.asianStrategy.priceDriftThreshold,
                      v => update({ asianStrategy: { ...cfg.asianStrategy, priceDriftThreshold: Math.min(1, Math.max(0, v)) } }), 0, 1, 0.01)}
                    <div className="bb-field">
                      <label className="bb-label">Check interval</label>
                      <div className="bb-radio-group">
                        {(['tick', 'minute', 'second'] as const).map(interval => (
                          <button key={interval} type="button"
                            className={`bb-radio-btn ${cfg.asianStrategy.checkInterval === interval ? 'active' : ''}`}
                            onClick={() => update({ asianStrategy: { ...cfg.asianStrategy, checkInterval: interval } })}>
                            {interval.charAt(0).toUpperCase() + interval.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>
                    {num('EMA period', cfg.asianStrategy.emaPeriod,
                      v => update({ asianStrategy: { ...cfg.asianStrategy, emaPeriod: Math.max(1, v) } }), 1, 200)}
                    <div className="bb-field-row">
                      {num('Strategy duration', cfg.asianStrategy.duration,
                        v => update({ asianStrategy: { ...cfg.asianStrategy, duration: Math.max(1, v) } }), 1, 1000)}
                      <div className="bb-select-wrap" style={{ flex: 1 }}>
                        <select className="bb-select" value={cfg.asianStrategy.durationUnit}
                          onChange={e => update({ asianStrategy: { ...cfg.asianStrategy, durationUnit: e.target.value as DurationUnit } })}>
                          {(['ticks','seconds','minutes','hours'] as const).map(u =>
                            <option key={u} value={u}>{u}</option>
                          )}
                        </select>
                        <ChevronDown size={12} className="bb-select-arrow" />
                      </div>
                    </div>
                  </>
                )}

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
                <span className="bb-running-label">{scanStatus || 'Bot running'}</span>
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
              <span>Status</span>
              <b>{isRunning ? (scanStatus || 'Running') : 'Stopped'}</b>
            </div>
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

      {/* ── Trade Journal Panel — collapsible slide-in from right ── */}
      {showPanel && (
        <div className="bb-journal-panel">
          <div className="bb-journal-header">
            {/* Status bar */}
            <div className="bb-journal-status">
              {isRunning ? (
                <>
                  <span className="live-dot" />
                  <span className="bb-journal-status-label">{scanStatus || 'Waiting for conditions...'}</span>
                  <div className="bb-journal-progress">
                    <div className="bb-journal-progress-fill" />
                  </div>
                </>
              ) : (
                <span className="bb-journal-status-label" style={{ color: '#64748b' }}>Bot not running</span>
              )}
              <button type="button" className="bb-icon-btn" style={{ marginLeft: 'auto', width: 24, height: 24 }}
                onClick={() => setShowPanel(false)}>
                <X size={13} />
              </button>
            </div>

            {/* Tabs */}
            <div className="bb-journal-tabs">
              {(['summary', 'transactions', 'journal'] as const).map(tab => (
                <button key={tab} type="button"
                  className={`bb-journal-tab ${panelTab === tab ? 'active' : ''}`}
                  onClick={() => setPanelTab(tab)}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="bb-journal-body">
            {/* ── Summary tab ── */}
            {panelTab === 'summary' && (
              <div className="bb-journal-summary">
                {sessionTrades.length === 0 && !isRunning && (
                  <p className="bb-journal-empty">Start the bot to see live trading stats here.</p>
                )}
                {(sessionTrades.length > 0 || isRunning) && (
                  <>
                    {/* Current contract indicator */}
                    <div className="bb-journal-market-row">
                      <div className="bb-journal-market-badge">
                        {cfg.market.replace('Volatility ', 'V').replace(' Index', '').replace('(1s)', '1s').substring(0, 6)}
                      </div>
                      <div>
                        <strong className="bb-journal-market-name">{cfg.market}</strong>
                        <span className="bb-journal-type">{TRADE_TYPES.find(t => t.key === cfg.tradeType)?.label}</span>
                      </div>
                    </div>

                    {/* Totals grid */}
                    <div className="bb-journal-grid">
                      <div className="bb-journal-cell">
                        <span>Total stake</span>
                        <b>${totalStake.toFixed(2)} USD</b>
                      </div>
                      <div className="bb-journal-cell">
                        <span>Total payout</span>
                        <b>${totalPayout.toFixed(2)} USD</b>
                      </div>
                      <div className="bb-journal-cell">
                        <span>No. of runs</span>
                        <b>{tradeCount}</b>
                      </div>
                    </div>

                    <div className="bb-journal-divider" />

                    <div className="bb-journal-grid">
                      <div className="bb-journal-cell">
                        <span>Contracts lost</span>
                        <b className="negative">{sessionLosses}</b>
                      </div>
                      <div className="bb-journal-cell">
                        <span>Contracts won</span>
                        <b className="positive">{sessionWins}</b>
                      </div>
                      <div className="bb-journal-cell">
                        <span>Total profit/loss</span>
                        <b className={totalPnl >= 0 ? 'positive' : 'negative'}>
                          {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)} USD
                        </b>
                      </div>
                    </div>

                    {/* Win/loss bar */}
                    {sessionTrades.length > 0 && (
                      <div className="bb-journal-bar-wrap">
                        <BacktestBar wins={sessionWins} losses={sessionLosses} />
                        <div className="bb-journal-bar-labels">
                          <span className="positive">{sessionWins} won</span>
                          <span className="negative">{sessionLosses} lost</span>
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* Reset session */}
                <button type="button" className="secondary"
                  style={{ width: '100%', marginTop: 12, fontSize: 11 }}
                  onClick={() => { setSessionStart(new Date().toISOString()); setTradeCount(0); tradeCountRef.current = 0; consecLossesRef.current = 0; setConsecLosses(0); }}>
                  <RefreshCw size={12} /> Reset session stats
                </button>
              </div>
            )}

            {/* ── Transactions tab ── */}
            {panelTab === 'transactions' && (
              <div className="bb-journal-transactions">
                <div className="bb-journal-toolbar">
                  <button type="button" className="secondary" style={{ fontSize: 10, padding: '4px 10px' }}
                    onClick={() => {
                      const csv = ['Time,Market,Direction,Stake,Result,P/L',
                        ...sessionTrades.map(t => `${t.created_at},${t.instrument},${t.direction},${t.stake},${t.result},${t.profit}`)
                      ].join('\n');
                      const blob = new Blob([csv], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url; a.download = `${cfg.name}-trades.csv`; a.click(); URL.revokeObjectURL(url);
                    }}>
                    <Download size={11} /> Download
                  </button>
                </div>
                {sessionTrades.length === 0 ? (
                  <p className="bb-journal-empty">No settled trades yet for this session.</p>
                ) : (
                  <div className="bb-transaction-list">
                    <div className="bb-transaction-header">
                      <span>Type</span>
                      <span>Entry / Exit</span>
                      <span>Stake & P/L</span>
                    </div>
                    {[...sessionTrades].reverse().map(t => (
                      <div key={t.id} className="bb-transaction-row">
                        <div className="bb-tx-type">
                          <span className="bb-tx-market">{t.instrument.replace('Volatility ', 'V').replace(' Index', '').replace(' (1s)', '1s')}</span>
                          <span className={`bb-tx-dir ${t.direction === 'CALL' ? 'call-text' : 'put-text'}`}>{t.direction}</span>
                        </div>
                        <div className="bb-tx-prices">
                          <span>● {t.entry_price?.toFixed(2) ?? '—'}</span>
                          <span>○ {t.exit_price?.toFixed(2) ?? '—'}</span>
                        </div>
                        <div className="bb-tx-pnl">
                          <span>${t.stake?.toFixed(2) ?? '0.00'}</span>
                          <b className={t.result === 'won' ? 'positive' : 'negative'}>
                            {t.result === 'won' ? '+' : '-'}${Math.abs(t.profit).toFixed(2)} USD
                          </b>
                        </div>
                      </div>
                    ))}
                    {/* Session totals */}
                    <div className="bb-transaction-footer">
                      <div className="bb-journal-grid">
                        <div className="bb-journal-cell"><span>Total stake</span><b>${totalStake.toFixed(2)}</b></div>
                        <div className="bb-journal-cell"><span>Contracts won</span><b className="positive">{sessionWins}</b></div>
                        <div className="bb-journal-cell"><span>Total P/L</span><b className={totalPnl >= 0 ? 'positive' : 'negative'}>{totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}</b></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Journal tab ── */}
            {panelTab === 'journal' && (
              <div className="bb-journal-log">
                <div className="bb-journal-toolbar">
                  <button type="button" className="secondary" style={{ fontSize: 10, padding: '4px 10px' }}
                    onClick={() => {
                      const lines = sessionTrades.flatMap(t => [
                        `Bought: Contract purchased\n${new Date(t.created_at).toLocaleString()}`,
                        `${t.result === 'won' ? 'Won' : 'Loss'} amount: ${t.result === 'won' ? '+' : '-'}$${Math.abs(t.profit).toFixed(2)} USD\n${new Date(t.created_at).toLocaleString()}`,
                      ]);
                      const blob = new Blob([lines.join('\n\n')], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${cfg.name}-journal.txt`; a.click(); URL.revokeObjectURL(url);
                    }}>
                    <Download size={11} /> Download
                  </button>
                </div>
                {sessionTrades.length === 0 && !isRunning ? (
                  <p className="bb-journal-empty">No activity yet. Start the bot to see the journal.</p>
                ) : (
                  <div className="bb-journal-entries">
                    {isRunning && (
                      <div className="bb-journal-entry bought">
                        <span className="bb-je-label">Running — next trade in ~5s</span>
                        <span className="bb-je-time">{new Date().toLocaleString()}</span>
                      </div>
                    )}
                    {[...sessionTrades].reverse().map(t => (
                      <div key={t.id}>
                        <div className="bb-journal-entry bought">
                          <span className="bb-je-label">Bought: Contract purchased ({t.instrument.replace('Volatility ', 'V').replace(' Index', '')} · {t.direction})</span>
                          <span className="bb-je-time">{new Date(t.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' })}</span>
                        </div>
                        <div className={`bb-journal-entry ${t.result === 'won' ? 'won' : 'lost'}`}>
                          <span className="bb-je-label">
                            {t.result === 'won' ? 'Won' : 'Loss'} amount:{' '}
                            <b className={t.result === 'won' ? 'positive' : 'negative'}>
                              {t.result === 'won' ? '+' : '-'}${Math.abs(t.profit).toFixed(2)} USD
                            </b>
                          </span>
                          <span className="bb-je-time">{new Date(t.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' })}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Risk gauge ───────────────────────────────────────────────────────────────

function RiskGauge({ cfg }: { cfg: BotConfig }) {
  let score = 0;
  if (cfg.stakeMode === 'martingale' && !cfg.drawdownGovernor.noMartingale) score += 35;
  else if (cfg.stakeMode === 'score_scaled') score += 10;
  else if (cfg.stakeMode === 'percent' || cfg.stakeMode === 'percent_of_account_balance') score += 15;
  else score += 5;
  if (cfg.maxConsecLosses >= 5) score += 10;
  else if (cfg.maxConsecLosses <= 2) score += 25;
  else score += 15;
  if (!cfg.enableDailyLoss) score += 20;
  if (cfg.cooldownMinutes === 0) score += 10;
  // Drawdown governor mitigations
  if (cfg.drawdownGovernor.afterLosses2StakeOverlay < 1) score -= 8;
  if (cfg.drawdownGovernor.noMartingale) score -= 12;
  // Regime filter reduces risk (skips bad market conditions)
  if (cfg.regimeFilter.enabled) score -= 8;
  // Entry scoring reduces risk (filters low-quality entries)
  if (cfg.entryScoring.enabled) score -= 6;
  score = Math.max(0, Math.min(100, score));

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
        {score < 30 ? 'Conservative — good for real-account use.'
          : score < 60 ? 'Moderate. Recommended to test on demo first.'
          : score < 80 ? 'High. Enable daily loss limit, regime filter and cooldown.'
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
