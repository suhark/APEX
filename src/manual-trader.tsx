import { useState, useEffect, useMemo } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
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
} from 'lucide-react';

export interface ManualTraderProps {
  tick: number;
  runTrade: (details: { instrument: string; direction: string; stake: number; source: string }) => Promise<void>;
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
  const [showHowToModal, setShowHowToModal] = useState<boolean>(false);
  const [showInstrumentDropdown, setShowInstrumentDropdown] = useState<boolean>(false);
  const [chartType, setChartType] = useState<'area' | 'line'>('area');
  const [zoomLevel, setZoomLevel] = useState<number>(35); // number of visible ticks
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Active in-chart contract visualization
  const [activeContract, setActiveContract] = useState<ActiveContract | null>(null);

  // Tick series generation
  const [tickHistory, setTickHistory] = useState<TickPoint[]>([]);
  const config = INSTRUMENT_CONFIGS[selectedInstrument] || INSTRUMENT_CONFIGS['Volatility 100 Index'];

  // Initialize tick series on instrument switch
  useEffect(() => {
    const initialTicks: TickPoint[] = [];
    let currentQuote = config.basePrice;
    const now = Date.now();

    for (let i = 50; i >= 0; i--) {
      const delta = (Math.sin(i / 3) * 0.4 + (Math.random() - 0.48) * 0.8) * config.volatility;
      currentQuote = Number((currentQuote + delta).toFixed(2));
      const timeStr = new Date(now - i * 1500).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      const changePct = Number((((currentQuote - config.basePrice) / config.basePrice) * 100).toFixed(2));
      initialTicks.push({
        index: 50 - i,
        quote: currentQuote,
        time: timeStr,
        changePct,
      });
    }
    setTickHistory(initialTicks);
    setActiveContract(null);
  }, [selectedInstrument]);

  // Append new tick whenever parent `tick` increments
  useEffect(() => {
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

      const updated = [...prev.slice(-65), nextTick];

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
  }, [tick]);

  // Current live quote
  const currentTick = tickHistory[tickHistory.length - 1] || {
    quote: config.basePrice,
    changePct: 0.02,
    time: '11:36:23',
    index: 0,
  };

  // Slice visible ticks based on zoom level
  const visibleTicks = useMemo(() => {
    return tickHistory.slice(-zoomLevel);
  }, [tickHistory, zoomLevel]);

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
    const points = visibleTicks.map((t, idx) => {
      const x = (idx / (visibleTicks.length - 1)) * 98;
      const y = 62 - ((t.quote - minQ) / range) * 58;
      return { x, y, quote: t.quote, index: t.index };
    });

    const pathStr = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    const lastP = points[points.length - 1];
    const firstP = points[0];
    const fillStr = `${pathStr} L ${lastP.x.toFixed(2)} 65 L ${firstP.x.toFixed(2)} 65 Z`;

    const currentY = lastP ? lastP.y : 32;

    // Generate 5 evenly spaced right-axis price labels
    const yLabels = [0, 0.25, 0.5, 0.75, 1].map((pct) => {
      const price = minQ + range * pct;
      const yPos = 62 - pct * 58;
      return { price: price.toFixed(2), yPos };
    });

    return { pathStr, fillStr, minQ, maxQ, range, points, yLabels, currentY };
  }, [visibleTicks]);

  // Contract overlay coordinates
  const contractOverlay = useMemo(() => {
    if (!activeContract || !chartMath.points) return null;
    const contractPointIndices = new Set(activeContract.ticks.map((t) => t.tickIndex));
    const matchedPoints = chartMath.points.filter((p) => contractPointIndices.has(p.index));

    if (matchedPoints.length === 0) return null;

    const overlayPath = matchedPoints.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    const latestContractPt = matchedPoints[matchedPoints.length - 1];

    return {
      points: matchedPoints,
      path: overlayPath,
      latestPt: latestContractPt,
    };
  }, [activeContract, chartMath]);

  const payoutRate = allowEquals ? 1.74 : 1.9;
  const potentialPayout = Number((stake * payoutRate).toFixed(2));

  const handleBuy = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      // Start in-chart 5-tick contract tracking
      setActiveContract({
        id: String(Date.now()),
        direction,
        entryQuote: currentTick.quote,
        entryTickIndex: currentTick.index,
        currentTickCount: 1,
        totalTicks: durationTicks,
        stake,
        payout: potentialPayout,
        ticks: [{ quote: currentTick.quote, tickIndex: currentTick.index }],
        status: 'running',
      });

      await runTrade({
        instrument: selectedInstrument,
        direction,
        stake,
        source: 'manual',
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
            onClick={() => setShowInstrumentDropdown(!showInstrumentDropdown)}
            title="Choose Market / Asset"
          >
            <Plus size={16} />
          </button>

          <div className="dtrader-asset-picker">
            <button
              type="button"
              className="dtrader-asset-btn"
              onClick={() => setShowInstrumentDropdown(!showInstrumentDropdown)}
            >
              <div className="dtrader-asset-badge">
                <span>{config.badge}</span>
                <span className="sub">1s</span>
              </div>
              <div className="dtrader-asset-info">
                <strong>{selectedInstrument}</strong>
                <span className="dtrader-trade-type">
                  Rise/Fall <ChevronDown size={13} />
                </span>
              </div>
            </button>

            {showInstrumentDropdown && (
              <div className="dtrader-dropdown-menu">
                <div className="dtrader-dropdown-header">Synthetic Volatility Indices</div>
                {INSTRUMENT_LIST.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={`dtrader-dropdown-item ${selectedInstrument === name ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedInstrument(name);
                      setShowInstrumentDropdown(false);
                    }}
                  >
                    <span className="inst-badge">{INSTRUMENT_CONFIGS[name].badge}</span>
                    <span>{name}</span>
                  </button>
                ))}
              </div>
            )}
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
            <button type="button" className="dtrader-tool-btn" title="Drawing Tools">
              <Pencil size={15} />
            </button>
            <button type="button" className="dtrader-tool-btn" title="Technical Indicators">
              <Layers size={15} />
            </button>
          </div>

          {/* SVG Price Chart */}
          <div className="dtrader-svg-wrapper">
            <svg viewBox="0 0 100 65" preserveAspectRatio="none" className="dtrader-svg">
              <defs>
                <linearGradient id="dtraderAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.28" />
                  <stop offset="85%" stopColor="#2dd4bf" stopOpacity="0.04" />
                  <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Dotted Grid Lines */}
              {chartMath.yLabels.map((yl, i) => (
                <line
                  key={i}
                  x1="0"
                  y1={yl.yPos}
                  x2="98"
                  y2={yl.yPos}
                  stroke="#1e2d2a"
                  strokeWidth="0.4"
                  strokeDasharray="1.5 2"
                />
              ))}
              <line x1="25" y1="0" x2="25" y2="65" stroke="#162320" strokeWidth="0.4" strokeDasharray="2 3" />
              <line x1="50" y1="0" x2="50" y2="65" stroke="#162320" strokeWidth="0.4" strokeDasharray="2 3" />
              <line x1="75" y1="0" x2="75" y2="65" stroke="#162320" strokeWidth="0.4" strokeDasharray="2 3" />

              {/* Area Fill */}
              {chartType === 'area' && chartMath.fillStr && (
                <path d={chartMath.fillStr} fill="url(#dtraderAreaGrad)" />
              )}

              {/* Main Price Line */}
              {chartMath.pathStr && (
                <path
                  d={chartMath.pathStr}
                  fill="none"
                  stroke="#f1f5f9"
                  strokeWidth="1.1"
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
                    strokeLinecap="round"
                  />
                  {contractOverlay.points.map((pt, i) => (
                    <circle
                      key={i}
                      cx={pt.x}
                      cy={pt.y}
                      r="1.3"
                      fill={activeContract?.status === 'won' ? '#34d399' : '#2dd4bf'}
                      stroke="#07100f"
                      strokeWidth="0.5"
                    />
                  ))}
                </g>
              )}

              {/* Current Price Horizontal Extension Line */}
              <line
                x1="0"
                y1={chartMath.currentY}
                x2="98"
                y2={chartMath.currentY}
                stroke="#f87171"
                strokeWidth="0.5"
                strokeDasharray="2 2"
              />

              {/* Latest Spot Marker Dot */}
              <circle
                cx="98"
                cy={chartMath.currentY}
                r="1.8"
                fill="#f87171"
                stroke="#ffffff"
                strokeWidth="0.6"
              />
            </svg>

            {/* Floating Live Price Callout (just like the photo!) */}
            <div
              className="dtrader-floating-callout"
              style={{
                top: `${Math.max(12, Math.min(chartMath.currentY * 4.2 - 60, 220))}px`,
                right: '110px',
              }}
            >
              <div className={`callout-pct ${currentTick.changePct >= 0 ? 'positive' : 'negative'}`}>
                {currentTick.changePct >= 0 ? `+${currentTick.changePct}%` : `${currentTick.changePct}%`}
              </div>
              <div className="callout-price">{currentTick.quote.toFixed(2)}</div>
              <div className="callout-time">
                08 Sep 2026 {currentTick.time}
              </div>
              <div className="callout-crosshair" />
            </div>

            {/* In-Chart Contract Badge (e.g. 5/5 or 2/5) */}
            {activeContract && (
              <div
                className={`dtrader-tick-counter-badge ${activeContract.status}`}
                style={{
                  top: `${Math.max(20, chartMath.currentY * 4.2 - 25)}px`,
                  right: '180px',
                }}
              >
                <b>
                  {activeContract.currentTickCount}/{activeContract.totalTicks}
                </b>
                <span>
                  {activeContract.status === 'running'
                    ? 'ticks'
                    : activeContract.status === 'won'
                    ? 'WON'
                    : 'LOST'}
                </span>
              </div>
            )}

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
                className="dtrader-live-price-badge"
                style={{ top: `${(chartMath.currentY / 65) * 100}%` }}
              >
                <span className="badge-dot" />
                <b>{currentTick.quote.toFixed(2)}</b>
              </div>
            </div>
          </div>

          {/* Bottom Zoom / Navigation Controls */}
          <div className="dtrader-bottom-controls">
            <div className="dtrader-zoom-pill">
              <button
                type="button"
                className="zoom-btn"
                onClick={() => setZoomLevel((z) => Math.min(60, z + 8))}
                title="Zoom Out"
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                className="zoom-btn"
                onClick={() => setZoomLevel(35)}
                title="Recenter Chart"
              >
                <Crosshair size={14} />
              </button>
              <button
                type="button"
                className="zoom-btn"
                onClick={() => setZoomLevel((z) => Math.max(18, z - 8))}
                title="Zoom In"
              >
                <Plus size={14} />
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

          {/* Direction Tabs (Rise / Fall) */}
          <div className="dtrader-direction-tabs">
            <button
              type="button"
              className={`direction-tab rise ${direction === 'CALL' ? 'active' : ''}`}
              onClick={() => setDirection('CALL')}
            >
              <ArrowUp size={16} />
              <span>Rise</span>
            </button>
            <button
              type="button"
              className={`direction-tab fall ${direction === 'PUT' ? 'active' : ''}`}
              onClick={() => setDirection('PUT')}
            >
              <ArrowDown size={16} />
              <span>Fall</span>
            </button>
          </div>

          {/* Duration Card */}
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

          {/* Allow Equals Toggle */}
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

          {/* Big Buy Action Button */}
          <button
            type="button"
            className={`dtrader-buy-action-btn ${direction === 'CALL' ? 'rise' : 'fall'}`}
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
                <strong className="buy-headline">
                  Buy {direction === 'CALL' ? 'Rise' : 'Fall'}
                </strong>
                <span className="buy-payout">
                  Payout <b>${potentialPayout.toFixed(2)}</b>
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
    </div>
  );
}
