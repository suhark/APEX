/**
 * DerivInstruments — real instrument list with live prices and price change indicators
 * Fetches active_symbols from Deriv API and shows mini sparkline charts with % change.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { getActiveSymbols, getTicksHistory, subscribeTicks, type ActiveSymbol, type DerivTick } from './deriv-client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InstrumentInfo {
  symbol: string;
  display_name: string;
  submarket: string;
  submarket_display_name: string;
  spot: number;
  pip: number;
  exchange_is_open: boolean;
  is_trading_suspended: boolean;
  // Live data
  currentPrice: number | null;
  priceHistory: number[]; // last 60 ticks
  change1m: number | null;
  change5m: number | null;
  change15m: number | null;
  change1h: number | null;
}

// Ticks per minute at ~1 tick/sec for standard, ~1 tick/sec for 1s indices too
const TICKS_PER_MIN = 60;

// Synthetic indices markets we care about
const SYNTHETIC_MARKETS = ['synthetic_index', 'synthetic_market'];

// ─── Mini sparkline SVG ───────────────────────────────────────────────────────
function Sparkline({ prices, isUp }: { prices: number[]; isUp: boolean }) {
  if (prices.length < 2) return <div style={{ width: 80, height: 28 }} />;

  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const w = 80; const h = 28;

  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = h - ((p - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const color = isUp ? '#2dd4bf' : '#f87171';
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={pts} fill='none' stroke={color} strokeWidth='1.5'
        strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}

// ─── Price change badge ───────────────────────────────────────────────────────
function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ fontSize: 11, color: '#4a6a62', fontFamily: "'DM Mono', monospace" }}>—</span>;
  const up = pct >= 0;
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, fontFamily: "'DM Mono', monospace",
      color: up ? '#2dd4bf' : '#f87171',
    }}>
      {up ? '+' : ''}{pct.toFixed(2)}%
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface DerivInstrumentsProps {
  onSelect: (symbol: string, displayName: string) => void;
  selectedSymbol: string;
  timeframe: '1m' | '5m' | '15m' | '1h';
  onTimeframeChange: (tf: '1m' | '5m' | '15m' | '1h') => void;
}

export function DerivInstruments({ onSelect, selectedSymbol, timeframe, onTimeframeChange }: DerivInstrumentsProps) {
  const [instruments, setInstruments] = useState<InstrumentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'synthetic' | 'forex' | 'stocks' | 'commodities'>('synthetic');
  const unsubRefs = useRef<Map<string, () => void>>(new Map());
  const historyRef = useRef<Map<string, number[]>>(new Map());

  const TIMEFRAME_TICKS: Record<string, number> = {
    '1m': TICKS_PER_MIN,
    '5m': TICKS_PER_MIN * 5,
    '15m': TICKS_PER_MIN * 15,
    '1h': TICKS_PER_MIN * 60,
  };

  const getChange = (prices: number[], lookback: number): number | null => {
    if (prices.length < 2) return null;
    const idx = Math.max(0, prices.length - 1 - lookback);
    const old = prices[idx];
    const current = prices[prices.length - 1];
    if (!old) return null;
    return ((current - old) / old) * 100;
  };

  const loadInstruments = useCallback(async () => {
    try {
      const symbols = await getActiveSymbols();
      const synthetics = symbols.filter(s =>
        SYNTHETIC_MARKETS.includes(s.market) && !s.is_trading_suspended
      );

      const infos: InstrumentInfo[] = synthetics.map(s => ({
        symbol: s.symbol,
        display_name: s.display_name,
        submarket: s.submarket,
        submarket_display_name: s.submarket_display_name,
        spot: s.spot,
        pip: s.pip,
        exchange_is_open: s.exchange_is_open,
        is_trading_suspended: s.is_trading_suspended,
        currentPrice: s.spot,
        priceHistory: [],
        change1m: null,
        change5m: null,
        change15m: null,
        change1h: null,
      }));

      setInstruments(infos);
      setLoading(false);

      // Fetch tick history for top instruments (limit concurrent fetches)
      const priority = infos.slice(0, 20);
      for (const inst of priority) {
        try {
          const hist = await getTicksHistory(inst.symbol, TICKS_PER_MIN * 60 + 10);
          const prices = hist.prices;
          historyRef.current.set(inst.symbol, prices);

          setInstruments(prev => prev.map(p => p.symbol === inst.symbol ? {
            ...p,
            priceHistory: prices.slice(-60),
            currentPrice: prices[prices.length - 1] ?? p.currentPrice,
            change1m:  getChange(prices, TICKS_PER_MIN),
            change5m:  getChange(prices, TICKS_PER_MIN * 5),
            change15m: getChange(prices, TICKS_PER_MIN * 15),
            change1h:  getChange(prices, TICKS_PER_MIN * 60),
          } : p));
        } catch { /* skip */ }
      }

      // Subscribe to live ticks for top instruments
      for (const inst of priority) {
        if (unsubRefs.current.has(inst.symbol)) continue;
        const unsub = subscribeTicks(inst.symbol as any, (tick: DerivTick) => {
          const prev = historyRef.current.get(tick.symbol) ?? [];
          const next = [...prev.slice(-(TICKS_PER_MIN * 60)), tick.quote];
          historyRef.current.set(tick.symbol, next);

          setInstruments(prev2 => prev2.map(p => p.symbol === tick.symbol ? {
            ...p,
            currentPrice: tick.quote,
            priceHistory: next.slice(-60),
            change1m:  getChange(next, TICKS_PER_MIN),
            change5m:  getChange(next, TICKS_PER_MIN * 5),
            change15m: getChange(next, TICKS_PER_MIN * 15),
            change1h:  getChange(next, TICKS_PER_MIN * 60),
          } : p));
        });
        unsubRefs.current.set(inst.symbol, unsub);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[DerivInstruments] Load failed:', err);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInstruments();
    return () => {
      unsubRefs.current.forEach(unsub => unsub());
      unsubRefs.current.clear();
    };
  }, [loadInstruments]);

  // Filter instruments
  const filtered = instruments.filter(i => {
    const matchesSearch = !search || i.display_name.toLowerCase().includes(search.toLowerCase());
    const matchesCat = category === 'synthetic'; // only synthetic for now
    return matchesSearch && matchesCat;
  });

  // Group by submarket
  const groups = filtered.reduce((acc, inst) => {
    const key = inst.submarket_display_name || inst.submarket;
    if (!acc[key]) acc[key] = [];
    acc[key].push(inst);
    return acc;
  }, {} as Record<string, InstrumentInfo[]>);

  const changeForTimeframe = (inst: InstrumentInfo) => {
    switch (timeframe) {
      case '1m':  return inst.change1m;
      case '5m':  return inst.change5m;
      case '15m': return inst.change15m;
      case '1h':  return inst.change1h;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0b1312' }}>
      {/* Search */}
      <div style={{ padding: '10px 12px 6px' }}>
        <input
          type='text' placeholder='Search by market name'
          value={search} onChange={e => setSearch(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '8px 12px',
            background: '#101b19', border: '1px solid #1d2d29', borderRadius: 8,
            color: '#e0f0ec', fontSize: 12, fontFamily: 'inherit', outline: 'none',
          }}
        />
      </div>

      {/* Category tabs */}
      <div style={{ display: 'flex', gap: 6, padding: '0 12px 8px', flexWrap: 'wrap' }}>
        {(['synthetic', 'forex', 'stocks', 'commodities'] as const).map(cat => (
          <button key={cat} type='button' onClick={() => setCategory(cat)}
            style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer',
              border: `1px solid ${category === cat ? '#2dd4bf' : '#1d2d29'}`,
              background: category === cat ? '#0d2e29' : 'transparent',
              color: category === cat ? '#2dd4bf' : '#718580', fontWeight: 600,
              textTransform: 'capitalize',
            }}>
            {cat === 'synthetic' ? 'Derived' : cat === 'stocks' ? 'Stocks & indices' : cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      {/* Timeframe selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px 8px', borderBottom: '1px solid #1d2d29' }}>
        <span style={{ fontSize: 10, color: '#4a6a62', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
          Price changes
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['1m', '5m', '15m', '1h'] as const).map(tf => (
            <button key={tf} type='button' onClick={() => onTimeframeChange(tf)}
              style={{
                padding: '3px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer',
                border: `1px solid ${timeframe === tf ? '#2dd4bf' : '#1d2d29'}`,
                background: timeframe === tf ? '#0d2e29' : 'transparent',
                color: timeframe === tf ? '#2dd4bf' : '#718580', fontFamily: "'DM Mono', monospace",
              }}>{tf}</button>
          ))}
        </div>
      </div>

      {/* Instrument list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#4a6a62', fontSize: 12 }}>
            Loading instruments…
          </div>
        ) : Object.entries(groups).length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#4a6a62', fontSize: 12 }}>
            No instruments found.
          </div>
        ) : (
          Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 800, color: '#50b9a9', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                {group}
              </div>
              {items.map(inst => {
                const isSelected = inst.symbol === selectedSymbol;
                const change = changeForTimeframe(inst);
                const isUp = (change ?? 0) >= 0;
                const pip = inst.pip ?? 0.01;
                const decimals = pip < 0.001 ? 4 : pip < 0.01 ? 3 : pip < 0.1 ? 2 : 1;

                return (
                  <div key={inst.symbol}
                    onClick={() => onSelect(inst.symbol, inst.display_name)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(45,212,191,0.06)' : 'transparent',
                      borderLeft: isSelected ? '2px solid #2dd4bf' : '2px solid transparent',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                  >
                    {/* Badge */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                      background: '#131f1d', border: '1px solid #1d2d29',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 800, color: '#2dd4bf', textAlign: 'center', lineHeight: 1.2,
                    }}>
                      {inst.display_name.replace('Volatility ', '').replace(' Index', '').replace('(1s)', '1s').substring(0, 5)}
                    </div>

                    {/* Name + price */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#e0f0ec', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {inst.display_name}
                      </div>
                      <div style={{ fontSize: 11, color: '#4a6a62', fontFamily: "'DM Mono', monospace", marginTop: 1 }}>
                        {inst.currentPrice !== null ? inst.currentPrice.toFixed(decimals) : '—'}
                      </div>
                    </div>

                    {/* Mini chart */}
                    <Sparkline prices={inst.priceHistory} isUp={isUp} />

                    {/* Change % */}
                    <div style={{ width: 58, textAlign: 'right', flexShrink: 0 }}>
                      <ChangeBadge pct={change} />
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
