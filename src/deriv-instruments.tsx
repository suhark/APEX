/**
 * DerivInstruments — full market selector with live prices, sparklines, price change %.
 * Covers all Deriv markets: Derived, Forex, Stocks & Indices, Commodities, Crypto.
 * Data sourced from apex-lab/src/components/shared/utils/common-data.js
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { getActiveSymbols, getTicksHistory, subscribeTicks, type DerivTick } from './deriv-client';

// ─── Market categories matching Deriv's classification ───────────────────────

const MARKET_CATEGORIES = [
  { key: 'synthetic_index', label: 'Derived',           markets: ['synthetic_index', 'random_index', 'synthetic', 'derived'] },
  { key: 'forex',           label: 'Forex',             markets: ['forex'] },
  { key: 'indices',         label: 'Stocks & Indices',  markets: ['indices', 'stocks'] },
  { key: 'commodities',     label: 'Commodities',       markets: ['commodities'] },
  { key: 'cryptocurrency',  label: 'Crypto',            markets: ['cryptocurrency'] },
] as const;

type CategoryKey = typeof MARKET_CATEGORIES[number]['key'];

// Submarket display names (from common-data.js)
const SUBMARKET_NAMES: Record<string, string> = {
  random_index:         'Continuous Indices',
  random_daily:         'Daily Reset Indices',
  crash_index:          'Crash/Boom Indices',
  jump_index:           'Jump Indices',
  step_index:           'Step Indices',
  range_break:          'Range Break Indices',
  major_pairs:          'Major Pairs',
  minor_pairs:          'Minor Pairs',
  exotic_pairs:         'Exotic Pairs',
  smart_fx:             'Smart FX',
  metals:               'Metals',
  energy:               'Energy',
  otc_index:            'OTC Indices',
  otc_indices:          'OTC Indices',
  asian_indices:        'Asian Indices',
  american_indices:     'American Indices',
  european_indices:     'European Indices',
  non_stable_coin:      'Cryptocurrencies',
  stable_coin:          'Stable Coins',
  crypto_index:         'Crypto Index',
  forex_basket:         'Forex Basket',
  basket_forex:         'Forex Basket',
  commodity_basket:     'Commodities Basket',
};

// Ticks per minute approximation
const TPM = 60;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InstrumentInfo {
  symbol:       string;
  display_name: string;
  market:       string;
  submarket:    string;
  submarket_display: string;
  spot:         number | null;
  pip:          number;
  exchange_is_open: boolean;
  currentPrice: number | null;
  priceHistory: number[];
  change1m:     number | null;
  change5m:     number | null;
  change15m:    number | null;
  change1h:     number | null;
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

function Sparkline({ prices, isUp }: { prices: number[]; isUp: boolean }) {
  if (prices.length < 2) return <div style={{ width: 72, height: 26 }} />;
  const min = Math.min(...prices), max = Math.max(...prices);
  const range = max - min || 1;
  const w = 72, h = 26;
  const pts = prices.map((p, i) =>
    `${((i / (prices.length - 1)) * w).toFixed(1)},${(h - ((p - min) / range) * (h - 4) - 2).toFixed(1)}`
  ).join(' ');
  return (
    <svg width={w} height={h} style={{ display: 'block', flexShrink: 0 }}>
      <polyline points={pts} fill='none' stroke={isUp ? '#2dd4bf' : '#f87171'}
        strokeWidth='1.5' strokeLinecap='round' strokeLinejoin='round' />
    </svg>
  );
}

// ─── Change badge ─────────────────────────────────────────────────────────────

function ChangeBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span style={{ fontSize: 11, color: '#4a6a62', fontFamily: "'DM Mono', monospace", width: 54, textAlign: 'right' }}>—</span>;
  const up = pct >= 0;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "'DM Mono', monospace", color: up ? '#2dd4bf' : '#f87171', width: 54, textAlign: 'right', flexShrink: 0 }}>
      {up ? '+' : ''}{pct.toFixed(2)}%
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  onSelect:          (symbol: string, displayName: string) => void;
  selectedSymbol:    string;
  timeframe:         '1m' | '5m' | '15m' | '1h';
  onTimeframeChange: (tf: '1m' | '5m' | '15m' | '1h') => void;
  derivConnected?:   boolean;
}

export function DerivInstruments({ onSelect, selectedSymbol, timeframe, onTimeframeChange, derivConnected }: Props) {
  const [category, setCategory]     = useState<CategoryKey>('synthetic_index');
  const [instruments, setInstruments] = useState<InstrumentInfo[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const unsubRefs   = useRef(new Map<string, () => void>());
  const historyRef  = useRef(new Map<string, number[]>());
  const loadedRef   = useRef(false);

  const LOOKBACK: Record<string, number> = { '1m': TPM, '5m': TPM*5, '15m': TPM*15, '1h': TPM*60 };

  const getChange = (prices: number[], lb: number): number | null => {
    if (prices.length < 2) return null;
    const old = prices[Math.max(0, prices.length - 1 - lb)];
    const cur = prices[prices.length - 1];
    return old ? ((cur - old) / old) * 100 : null;
  };

  const buildInfo = useCallback((prices: number[], inst: InstrumentInfo): Partial<InstrumentInfo> => ({
    currentPrice: prices[prices.length - 1] ?? inst.currentPrice,
    priceHistory: prices.slice(-60),
    change1m:  getChange(prices, TPM),
    change5m:  getChange(prices, TPM * 5),
    change15m: getChange(prices, TPM * 15),
    change1h:  getChange(prices, TPM * 60),
  }), []);

  const load = useCallback(async () => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    try {
      const syms = await getActiveSymbols();
      if (import.meta.env.DEV) {
        const markets = [...new Set(syms.map(s => s.market))];
        console.log('[DerivInstruments] available markets:', markets);
        console.log('[DerivInstruments] total symbols:', syms.length);
      }
      const infos: InstrumentInfo[] = syms
        .filter(s => !s.is_trading_suspended && s.symbol && s.display_name)
        .map(s => ({
          symbol:       s.symbol,
          display_name: s.display_name,
          market:       s.market,
          submarket:    s.submarket,
          submarket_display: SUBMARKET_NAMES[s.submarket] ?? s.submarket_display_name ?? s.submarket,
          spot:         s.spot ?? null,
          pip:          s.pip ?? 0.01,
          exchange_is_open: s.exchange_is_open ?? true,
          currentPrice: s.spot ?? null,
          priceHistory: [],
          change1m: null, change5m: null, change15m: null, change1h: null,
        }));
      setInstruments(infos);
      setLoading(false);

      // Fetch history and subscribe for first 30 symbols
      const priority = infos.slice(0, 30);
      for (const inst of priority) {
        void (async () => {
          try {
            const hist = await getTicksHistory(inst.symbol, TPM * 60 + 10);
            historyRef.current.set(inst.symbol, hist.prices);
            setInstruments(prev => prev.map(p =>
              p.symbol === inst.symbol ? { ...p, ...buildInfo(hist.prices, p) } : p
            ));
          } catch { /* skip unsupported symbol */ }
        })();

        if (!unsubRefs.current.has(inst.symbol)) {
          const unsub = subscribeTicks(inst.symbol as any, (t: DerivTick) => {
            const prev = historyRef.current.get(t.symbol) ?? [];
            const next = [...prev.slice(-(TPM * 60)), t.quote];
            historyRef.current.set(t.symbol, next);
            setInstruments(prev2 => prev2.map(p =>
              p.symbol === t.symbol ? { ...p, ...buildInfo(next, p) } : p
            ));
          });
          unsubRefs.current.set(inst.symbol, unsub);
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[DerivInstruments]', err);
      // Reset so the next open or connection event can retry
      loadedRef.current = false;
      setLoading(false);
    }
  }, [buildInfo]);

  // Load on mount — or immediately if already connected
  useEffect(() => {
    void load();
    return () => { unsubRefs.current.forEach(u => u()); unsubRefs.current.clear(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also retry whenever the Deriv connection becomes available
  useEffect(() => {
    if (derivConnected) {
      loadedRef.current = false;
      void load();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivConnected]);

  // Filter by category and search
  const catMarkets = MARKET_CATEGORIES.find(c => c.key === category)?.markets ?? [];
  const filtered = instruments.filter(i =>
    catMarkets.includes(i.market as any) &&
    (!search || (i.display_name ?? '').toLowerCase().includes(search.toLowerCase()) ||
     i.symbol.toLowerCase().includes(search.toLowerCase()))
  );

  // Group by submarket
  const groups = filtered.reduce<Record<string, InstrumentInfo[]>>((acc, inst) => {
    const key = inst.submarket_display;
    if (!acc[key]) acc[key] = [];
    acc[key].push(inst);
    return acc;
  }, {});

  const changeForTf = (inst: InstrumentInfo) =>
    timeframe === '1m' ? inst.change1m :
    timeframe === '5m' ? inst.change5m :
    timeframe === '15m' ? inst.change15m : inst.change1h;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0b1312', overflow: 'hidden' }}>

      {/* Search */}
      <div style={{ padding: '10px 12px 6px' }}>
        <input type='text' placeholder='Search by market name'
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', background: '#101b19', border: '1px solid #1d2d29', borderRadius: 8, color: '#e0f0ec', fontSize: 12, fontFamily: 'inherit', outline: 'none' }}
        />
      </div>

      {/* Category tabs */}
      <div style={{ display: 'flex', gap: 5, padding: '0 12px 8px', overflowX: 'auto', flexShrink: 0 }}>
        {MARKET_CATEGORIES.map(cat => (
          <button key={cat.key} type='button' onClick={() => setCategory(cat.key)}
            style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', flexShrink: 0,
              border: `1px solid ${category === cat.key ? '#2dd4bf' : '#1d2d29'}`,
              background: category === cat.key ? '#0d2e29' : 'transparent',
              color: category === cat.key ? '#2dd4bf' : '#718580', fontWeight: 600,
              whiteSpace: 'nowrap',
            }}>{cat.label}
          </button>
        ))}
      </div>

      {/* Timeframe selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 12px 8px', borderBottom: '1px solid #1d2d29', flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: '#4a6a62', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
          Price changes
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['1m', '5m', '15m', '1h'] as const).map(tf => (
            <button key={tf} type='button' onClick={() => onTimeframeChange(tf)}
              style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, cursor: 'pointer', fontFamily: "'DM Mono', monospace", border: `1px solid ${timeframe === tf ? '#2dd4bf' : '#1d2d29'}`, background: timeframe === tf ? '#0d2e29' : 'transparent', color: timeframe === tf ? '#2dd4bf' : '#718580' }}>
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Instrument list */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#4a6a62', fontSize: 12 }}>
            <div style={{ marginBottom: 8 }}>Loading instruments…</div>
            <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(45,212,191,0.2)', borderTopColor: '#2dd4bf', animation: 'spin 0.7s linear infinite', margin: '0 auto' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#4a6a62', fontSize: 12 }}>
            {search ? `No results for "${search}"` : 'No instruments available in this category.'}
          </div>
        ) : (
          Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 800, color: '#50b9a9', textTransform: 'uppercase', letterSpacing: '0.1em', background: '#0b1312', position: 'sticky', top: 0, zIndex: 1 }}>
                {group}
              </div>
              {items.map(inst => {
                const isSelected = inst.symbol === selectedSymbol;
                const change = changeForTf(inst);
                const isUp = (change ?? 0) >= 0;
                const pip = inst.pip ?? 0.01;
                const decimals = pip < 0.0001 ? 5 : pip < 0.001 ? 4 : pip < 0.01 ? 3 : pip < 0.1 ? 2 : 1;
                const isOpen = inst.exchange_is_open;

                return (
                  <div key={inst.symbol} onClick={() => onSelect(inst.symbol, inst.display_name)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(45,212,191,0.06)' : 'transparent',
                      borderLeft: isSelected ? '2px solid #2dd4bf' : '2px solid transparent',
                      opacity: isOpen ? 1 : 0.5,
                    }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; }}
                    onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    {/* Badge */}
                    <div style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, background: '#131f1d', border: '1px solid #1d2d29', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800, color: '#2dd4bf', textAlign: 'center', lineHeight: 1.2, padding: '0 2px' }}>
                      {(inst.display_name ?? inst.symbol ?? '').replace('Volatility ', '').replace(' Index', '').replace('(1s)', '1s').replace('/', '/\n').substring(0, 8)}
                    </div>

                    {/* Name + price */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#e0f0ec', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {inst.display_name}
                      </div>
                      <div style={{ fontSize: 10, color: '#4a6a62', fontFamily: "'DM Mono', monospace", marginTop: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                        {inst.currentPrice !== null ? inst.currentPrice.toFixed(decimals) : '—'}
                        {!isOpen && <span style={{ fontSize: 9, color: '#f97316', fontWeight: 700 }}>CLOSED</span>}
                      </div>
                    </div>

                    {/* Sparkline */}
                    <Sparkline prices={inst.priceHistory} isUp={isUp} />

                    {/* Change % */}
                    <ChangeBadge pct={change} />
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
