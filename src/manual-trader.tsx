import { useState, useEffect, useMemo, useRef } from 'react';
import { subscribeTicks, symbolMap, getTicksHistory, getActiveSymbols, getProposal, type DerivTick, type DerivSymbol } from './deriv-client';
import { DerivInstruments } from './deriv-instruments';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Hash,
  HelpCircle,
  Layers,
  LineChart as LineChartIcon,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
  Zap,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  Minus as MinusIcon,
  Plus as PlusIcon,
  X as XIcon,
  Check,
  Grid3x3,
  Infinity,
} from 'lucide-react';

export interface ManualTraderProps {
  tick: number;
  runTrade: (details: { instrument: string; direction: string; stake: number; source: string; barrier?: number; growth_rate?: number; duration?: number }) => Promise<{ contractId?: number; derivPayout?: number }>;
  derivConnected: boolean;
  isDerivReal: boolean;
  liveArmed?: boolean;
  derivAccount: { loginid: string; balance: number; is_virtual: boolean; currency?: string } | null;
  workspaceBalance: number;
  onSwitchAccount?: (loginid: string) => void;
  linkedRealAccount?: { loginid: string; balance: number; currency: string };
  linkedDemoAccount?: { loginid: string; balance: number; currency: string };
  onGoToSettings?: () => void;
  onBack?: () => void;
  trades?: Array<{ id: string; result: string; profit: number; created_at: string; source?: string }>;
}

interface TickPoint {
  index: number;
  quote: number;
  time: string;
  changePct: number;
}

interface ActiveContract {
  id: string;
  tradeId?: string; // Deriv trade ID for matching with trades array
  derivContractId?: number; // Actual Deriv contract ID for real-time updates
  direction: 'CALL' | 'PUT';
  contractType?: string;
  digitBarrier?: number;
  entryQuote: number;
  entryTickIndex: number;
  currentTickCount: number;
  totalTicks: number;
  stake: number;
  payout: number;
  derivPayout?: number; // Accurate payout from Deriv API
  ticks: Array<{ quote: number; tickIndex: number }>;
  status: 'running' | 'won' | 'lost';
}

const INSTRUMENT_CONFIGS: Record<string, { badge: string; basePrice: number; volatility: number }> = {
  'Volatility 100 Index':      { badge: '100',  basePrice: 720.0,  volatility: 0.75 },
  'Volatility 75 Index':       { badge: '75',   basePrice: 520.0,  volatility: 0.65 },
  'Volatility 50 Index':       { badge: '50',   basePrice: 340.0,  volatility: 0.5  },
  'Volatility 25 Index':       { badge: '25',   basePrice: 225.0,  volatility: 0.35 },
  'Volatility 10 Index':       { badge: '10',   basePrice: 110.0,  volatility: 0.2  },
  'Volatility 100 (1s) Index': { badge: '100s', basePrice: 720.0,  volatility: 0.75 },
  'Volatility 75 (1s) Index':  { badge: '75s',  basePrice: 520.0,  volatility: 0.65 },
  'Volatility 50 (1s) Index':  { badge: '50s',  basePrice: 340.0,  volatility: 0.5  },
  'Volatility 25 (1s) Index':  { badge: '25s',  basePrice: 225.0,  volatility: 0.35 },
  'Volatility 10 (1s) Index':  { badge: '10s',  basePrice: 110.0,  volatility: 0.2  },
};

// ─── Trade type definitions ────────────────────────────────────────────────────
export type TradeCategory = 'directional' | 'growth' | 'digits';

// Digits subtypes
export type DigitSubtype = 'over_under' | 'match_diff' | 'even_odd';

// Directional subtypes
export type DirectionalType = 'rise_fall' | 'higher_lower' | 'touch_no_touch' | 'in_out' | 'asians' | 'reset' | 'ticks_hl' | 'runs';
export const DIRECTIONAL_TYPES: { key: DirectionalType; label: string; desc: string }[] = [
  { key: 'rise_fall',      label: 'Rise/Fall',          desc: 'Win if exit price is higher/lower than entry' },
  { key: 'higher_lower',   label: 'Higher/Lower',       desc: 'Win if price is higher/lower than a set barrier' },
  { key: 'touch_no_touch', label: 'Touch/No Touch',     desc: 'Win if price touches or never touches a barrier' },
  { key: 'in_out',         label: 'In/Out',             desc: 'Win if price ends or stays between two barriers' },
  { key: 'asians',         label: 'Asians',             desc: 'Win if average price is higher/lower than close' },
  { key: 'reset',          label: 'Reset Call/Put',     desc: 'Entry price resets during the contract' },
  { key: 'ticks_hl',       label: 'High/Low Ticks',     desc: 'Predict the highest or lowest tick' },
  { key: 'runs',           label: 'Only Ups/Downs',     desc: 'Win if every tick moves in the same direction' },
];

// Growth subtypes
export type GrowthType = 'accumulator' | 'multiplier';
export const GROWTH_TYPES: { key: GrowthType; label: string; desc: string }[] = [
  { key: 'accumulator', label: 'Accumulators', desc: 'Stake grows each tick if price stays within range' },
  { key: 'multiplier',  label: 'Multipliers',  desc: 'Multiply profit/loss with leverage, stop loss/take profit' },
];

export const TRADE_CATEGORIES: { key: TradeCategory; label: string; icon: string }[] = [
  { key: 'directional', label: 'Directional', icon: '📈' },
  { key: 'growth',      label: 'Growth',      icon: '🌱' },
  { key: 'digits',      label: 'Digits',      icon: '🔢' },
];

export type DigitContractType = 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';

export const DIGIT_TYPES: { type: DigitContractType; label: string; needsBarrier: boolean; color: string }[] = [
  { type: 'DIGITEVEN',  label: 'Even',    needsBarrier: false, color: '#2dd4bf' },
  { type: 'DIGITODD',   label: 'Odd',     needsBarrier: false, color: '#f87171' },
  { type: 'DIGITOVER',  label: 'Over',    needsBarrier: true,  color: '#f97316' },
  { type: 'DIGITUNDER', label: 'Under',   needsBarrier: true,  color: '#3b82f6' },
  { type: 'DIGITMATCH', label: 'Matches', needsBarrier: true,  color: '#a78bfa' },
  { type: 'DIGITDIFF',  label: 'Differs', needsBarrier: true,  color: '#fbbf24' },
];

export function getQuoteLastDigit(quote: number): number {
  const s = quote.toFixed(2);
  const d = parseInt(s.charAt(s.length - 1), 10);
  return isNaN(d) ? 0 : d;
}

export function evaluateContractResult(contract: ActiveContract, finalQuote: number, allowEq: boolean): boolean {
  const finalLastDigit = getQuoteLastDigit(finalQuote);
  const type = contract.contractType || contract.direction;
  const b = contract.digitBarrier ?? 5;

  switch (type) {
    case 'DIGITOVER':
      return finalLastDigit > b;
    case 'DIGITUNDER':
      return finalLastDigit < b;
    case 'DIGITMATCH':
      return finalLastDigit === b;
    case 'DIGITDIFF':
      return finalLastDigit !== b;
    case 'DIGITEVEN':
      return finalLastDigit % 2 === 0;
    case 'DIGITODD':
      return finalLastDigit % 2 === 1;
    case 'CALL':
    case 'RISE':
      return allowEq ? finalQuote >= contract.entryQuote : finalQuote > contract.entryQuote;
    case 'PUT':
    case 'FALL':
      return allowEq ? finalQuote <= contract.entryQuote : finalQuote < contract.entryQuote;
    case 'HIGHER':
      return finalQuote > contract.entryQuote;
    case 'LOWER':
      return finalQuote < contract.entryQuote;
    case 'ACCU':
      return true;
    case 'MULTUP':
      return finalQuote > contract.entryQuote;
    case 'MULTDOWN':
      return finalQuote < contract.entryQuote;
    default:
      return finalQuote > contract.entryQuote;
  }
}

const INSTRUMENT_LIST = Object.keys(INSTRUMENT_CONFIGS);

function formatCurrency(val: number): string {
  return `${val < 0 ? '-' : ''}$${Math.abs(val).toFixed(2)}`;
}

export function ManualTrader({
  tick,
  runTrade,
  derivConnected,
  isDerivReal,
  liveArmed,
  derivAccount,
  workspaceBalance,
  onSwitchAccount,
  linkedRealAccount,
  linkedDemoAccount,
  onGoToSettings,
  onBack,
  trades = [],
}: ManualTraderProps) {
  const [selectedInstrument, setSelectedInstrument] = useState<string>('Volatility 100 (1s) Index');
  const [selectedSymbolCode, setSelectedSymbolCode] = useState<string | null>('R_100');
  const [direction, setDirection] = useState<'CALL' | 'PUT'>('CALL');
  const [stake, setStake] = useState<number>(2);
  const [durationTicks, setDurationTicks] = useState<number>(5);
  const [allowEquals, setAllowEquals] = useState<boolean>(false);

  // Trade type state
  const [tradeCategory, setTradeCategory] = useState<TradeCategory>('digits');
  const [digitSubtype, setDigitSubtype] = useState<DigitSubtype>('over_under');
  const [directionalType, setDirectionalType] = useState<DirectionalType>('rise_fall');
  const [growthType, setGrowthType] = useState<GrowthType>('accumulator');
  const [digitType, setDigitType] = useState<DigitContractType>('DIGITOVER');
  const [digitBarrier, setDigitBarrier] = useState<number>(5);
  const [growthRate, setGrowthRate] = useState<number>(0.01);
  const [multiplier, setMultiplier] = useState<number>(10);
  const [stopLoss, setStopLoss] = useState<number>(10);
  const [takeProfit, setTakeProfit] = useState<number>(10);
  const [barrier, setBarrier] = useState<string>('1234.56');
  const [showHowToModal, setShowHowToModal] = useState<boolean>(false);
  const [showInstrumentDropdown, setShowInstrumentDropdown] = useState<boolean>(false);
  const [showTradeTypeDropdown, setShowTradeTypeDropdown] = useState<boolean>(false);
  const [activeParamPopover, setActiveParamPopover] = useState<'duration' | 'stake' | 'barrier' | null>(null);
  const [showPositionsPanel, setShowPositionsPanel] = useState<boolean>(false);
  const [chartType, setChartType] = useState<'area' | 'line'>('area');
  const [chartViewOverride, setChartViewOverride] = useState<'auto' | 'chart' | 'digits'>('auto');
  const [zoomLevel, setZoomLevel] = useState<number>(35);
  const [showZoomPill, setShowZoomPill] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [accuratePayouts, setAccuratePayouts] = useState<Record<string, number>>({});
  const [showContractCard, setShowContractCard] = useState<boolean>(true);
  const contractCardTimerRef = useRef<number | null>(null);

  const tradeTypePickerRef = useRef<HTMLDivElement>(null);
  const paramsRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showTradeTypeDropdown) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (tradeTypePickerRef.current && !tradeTypePickerRef.current.contains(e.target as Node)) {
        setShowTradeTypeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showTradeTypeDropdown]);

  useEffect(() => {
    if (!activeParamPopover) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (paramsRowRef.current && !paramsRowRef.current.contains(e.target as Node)) {
        setActiveParamPopover(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [activeParamPopover]);

  // Historical panning & gesture state
  const [scrollOffset, setScrollOffset] = useState<number>(0);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartXRef = useRef<number>(0);
  const dragStartOffsetRef = useRef<number>(0);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  // Gesture and zoom refs for pinch-to-zoom & double tap
  const touchStartDistRef = useRef<number | null>(null);
  const startZoomRef = useRef<number>(35);
  const lastTapTimeRef = useRef<number>(0);
  const zoomFeedbackTimeoutRef = useRef<number | null>(null);

  const triggerZoomPill = () => {
    setShowZoomPill(true);
    if (zoomFeedbackTimeoutRef.current) {
      window.clearTimeout(zoomFeedbackTimeoutRef.current);
    }
    zoomFeedbackTimeoutRef.current = window.setTimeout(() => {
      setShowZoomPill(false);
    }, 1600);
  };

  const updateZoomLevel = (val: number | ((prev: number) => number)) => {
    setZoomLevel((prev) => {
      const next = typeof val === 'function' ? val(prev) : val;
      return Math.min(90, Math.max(15, next));
    });
    triggerZoomPill();
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
      startZoomRef.current = zoomLevel;
      triggerZoomPill();
    } else if (e.touches.length === 1) {
      touchStartXRef.current = e.touches[0].clientX;
      touchStartYRef.current = e.touches[0].clientY;
      dragStartOffsetRef.current = scrollOffset;
      const now = Date.now();
      if (now - lastTapTimeRef.current < 320) {
        // Double tap on chart resets to live and standard 35 ticks
        setScrollOffset(0);
        updateZoomLevel(35);
      }
      lastTapTimeRef.current = now;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / touchStartDistRef.current;
      const target = Math.round(startZoomRef.current / ratio);
      setZoomLevel(Math.min(90, Math.max(15, target)));
      triggerZoomPill();
    } else if (e.touches.length === 1 && touchStartXRef.current !== null) {
      const deltaX = e.touches[0].clientX - touchStartXRef.current;
      const deltaY = e.touches[0].clientY - (touchStartYRef.current || 0);
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 6) {
        const tickDelta = Math.round(deltaX / 7);
        const maxOffset = Math.max(0, tickHistory.length - zoomLevel);
        const newOffset = Math.max(0, Math.min(maxOffset, dragStartOffsetRef.current + tickDelta));
        setScrollOffset(newOffset);
      }
    }
  };

  const handleTouchEnd = () => {
    touchStartDistRef.current = null;
    touchStartXRef.current = null;
    touchStartYRef.current = null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Only left-click initiates pan
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStartXRef.current = e.clientX;
    dragStartOffsetRef.current = scrollOffset;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    const deltaX = e.clientX - dragStartXRef.current;
    const tickDelta = Math.round(deltaX / 7);
    const maxOffset = Math.max(0, tickHistory.length - zoomLevel);
    const newOffset = Math.max(0, Math.min(maxOffset, dragStartOffsetRef.current + tickDelta));
    setScrollOffset(newOffset);
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
    setIsDragging(false);
  };

  const handleWheelZoom = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) > 4) {
      e.preventDefault();
      updateZoomLevel((prev) => prev + (e.deltaY > 0 ? 4 : -4));
    }
  };

  // Active in-chart contract visualization
  const [activeContract, setActiveContract] = useState<ActiveContract | null>(null);
  const [positionHistory, setPositionHistory] = useState<ActiveContract[]>([]);
  const [positionsTab, setPositionsTab] = useState<'open' | 'closed'>('open');

  // Tick series generation
  const [tickHistory, setTickHistory] = useState<TickPoint[]>([]);
  const config = INSTRUMENT_CONFIGS[selectedInstrument]
    || INSTRUMENT_CONFIGS['Volatility 100 (1s) Index']
    || { badge: '100', basePrice: 720.0, volatility: 0.75 };
  const tickHistoryRef = useRef<TickPoint[]>([]);
  const realTickUnsubRef = useRef<(() => void) | null>(null);
  const [showInstrumentPanel, setShowInstrumentPanel] = useState(false);
  const [instrumentTimeframe, setInstrumentTimeframe] = useState<'1m' | '5m' | '15m' | '1h'>('5m');

  // ── When Deriv connects, validate/resolve the instrument symbol ────────────
  // active_symbols gives us exactly what's available for this account.
  // When Deriv connects, validate the current symbol is actually available.
  // Uses the correct field names from the Options API response.
  useEffect(() => {
    if (!derivConnected) return;
    let cancelled = false;
    getActiveSymbols().then(syms => {
      if (cancelled) return;
      // Options API returns underlying_symbol, standard WS returns symbol
      const available = new Set(syms.map(s => (s as any).underlying_symbol ?? s.symbol).filter(Boolean) as string[]);
      const currentCode = selectedSymbolCode ?? (symbolMap[selectedInstrument] as string);
      if (currentCode && available.has(currentCode)) return; // already valid — do nothing
      // Current symbol not available — pick best alternative
      const preferred = ['R_100', 'R_75', 'R_50', 'R_25', 'R_10',
                         '1HZ100V', '1HZ75V', '1HZ50V', '1HZ25V', '1HZ10V'];
      const fallback = preferred.find(s => available.has(s));
      if (fallback) {
        const match = syms.find(s => ((s as any).underlying_symbol ?? s.symbol) === fallback);
        const displayName = (match as any)?.underlying_symbol_name ?? match?.display_name ?? fallback;
        setSelectedSymbolCode(fallback);
        setSelectedInstrument(displayName);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivConnected]);

  // ── Tick feed: real when Deriv connected, synthetic fallback ─────────────
  useEffect(() => {
    // Clean up previous real subscription
    if (realTickUnsubRef.current) { realTickUnsubRef.current(); realTickUnsubRef.current = null; }

    const derivSymbol = (selectedSymbolCode ?? symbolMap[selectedInstrument]) as string | undefined;

    if (derivConnected && derivSymbol) {
      // Immediately clear stale tick history so the chart doesn't show old/fake prices
      tickHistoryRef.current = [];
      setTickHistory([]);
      setScrollOffset(0);
      setActiveContract(null);

      if (import.meta.env.DEV) {
        console.log(`[ManualTrader] Subscribing to ${derivSymbol} (${selectedInstrument})`);
      }

      // Seed with real tick history first
      let cancelled = false;
      getTicksHistory(derivSymbol, 300).then(hist => {
        if (cancelled) return;
        if (!hist.prices.length) return;
        const ticks: TickPoint[] = hist.prices.map((q, i) => ({
          index: i,
          quote: q,
          time: new Date(hist.times[i] * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
          changePct: hist.prices[0] ? Number((((q - hist.prices[0]) / hist.prices[0]) * 100).toFixed(2)) : 0,
        }));
        tickHistoryRef.current = ticks;
        setTickHistory(ticks);
      }).catch((err) => {
        // History unavailable — live ticks will build the chart from scratch
        if (import.meta.env.DEV) console.warn(`[ManualTrader] getTicksHistory failed for ${derivSymbol}:`, err);
      });

      // Subscribe to live ticks
      const unsub = subscribeTicks(derivSymbol as any, (t: DerivTick) => {
        const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        const prev = tickHistoryRef.current;
        const baseQ = prev[0]?.quote ?? t.quote;
        const nextTick: TickPoint = {
          index: (prev[prev.length - 1]?.index ?? -1) + 1,
          quote: t.quote,
          time: nowStr,
          changePct: Number((((t.quote - baseQ) / baseQ) * 100).toFixed(2)),
        };
        const next = [...prev.slice(-400), nextTick];
        tickHistoryRef.current = next;
        setTickHistory(next);

        // Advance active contract
        setActiveContract(prevAc => {
          if (!prevAc || prevAc.status !== 'running') return prevAc;

          // If this is a real Deriv contract, don't evaluate locally - wait for Deriv results
          if (prevAc.derivContractId) {
            const nextTicks = [...prevAc.ticks, { quote: t.quote, tickIndex: nextTick.index }];
            // Just update ticks, don't settle - let Deriv handle the result
            return { ...prevAc, currentTickCount: nextTicks.length, ticks: nextTicks };
          }

          // Synthetic mode - evaluate locally
          const nextTicks = [...prevAc.ticks, { quote: t.quote, tickIndex: nextTick.index }];
          if (nextTicks.length >= prevAc.totalTicks) {
            const won = evaluateContractResult(prevAc, t.quote, allowEquals);
            const updatedContract = { ...prevAc, currentTickCount: prevAc.totalTicks, ticks: nextTicks, status: won ? 'won' : 'lost' };
            // Update position history when contract completes
            setPositionHistory(prev => prev.map(c => c.id === prevAc.id ? updatedContract : c));
            return updatedContract;
          }
          return { ...prevAc, currentTickCount: nextTicks.length, ticks: nextTicks };
        });
      });
      realTickUnsubRef.current = unsub;
      return () => { cancelled = true; unsub(); realTickUnsubRef.current = null; };
    } else {
      // Synthetic fallback — generate realistic history from config
      const initialTicks: TickPoint[] = [];
      let currentQuote = config.basePrice;
      const now = Date.now();
      for (let i = 220; i >= 0; i--) {
        const delta = (Math.sin(i / 3) * 0.4 + (Math.random() - 0.48) * 0.8) * config.volatility;
        currentQuote = Number((currentQuote + delta).toFixed(2));
        const timeStr = new Date(now - i * 1500).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
        const changePct = Number((((currentQuote - config.basePrice) / config.basePrice) * 100).toFixed(2));
        initialTicks.push({ index: 220 - i, quote: currentQuote, time: timeStr, changePct });
      }
      tickHistoryRef.current = initialTicks;
      setTickHistory(initialTicks);
      setScrollOffset(0);
      setActiveContract(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstrument, selectedSymbolCode, derivConnected]);

  // Monitor trades array to update manual trader contracts when Deriv settles them
  useEffect(() => {
    if (!derivConnected) return;

    // Find recent manual trades that have settled
    const recentManualTrades = trades.filter(t =>
      t.source === 'manual' &&
      (t.result === 'won' || t.result === 'lost') &&
      new Date(t.created_at).getTime() > Date.now() - 60000 // Last 60 seconds
    );

    recentManualTrades.forEach(trade => {
      // Try to match with active contract by creation time
      const tradeTime = new Date(trade.created_at).getTime();
      setActiveContract(prevAc => {
        if (!prevAc || prevAc.status !== 'running') return prevAc;

        // If this contract was created around the same time as the trade
        const contractTime = parseInt(prevAc.id);
        if (Math.abs(contractTime - tradeTime) < 5000) { // Within 5 seconds
          console.log('[ManualTrader] Updating contract from Deriv result:', { contractId: prevAc.id, tradeResult: trade.result, profit: trade.profit });
          const updatedContract = {
            ...prevAc,
            status: trade.result as 'won' | 'lost',
            payout: Math.abs(trade.profit), // Use actual Deriv profit (absolute value for display)
            derivPayout: trade.profit,
          };
          // Update position history
          setPositionHistory(prev => prev.map(c => c.id === prevAc.id ? updatedContract : c));
          return updatedContract;
        }
        return prevAc;
      });
    });
  }, [trades, derivConnected]);

  // Synthetic tick feed — only runs when NOT connected to Deriv
  useEffect(() => {
    if (derivConnected) return; // real ticks handle updates when connected
    if (tickHistory.length === 0) return;

    setTickHistory((prev) => {
      const last = prev[prev.length - 1];
      const delta = (Math.sin(tick / 2.8) * 0.45 + (Math.random() - 0.47) * 0.85) * config.volatility;
      const nextQuote = Number(Math.max(1, last.quote + delta).toFixed(2));
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const changePct = Number((((nextQuote - config.basePrice) / config.basePrice) * 100).toFixed(2));

      const nextTick: TickPoint = {
        index: last.index + 1,
        quote: nextQuote,
        time: nowStr,
        changePct,
      };

      // Retain a generous buffer of 400 ticks for deep historical scrolling
      const updated = [...prev.slice(-400), nextTick];

      // Advance active contract ticks if a contract is running
      if (activeContract && activeContract.status === 'running') {
        // If this is a real Deriv contract, don't evaluate locally - wait for Deriv results
        if (activeContract.derivContractId) {
          const nextContractTicks = [...activeContract.ticks, { quote: nextQuote, tickIndex: nextTick.index }];
          setActiveContract({
            ...activeContract,
            currentTickCount: nextContractTicks.length,
            ticks: nextContractTicks,
          });
          return updated;
        }

        // Synthetic mode - evaluate locally
        const nextContractTicks = [...activeContract.ticks, { quote: nextQuote, tickIndex: nextTick.index }];
        const count = nextContractTicks.length;

        if (count >= activeContract.totalTicks) {
          // Settle contract
          const won = evaluateContractResult(activeContract, nextQuote, allowEquals);
          const updatedContract = {
            ...activeContract,
            currentTickCount: activeContract.totalTicks,
            ticks: nextContractTicks,
            status: won ? 'won' : 'lost',
          };
          setActiveContract(updatedContract);
          // Update position history when contract completes
          setPositionHistory(prev => prev.map(c => c.id === activeContract.id ? updatedContract : c));
        } else {
          setActiveContract({
            ...activeContract,
            currentTickCount: count,
            ticks: nextContractTicks,
          });
        }
      }

      return updated;
    });

    // If currently inspecting the past, increment scrollOffset by 1 so the historical window stays anchored
    setScrollOffset((prevOffset) => (prevOffset > 0 ? prevOffset + 1 : 0));
  }, [tick]);

  // Current live quote
  const currentTick = tickHistory[tickHistory.length - 1] ?? null;
  const isChartLoading = derivConnected && tickHistory.length === 0;
  // Safe quote reference — null when loading, used in JSX via optional chaining
  const liveQuote = currentTick?.quote ?? null;

  // Slice visible ticks based on zoom level and scrollOffset
  const visibleTicks = useMemo(() => {
    if (tickHistory.length === 0) return [];
    const endIndex = Math.max(zoomLevel, tickHistory.length - scrollOffset);
    const startIndex = Math.max(0, endIndex - zoomLevel);
    return tickHistory.slice(startIndex, endIndex);
  }, [tickHistory, zoomLevel, scrollOffset]);

  // Chart coordinate calculation
  const chartMath = useMemo(() => {
    if (visibleTicks.length < 2) {
      return { pathStr: '', fillStr: '', minQ: 0, maxQ: 1, range: 1, points: [], yLabels: [], currentY: 32 };
    }

    const quotes = visibleTicks.map((t) => t.quote);
    let minQ = Math.min(...quotes);
    let maxQ = Math.max(...quotes);
    const padding = (maxQ - minQ) * 0.15 || 0.5;
    minQ = Number((minQ - padding).toFixed(2));
    maxQ = Number((maxQ + padding).toFixed(2));
    const range = maxQ - minQ || 1;

    // SVG coordinate space: 0 0 100 65
    // Map the last tick to x = 96, leaving just 4 units of right padding —
    // enough for the glowing dot to breathe without a large empty gap.
    const points = visibleTicks.map((t, idx) => {
      const x = (idx / (visibleTicks.length - 1)) * 96;
      const y = 60 - ((t.quote - minQ) / range) * 54;
      return { x, y, quote: t.quote, index: t.index, time: t.time };
    });

    // Generate smooth financial bezier curve
    const buildSmoothPath = (pts: { x: number; y: number }[]) => {
      if (pts.length < 2) return '';
      let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];

        const cp1x = p1.x + (p2.x - p0.x) * 0.16;
        const cp1y = p1.y + (p2.y - p0.y) * 0.16;
        const cp2x = p2.x - (p3.x - p1.x) * 0.16;
        const cp2y = p2.y - (p3.y - p1.y) * 0.16;

        d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
      }
      return d;
    };

    const pathStr = buildSmoothPath(points);
    const lastP = points[points.length - 1];
    const firstP = points[0];
    const fillStr = `${pathStr} L ${lastP.x.toFixed(2)} 65 L ${firstP.x.toFixed(2)} 65 Z`;

    const currentX = lastP ? lastP.x : 96;
    const currentY = lastP ? lastP.y : 32;

    // Generate 5 evenly spaced right-axis price labels
    const yLabels = [0, 0.25, 0.5, 0.75, 1].map((pct) => {
      const price = minQ + range * pct;
      const yPos = 60 - pct * 54;
      return { price: price.toFixed(2), yPos };
    });

    return { pathStr, fillStr, minQ, maxQ, range, points, yLabels, currentX, currentY };
  }, [visibleTicks]);

  // Contract overlay coordinates with smooth path
  const contractOverlay = useMemo(() => {
    if (!activeContract || !chartMath.points) return null;
    const contractPointIndices = new Set(activeContract.ticks.map((t) => t.tickIndex));
    const matchedPoints = chartMath.points.filter((p) => contractPointIndices.has(p.index));

    if (matchedPoints.length === 0) return null;

    let overlayPath = '';
    if (matchedPoints.length === 1) {
      overlayPath = `M ${matchedPoints[0].x.toFixed(2)} ${matchedPoints[0].y.toFixed(2)}`;
    } else {
      overlayPath = matchedPoints.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    }
    const entryPt = matchedPoints[0];
    const latestContractPt = matchedPoints[matchedPoints.length - 1];

    return {
      points: matchedPoints,
      path: overlayPath,
      entryPt,
      latestPt: latestContractPt,
    };
  }, [activeContract, chartMath]);

  const payoutRate = allowEquals ? 1.74 : 1.95;
  const potentialPayout = Number((stake * payoutRate).toFixed(2));

  // Over/Under payouts matching Deriv DTrader (use accurate data when available)
  const payoutOver = useMemo(() => {
    if (accuratePayouts['DIGITOVER']) return accuratePayouts['DIGITOVER'];
    const winningDigits = Math.max(1, 9 - digitBarrier);
    const winProb = winningDigits / 10;
    return Number(((stake * 0.8888) / winProb).toFixed(2));
  }, [stake, digitBarrier, accuratePayouts]);

  const payoutUnder = useMemo(() => {
    if (accuratePayouts['DIGITUNDER']) return accuratePayouts['DIGITUNDER'];
    const winningDigits = Math.max(1, digitBarrier);
    const winProb = winningDigits / 10;
    return Number(((stake * 0.909) / winProb).toFixed(2));
  }, [stake, digitBarrier, accuratePayouts]);

  // Matches/Differs payouts (use accurate data when available)
  const payoutMatch = accuratePayouts['DIGITMATCH'] || Number((stake * 9.0).toFixed(2));
  const payoutDiff = accuratePayouts['DIGITDIFF'] || Number((stake * 1.098).toFixed(2));

  // Even/Odd payouts (use accurate data when available)
  const payoutEven = accuratePayouts['DIGITEVEN'] || Number((stake * 1.95).toFixed(2));
  const payoutOdd = accuratePayouts['DIGITODD'] || Number((stake * 1.95).toFixed(2));

  // Rise/Fall payouts (use accurate data when available)
  const payoutRise = (accuratePayouts['CALL'] || Number((stake * (allowEquals ? 1.74 : 1.95)).toFixed(2)));
  const payoutFall = (accuratePayouts['PUT'] || Number((stake * (allowEquals ? 1.74 : 1.95)).toFixed(2)));

  // Accumulator live payout
  const liveAccuPayout = activeContract && activeContract.contractType === 'ACCU'
    ? Number((stake * Math.pow(1 + growthRate, activeContract.currentTickCount)).toFixed(2))
    : Number((stake * (1 + growthRate)).toFixed(2));

  const digitMeta = DIGIT_TYPES.find(d => d.type === digitType)!;

  const tradeLabelCurrent = tradeCategory === 'digits'
    ? (digitSubtype === 'over_under' ? 'Over/Under' : digitSubtype === 'match_diff' ? 'Matches/Differs' : 'Even/Odd')
    : tradeCategory === 'growth'
    ? (growthType === 'accumulator' ? 'Accumulators' : 'Multipliers')
    : (DIRECTIONAL_TYPES.find((d) => d.key === directionalType)?.label ?? 'Rise/Fall');

  const getTradeTypeIcon = () => {
    if (tradeCategory === 'digits') {
      if (digitSubtype === 'over_under') return '↗ ↘';
      if (digitSubtype === 'match_diff') return '≑ ≠';
      return '2 | 3';
    }
    if (tradeCategory === 'growth') {
      return growthType === 'accumulator' ? '🌱' : '⚡';
    }
    if (directionalType === 'higher_lower') return '↑ ↓';
    if (directionalType === 'touch_no_touch') return '⊙';
    return '↗ ↘';
  };

  const getTradeTypeIconComponent = (type: string) => {
    switch (type) {
      case 'over_under':
        return (
          <div className="trade-type-icon-pair">
            <ArrowUp size={16} className="icon-up" />
            <ArrowDown size={16} className="icon-down" />
          </div>
        );
      case 'match_diff':
        return (
          <div className="trade-type-icon-pair">
            <Zap size={16} className="icon-match" />
            <XIcon size={16} className="icon-diff" />
          </div>
        );
      case 'even_odd':
        return (
          <div className="trade-type-icon-pair">
            <Grid3x3 size={16} className="icon-even" />
            <MinusIcon size={16} className="icon-odd" />
          </div>
        );
      case 'rise_fall':
        return (
          <div className="trade-type-icon-pair">
            <TrendingUp size={16} className="icon-rise" />
            <TrendingDown size={16} className="icon-fall" />
          </div>
        );
      case 'higher_lower':
        return (
          <div className="trade-type-icon-pair separated">
            <ArrowUpRight size={16} className="icon-higher" />
            <ArrowDownRight size={16} className="icon-lower" />
          </div>
        );
      case 'touch_no_touch':
        return (
          <div className="trade-type-icon-pair">
            <Target size={16} className="icon-touch" />
            <XIcon size={16} className="icon-no-touch" />
          </div>
        );
      case 'accumulator':
        return (
          <div className="trade-type-icon-pair">
            <PlusIcon size={16} className="icon-accu" />
            <Zap size={16} className="icon-accu" />
          </div>
        );
      case 'multiplier':
        return (
          <div className="trade-type-icon-pair">
            <Infinity size={16} className="icon-mult" />
            <Zap size={16} className="icon-mult" />
          </div>
        );
      default:
        return <Hash size={16} />;
    }
  };

  const activeChartView = useMemo(() => {
    if (chartViewOverride !== 'auto') return chartViewOverride;
    if (tradeCategory === 'digits') return 'digits';
    return 'chart';
  }, [chartViewOverride, tradeCategory]);

  const digitStats = useMemo(() => {
    const sample = tickHistory.length > 0 ? tickHistory.slice(-100) : [];
    const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    if (sample.length === 0) {
      return {
        percentages: [8.1, 9.6, 11.2, 11.5, 9.5, 8.9, 10.7, 11.0, 9.3, 10.2],
        maxIdx: 3,
        minIdx: 0,
        currentLastDigit: currentTick ? getQuoteLastDigit(currentTick.quote) : 7,
        sampleSize: 0,
      };
    }
    sample.forEach((t) => {
      const d = getQuoteLastDigit(t.quote);
      counts[d] = (counts[d] || 0) + 1;
    });
    const total = sample.length;
    const percentages = counts.map((c) => Number(((c / total) * 100).toFixed(1)));

    let maxIdx = 0;
    let minIdx = 0;
    for (let i = 1; i < 10; i++) {
      if (percentages[i] > percentages[maxIdx]) maxIdx = i;
      if (percentages[i] < percentages[minIdx]) minIdx = i;
    }

    const currentLastDigit = currentTick ? getQuoteLastDigit(currentTick.quote) : null;

    return {
      percentages,
      maxIdx,
      minIdx,
      currentLastDigit,
      sampleSize: total,
    };
  }, [tickHistory, currentTick]);

  const getInstrumentBadge = (inst: string) => {
    const is1s = inst.includes('(1s)');
    const numMatch = inst.match(/\d+/);
    const num = numMatch ? numMatch[0] : inst.replace(' Index', '').substring(0, 4);
    return { num, is1s };
  };

  const badgeInfo = getInstrumentBadge(selectedInstrument);

  const handleExecuteTrade = async (action: 'CALL' | 'PUT' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF' | 'DIGITEVEN' | 'DIGITODD' | 'ACCU' | 'MULTUP' | 'MULTDOWN') => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      let contractDirection: string = action;
      let contractBarrier: number | undefined;
      let growth_rate: number | undefined;
      let duration: number | undefined = durationTicks;
      let calcPayout = potentialPayout;

      if (action === 'DIGITOVER') {
        contractBarrier = digitBarrier;
        calcPayout = payoutOver;
      } else if (action === 'DIGITUNDER') {
        contractBarrier = digitBarrier;
        calcPayout = payoutUnder;
      } else if (action === 'DIGITMATCH') {
        contractBarrier = digitBarrier;
        calcPayout = payoutMatch;
      } else if (action === 'DIGITDIFF') {
        contractBarrier = digitBarrier;
        calcPayout = payoutDiff;
      } else if (action === 'DIGITEVEN') {
        calcPayout = payoutEven;
      } else if (action === 'DIGITODD') {
        calcPayout = payoutOdd;
      } else if (action === 'CALL') {
        calcPayout = payoutRise;
      } else if (action === 'PUT') {
        calcPayout = payoutFall;
      } else if (action === 'ACCU') {
        growth_rate = growthRate;
        duration = undefined;
        calcPayout = liveAccuPayout;
      } else if (action === 'MULTUP' || action === 'MULTDOWN') {
        duration = undefined;
        calcPayout = Number((stake * multiplier).toFixed(2));
      }

      const localContractId = String(Date.now());
      const newContract: ActiveContract = {
        id: localContractId,
        direction: (action === 'CALL' || action === 'PUT') ? action : (action === 'DIGITOVER' || action === 'DIGITMATCH' || action === 'DIGITEVEN' || action === 'MULTUP' || action === 'ACCU') ? 'CALL' : 'PUT',
        contractType: action,
        digitBarrier: (action === 'DIGITOVER' || action === 'DIGITUNDER' || action === 'DIGITMATCH' || action === 'DIGITDIFF') ? digitBarrier : undefined,
        entryQuote: currentTick?.quote ?? 0,
        entryTickIndex: currentTick?.index ?? 0,
        currentTickCount: 1,
        totalTicks: tradeCategory === 'growth' ? 999 : durationTicks,
        stake,
        payout: calcPayout,
        ticks: [{ quote: currentTick?.quote ?? 0, tickIndex: currentTick?.index ?? 0 }],
        status: 'running',
      };

      setActiveContract(newContract);
      setPositionHistory(prev => [newContract, ...prev]);

      if (derivConnected) {
        try {
          const result = await runTrade({
            instrument: selectedInstrument,
            direction: contractDirection,
            stake,
            source: 'manual',
            barrier: contractBarrier,
            growth_rate,
            duration,
          });

          // Update the contract with Deriv contract ID and accurate payout data
          if (result && result.contractId) {
            setActiveContract(prev => prev ? { ...prev, derivContractId: result.contractId, derivPayout: result.derivPayout } : prev);
            setPositionHistory(prev => prev.map(c => c.id === localContractId ? { ...c, derivContractId: result.contractId, derivPayout: result.derivPayout } : c));
          }
        } catch (err) {
          console.warn('[ManualTrader] live runTrade warning:', err);
          // If Deriv trade fails, remove the local contract
          setActiveContract(null);
          setPositionHistory(prev => prev.filter(c => c.id !== localContractId));
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseAccumulator = () => {
    if (!activeContract) return;
    setActiveContract({
      ...activeContract,
      status: 'won',
      payout: liveAccuPayout,
    });
  };

  const renderDigitDial = (d: number) => {
    const pct = digitStats.percentages[d];
    const isMax = d === digitStats.maxIdx;
    const isMin = d === digitStats.minIdx;
    const isSelected = digitBarrier === d;
    const isCurrent = digitStats.currentLastDigit === d;

    // Arc math: circumference for r=22 is ~138.23
    const radius = 22;
    const circumference = 2 * Math.PI * radius;
    const arcLength = Math.max(3, (pct / 100) * circumference);
    const strokeColor = isMax ? '#00e5bf' : isMin ? '#f43f5e' : '#2dd4bf';

    return (
      <div
        key={d}
        className={`digit-dial-wrapper ${isSelected ? 'selected' : ''} ${isCurrent ? 'current' : ''}`}
        onClick={() => setDigitBarrier(d)}
        title={`Digit ${d}: ${pct}% (Click to select barrier)`}
      >
        <svg viewBox="0 0 56 56" className="digit-dial-svg">
          {isSelected ? (
            /* Selected Prediction Dial: Traderscheme / Deriv blue highlight with crisp white text */
            <>
              <circle
                cx="28"
                cy="28"
                r={radius}
                fill="#1e293b"
                stroke="#3b82f6"
                strokeWidth="4.5"
              />
              <circle
                cx="28"
                cy="28"
                r={radius}
                fill="none"
                stroke="#60a5fa"
                strokeWidth="4.5"
                strokeDasharray={`${arcLength.toFixed(1)} ${circumference.toFixed(1)}`}
                strokeDashoffset="0"
                strokeLinecap="round"
                transform="rotate(-90 28 28)"
              />
              <text
                x="28"
                y="25"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="15"
                fontWeight="800"
                fontFamily="'DM Mono', monospace"
              >
                {d}
              </text>
              <text
                x="28"
                y="38"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="10"
                fontWeight="700"
                fontFamily="'DM Mono', monospace"
              >
                {pct}%
              </text>
            </>
          ) : (
            /* Standard Digits Dial with circular percentage arc */
            <>
              <circle
                cx="28"
                cy="28"
                r={radius}
                fill="#0b1413"
                stroke="#162c28"
                strokeWidth="5.5"
              />
              <circle
                cx="28"
                cy="28"
                r={radius}
                fill="none"
                stroke={strokeColor}
                strokeWidth="5.5"
                strokeDasharray={`${arcLength.toFixed(1)} ${circumference.toFixed(1)}`}
                strokeDashoffset="0"
                strokeLinecap="round"
                transform="rotate(-90 28 28)"
              />
              <text
                x="28"
                y="25"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="15"
                fontWeight="800"
                fontFamily="'DM Mono', monospace"
              >
                {d}
              </text>
              <text
                x="28"
                y="38"
                textAnchor="middle"
                fill={isMax ? '#00e5bf' : isMin ? '#f43f5e' : '#94a3b8'}
                fontSize="10"
                fontWeight="600"
                fontFamily="'DM Mono', monospace"
              >
                {pct}%
              </text>
            </>
          )}
        </svg>
        <div className="digit-indicator-slot">
          {isCurrent && <span className="digit-current-arrow">▲</span>}
        </div>
      </div>
    );
  };

  const activeBalance = derivConnected && derivAccount ? derivAccount.balance : null;
  const activeCurrency = derivConnected && derivAccount ? (derivAccount.currency ?? 'USD') : 'USD';
  const isDemo = !derivConnected || Boolean(derivAccount?.is_virtual);

  // Fetch accurate payouts from Deriv when connected
  useEffect(() => {
    if (!derivConnected || !selectedSymbolCode) {
      setAccuratePayouts({});
      return;
    }

    const fetchAccuratePayouts = async () => {
      try {
        const symbol = selectedSymbolCode as DerivSymbol;
        const payoutMap: Record<string, number> = {};

        // Fetch accurate payouts for each contract type
        const contractTypes: Array<{ type: string; barrier?: number }> = [
          { type: 'CALL' },
          { type: 'PUT' },
          { type: 'DIGITEVEN' },
          { type: 'DIGITODD' },
          { type: 'DIGITOVER', barrier: digitBarrier },
          { type: 'DIGITUNDER', barrier: digitBarrier },
          { type: 'DIGITMATCH', barrier: digitBarrier },
          { type: 'DIGITDIFF', barrier: digitBarrier },
        ];

        for (const { type, barrier } of contractTypes) {
          try {
            const proposal = await getProposal({
              symbol,
              contract_type: type as any,
              stake,
              duration: durationTicks,
              barrier,
            });
            payoutMap[type] = proposal.payout;
          } catch (err) {
            // Fall back to local calculation if proposal fails
            if (import.meta.env.DEV) console.warn(`Failed to get proposal for ${type}:`, err);
          }
        }

        setAccuratePayouts(payoutMap);
      } catch (err) {
        if (import.meta.env.DEV) console.warn('Failed to fetch accurate payouts:', err);
      }
    };

    fetchAccuratePayouts();
  }, [derivConnected, selectedSymbolCode, stake, durationTicks, digitBarrier]);

  // Auto-hide contract card after trade completes
  useEffect(() => {
    // Clear any existing timer
    if (contractCardTimerRef.current) {
      clearTimeout(contractCardTimerRef.current);
      contractCardTimerRef.current = null;
    }

    if (!activeContract) {
      setShowContractCard(false);
      return;
    }

    if (activeContract.status === 'running') {
      setShowContractCard(true);
      return;
    }

    // Hide the card after 3 seconds when trade completes
    contractCardTimerRef.current = window.setTimeout(() => {
      setShowContractCard(false);
      contractCardTimerRef.current = null;
    }, 3000);

    return () => {
      if (contractCardTimerRef.current) {
        clearTimeout(contractCardTimerRef.current);
        contractCardTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContract?.status]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (contractCardTimerRef.current) {
        clearTimeout(contractCardTimerRef.current);
        contractCardTimerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="dtrader-container">
      {/* Top Navigation & Account Bar */}
      <div className="dtrader-topbar">
        <div className="dtrader-topbar-account-row">
          <div className="dtrader-topbar-left">
            {onBack && (
              <button
                type="button"
                className="dtrader-back-btn"
                onClick={onBack}
                aria-label="Back"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            <div className="dtrader-account-card">
              <span className={`dtrader-acc-type ${isDemo ? 'demo' : 'real'}`}>
                {derivConnected && derivAccount
                  ? isDerivReal
                    ? (liveArmed ? 'Real account · LIVE' : 'Real account · Safe')
                    : 'Demo account'
                  : 'Simulation Mode'}
              </span>
              <strong className="dtrader-acc-balance">
                {derivConnected && derivAccount
                  ? `${formatCurrency(activeBalance ?? 0).replace('$', '')} ${activeCurrency}`
                  : 'Demo Trading'}
              </strong>
            </div>
          </div>

          <div className="dtrader-topbar-right">
            {/* Positions Button in Topbar */}
            <button
              type="button"
              className={`dtrader-topbar-pos-btn ${showPositionsPanel ? 'active' : ''} ${positionHistory.length > 0 ? 'has-active' : ''}`}
              onClick={() => setShowPositionsPanel((v) => !v)}
              title="Toggle Positions"
            >
              <Layers size={13} />
              <span>Positions{positionHistory.length > 0 ? ` (${positionHistory.length})` : ''}</span>
            </button>

            {derivConnected && derivAccount ? (
              isDemo && linkedRealAccount && onSwitchAccount ? (
                <button
                  type="button"
                  className="dtrader-switch-real-btn"
                  onClick={() => onSwitchAccount(linkedRealAccount.loginid)}
                  title="Switch to Real Account"
                >
                  Try real
                </button>
              ) : !isDemo && linkedDemoAccount && onSwitchAccount ? (
                <button
                  type="button"
                  className="dtrader-switch-demo-btn"
                  onClick={() => onSwitchAccount(linkedDemoAccount.loginid)}
                  title="Switch to Demo Account"
                >
                  Use demo
                </button>
              ) : null
            ) : (
              <button
                type="button"
                className="connect-deriv-topbar-btn"
                onClick={() => onGoToSettings?.()}
              >
                Connect Deriv
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Terminal Body: Chart + Ticket */}
      <div className="dtrader-grid">
        {/* Left / Center Financial Chart / Digits Panel */}
        <div className="dtrader-chart-panel">
          {/* Collapsible Positions Panel */}
          {showPositionsPanel && (
            <div className="dtrader-positions-panel">
              <div className="positions-panel-header">
                <span className="positions-panel-title">Positions</span>
                <div className="positions-panel-tabs">
                  <span
                    className={`pos-tab ${positionsTab === 'open' ? 'active' : ''}`}
                    onClick={() => setPositionsTab('open')}
                  >
                    Open
                  </span>
                  <span
                    className={`pos-tab ${positionsTab === 'closed' ? 'active' : ''}`}
                    onClick={() => setPositionsTab('closed')}
                  >
                    Closed
                  </span>
                </div>
                <button
                  type="button"
                  className="positions-panel-close"
                  onClick={() => setShowPositionsPanel(false)}
                >
                  <X size={15} />
                </button>
              </div>
              <div className="positions-panel-body">
                {positionsTab === 'open' ? (
                  <>
                    {activeContract && activeContract.status === 'running' ? (
                      <div className={`position-row ${activeContract.status}`}>
                        <div className="position-row-icon">
                          <span>{selectedInstrument.replace('Volatility ', 'V').replace(' Index', '')}</span>
                        </div>
                        <div className="position-row-info">
                          <strong>{selectedInstrument}</strong>
                          <span>{activeContract.direction === 'CALL' ? 'Rise' : 'Fall'} · ${activeContract.stake.toFixed(2)}</span>
                        </div>
                        <div className="position-row-status">
                          <span className={`pos-status-badge ${activeContract.status}`}>
                            {activeContract.status === 'running' ? `${activeContract.currentTickCount}/${activeContract.totalTicks}t` : activeContract.status}
                          </span>
                          <strong className={activeContract.status === 'won' ? 'positive' : activeContract.status === 'lost' ? 'negative' : ''}>
                            {activeContract.status === 'won' ? `+$${(activeContract.derivPayout ?? activeContract.payout).toFixed(2)}` :
                             activeContract.status === 'lost' ? `-$${activeContract.stake.toFixed(2)}` :
                             `$${(activeContract.derivPayout ?? activeContract.payout).toFixed(2)}`}
                          </strong>
                        </div>
                      </div>
                    ) : (
                      <div className="positions-empty">
                        <span>No open positions</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {positionHistory.filter(p => p.status !== 'running').length > 0 ? (
                      positionHistory.filter(p => p.status !== 'running').map((position) => (
                        <div key={position.id} className={`position-row ${position.status}`}>
                          <div className="position-row-icon">
                            <span>{selectedInstrument.replace('Volatility ', 'V').replace(' Index', '')}</span>
                          </div>
                          <div className="position-row-info">
                            <strong>{selectedInstrument}</strong>
                            <span>{position.direction === 'CALL' ? 'Rise' : 'Fall'} · ${position.stake.toFixed(2)}</span>
                          </div>
                          <div className="position-row-status">
                            <span className={`pos-status-badge ${position.status}`}>
                              {position.status}
                            </span>
                            <strong className={position.status === 'won' ? 'positive' : position.status === 'lost' ? 'negative' : ''}>
                              {position.status === 'won' ? `+$${(position.derivPayout ?? position.payout).toFixed(2)}` :
                               position.status === 'lost' ? `-$${position.stake.toFixed(2)}` :
                               `$${(position.derivPayout ?? position.payout).toFixed(2)}`}
                            </strong>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="positions-empty">
                        <span>No closed positions</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Market Selector Card positioned directly above digits/chart matching Traderscheme / Deriv */}
          <div
            className="dtrader-market-card"
            onClick={() => setShowInstrumentPanel(true)}
            title="Click to select market"
          >
            <div className="dtrader-market-card-left">
              <div className="dtrader-asset-badge">
                <span>{badgeInfo.num}</span>
                {badgeInfo.is1s && <span className="sub">1s</span>}
              </div>
              <div className="dtrader-market-meta">
                <div className="dtrader-market-name-row">
                  <strong className="dtrader-market-name">{selectedInstrument}</strong>
                  <ChevronDown size={14} className={showInstrumentPanel ? 'rotated' : ''} />
                </div>
                <div className="dtrader-market-price-row">
                  <span className="dtrader-market-price">
                    {currentTick ? currentTick.quote.toFixed(2) : '—'}
                  </span>
                  <span className={`dtrader-market-delta ${(currentTick?.changePct ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                    {(currentTick?.changePct ?? 0) >= 0 ? '+' : ''}{(currentTick?.changePct ?? 0).toFixed(2)}%
                    {(currentTick?.changePct ?? 0) >= 0 ? ' ▲' : ' ▼'}
                  </span>
                </div>
              </div>
            </div>

            <div className="dtrader-market-card-right">
              {tradeCategory === 'digits' && (
                <button
                  type="button"
                  className="dtrader-view-toggle-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setChartViewOverride(activeChartView === 'digits' ? 'chart' : 'digits');
                  }}
                  title={activeChartView === 'digits' ? 'Switch to Price Line Chart' : 'Switch to Digits Analysis'}
                >
                  {activeChartView === 'digits' ? (
                    <>
                      <LineChartIcon size={13} />
                      <span>Price Chart</span>
                    </>
                  ) : (
                    <>
                      <Hash size={13} />
                      <span>Digit Stats</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Digits Statistics Analysis Gauge (10 circular dials matching Deriv) */}
          {activeChartView === 'digits' ? (
            <div className="dtrader-digit-stats-container">
              <div className="dtrader-digit-dials-grid">
                <div className="digit-dial-row">
                  {[0, 1, 2, 3, 4].map((d) => renderDigitDial(d))}
                </div>
                <div className="digit-dial-row with-arrows">
                  <span className="digit-nav-chevron left">«</span>
                  {[5, 6, 7, 8, 9].map((d) => renderDigitDial(d))}
                  <span className="digit-nav-chevron right">»</span>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Floating Left Toolbar */}
              <div className="dtrader-left-toolbar">
                <div className="dtrader-tool-btn interval" title="1-tick interval">
                  1t
                </div>
                <button
                  type="button"
                  className={`dtrader-tool-btn ${chartType === 'area' ? 'active' : ''}`}
                  onClick={() => setChartType(chartType === 'area' ? 'line' : 'area')}
                  title="Toggle Area / Line Chart"
                >
                  <LineChartIcon size={16} />
                </button>
                <button
                  type="button"
                  className="dtrader-tool-btn"
                  onClick={() => updateZoomLevel((prev) => Math.max(15, prev - 6))}
                  title="Zoom In (Spread ticks)"
                >
                  <ZoomIn size={15} />
                </button>
                <button
                  type="button"
                  className="dtrader-tool-btn"
                  onClick={() => updateZoomLevel((prev) => Math.min(90, prev + 6))}
                  title="Zoom Out (More ticks)"
                >
                  <ZoomOut size={15} />
                </button>
                <button type="button" className="dtrader-tool-btn" title="Drawing Tools">
                  <Pencil size={15} />
                </button>
                <button type="button" className="dtrader-tool-btn" title="Technical Indicators">
                  <Layers size={15} />
                </button>
              </div>

              {/* Floating Zoom Level Pill */}
              {showZoomPill && (
                <div className="dtrader-zoom-pill">
                  <span>Zoom: {zoomLevel} ticks</span>
                  <button
                    type="button"
                    onClick={() => updateZoomLevel(35)}
                    title="Reset zoom"
                  >
                    Reset
                  </button>
                </div>
              )}

              {/* Historical Inspection Floating Banner */}
              {scrollOffset > 0 && (
                <div className="dtrader-past-banner">
                  <span className="past-info">
                    Viewing past trend (<b>-{scrollOffset}</b> ticks · {visibleTicks[visibleTicks.length - 1]?.time})
                  </span>
                  <button
                    type="button"
                    className="dtrader-return-live-btn"
                    onClick={() => setScrollOffset(0)}
                  >
                    <span className="live-dot-pulse" />
                    Return to Live ⏺
                  </button>
                </div>
              )}

              {/* SVG Price Chart */}
              <div
                className={`dtrader-svg-wrapper ${isDragging ? 'dragging' : ''} ${scrollOffset > 0 ? 'inspecting-past' : ''}`}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheelZoom}
              >
                {/* Chart loading overlay */}
                {isChartLoading && (
                  <div className="chart-loading-overlay">
                    <span className="chart-loading-dot" />
                    <span>Connecting to live feed…</span>
                  </div>
                )}
                <svg viewBox="0 0 100 65" preserveAspectRatio="none" className="dtrader-svg">
                  <defs>
                    <linearGradient id="dtraderAreaGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#2dd4bf" stopOpacity="0.18" />
                      <stop offset="55%"  stopColor="#2dd4bf" stopOpacity="0.05" />
                      <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
                    </linearGradient>
                    <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
                      <feDropShadow dx="0" dy="0" stdDeviation="0.35" floodColor="#2dd4bf" floodOpacity="0.35" />
                    </filter>
                  </defs>

                  {/* Clean subtle horizontal guides — only 3, very faint */}
                  {chartMath.yLabels.filter((_, i) => i === 1 || i === 2 || i === 3).map((yl, i) => (
                    <line
                      key={i}
                      x1="0" y1={yl.yPos} x2="100" y2={yl.yPos}
                      stroke="#1a2e2a"
                      strokeWidth="0.5"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}

                  {/* Accumulator dynamic survival corridor band */}
                  {tradeCategory === 'growth' && growthType === 'accumulator' && (
                    <g className="accumulator-corridor-group">
                      <rect
                        x="0"
                        y={Math.max(4, chartMath.currentY - 11)}
                        width="100"
                        height="22"
                        fill="rgba(45, 212, 191, 0.08)"
                        stroke="rgba(45, 212, 191, 0.35)"
                        strokeDasharray="2 3"
                        vectorEffect="non-scaling-stroke"
                      />
                      <line
                        x1="0"
                        y1={Math.max(4, chartMath.currentY - 11)}
                        x2="100"
                        y2={Math.max(4, chartMath.currentY - 11)}
                        stroke="#2dd4bf"
                        strokeWidth="0.8"
                        strokeDasharray="2 3"
                        vectorEffect="non-scaling-stroke"
                      />
                      <line
                        x1="0"
                        y1={Math.min(61, chartMath.currentY + 11)}
                        x2="100"
                        y2={Math.min(61, chartMath.currentY + 11)}
                        stroke="#f87171"
                        strokeWidth="0.8"
                        strokeDasharray="2 3"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  )}

                  {/* Multiplier TP & SL target lines */}
                  {tradeCategory === 'growth' && growthType === 'multiplier' && (
                    <g className="multiplier-guides-group">
                      <line
                        x1="0"
                        y1={Math.max(4, chartMath.currentY - 14)}
                        x2="100"
                        y2={Math.max(4, chartMath.currentY - 14)}
                        stroke="#34d399"
                        strokeWidth="0.8"
                        strokeDasharray="3 3"
                        vectorEffect="non-scaling-stroke"
                      />
                      <line
                        x1="0"
                        y1={Math.min(61, chartMath.currentY + 14)}
                        x2="100"
                        y2={Math.min(61, chartMath.currentY + 14)}
                        stroke="#f87171"
                        strokeWidth="0.8"
                        strokeDasharray="3 3"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  )}

                  {/* Barrier line for Higher/Lower or Touch/No Touch */}
                  {tradeCategory === 'directional' && (directionalType === 'higher_lower' || directionalType === 'touch_no_touch') && (
                    <g className="barrier-guide-group">
                      <line
                        x1="0"
                        y1="32.5"
                        x2="100"
                        y2="32.5"
                        stroke="#f59e0b"
                        strokeWidth="0.8"
                        strokeDasharray="3 3"
                        vectorEffect="non-scaling-stroke"
                      />
                      <text x="4" y="30" fill="#fbbf24" fontSize="2.8" fontWeight="700">Barrier: {barrier}</text>
                    </g>
                  )}

                  {/* Area Fill */}
                  {chartType === 'area' && chartMath.fillStr && (
                    <path d={chartMath.fillStr} fill="url(#dtraderAreaGrad)" />
                  )}

                  {/* Main Price Line - Ultra smooth financial spline */}
                  {chartMath.pathStr && (
                    <path
                      d={chartMath.pathStr}
                      fill="none"
                      stroke="#f8fafc"
                      strokeWidth="1.15"
                      filter="url(#lineGlow)"
                      vectorEffect="non-scaling-stroke"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Active Contract Overlay (5 ticks progress) */}
                  {contractOverlay && (
                    <g className="contract-visualization-group">
                      <path
                        d={contractOverlay.path}
                        fill="none"
                        stroke={
                          activeContract?.status === 'won'
                            ? '#34d399'
                            : activeContract?.status === 'lost'
                            ? '#f87171'
                            : '#38bdf8'
                        }
                        strokeWidth="2.2"
                        vectorEffect="non-scaling-stroke"
                        strokeLinecap="round"
                      />
                      {contractOverlay.points.map((pt, i) => (
                        <circle
                          key={i}
                          cx={pt.x}
                          cy={pt.y}
                          r="0.85"
                          fill={activeContract?.status === 'won' ? '#34d399' : '#2dd4bf'}
                          stroke="#07100f"
                          strokeWidth="0.75"
                          vectorEffect="non-scaling-stroke"
                        />
                      ))}
                      {/* Contract Progress Text Badge (e.g. 5/5) like Deriv */}
                      {contractOverlay.entryPt && (
                        <text
                          x={contractOverlay.entryPt.x}
                          y={Math.max(6, contractOverlay.entryPt.y - 3)}
                          fill="#f1f5f9"
                          fontSize="3"
                          fontWeight="800"
                          textAnchor="middle"
                          fontFamily="'DM Mono', monospace"
                        >
                          {activeContract?.currentTickCount}/{activeContract?.totalTicks}
                        </text>
                      )}
                    </g>
                  )}

                  {/* Spot Vertical Crosshair dashed line */}
                  <line
                    x1={chartMath.currentX}
                    y1="0"
                    x2={chartMath.currentX}
                    y2="65"
                    stroke="#2dd4bf"
                    strokeWidth="0.75"
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray="2 3"
                    opacity="0.4"
                  />

                  {/* Spot Horizontal Crosshair Line extending to axis */}
                  <line
                    x1="0"
                    y1={chartMath.currentY}
                    x2="100"
                    y2={chartMath.currentY}
                    stroke="#2dd4bf"
                    strokeWidth="0.75"
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray="2 3"
                    opacity="0.55"
                  />

                  {/* Latest Spot Marker - Glowing pulsing multi-layer dot */}
                  <circle
                    cx={chartMath.currentX}
                    cy={chartMath.currentY}
                    r="2.2"
                    fill="#2dd4bf"
                    opacity="0.2"
                  />
                  <circle
                    cx={chartMath.currentX}
                    cy={chartMath.currentY}
                    r="1.4"
                    fill="#2dd4bf"
                    opacity="0.45"
                  />
                  <circle
                    cx={chartMath.currentX}
                    cy={chartMath.currentY}
                    r="0.85"
                    fill="#ffffff"
                    stroke="#0d9488"
                    strokeWidth="0.6"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>

                {/* Accumulator HUD Banner */}
                {tradeCategory === 'growth' && growthType === 'accumulator' && (
                  <div className="dtrader-accu-hud">
                    <span className="accu-hud-title">🌱 Accumulators ({(growthRate * 100).toFixed(0)}%/tick)</span>
                    <span className="accu-hud-stats">
                      Ticks: <b>{activeContract?.currentTickCount ?? 0}t</b> · Return: <b>${liveAccuPayout.toFixed(2)}</b>
                    </span>
                  </div>
                )}

                {/* Multipliers HUD Banner */}
                {tradeCategory === 'growth' && growthType === 'multiplier' && (
                  <div className="dtrader-mult-hud">
                    <span style={{ color: '#2dd4bf', fontWeight: 700 }}>⚡ Multipliers ×{multiplier}</span>
                    <span>TP: <b style={{ color: '#34d399' }}>+${takeProfit}</b></span>
                    <span>SL: <b style={{ color: '#f87171' }}>-${stopLoss}</b></span>
                  </div>
                )}

                {/* Floating Live Price Callout */}
                <div className="dtrader-floating-callout">
                  <div className={`callout-pct ${(currentTick?.changePct ?? 0) >= 0 ? 'positive' : 'negative'}`}>
                    {scrollOffset > 0 ? `Past: -${scrollOffset}t` : (currentTick?.changePct ?? 0) >= 0 ? `+${currentTick?.changePct ?? 0}%` : `${currentTick?.changePct ?? 0}%`}
                  </div>
                  <div className="callout-price">
                    {scrollOffset > 0 && visibleTicks.length > 0
                      ? visibleTicks[visibleTicks.length - 1].quote.toFixed(2)
                      : currentTick?.quote.toFixed(2) ?? '—'}
                  </div>
                  <div className="callout-time">
                    {scrollOffset > 0 && visibleTicks.length > 0
                      ? visibleTicks[visibleTicks.length - 1].time
                      : currentTick?.time ?? '—'}
                  </div>
                </div>

                {/* Right Y-Axis Price Labels */}
                <div className="dtrader-y-axis">
                  {chartMath.yLabels.map((yl, i) => (
                    <span
                      key={i}
                      className="dtrader-axis-label"
                      style={{ top: `${(yl.yPos / 65) * 100}%` }}
                    >
                      {yl.price}
                    </span>
                  ))}

                  {/* High-Contrast Live Price Badge */}
                  <div
                    className={`dtrader-live-price-badge ${scrollOffset > 0 ? 'historical' : ''}`}
                    style={{ top: `${(chartMath.currentY / 65) * 100}%` }}
                  >
                    <span className={`badge-dot ${scrollOffset > 0 ? 'past' : ''}`} />
                    <b>{scrollOffset > 0 && visibleTicks.length > 0 ? visibleTicks[visibleTicks.length - 1].quote.toFixed(2) : currentTick?.quote.toFixed(2) ?? '—'}</b>
                  </div>
                </div>
              </div>

              {/* Bottom Zoom / Navigation Controls */}
              <div className="dtrader-bottom-controls">
                <div className="dtrader-bottom-pill">
                  <button
                    type="button"
                    className="zoom-btn"
                    onClick={() => setScrollOffset((prev) => Math.min(Math.max(0, tickHistory.length - zoomLevel), prev + 12))}
                    title="Scroll back in history (older ticks)"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className="zoom-btn"
                    onClick={() => updateZoomLevel((z) => Math.min(90, z + 8))}
                    title="Zoom Out (More ticks)"
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    type="button"
                    className={`zoom-btn ${scrollOffset === 0 ? 'active' : ''}`}
                    onClick={() => { setScrollOffset(0); updateZoomLevel(35); }}
                    title={scrollOffset === 0 ? 'Recenter Live Chart' : 'Return to Live'}
                  >
                    <Crosshair size={14} />
                  </button>
                  <button
                    type="button"
                    className="zoom-btn"
                    onClick={() => updateZoomLevel((z) => Math.max(15, z - 8))}
                    title="Zoom In (Spread ticks)"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    type="button"
                    className="zoom-btn"
                    onClick={() => setScrollOffset((prev) => Math.max(0, prev - 12))}
                    title="Scroll forward (newer ticks)"
                    disabled={scrollOffset === 0}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </>
          )}

          {/* In-chart Active Contract Overlay Status Card */}
          {activeContract && showContractCard && (
            <div className={`dtrader-chart-contract-card ${activeContract.status}`}>
              <div className="contract-card-header">
                <span className="contract-card-badge">
                  {activeContract.status === 'running'
                    ? 'In Progress'
                    : activeContract.status === 'won'
                    ? '🎉 Won'
                    : '📉 Lost'}
                </span>
                <b className="contract-card-ticks">
                  {activeContract.currentTickCount}/{activeContract.totalTicks} ticks
                </b>
              </div>
              <div className="contract-card-grid">
                <div>
                  <small>Entry</small>
                  <strong>{activeContract.entryQuote.toFixed(2)}</strong>
                </div>
                <div>
                  <small>Current</small>
                  <strong>{currentTick?.quote.toFixed(2) ?? '—'}</strong>
                </div>
                <div>
                  <small>Payout</small>
                  <strong className={activeContract.status === 'won' ? 'positive' : ''}>
                    ${(activeContract.derivPayout ?? activeContract.payout).toFixed(2)}
                  </strong>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Execution Ticket Panel */}
        <div className="dtrader-ticket-panel">
          {/* Grabber Handle */}
          <div className="dtrader-ticket-grabber" />

          {/* Learn about this trade type link */}
          <div className="dtrader-learn-trade-row">
            <button
              type="button"
              className="dtrader-learn-trade-btn"
              onClick={() => setShowHowToModal(true)}
            >
              <HelpCircle size={13} />
              <span>Learn about this trade type</span>
              <ChevronRight size={13} />
            </button>
          </div>

          {/* Trade Type Selector Card matching Traderscheme / Deriv */}
          <button
            type="button"
            className="dtrader-contract-select-card"
            onClick={() => setShowTradeTypeDropdown(true)}
            title="Click to change trade type"
          >
            <div className="contract-select-left">
              <span className="contract-icon-box">
                {tradeCategory === 'digits' && digitSubtype === 'over_under' ? (
                  <span className="contract-arrows-pair">
                    <span className="arr-up">↗</span>
                    <span className="arr-down">↘</span>
                  </span>
                ) : tradeCategory === 'digits' && digitSubtype === 'match_diff' ? (
                  <span className="contract-arrows-pair">
                    <span className="arr-up">⌕</span>
                  </span>
                ) : tradeCategory === 'growth' ? (
                  <span>🌱</span>
                ) : (
                  <span className="contract-arrows-pair">
                    <span className="arr-up">↗</span>
                    <span className="arr-down">↘</span>
                  </span>
                )}
              </span>
              <strong className="contract-select-name">{tradeLabelCurrent}</strong>
            </div>
            <ChevronRight size={16} className="contract-select-chevron" />
          </button>

          {/* Direction Segmented Tabs for Rise/Fall */}
          {tradeCategory === 'directional' && directionalType === 'rise_fall' && (
            <div className="dtrader-direction-tabs">
              <button
                type="button"
                className={`direction-tab rise ${direction === 'CALL' ? 'active' : ''}`}
                onClick={() => setDirection('CALL')}
              >
                <span>Rise</span>
              </button>
              <button
                type="button"
                className={`direction-tab fall ${direction === 'PUT' ? 'active' : ''}`}
                onClick={() => setDirection('PUT')}
              >
                <span>Fall</span>
              </button>
            </div>
          )}

          {/* Direction Segmented Tabs for Higher/Lower */}
          {tradeCategory === 'directional' && directionalType === 'higher_lower' && (
            <div className="dtrader-direction-tabs">
              <button
                type="button"
                className={`direction-tab rise ${direction === 'CALL' ? 'active' : ''}`}
                onClick={() => setDirection('CALL')}
              >
                <span>Higher</span>
              </button>
              <button
                type="button"
                className={`direction-tab fall ${direction === 'PUT' ? 'active' : ''}`}
                onClick={() => setDirection('PUT')}
              >
                <span>Lower</span>
              </button>
            </div>
          )}

          {/* Direction Segmented Tabs for Touch/No Touch */}
          {tradeCategory === 'directional' && directionalType === 'touch_no_touch' && (
            <div className="dtrader-direction-tabs">
              <button
                type="button"
                className={`direction-tab rise ${direction === 'CALL' ? 'active' : ''}`}
                onClick={() => setDirection('CALL')}
              >
                <span>Touch</span>
              </button>
              <button
                type="button"
                className={`direction-tab fall ${direction === 'PUT' ? 'active' : ''}`}
                onClick={() => setDirection('PUT')}
              >
                <span>No Touch</span>
              </button>
            </div>
          )}

          {/* Direction Segmented Tabs for Multipliers */}
          {tradeCategory === 'growth' && growthType === 'multiplier' && (
            <div className="dtrader-direction-tabs">
              <button
                type="button"
                className={`direction-tab rise ${direction === 'CALL' ? 'active' : ''}`}
                onClick={() => setDirection('CALL')}
              >
                <span>Up</span>
              </button>
              <button
                type="button"
                className={`direction-tab fall ${direction === 'PUT' ? 'active' : ''}`}
                onClick={() => setDirection('PUT')}
              >
                <span>Down</span>
              </button>
            </div>
          )}

          {/* Direction Segmented Tabs for Even/Odd */}
          {tradeCategory === 'digits' && digitSubtype === 'even_odd' && (
            <div className="dtrader-direction-tabs">
              <button
                type="button"
                className={`direction-tab rise ${digitType === 'DIGITEVEN' ? 'active' : ''}`}
                onClick={() => setDigitType('DIGITEVEN')}
              >
                <span>Even</span>
              </button>
              <button
                type="button"
                className={`direction-tab fall ${digitType === 'DIGITODD' ? 'active' : ''}`}
                onClick={() => setDigitType('DIGITODD')}
              >
                <span>Odd</span>
              </button>
            </div>
          )}

          {/* 2x5 Digit Keypad for Over/Under and Matches/Differs */}
          {tradeCategory === 'digits' && digitSubtype !== 'even_odd' && (
            <div className="dtrader-digit-keypad">
              <div className="digit-keypad-row">
                {[0, 1, 2, 3, 4].map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`digit-key-btn ${digitBarrier === d ? 'active' : ''}`}
                    onClick={() => setDigitBarrier(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
              <div className="digit-keypad-row">
                {[5, 6, 7, 8, 9].map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={`digit-key-btn ${digitBarrier === d ? 'active' : ''}`}
                    onClick={() => setDigitBarrier(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── 3 Parameter Cards in ONE compact row ── */}
          <div className="dtrader-params-row" ref={paramsRowRef}>
            {/* Card 1: Duration / Growth Rate / Multiplier */}
            {tradeCategory === 'growth' && growthType === 'accumulator' ? (
              <div
                className={`dtrader-param-card ${activeParamPopover === 'duration' ? 'active' : ''}`}
                onClick={() => setActiveParamPopover(activeParamPopover === 'duration' ? null : 'duration')}
              >
                <span className="param-card-label">Growth</span>
                <span className="param-card-value">{(growthRate * 100).toFixed(0)}%</span>
                {activeParamPopover === 'duration' && (
                  <div className="param-popover popover-left" onClick={(e) => e.stopPropagation()}>
                    <div className="popover-title">Growth Rate</div>
                    <div className="popover-chips">
                      {[0.01, 0.02, 0.03, 0.04, 0.05].map((r) => (
                        <button
                          key={r}
                          type="button"
                          className={`popover-chip ${growthRate === r ? 'active' : ''}`}
                          onClick={() => {
                            setGrowthRate(r);
                            setActiveParamPopover(null);
                          }}
                        >
                          {(r * 100).toFixed(0)}%
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : tradeCategory === 'growth' && growthType === 'multiplier' ? (
              <div
                className={`dtrader-param-card ${activeParamPopover === 'duration' ? 'active' : ''}`}
                onClick={() => setActiveParamPopover(activeParamPopover === 'duration' ? null : 'duration')}
              >
                <span className="param-card-label">Multiplier</span>
                <span className="param-card-value">×{multiplier}</span>
                {activeParamPopover === 'duration' && (
                  <div className="param-popover popover-left" onClick={(e) => e.stopPropagation()}>
                    <div className="popover-title">Multiplier</div>
                    <div className="popover-chips">
                      {[10, 20, 30, 40, 50].map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`popover-chip ${multiplier === m ? 'active' : ''}`}
                          onClick={() => {
                            setMultiplier(m);
                            setActiveParamPopover(null);
                          }}
                        >
                          ×{m}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div
                className={`dtrader-param-card ${activeParamPopover === 'duration' ? 'active' : ''}`}
                onClick={() => setActiveParamPopover(activeParamPopover === 'duration' ? null : 'duration')}
              >
                <span className="param-card-label">Duration</span>
                <span className="param-card-value">{durationTicks} {durationTicks === 1 ? 'tick' : 'ticks'}</span>
                {activeParamPopover === 'duration' && (
                  <div className="param-popover popover-left" onClick={(e) => e.stopPropagation()}>
                    <div className="popover-title">Duration</div>
                    <div className="popover-chips">
                      {[1, 2, 3, 5, 10, 15].map((t) => (
                        <button
                          key={t}
                          type="button"
                          className={`popover-chip ${durationTicks === t ? 'active' : ''}`}
                          onClick={() => {
                            setDurationTicks(t);
                            setActiveParamPopover(null);
                          }}
                        >
                          {t}t
                        </button>
                      ))}
                    </div>
                    <div className="popover-stepper">
                      <button
                        type="button"
                        onClick={() => setDurationTicks((d) => Math.max(1, d - 1))}
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        value={durationTicks}
                        onChange={(e) => setDurationTicks(Math.max(1, Math.min(60, Number(e.target.value))))}
                      />
                      <span>ticks</span>
                      <button
                        type="button"
                        onClick={() => setDurationTicks((d) => Math.min(60, d + 1))}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Card 2: Stake (always present) */}
            <div
              className={`dtrader-param-card ${activeParamPopover === 'stake' ? 'active' : ''}`}
              onClick={() => setActiveParamPopover(activeParamPopover === 'stake' ? null : 'stake')}
            >
              <span className="param-card-label">Stake</span>
              <span className="param-card-value">${stake.toFixed(2)}</span>
              {activeParamPopover === 'stake' && (
                <div className="param-popover popover-center" onClick={(e) => e.stopPropagation()}>
                  <div className="popover-title">Stake</div>
                  <div className="popover-chips">
                    {[1, 2, 5, 10, 25, 50].map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={`popover-chip ${stake === s ? 'active' : ''}`}
                        onClick={() => {
                          setStake(s);
                          setActiveParamPopover(null);
                        }}
                      >
                        ${s}
                      </button>
                    ))}
                  </div>
                  <div className="popover-stepper">
                    <button
                      type="button"
                      onClick={() => setStake((s) => Math.max(0.35, Number((s - 1).toFixed(2))))}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min="0.35"
                      step="1"
                      value={stake}
                      onChange={(e) => setStake(Math.max(0.35, Number(e.target.value)))}
                    />
                    <span>USD</span>
                    <button
                      type="button"
                      onClick={() => setStake((s) => Number((s + 1).toFixed(2)))}
                    >
                      +
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Card 3: Allow equals / Barrier / Prediction / TP-SL */}
            {tradeCategory === 'directional' && directionalType === 'rise_fall' ? (
              <div
                className={`dtrader-param-card ${allowEquals ? 'enabled' : ''}`}
                onClick={() => setAllowEquals((v) => !v)}
                title="Toggle Allow Equals"
              >
                <span className="param-card-label">Allow equals</span>
                <span className="param-card-value">{allowEquals ? 'Yes' : '-'}</span>
              </div>
            ) : tradeCategory === 'directional' && (directionalType === 'higher_lower' || directionalType === 'touch_no_touch') ? (
              <div
                className={`dtrader-param-card ${activeParamPopover === 'barrier' ? 'active' : ''}`}
                onClick={() => setActiveParamPopover(activeParamPopover === 'barrier' ? null : 'barrier')}
              >
                <span className="param-card-label">Barrier</span>
                <span className="param-card-value">{barrier}</span>
                {activeParamPopover === 'barrier' && (
                  <div className="param-popover popover-right" onClick={(e) => e.stopPropagation()}>
                    <div className="popover-title">Barrier Offset/Price</div>
                    <input
                      type="text"
                      value={barrier}
                      onChange={(e) => setBarrier(e.target.value)}
                      className="popover-input"
                      placeholder="e.g. 1234.56"
                    />
                  </div>
                )}
              </div>
            ) : tradeCategory === 'digits' && digitSubtype !== 'even_odd' ? (
              <div
                className={`dtrader-param-card ${activeParamPopover === 'barrier' ? 'active' : ''}`}
                onClick={() => setActiveParamPopover(activeParamPopover === 'barrier' ? null : 'barrier')}
              >
                <span className="param-card-label">Prediction</span>
                <span className="param-card-value">{digitBarrier}</span>
              </div>
            ) : tradeCategory === 'growth' && growthType === 'multiplier' ? (
              <div
                className={`dtrader-param-card ${activeParamPopover === 'barrier' ? 'active' : ''}`}
                onClick={() => setActiveParamPopover(activeParamPopover === 'barrier' ? null : 'barrier')}
              >
                <span className="param-card-label">TP / SL</span>
                <span className="param-card-value">${takeProfit} / ${stopLoss}</span>
                {activeParamPopover === 'barrier' && (
                  <div className="param-popover popover-right" onClick={(e) => e.stopPropagation()}>
                    <div className="popover-title">Take Profit & Stop Loss</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <div>
                        <div style={{ fontSize: 10, color: '#8fa6a0', marginBottom: 2 }}>TP ($)</div>
                        <input
                          type="number"
                          min="0"
                          value={takeProfit}
                          onChange={(e) => setTakeProfit(Number(e.target.value))}
                          className="popover-input"
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: '#8fa6a0', marginBottom: 2 }}>SL ($)</div>
                        <input
                          type="number"
                          min="0"
                          value={stopLoss}
                          onChange={(e) => setStopLoss(Number(e.target.value))}
                          className="popover-input"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="dtrader-param-card">
                <span className="param-card-label">Payout</span>
                <span className="param-card-value">${potentialPayout.toFixed(2)}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="dtrader-actions-container">
            {isSubmitting ? (
              <div className="dtrader-action-loading">
                <RefreshCw size={18} className="spin" />
                <span>Purchasing contract…</span>
              </div>
            ) : activeContract !== null && activeContract.status === 'running' ? (
              tradeCategory === 'growth' && growthType === 'accumulator' ? (
                <button
                  type="button"
                  className="dtrader-single-btn close-accu"
                  onClick={handleCloseAccumulator}
                >
                  <span className="btn-main">Close Position</span>
                  <span className="btn-sub">Profit +${(liveAccuPayout - stake).toFixed(2)} USD (Tick {activeContract.currentTickCount})</span>
                </button>
              ) : (
                <button type="button" className="dtrader-buy-action-btn running" disabled>
                  <strong className="buy-headline">Running contract ({activeContract.currentTickCount}/{activeContract.totalTicks}t)</strong>
                  <span className="buy-payout">Potential payout ${activeContract.payout.toFixed(2)}</span>
                </button>
              )
            ) : tradeCategory === 'growth' && growthType === 'accumulator' ? (
              <button
                type="button"
                className="dtrader-buy-action-btn accu"
                onClick={() => void handleExecuteTrade('ACCU')}
              >
                <strong className="buy-headline">Open Accumulator</strong>
                <span className="buy-payout">Stake ${stake.toFixed(2)} USD · {(growthRate * 100).toFixed(0)}%/tick</span>
              </button>
            ) : tradeCategory === 'digits' && digitSubtype === 'over_under' ? (
              <div className="dtrader-dual-action-row">
                <button
                  type="button"
                  className="dtrader-dual-btn teal"
                  onClick={() => void handleExecuteTrade('DIGITOVER')}
                >
                  <span className="btn-line-1"><span className="btn-arrow">↗</span> Over</span>
                  <span className="btn-line-2">Payout ${payoutOver.toFixed(2)} USD</span>
                </button>
                <button
                  type="button"
                  className="dtrader-dual-btn red"
                  onClick={() => void handleExecuteTrade('DIGITUNDER')}
                >
                  <span className="btn-line-1"><span className="btn-arrow">↘</span> Under</span>
                  <span className="btn-line-2">Payout ${payoutUnder.toFixed(2)} USD</span>
                </button>
              </div>
            ) : tradeCategory === 'digits' && digitSubtype === 'match_diff' ? (
              <div className="dtrader-dual-action-row">
                <button
                  type="button"
                  className="dtrader-dual-btn teal"
                  onClick={() => void handleExecuteTrade('DIGITMATCH')}
                >
                  <span className="btn-line-1">Matches</span>
                  <span className="btn-line-2">Payout ${payoutMatch.toFixed(2)} USD</span>
                </button>
                <button
                  type="button"
                  className="dtrader-dual-btn red"
                  onClick={() => void handleExecuteTrade('DIGITDIFF')}
                >
                  <span className="btn-line-1">Differs</span>
                  <span className="btn-line-2">Payout ${payoutDiff.toFixed(2)} USD</span>
                </button>
              </div>
            ) : tradeCategory === 'digits' && digitSubtype === 'even_odd' ? (
              <button
                type="button"
                className={`dtrader-buy-action-btn ${digitType === 'DIGITEVEN' ? 'rise' : 'fall'}`}
                onClick={() => void handleExecuteTrade(digitType === 'DIGITEVEN' ? 'DIGITEVEN' : 'DIGITODD')}
              >
                <strong className="buy-headline">Buy</strong>
                <span className="buy-payout">
                  {digitType === 'DIGITEVEN' ? 'Even' : 'Odd'} · Payout ${payoutEven.toFixed(2)} USD
                </span>
              </button>
            ) : tradeCategory === 'growth' && growthType === 'multiplier' ? (
              <button
                type="button"
                className={`dtrader-buy-action-btn ${direction === 'CALL' ? 'rise' : 'fall'}`}
                onClick={() => void handleExecuteTrade(direction === 'CALL' ? 'MULTUP' : 'MULTDOWN')}
              >
                <strong className="buy-headline">Buy</strong>
                <span className="buy-payout">
                  {direction === 'CALL' ? 'Up' : 'Down'} · Multiplier ×{multiplier}
                </span>
              </button>
            ) : (
              /* Directional: Rise/Fall, Higher/Lower, Touch/No Touch — single large Buy button matching Deriv DTrader! */
              <button
                type="button"
                className={`dtrader-buy-action-btn ${direction === 'CALL' ? 'rise' : 'fall'}`}
                onClick={() => void handleExecuteTrade(direction)}
              >
                <strong className="buy-headline">Buy</strong>
                <span className="buy-payout">
                  Payout ${direction === 'CALL' ? payoutRise.toFixed(2) : payoutFall.toFixed(2)} USD
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Trade Type Selector Modal / Sheet ─────────────────────────── */}
      {showTradeTypeDropdown && (
        <div className="dtrader-modal-backdrop" onClick={() => setShowTradeTypeDropdown(false)}>
          <div className="dtrader-type-modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <h3>Select Trade Type</h3>
                <span className="modal-subtitle">Choose contract mechanics</span>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setShowTradeTypeDropdown(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="type-picker-body">
              {/* Category: Digits */}
              <div className="type-group-section">
                <div className="type-group-header">
                  <Hash size={14} />
                  <span>Digits</span>
                </div>
                <div className="type-options-grid">
                  <button
                    type="button"
                    className={`type-option-card ${tradeCategory === 'digits' && digitSubtype === 'over_under' ? 'selected' : ''}`}
                    onClick={() => {
                      setTradeCategory('digits');
                      setDigitSubtype('over_under');
                      setDigitType('DIGITOVER');
                      setShowTradeTypeDropdown(false);
                    }}
                  >
                    <div className="type-option-icon">{getTradeTypeIconComponent('over_under')}</div>
                    <div className="type-option-info">
                      <strong>Over/Under</strong>
                      <span>Predict if last digit is greater or less than target</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`type-option-card ${tradeCategory === 'digits' && digitSubtype === 'match_diff' ? 'selected' : ''}`}
                    onClick={() => {
                      setTradeCategory('digits');
                      setDigitSubtype('match_diff');
                      setDigitType('DIGITMATCH');
                      setShowTradeTypeDropdown(false);
                    }}
                  >
                    <div className="type-option-icon">{getTradeTypeIconComponent('match_diff')}</div>
                    <div className="type-option-info">
                      <strong>Matches/Differs</strong>
                      <span>Predict if last digit matches or differs from target</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`type-option-card ${tradeCategory === 'digits' && digitSubtype === 'even_odd' ? 'selected' : ''}`}
                    onClick={() => {
                      setTradeCategory('digits');
                      setDigitSubtype('even_odd');
                      setDigitType('DIGITEVEN');
                      setShowTradeTypeDropdown(false);
                    }}
                  >
                    <div className="type-option-icon">{getTradeTypeIconComponent('even_odd')}</div>
                    <div className="type-option-info">
                      <strong>Even/Odd</strong>
                      <span>Predict if exit tick digit is even or odd</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Category: Directional */}
              <div className="type-group-section">
                <div className="type-group-header">
                  <LineChartIcon size={14} />
                  <span>Directional</span>
                </div>
                <div className="type-options-grid">
                  <button
                    type="button"
                    className={`type-option-card ${tradeCategory === 'directional' && directionalType === 'rise_fall' ? 'selected' : ''}`}
                    onClick={() => {
                      setTradeCategory('directional');
                      setDirectionalType('rise_fall');
                      setShowTradeTypeDropdown(false);
                    }}
                  >
                    <div className="type-option-icon">{getTradeTypeIconComponent('rise_fall')}</div>
                    <div className="type-option-info">
                      <strong>Rise/Fall</strong>
                      <span>Predict if exit price is higher or lower than entry</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`type-option-card ${tradeCategory === 'directional' && directionalType === 'higher_lower' ? 'selected' : ''}`}
                    onClick={() => {
                      setTradeCategory('directional');
                      setDirectionalType('higher_lower');
                      setShowTradeTypeDropdown(false);
                    }}
                  >
                    <div className="type-option-icon">{getTradeTypeIconComponent('higher_lower')}</div>
                    <div className="type-option-info">
                      <strong>Higher/Lower</strong>
                      <span>Predict price above or below a barrier price</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`type-option-card ${tradeCategory === 'directional' && directionalType === 'touch_no_touch' ? 'selected' : ''}`}
                    onClick={() => {
                      setTradeCategory('directional');
                      setDirectionalType('touch_no_touch');
                      setShowTradeTypeDropdown(false);
                    }}
                  >
                    <div className="type-option-icon">{getTradeTypeIconComponent('touch_no_touch')}</div>
                    <div className="type-option-info">
                      <strong>Touch/No Touch</strong>
                      <span>Win if price touches or avoids a barrier</span>
                    </div>
                  </button>
                </div>
              </div>

              {/* Category: Growth */}
              <div className="type-group-section">
                <div className="type-group-header">
                  <span>🌱</span>
                  <span>Growth</span>
                </div>
                <div className="type-options-grid">
                  <button
                    type="button"
                    className={`type-option-card ${tradeCategory === 'growth' && growthType === 'accumulator' ? 'selected' : ''}`}
                    onClick={() => {
                      setTradeCategory('growth');
                      setGrowthType('accumulator');
                      setShowTradeTypeDropdown(false);
                    }}
                  >
                    <div className="type-option-icon">{getTradeTypeIconComponent('accumulator')}</div>
                    <div className="type-option-info">
                      <strong>Accumulators</strong>
                      <span>Stake grows each tick as price stays within range</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    className={`type-option-card ${tradeCategory === 'growth' && growthType === 'multiplier' ? 'selected' : ''}`}
                    onClick={() => {
                      setTradeCategory('growth');
                      setGrowthType('multiplier');
                      setShowTradeTypeDropdown(false);
                    }}
                  >
                    <div className="type-option-icon">{getTradeTypeIconComponent('multiplier')}</div>
                    <div className="type-option-info">
                      <strong>Multipliers</strong>
                      <span>Multiply profit/loss with leverage and risk controls</span>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* "How to trade" Modal */}
      {showHowToModal && (
        <div className="dtrader-modal-backdrop" onClick={() => setShowHowToModal(false)}>
          <div className="dtrader-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>How to trade {tradeLabelCurrent}?</h3>
              <button type="button" onClick={() => setShowHowToModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              {tradeCategory === 'digits' && digitSubtype === 'over_under' && (
                <>
                  <p>
                    <b>Over:</b> You win the payout if the last digit of the exit tick is strictly <b>greater than</b> your prediction digit ({digitBarrier}).
                  </p>
                  <p>
                    <b>Under:</b> You win the payout if the last digit of the exit tick is strictly <b>less than</b> your prediction digit ({digitBarrier}).
                  </p>
                  <p className="muted">
                    Contract runs for the specified ticks (default {durationTicks} ticks) and settles automatically with instant payout credit.
                  </p>
                </>
              )}
              {tradeCategory === 'digits' && digitSubtype === 'match_diff' && (
                <>
                  <p>
                    <b>Matches:</b> You win if the last digit of the exit tick <b>matches</b> your selected digit (up to 9× payout!).
                  </p>
                  <p>
                    <b>Differs:</b> You win if the last digit of the exit tick is <b>different from</b> your selected digit.
                  </p>
                  <p className="muted">
                    Instant settlement after {durationTicks} ticks with live Deriv verification.
                  </p>
                </>
              )}
              {tradeCategory === 'digits' && digitSubtype === 'even_odd' && (
                <>
                  <p>
                    <b>Even:</b> Win if the exit tick's last digit is 0, 2, 4, 6, or 8.
                  </p>
                  <p>
                    <b>Odd:</b> Win if the exit tick's last digit is 1, 3, 5, 7, or 9.
                  </p>
                  <p className="muted">
                    Fair 50/50 probability mechanism with standard binary payout.
                  </p>
                </>
              )}
              {tradeCategory === 'growth' && growthType === 'accumulator' && (
                <>
                  <p>
                    <b>Accumulators:</b> Your stake continuously compounds by {(growthRate * 100).toFixed(0)}% every tick as long as price stays inside the dynamic volatility corridor.
                  </p>
                  <p>
                    <b>Cash Out:</b> You can close your position at any time to lock in accumulated profits before a corridor breach.
                  </p>
                </>
              )}
              {tradeCategory === 'growth' && growthType === 'multiplier' && (
                <>
                  <p>
                    <b>Multipliers:</b> Amplifies returns by {multiplier}× leverage.
                  </p>
                  <p>
                    <b>Risk Protection:</b> Take Profit and Stop Loss limits safeguard your capital automatically.
                  </p>
                </>
              )}
              {tradeCategory === 'directional' && (
                <>
                  <p>
                    <b>Rise:</b> You win the payout if the exit tick is strictly higher than the entry tick.
                  </p>
                  <p>
                    <b>Fall:</b> You win the payout if the exit tick is strictly lower than the entry tick.
                  </p>
                  <p>
                    <b>Allow equals:</b> If enabled, you also win if the exit tick equals the entry tick (payout is slightly adjusted for the equal advantage).
                  </p>
                  <p className="muted">
                    Each trade settles automatically after {durationTicks} ticks with instant credit to your account.
                  </p>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="primary" onClick={() => setShowHowToModal(false)}>
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Full Instrument Panel ─────────────────────────────────────── */}
      {showInstrumentPanel && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          display: 'flex',
        }}>
          {/* Backdrop */}
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)' }}
            onClick={() => setShowInstrumentPanel(false)} />
          {/* Panel */}
          <div style={{
            position: 'relative', width: '100%', maxWidth: 560,
            background: '#0b1312', borderRight: '1px solid #1d2d29',
            display: 'flex', flexDirection: 'column', zIndex: 1,
            height: '100%', overflowY: 'auto', scrollbarWidth: 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #1d2d29' }}>
              <h2 style={{ margin: 0, fontSize: 14, color: '#e0f0ec', fontWeight: 700 }}>Select Market</h2>
              <button type='button' onClick={() => setShowInstrumentPanel(false)}
                style={{ background: 'none', border: 'none', color: '#718580', cursor: 'pointer', padding: 4 }}>
                <X size={18} />
              </button>
            </div>
            {derivConnected ? (
              <DerivInstruments
                selectedSymbol={selectedSymbolCode ?? (symbolMap[selectedInstrument] as string) ?? ''}
                timeframe={instrumentTimeframe}
                onTimeframeChange={setInstrumentTimeframe}
                derivConnected={derivConnected}
                onSelect={(sym, displayName) => {
                  setSelectedInstrument(displayName);
                  setSelectedSymbolCode(sym);
                  setShowInstrumentPanel(false);
                }}
              />
            ) : (
              /* Fallback: static list when not connected */
              <div style={{ padding: 16 }}>
                <div style={{ fontSize: 10, color: '#50b9a9', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>
                  Synthetic Volatility Indices
                </div>
                {Object.keys(symbolMap).map(name => (
                  <button key={name} type='button'
                    onClick={() => { setSelectedInstrument(name); setSelectedSymbolCode(null); setShowInstrumentPanel(false); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                      padding: '10px 12px', borderRadius: 8, marginBottom: 4, cursor: 'pointer',
                      background: selectedInstrument === name ? 'rgba(45,212,191,0.08)' : 'transparent',
                      border: `1px solid ${selectedInstrument === name ? 'rgba(45,212,191,0.3)' : '#1d2d29'}`,
                      color: selectedInstrument === name ? '#2dd4bf' : '#cde0da', fontSize: 12, textAlign: 'left',
                    }}>
                    <span style={{ width: 32, height: 32, borderRadius: 6, background: '#131f1d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#2dd4bf', flexShrink: 0 }}>
                      {name.replace('Volatility ', '').replace(' Index', '').replace('(1s)', '').trim().substring(0, 4)}
                    </span>
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
