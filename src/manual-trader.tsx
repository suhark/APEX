import { useState, useEffect, useMemo, useRef } from 'react';
import { subscribeTicks, symbolMap, getTicksHistory, type DerivTick } from './deriv-client';
import { DerivInstruments } from './deriv-instruments';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  HelpCircle,
  Info,
  Layers,
  LineChart as LineChartIcon,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export interface ManualTraderProps {
  tick: number;
  runTrade: (details: { instrument: string; direction: string; stake: number; source: string; barrier?: number; growth_rate?: number; duration?: number }) => Promise<void>;
  derivConnected: boolean;
  isDerivReal: boolean;
  derivAccount: { loginid: string; balance: number; is_virtual: boolean; currency?: string } | null;
  workspaceBalance: number;
  onSwitchAccount?: (loginid: string) => void;
  linkedRealAccount?: { loginid: string; balance: number; currency: string };
  linkedDemoAccount?: { loginid: string; balance: number; currency: string };
}

interface TickPoint {
  index: number;
  quote: number;
  time: string;
  changePct: number;
}

interface ActiveContract {
  id: string;
  direction: 'CALL' | 'PUT';
  entryQuote: number;
  entryTickIndex: number;
  currentTickCount: number;
  totalTicks: number;
  stake: number;
  payout: number;
  ticks: Array<{ quote: number; tickIndex: number }>;
  status: 'running' | 'won' | 'lost';
}

const INSTRUMENT_CONFIGS: Record<string, { badge: string; basePrice: number; volatility: number }> = {
  'Volatility 100 Index': { badge: '100', basePrice: 927.0, volatility: 0.75 },
  'Volatility 75 Index': { badge: '75', basePrice: 785.0, volatility: 0.65 },
  'Volatility 50 Index': { badge: '50', basePrice: 512.0, volatility: 0.5 },
  'Volatility 25 Index': { badge: '25', basePrice: 342.0, volatility: 0.35 },
  'Volatility 10 Index': { badge: '10', basePrice: 128.0, volatility: 0.2 },
};

// ─── Trade type definitions ────────────────────────────────────────────────────
type TradeCategory = 'directional' | 'growth' | 'digits';

// Directional subtypes
type DirectionalType = 'rise_fall' | 'higher_lower' | 'touch_no_touch';
const DIRECTIONAL_TYPES: { key: DirectionalType; label: string; desc: string }[] = [
  { key: 'rise_fall',      label: 'Rise/Fall',       desc: 'Win if exit price is higher/lower than entry' },
  { key: 'higher_lower',   label: 'Higher/Lower',    desc: 'Win if price is higher/lower than a set barrier' },
  { key: 'touch_no_touch', label: 'Touch/No Touch',  desc: 'Win if price touches or never touches a barrier' },
];

// Growth subtypes
type GrowthType = 'accumulator' | 'multiplier';
const GROWTH_TYPES: { key: GrowthType; label: string; desc: string }[] = [
  { key: 'accumulator', label: 'Accumulators', desc: 'Stake grows each tick if price stays within range' },
  { key: 'multiplier',  label: 'Multipliers',  desc: 'Multiply profit/loss with leverage, stop loss/take profit' },
];

const TRADE_CATEGORIES: { key: TradeCategory; label: string; icon: string }[] = [
  { key: 'directional', label: 'Directional', icon: '📈' },
  { key: 'growth',      label: 'Growth',      icon: '🌱' },
  { key: 'digits',      label: 'Digits',      icon: '🔢' },
];

type DigitContractType = 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';

const DIGIT_TYPES: { type: DigitContractType; label: string; needsBarrier: boolean; color: string }[] = [
  { type: 'DIGITEVEN',  label: 'Even',    needsBarrier: false, color: '#2dd4bf' },
  { type: 'DIGITODD',   label: 'Odd',     needsBarrier: false, color: '#f87171' },
  { type: 'DIGITOVER',  label: 'Over',    needsBarrier: true,  color: '#f97316' },
  { type: 'DIGITUNDER', label: 'Under',   needsBarrier: true,  color: '#3b82f6' },
  { type: 'DIGITMATCH', label: 'Matches', needsBarrier: true,  color: '#a78bfa' },
  { type: 'DIGITDIFF',  label: 'Differs', needsBarrier: true,  color: '#fbbf24' },
];

const INSTRUMENT_LIST = Object.keys(INSTRUMENT_CONFIGS);

function formatCurrency(val: number): string {
  return `${val < 0 ? '-' : ''}$${Math.abs(val).toFixed(2)}`;
}

export function ManualTrader({
  tick,
  runTrade,
  derivConnected,
  isDerivReal,
  derivAccount,
  workspaceBalance,
  onSwitchAccount,
  linkedRealAccount,
  linkedDemoAccount,
}: ManualTraderProps) {
  const [selectedInstrument, setSelectedInstrument] = useState<string>('Volatility 100 Index');
  const [direction, setDirection] = useState<'CALL' | 'PUT'>('CALL'); // CALL = Rise, PUT = Fall
  const [stake, setStake] = useState<number>(2);
  const [durationTicks, setDurationTicks] = useState<number>(5);
  const [allowEquals, setAllowEquals] = useState<boolean>(false);

  // Trade type state
  const [tradeCategory, setTradeCategory] = useState<TradeCategory>('directional');
  const [directionalType, setDirectionalType] = useState<DirectionalType>('rise_fall');
  const [growthType, setGrowthType] = useState<GrowthType>('accumulator');
  const [digitType, setDigitType] = useState<DigitContractType>('DIGITEVEN');
  const [digitBarrier, setDigitBarrier] = useState<number>(5);
  const [growthRate, setGrowthRate] = useState<number>(0.01);
  const [multiplier, setMultiplier] = useState<number>(10);
  const [stopLoss, setStopLoss] = useState<number>(10);
  const [takeProfit, setTakeProfit] = useState<number>(10);
  const [barrier, setBarrier] = useState<string>('1234.56'); // Higher/Lower / Touch barrier
  const [showHowToModal, setShowHowToModal] = useState<boolean>(false);
  const [showInstrumentDropdown, setShowInstrumentDropdown] = useState<boolean>(false);
  const [chartType, setChartType] = useState<'area' | 'line'>('area');
  const [zoomLevel, setZoomLevel] = useState<number>(35); // number of visible ticks
  const [showZoomPill, setShowZoomPill] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

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

  // Tick series generation
  const [tickHistory, setTickHistory] = useState<TickPoint[]>([]);
  const config = INSTRUMENT_CONFIGS[selectedInstrument] || INSTRUMENT_CONFIGS['Volatility 100 Index'];
  const tickHistoryRef = useRef<TickPoint[]>([]);
  const realTickUnsubRef = useRef<(() => void) | null>(null);
  const [showInstrumentPanel, setShowInstrumentPanel] = useState(false);
  const [instrumentTimeframe, setInstrumentTimeframe] = useState<'1m' | '5m' | '15m' | '1h'>('5m');

  // ── Tick feed: real when Deriv connected, synthetic fallback ─────────────
  useEffect(() => {
    // Clean up previous real subscription
    if (realTickUnsubRef.current) { realTickUnsubRef.current(); realTickUnsubRef.current = null; }

    const derivSymbol = symbolMap[selectedInstrument] as string | undefined;

    if (derivConnected && derivSymbol) {
      // Seed with real tick history first
      let cancelled = false;
      getTicksHistory(derivSymbol, 300).then(hist => {
        if (cancelled) return;
        const now = Date.now();
        const ticks: TickPoint[] = hist.prices.map((q, i) => ({
          index: i,
          quote: q,
          time: new Date(now - (hist.prices.length - 1 - i) * 1500).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
          changePct: hist.prices[0] ? Number((((q - hist.prices[0]) / hist.prices[0]) * 100).toFixed(2)) : 0,
        }));
        tickHistoryRef.current = ticks;
        setTickHistory(ticks);
      }).catch(() => {});

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
          const nextTicks = [...prevAc.ticks, { quote: t.quote, tickIndex: nextTick.index }];
          if (nextTicks.length >= prevAc.totalTicks) {
            const won = prevAc.direction === 'CALL'
              ? (allowEquals ? t.quote >= prevAc.entryQuote : t.quote > prevAc.entryQuote)
              : (allowEquals ? t.quote <= prevAc.entryQuote : t.quote < prevAc.entryQuote);
            return { ...prevAc, currentTickCount: prevAc.totalTicks, ticks: nextTicks, status: won ? 'won' : 'lost' };
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
  }, [selectedInstrument, derivConnected]);

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
        const nextContractTicks = [...activeContract.ticks, { quote: nextQuote, tickIndex: nextTick.index }];
        const count = nextContractTicks.length;

        if (count >= activeContract.totalTicks) {
          // Settle contract
          const finalSpot = nextQuote;
          const won =
            activeContract.direction === 'CALL'
              ? allowEquals
                ? finalSpot >= activeContract.entryQuote
                : finalSpot > activeContract.entryQuote
              : allowEquals
              ? finalSpot <= activeContract.entryQuote
              : finalSpot < activeContract.entryQuote;

          setActiveContract({
            ...activeContract,
            currentTickCount: activeContract.totalTicks,
            ticks: nextContractTicks,
            status: won ? 'won' : 'lost',
          });
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
  const currentTick = tickHistory[tickHistory.length - 1] || {
    quote: config.basePrice,
    changePct: 0.02,
    time: '11:36:23',
    index: 0,
  };

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

  const payoutRate = allowEquals ? 1.74 : 1.9;
  const potentialPayout = Number((stake * payoutRate).toFixed(2));

  const digitMeta = DIGIT_TYPES.find(d => d.type === digitType)!;
  const tradeLabel = tradeCategory === 'digits'
    ? `${digitMeta.label}${digitMeta.needsBarrier ? ` ${digitBarrier}` : ''}`
    : tradeCategory === 'growth'
    ? growthType === 'accumulator' ? 'Accumulate' : `Multiply ×${multiplier}`
    : directionalType === 'touch_no_touch'
    ? direction === 'CALL' ? 'Touch' : 'No Touch'
    : directionalType === 'higher_lower'
    ? direction === 'CALL' ? 'Higher' : 'Lower'
    : direction === 'CALL' ? 'Rise' : 'Fall';

  const tradeBtnColor = tradeCategory === 'digits' ? 'digit'
    : tradeCategory === 'growth' ? 'accu'
    : direction === 'CALL' ? 'rise' : 'fall';

  const handleBuy = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      let contractDirection = direction;
      let contractBarrier: number | undefined;
      let growth_rate: number | undefined;
      let duration: number | undefined;

      if (tradeCategory === 'digits') {
        contractDirection = digitType;
        contractBarrier = digitMeta.needsBarrier ? digitBarrier : undefined;
        duration = durationTicks;
      } else if (tradeCategory === 'growth') {
        if (growthType === 'accumulator') {
          contractDirection = 'ACCU';
          growth_rate = growthRate;
          duration = undefined;
        } else {
          // Multiplier: MULTUP / MULTDOWN
          contractDirection = direction === 'CALL' ? 'MULTUP' : 'MULTDOWN';
          duration = undefined;
        }
      } else {
        // Directional
        if (directionalType === 'touch_no_touch') {
          contractDirection = direction === 'CALL' ? 'ONETOUCH' : 'NOTOUCH';
        } else {
          // rise_fall and higher_lower both use CALL/PUT — higher_lower just adds a barrier
          contractDirection = direction;
        }
        duration = durationTicks;
      }

      setActiveContract({
        id: String(Date.now()),
        direction: (contractDirection === 'CALL' || contractDirection === 'PUT') ? contractDirection : 'CALL',
        entryQuote: currentTick.quote,
        entryTickIndex: currentTick.index,
        currentTickCount: 1,
        totalTicks: tradeCategory === 'growth' ? 999 : durationTicks,
        stake,
        payout: potentialPayout,
        ticks: [{ quote: currentTick.quote, tickIndex: currentTick.index }],
        status: 'running',
      });

      await runTrade({
        instrument: selectedInstrument,
        direction: contractDirection,
        stake,
        source: 'manual',
        barrier: contractBarrier,
        growth_rate,
        duration,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeBalance = derivConnected && derivAccount ? derivAccount.balance : workspaceBalance;
  const activeCurrency = derivConnected && derivAccount ? derivAccount.currency : 'USD';
  const isDemo = !derivConnected || Boolean(derivAccount?.is_virtual);

  return (
    <div className="dtrader-container">
      {/* Top Asset & Account Bar */}
      <div className="dtrader-topbar">
        <div className="dtrader-topbar-left">
          <button
            type="button"
            className="dtrader-add-btn"
            onClick={() => setShowInstrumentPanel(!showInstrumentPanel)}
            title="Choose Market / Asset"
          >
            <Plus size={16} />
          </button>

          <div className="dtrader-asset-picker">
            <button
              type="button"
              className="dtrader-asset-btn"
              onClick={() => setShowInstrumentPanel(!showInstrumentPanel)}
            >
              <div className="dtrader-asset-badge">
                <span>{selectedInstrument.replace('Volatility ', '').replace(' Index', '').replace('(1s)', '1s').substring(0, 5)}</span>
                <span className="sub">1s</span>
              </div>
              <div className="dtrader-asset-info">
                <strong>{selectedInstrument}</strong>
                <span className="dtrader-trade-type">
                  {tradeCategory === 'directional' ? 'Rise/Fall' : tradeCategory === 'growth' ? 'Accumulator' : 'Digits'} <ChevronDown size={13} />
                </span>
              </div>
            </button>
          </div>
        </div>

        <div className="dtrader-topbar-right">
          <div className="dtrader-account-card">
            <span className={`dtrader-acc-type ${isDemo ? 'demo' : 'real'}`}>
              {isDemo ? 'Demo account' : 'Real account'}
            </span>
            <strong className="dtrader-acc-balance">
              {formatCurrency(activeBalance).replace('$', '')} {activeCurrency}
            </strong>
          </div>

          {isDemo && linkedRealAccount && onSwitchAccount && (
            <button
              type="button"
              className="dtrader-switch-real-btn"
              onClick={() => onSwitchAccount(linkedRealAccount.loginid)}
              title="Switch to Real Account"
            >
              Try real
            </button>
          )}

          {!isDemo && linkedDemoAccount && onSwitchAccount && (
            <button
              type="button"
              className="dtrader-switch-demo-btn"
              onClick={() => onSwitchAccount(linkedDemoAccount.loginid)}
              title="Switch to Demo Account"
            >
              Use demo
            </button>
          )}
        </div>
      </div>

      {/* Main Terminal Body: Chart + Ticket */}
      <div className="dtrader-grid">
        {/* Left / Center Financial Chart */}
        <div className="dtrader-chart-panel">
          {/* Chart Header Overlay */}
          <div className="dtrader-chart-header">
            <div className="dtrader-chart-title">
              <span className="market-live-dot" />
              <span>Tick Feed</span>
              <b>1 tick = 1.5s</b>
            </div>
            <div className="dtrader-chart-spot">
              <span>Spot:</span>
              <strong>{currentTick.quote.toFixed(2)}</strong>
              <em className={currentTick.changePct >= 0 ? 'positive' : 'negative'}>
                {currentTick.changePct >= 0 ? `+${currentTick.changePct}%` : `${currentTick.changePct}%`}
              </em>
            </div>
          </div>

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
            <svg viewBox="0 0 100 65" preserveAspectRatio="none" className="dtrader-svg">
              <defs>
                <linearGradient id="dtraderAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.22" />
                  <stop offset="65%" stopColor="#2dd4bf" stopOpacity="0.04" />
                  <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
                </linearGradient>
                <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="0" stdDeviation="0.4" floodColor="#2dd4bf" floodOpacity="0.4" />
                </filter>
              </defs>

              {/* Dotted Grid Lines */}
              {chartMath.yLabels.map((yl, i) => (
                <line
                  key={i}
                  x1="0"
                  y1={yl.yPos}
                  x2="100"
                  y2={yl.yPos}
                  stroke="#162824"
                  strokeWidth="0.75"
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray="2 3"
                />
              ))}
              <line x1="20" y1="0" x2="20" y2="65" stroke="#13231f" strokeWidth="0.75" vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />
              <line x1="40" y1="0" x2="40" y2="65" stroke="#13231f" strokeWidth="0.75" vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />
              <line x1="60" y1="0" x2="60" y2="65" stroke="#13231f" strokeWidth="0.75" vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />
              <line x1="80" y1="0" x2="80" y2="65" stroke="#13231f" strokeWidth="0.75" vectorEffect="non-scaling-stroke" strokeDasharray="2 3" />

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

            {/* Floating Live Price Callout (aligned neatly without covering chart waves) */}
            <div className="dtrader-floating-callout">
              <div className={`callout-pct ${currentTick.changePct >= 0 ? 'positive' : 'negative'}`}>
                {scrollOffset > 0 ? `Past: -${scrollOffset}t` : currentTick.changePct >= 0 ? `+${currentTick.changePct}%` : `${currentTick.changePct}%`}
              </div>
              <div className="callout-price">
                {scrollOffset > 0 && visibleTicks.length > 0 ? visibleTicks[visibleTicks.length - 1].quote.toFixed(2) : currentTick.quote.toFixed(2)}
              </div>
              <div className="callout-time">
                {scrollOffset > 0 && visibleTicks.length > 0 ? visibleTicks[visibleTicks.length - 1].time : currentTick.time}
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
                <b>{scrollOffset > 0 && visibleTicks.length > 0 ? visibleTicks[visibleTicks.length - 1].quote.toFixed(2) : currentTick.quote.toFixed(2)}</b>
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
        </div>

        {/* Right Execution Ticket Panel */}
        <div className="dtrader-ticket-panel">
          {/* Header Link */}
          <div className="dtrader-ticket-top">
            <button
              type="button"
              className="dtrader-help-link"
              onClick={() => setShowHowToModal(true)}
            >
              <span>How to trade Rise/Fall?</span>
              <HelpCircle size={14} />
            </button>
          </div>

          {/* ── Trade Category Selector ── */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
            {TRADE_CATEGORIES.map(cat => (
              <button key={cat.key} type="button"
                onClick={() => setTradeCategory(cat.key)}
                style={{
                  flex: 1, padding: '7px 4px', borderRadius: 7, fontSize: 10, fontWeight: 700,
                  cursor: 'pointer', border: `1px solid ${tradeCategory === cat.key ? '#2dd4bf' : '#1d2d29'}`,
                  background: tradeCategory === cat.key ? '#0d2e29' : 'transparent',
                  color: tradeCategory === cat.key ? '#2dd4bf' : '#718580',
                  transition: 'all 0.15s',
                }}>
                {cat.icon} {cat.label}
              </button>
            ))}
          </div>

          {/* ── Directional sub-type ── */}
          {tradeCategory === 'directional' && (
            <div style={{ marginBottom: 10 }}>
              {/* Sub-type selector */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {DIRECTIONAL_TYPES.map(dt => (
                  <button key={dt.key} type="button"
                    onClick={() => setDirectionalType(dt.key)}
                    style={{
                      flex: 1, padding: '5px 3px', borderRadius: 6, fontSize: 9, fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${directionalType === dt.key ? '#2dd4bf' : '#1d2d29'}`,
                      background: directionalType === dt.key ? '#0d2e29' : 'transparent',
                      color: directionalType === dt.key ? '#2dd4bf' : '#718580',
                    }}>{dt.label}</button>
                ))}
              </div>

              {/* Rise/Fall */}
              {directionalType === 'rise_fall' && (
                <div className="dtrader-direction-tabs">
                  <button type="button" className={`direction-tab rise ${direction === 'CALL' ? 'active' : ''}`} onClick={() => setDirection('CALL')}>
                    <ArrowUp size={16} /><span>Rise</span>
                  </button>
                  <button type="button" className={`direction-tab fall ${direction === 'PUT' ? 'active' : ''}`} onClick={() => setDirection('PUT')}>
                    <ArrowDown size={16} /><span>Fall</span>
                  </button>
                </div>
              )}

              {/* Higher/Lower */}
              {directionalType === 'higher_lower' && (
                <>
                  <div className="dtrader-direction-tabs">
                    <button type="button" className={`direction-tab rise ${direction === 'CALL' ? 'active' : ''}`} onClick={() => setDirection('CALL')}>
                      <ArrowUp size={16} /><span>Higher</span>
                    </button>
                    <button type="button" className={`direction-tab fall ${direction === 'PUT' ? 'active' : ''}`} onClick={() => setDirection('PUT')}>
                      <ArrowDown size={16} /><span>Lower</span>
                    </button>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: '#80948e', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Barrier</div>
                    <input type="text" value={barrier} onChange={e => setBarrier(e.target.value)}
                      placeholder="e.g. 1234.56"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: '#0b1918', border: '1px solid #1d2d29', borderRadius: 6, color: '#e0f0ec', fontSize: 12, fontFamily: "'DM Mono', monospace", outline: 'none' }} />
                    <p style={{ fontSize: 10, color: '#4a6a62', marginTop: 4 }}>Win if exit price is higher/lower than this barrier.</p>
                  </div>
                </>
              )}

              {/* Touch/No Touch */}
              {directionalType === 'touch_no_touch' && (
                <>
                  <div className="dtrader-direction-tabs">
                    <button type="button" className={`direction-tab rise ${direction === 'CALL' ? 'active' : ''}`} onClick={() => setDirection('CALL')}>
                      <span>Touch</span>
                    </button>
                    <button type="button" className={`direction-tab fall ${direction === 'PUT' ? 'active' : ''}`} onClick={() => setDirection('PUT')}>
                      <span>No Touch</span>
                    </button>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: '#80948e', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Barrier</div>
                    <input type="text" value={barrier} onChange={e => setBarrier(e.target.value)}
                      placeholder="e.g. 1234.56"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', background: '#0b1918', border: '1px solid #1d2d29', borderRadius: 6, color: '#e0f0ec', fontSize: 12, fontFamily: "'DM Mono', monospace", outline: 'none' }} />
                    <p style={{ fontSize: 10, color: '#4a6a62', marginTop: 4 }}>Win if price {direction === 'CALL' ? 'touches' : 'never touches'} this barrier before expiry.</p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Growth based ── */}
          {tradeCategory === 'growth' && (
            <div style={{ marginBottom: 8 }}>
              {/* Sub-type: Accumulator / Multiplier */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {GROWTH_TYPES.map(gt => (
                  <button key={gt.key} type="button"
                    onClick={() => setGrowthType(gt.key)}
                    style={{
                      flex: 1, padding: '6px 4px', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${growthType === gt.key ? '#22c55e' : '#1d2d29'}`,
                      background: growthType === gt.key ? 'rgba(34,197,94,0.08)' : 'transparent',
                      color: growthType === gt.key ? '#22c55e' : '#718580',
                    }}>{gt.label}</button>
                ))}
              </div>

              {/* Accumulator controls */}
              {growthType === 'accumulator' && (
                <>
                  <div style={{ fontSize: 11, color: '#80948e', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Growth rate</div>
                  <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                    {[0.01, 0.02, 0.03, 0.04, 0.05].map(r => (
                      <button key={r} type="button" onClick={() => setGrowthRate(r)}
                        style={{ padding: '6px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer', border: `1px solid ${growthRate === r ? '#22c55e' : '#1d2d29'}`, background: growthRate === r ? 'rgba(34,197,94,0.1)' : 'transparent', color: growthRate === r ? '#22c55e' : '#718580', fontWeight: 700 }}>
                        {(r * 100).toFixed(0)}%
                      </button>
                    ))}
                  </div>
                  <p style={{ fontSize: 10, color: '#4a6a62', marginTop: 6, lineHeight: 1.5 }}>Stake grows by selected % each tick while price stays in range.</p>
                </>
              )}

              {/* Multiplier controls */}
              {growthType === 'multiplier' && (
                <>
                  <div className="dtrader-direction-tabs">
                    <button type="button" className={`direction-tab rise ${direction === 'CALL' ? 'active' : ''}`} onClick={() => setDirection('CALL')}>
                      <ArrowUp size={16} /><span>Up</span>
                    </button>
                    <button type="button" className={`direction-tab fall ${direction === 'PUT' ? 'active' : ''}`} onClick={() => setDirection('PUT')}>
                      <ArrowDown size={16} /><span>Down</span>
                    </button>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: '#80948e', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Multiplier</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
                      {[10, 20, 30, 40, 50].map(m => (
                        <button key={m} type="button" onClick={() => setMultiplier(m)}
                          style={{ padding: '5px 10px', borderRadius: 5, fontSize: 11, cursor: 'pointer', border: `1px solid ${multiplier === m ? '#22c55e' : '#1d2d29'}`, background: multiplier === m ? 'rgba(34,197,94,0.1)' : 'transparent', color: multiplier === m ? '#22c55e' : '#718580', fontWeight: 700 }}>
                          ×{m}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <div style={{ fontSize: 10, color: '#80948e', marginBottom: 4, fontWeight: 600 }}>Stop loss ($)</div>
                        <input type="number" min={0} value={stopLoss} onChange={e => setStopLoss(Number(e.target.value))}
                          style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px', background: '#0b1918', border: '1px solid #1d2d29', borderRadius: 6, color: '#e0f0ec', fontSize: 12, fontFamily: "'DM Mono', monospace", outline: 'none' }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 10, color: '#80948e', marginBottom: 4, fontWeight: 600 }}>Take profit ($)</div>
                        <input type="number" min={0} value={takeProfit} onChange={e => setTakeProfit(Number(e.target.value))}
                          style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px', background: '#0b1918', border: '1px solid #1d2d29', borderRadius: 6, color: '#e0f0ec', fontSize: 12, fontFamily: "'DM Mono', monospace", outline: 'none' }} />
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Digit based ── */}
          {tradeCategory === 'digits' && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5, marginBottom: 8 }}>
                {DIGIT_TYPES.map(dt => (
                  <button key={dt.type} type="button" onClick={() => setDigitType(dt.type)}
                    style={{ padding: '7px 4px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: `1px solid ${digitType === dt.type ? dt.color : '#1d2d29'}`, background: digitType === dt.type ? 'rgba(255,255,255,0.04)' : 'transparent', color: digitType === dt.type ? dt.color : '#718580', transition: 'all 0.15s' }}>
                    {dt.label}
                  </button>
                ))}
              </div>
              {digitMeta.needsBarrier && (
                <div>
                  <div style={{ fontSize: 11, color: '#80948e', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {digitType === 'DIGITOVER' ? 'Over digit' : digitType === 'DIGITUNDER' ? 'Under digit' : 'Digit'}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {[0,1,2,3,4,5,6,7,8,9].map(d => (
                      <button key={d} type="button" onClick={() => setDigitBarrier(d)}
                        style={{ width: 28, height: 28, borderRadius: 5, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: "'DM Mono', monospace", border: `1px solid ${digitBarrier === d ? digitMeta.color : '#1d2d29'}`, background: digitBarrier === d ? 'rgba(167,139,250,0.12)' : 'transparent', color: digitBarrier === d ? digitMeta.color : '#718580' }}>
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Duration Card — hidden for Accumulators */}
          {tradeCategory !== 'growth' && (
          <div className="dtrader-card-field">
            <span className="field-label">Duration</span>
            <div className="field-input-row">
              <input
                type="number"
                min="1"
                max="60"
                value={durationTicks}
                onChange={(e) => setDurationTicks(Math.max(1, Number(e.target.value)))}
              />
              <span className="field-unit">ticks</span>
            </div>
            <div className="quick-ticks-row">
              {[5, 10, 15].map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`mini-pill ${durationTicks === t ? 'active' : ''}`}
                  onClick={() => setDurationTicks(t)}
                >
                  {t}t
                </button>
              ))}
            </div>
          </div>
          )}

          {/* Stake Card */}
          <div className="dtrader-card-field">
            <span className="field-label">Stake</span>
            <div className="field-input-row">
              <span className="field-currency">$</span>
              <input
                type="number"
                min="0.35"
                step="1"
                value={stake}
                onChange={(e) => setStake(Math.max(0.35, Number(e.target.value)))}
              />
            </div>
            <div className="quick-stake-row">
              {[1, 2, 5, 10, 25].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className={`mini-pill ${stake === amt ? 'active' : ''}`}
                  onClick={() => setStake(amt)}
                >
                  ${amt}
                </button>
              ))}
            </div>
          </div>

          {/* Allow Equals Toggle — directional only */}
          {tradeCategory === 'directional' && (
          <div className="dtrader-toggle-field">
            <div className="toggle-label-wrap">
              <span className="toggle-title">Allow equals</span>
              <small>Win even if exit spot equals entry spot</small>
            </div>
            <label className="dtrader-switch">
              <input
                type="checkbox"
                checked={allowEquals}
                onChange={(e) => setAllowEquals(e.target.checked)}
              />
              <span className="slider" />
            </label>
          </div>
          )}

          {/* Big Buy Action Button */}
          <button
            type="button"
            className={`dtrader-buy-action-btn ${tradeBtnColor}`}
            disabled={isSubmitting || (activeContract !== null && activeContract.status === 'running')}
            onClick={() => void handleBuy()}
          >
            {isSubmitting ? (
              <span className="buy-loading">
                <RefreshCw size={18} className="spin" />
                Purchasing contract…
              </span>
            ) : (
              <>
                <strong className="buy-headline">Buy {tradeLabel}</strong>
                <span className="buy-payout">
                  {tradeCategory === 'growth' ? `Growth ${(growthRate * 100).toFixed(0)}% / tick` : `Payout \$${potentialPayout.toFixed(2)}`}
                </span>
              </>
            )}
          </button>

          {/* Active Contract Status Card */}
          {activeContract && (
            <div className={`contract-status-card ${activeContract.status}`}>
              <div className="contract-status-header">
                <span>
                  {activeContract.status === 'running'
                    ? 'Contract in Progress'
                    : activeContract.status === 'won'
                    ? '🎉 Contract Won!'
                    : '📉 Contract Lost'}
                </span>
                <b>
                  {activeContract.currentTickCount}/{activeContract.totalTicks} ticks
                </b>
              </div>
              <div className="contract-status-body">
                <div>
                  <small>Entry Quote</small>
                  <strong>{activeContract.entryQuote.toFixed(2)}</strong>
                </div>
                <div>
                  <small>Current</small>
                  <strong>{currentTick.quote.toFixed(2)}</strong>
                </div>
                <div>
                  <small>Payout</small>
                  <strong className={activeContract.status === 'won' ? 'positive' : ''}>
                    ${activeContract.payout.toFixed(2)}
                  </strong>
                </div>
              </div>
            </div>
          )}

          <div className="dtrader-ticket-footer">
            <Info size={13} />
            <span>
              {derivConnected
                ? `Trades execute live on Deriv (${derivAccount?.loginid || 'Deriv'}).`
                : 'Demo simulation mode active. Connect Deriv for broker execution.'}
            </span>
          </div>
        </div>
      </div>

      {/* "How to trade Rise/Fall" Modal */}
      {showHowToModal && (
        <div className="dtrader-modal-backdrop" onClick={() => setShowHowToModal(false)}>
          <div className="dtrader-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>How to trade Rise/Fall?</h3>
              <button type="button" onClick={() => setShowHowToModal(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
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
                Each trade settles automatically after 5 ticks (approx. 7.5 seconds) with instant credit to your account.
              </p>
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
            height: '100%', overflowY: 'auto',
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
                selectedSymbol={symbolMap[selectedInstrument] as string ?? ''}
                timeframe={instrumentTimeframe}
                onTimeframeChange={setInstrumentTimeframe}
                onSelect={(sym, displayName) => {
                  setSelectedInstrument(displayName);
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
                    onClick={() => { setSelectedInstrument(name); setShowInstrumentPanel(false); }}
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
