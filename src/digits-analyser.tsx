import { useEffect, useRef, useState, useCallback } from 'react';
import { subscribeTicks, symbolMap, type DerivTick } from './deriv-client';

// ─── Constants ────────────────────────────────────────────────────────────────
const INSTRUMENTS = [
  'Volatility 10 Index',
  'Volatility 25 Index',
  'Volatility 50 Index',
  'Volatility 75 Index',
  'Volatility 100 Index',
] as const;

const PIP_SIZE: Record<string, number> = {
  'Volatility 10 Index':  3,
  'Volatility 25 Index':  3,
  'Volatility 50 Index':  4,
  'Volatility 75 Index':  4,
  'Volatility 100 Index': 2,
};

// Synthetic index in App.tsx instruments[]
const SYNTH_INDEX: Record<string, number> = {
  'Volatility 10 Index': 0, 'Volatility 25 Index': 1,
  'Volatility 50 Index': 2, 'Volatility 75 Index': 3,
  'Volatility 100 Index': 4,
};

const DIGIT_COLORS = [
  '#ef4444','#f97316','#eab308','#84cc16','#22c55e',
  '#14b8a6','#3b82f6','#8b5cf6','#ec4899','#2dd4bf',
];

// All digit contract types
type DigitContractType = 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';

const CONTRACT_TYPES: { type: DigitContractType; label: string; needsBarrier: boolean; color: string }[] = [
  { type: 'DIGITEVEN',  label: 'Even',    needsBarrier: false, color: '#2dd4bf' },
  { type: 'DIGITODD',   label: 'Odd',     needsBarrier: false, color: '#f87171' },
  { type: 'DIGITOVER',  label: 'Over',    needsBarrier: true,  color: '#f97316' },
  { type: 'DIGITUNDER', label: 'Under',   needsBarrier: true,  color: '#3b82f6' },
  { type: 'DIGITMATCH', label: 'Matches', needsBarrier: true,  color: '#a78bfa' },
  { type: 'DIGITDIFF',  label: 'Differs', needsBarrier: true,  color: '#fbbf24' },
];

interface TickPoint { quote: number; digit: number; epoch: number }

function getLastDigit(quote: number, pip: number): number {
  const s = quote.toFixed(pip);
  return Number(s[s.length - 1]);
}

function priceFor(index: number, tick: number) {
  return Number((100 + Math.sin((tick + index * 7) / 4) * 2.5 + Math.cos((tick + index) / 8) * 1.4).toFixed(2));
}

function money(v: number) { return `$${Math.abs(v).toFixed(2)}`; }

// ─── Circular arc gauge ────────────────────────────────────────────────────────
function DigitGauge({ digit, count, total, isLast, accentColor, onClick, selected }: {
  digit: number; count: number; total: number; isLast: boolean;
  accentColor: string; onClick?: () => void; selected?: boolean;
}) {
  const pct  = total > 0 ? (count / total) * 100 : 0;
  const R    = 24; const sw = 4;
  const circ = 2 * Math.PI * R;
  const dash = circ - (pct / 100) * circ;
  const clickable = !!onClick;

  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        padding: '8px 4px 6px',
        background: selected ? 'rgba(167,139,250,0.12)' : isLast ? 'rgba(45,212,191,0.08)' : 'transparent',
        border: 'none',
        borderRadius: 8,
        transition: 'all 0.2s ease',
        cursor: clickable ? 'pointer' : 'default',
        position: 'relative',
      }}>
      <div style={{ position: 'relative', width: 56, height: 56 }}>
        <svg width={56} height={56} style={{ position: 'absolute', inset: 0 }}>
          <circle cx={28} cy={28} r={R} fill='none' stroke='#1a2c27' strokeWidth={sw} />
          <circle cx={28} cy={28} r={R} fill='none'
            stroke={selected ? '#a78bfa' : isLast ? '#2dd4bf' : accentColor}
            strokeWidth={sw}
            strokeDasharray={circ} strokeDashoffset={dash}
            strokeLinecap='round' transform='rotate(-90 28 28)'
            style={{ transition: 'stroke-dashoffset 0.5s, stroke 0.2s' }}
          />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 16, fontWeight: 800, lineHeight: 1, fontFamily: "'DM Mono', monospace", color: selected ? '#c4b5fd' : isLast ? '#2dd4bf' : '#cde0da' }}>{digit}</span>
          <span style={{ fontSize: 8, color: selected ? '#a78bfa' : isLast ? '#2dd4bf' : '#5a7a72', marginTop: 1, fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>{pct.toFixed(1)}%</span>
        </div>
      </div>
      <span style={{ fontSize: 9, color: '#4a6a62', fontFamily: "'DM Mono', monospace", fontWeight: 500 }}>{count}</span>
      {isLast && !selected && (
        <div style={{ position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '6px solid #2dd4bf' }} />
      )}
      {selected && (
        <div style={{ position: 'absolute', bottom: -8, left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '6px solid #a78bfa' }} />
      )}
    </div>
  );
}

// ─── Tick history squares ─────────────────────────────────────────────────────
function TickHistoryRow({ history, barrier }: { history: TickPoint[]; barrier: number }) {
  const visible = history.slice(-30);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Digit squares */}
      <div>
        <div style={{ fontSize: 10, color: '#4a6a62', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 8 }}>Recent digits</div>
        <div className='tick-history-squares' style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {visible.map((t, i) => (
            <div key={`${t.epoch}-${i}`} style={{
              width: 32, height: 32, borderRadius: 6,
              background: DIGIT_COLORS[t.digit],
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 13, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: '#000',
              opacity: 0.4 + (i / visible.length) * 0.6,
              border: i === visible.length - 1 ? '2px solid #fff' : '2px solid transparent',
              boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
            }}>{t.digit}</div>
          ))}
        </div>
      </div>

      {/* Even/Odd log */}
      <div>
        <div style={{ fontSize: 10, color: '#4a6a62', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 8 }}>Even / Odd</div>
        <div className='tick-history-odd-even' style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {visible.map((t, i) => {
            const isEven = t.digit % 2 === 0;
            return (
              <div key={`eo-${t.epoch}-${i}`} style={{
                width: 32, height: 32, borderRadius: 6, fontSize: 10, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'DM Mono', monospace",
                background: isEven ? 'rgba(45,212,191,0.15)' : 'rgba(248,113,113,0.15)',
                color: isEven ? '#2dd4bf' : '#f87171',
                border: `1px solid ${isEven ? 'rgba(45,212,191,0.3)' : 'rgba(248,113,113,0.3)'}`,
                opacity: 0.4 + (i / visible.length) * 0.6,
              }}>
                {isEven ? 'E' : 'O'}
              </div>
            );
          })}
        </div>
      </div>

      {/* Over/Under log */}
      <div>
        <div style={{ fontSize: 10, color: '#4a6a62', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: 8 }}>Over / Under {barrier}</div>
        <div className='tick-history-over-under' style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {visible.map((t, i) => {
            const isOver = t.digit > barrier;
            const isUnder = t.digit < barrier;
            const label = isOver ? `>${barrier}` : isUnder ? `<${barrier}` : `=${barrier}`;
            const bg    = isOver ? 'rgba(249,115,22,0.15)' : isUnder ? 'rgba(59,130,246,0.15)' : 'rgba(251,191,36,0.15)';
            const col   = isOver ? '#f97316' : isUnder ? '#60a5fa' : '#fbbf24';
            const bdr   = isOver ? 'rgba(249,115,22,0.3)' : isUnder ? 'rgba(59,130,246,0.3)' : 'rgba(251,191,36,0.3)';
            return (
              <div key={`ou-${t.epoch}-${i}`} style={{
                minWidth: 32, height: 32, padding: '0 4px', borderRadius: 6, fontSize: 9, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'DM Mono', monospace",
                background: bg, color: col, border: `1px solid ${bdr}`,
                opacity: 0.4 + (i / visible.length) * 0.6,
              }}>
                {label}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function DigitsAnalyser({
  derivConnected, tick, runTrade, derivAccount, workspaceBalance,
}: {
  derivConnected: boolean;
  tick: number;
  runTrade: (details: { instrument: string; direction: string; stake: number; source: string; barrier?: number }) => Promise<void>;
  derivAccount: { balance: number; currency: string; is_virtual: boolean } | null;
  workspaceBalance: number;
}) {
  const [instrument, setInstrument] = useState('Volatility 100 Index');
  const [history, setHistory]       = useState<TickPoint[]>([]);
  const [currentQuote, setCurrentQuote] = useState<number | null>(null);
  const [windowSize, setWindowSize] = useState(1000);

  // Trading state
  const [contractType, setContractType] = useState<DigitContractType>('DIGITEVEN');
  const [selectedBarrier, setSelectedBarrier] = useState(5);
  const [stake, setStake]               = useState(1);
  const [durationTicks, setDurationTicks] = useState(5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastResult, setLastResult]     = useState<{ status: 'won' | 'lost'; profit: number } | null>(null);

  const histRef  = useRef<TickPoint[]>([]);
  const unsubRef = useRef<(() => void) | null>(null);
  const pip      = PIP_SIZE[instrument] ?? 2;

  // ── Tick subscription ──────────────────────────────────────────────────
  const subscribeDerivTicks = useCallback(() => {
    if (unsubRef.current) { unsubRef.current(); unsubRef.current = null; }
    if (!derivConnected) return;
    const sym = symbolMap[instrument];
    if (!sym) return;
    const unsub = subscribeTicks(sym, (t: DerivTick) => {
      const digit = getLastDigit(t.quote, pip);
      const pt: TickPoint = { quote: t.quote, digit, epoch: t.epoch };
      histRef.current = [...histRef.current.slice(-(windowSize - 1)), pt];
      setHistory([...histRef.current]);
      setCurrentQuote(t.quote);
    });
    unsubRef.current = unsub;
  }, [instrument, derivConnected, pip, windowSize]);

  useEffect(() => {
    histRef.current = []; setHistory([]); setCurrentQuote(null);
    subscribeDerivTicks();
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, [subscribeDerivTicks]);

  // ── Synthetic fallback ────────────────────────────────────────────────
  const synthLastRef = useRef(-1);
  useEffect(() => {
    if (derivConnected || tick === synthLastRef.current) return;
    synthLastRef.current = tick;
    const idx   = SYNTH_INDEX[instrument] ?? 0;
    const quote = priceFor(idx, tick);
    const digit = getLastDigit(quote, pip);
    const pt: TickPoint = { quote, digit, epoch: tick };
    histRef.current = [...histRef.current.slice(-(windowSize - 1)), pt];
    setHistory([...histRef.current]);
    setCurrentQuote(quote);
  }, [tick, derivConnected, instrument, pip, windowSize]);

  useEffect(() => {
    histRef.current = []; setHistory([]); setCurrentQuote(null);
  }, [instrument, windowSize]);

  // ── Stats ─────────────────────────────────────────────────────────────
  const win       = history.slice(-windowSize);
  const counts    = Array(10).fill(0) as number[];
  win.forEach(t => counts[t.digit]++);
  const total     = win.length;
  const lastDigit = win.length > 0 ? win[win.length - 1].digit : null;
  const evenCount = [0,2,4,6,8].reduce((s, d) => s + counts[d], 0);
  const oddCount  = [1,3,5,7,9].reduce((s, d) => s + counts[d], 0);

  // ── Current contract meta ──────────────────────────────────────────────
  const ctMeta    = CONTRACT_TYPES.find(c => c.type === contractType)!;
  const needsBarrier = ctMeta.needsBarrier;
  const balance   = derivConnected && derivAccount ? derivAccount.balance : workspaceBalance;
  const currency  = derivConnected && derivAccount ? derivAccount.currency : 'USD';

  // ── Place trade ────────────────────────────────────────────────────────
  const placeTrade = async () => {
    setIsSubmitting(true);
    setLastResult(null);
    try {
      await runTrade({
        instrument,
        direction: contractType,
        stake,
        source: 'manual',
        barrier: needsBarrier ? selectedBarrier : undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      {/* Page header */}
      <div className='page-header' style={{ marginBottom: 32 }}>
        <div>
          <div className='eyebrow'>Live market analysis & trading</div>
          <h1>Digits trader</h1>
          <p style={{ marginTop: 12 }}>
            Analyse digit frequency and trade Even/Odd, Over/Under, Matches/Differs directly.
            {!derivConnected && ' Connect Deriv for live data and real trade execution.'}
          </p>
        </div>
      </div>

      {/* Main layout: stats left, trade panel right — stacks on mobile */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 20, alignItems: 'start' }}
        className='digits-layout'>

        {/* LEFT — analysis */}
        <div>
          {/* Controls */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 20, alignItems: 'end' }}>
            <div>
              <div className='eyebrow' style={{ marginBottom: 6 }}>Instrument</div>
              <select value={instrument} onChange={e => setInstrument(e.target.value)} style={{ width: '100%', padding: '10px 12px', borderRadius: 8, background: '#0d1816', border: '1px solid #1e3a34', color: '#e0f0ec', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', outline: 'none', transition: 'border-color 0.15s' }}>
                {INSTRUMENTS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <div className='eyebrow' style={{ marginBottom: 6 }}>Sample window</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[100, 250, 500, 1000].map(n => (
                  <button key={n} type='button' onClick={() => setWindowSize(n)} style={{ flex: 1, padding: '8px 12px', borderRadius: 7, fontSize: 11, cursor: 'pointer', border: `1px solid ${windowSize === n ? '#2dd4bf' : '#1e3a34'}`, background: windowSize === n ? '#0d2e29' : 'transparent', color: windowSize === n ? '#2dd4bf' : '#718580', fontFamily: "'DM Mono', monospace", fontWeight: 600, transition: 'all 0.15s' }}>{n}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Current tick */}
          <div className='current-tick-grid' style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
            <div style={{ padding: '10px 12px', borderRadius: 10, background: 'linear-gradient(135deg, #0d1816, #0a1413)', border: '1px solid #1e3a34', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
              <div className='eyebrow' style={{ marginBottom: 4, fontSize: 8 }}>Current tick</div>
              <div style={{ fontSize: 20, fontFamily: "'DM Mono', monospace", color: '#e8f2f0', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' }}>
                {currentQuote !== null ? currentQuote.toFixed(pip) : '—'}
              </div>
              {lastDigit !== null && (
                <div style={{ marginTop: 4, fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: '#4a6a62' }}>Last:</span>
                  <strong style={{ color: DIGIT_COLORS[lastDigit], fontFamily: "'DM Mono', monospace", fontSize: 14, background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: 3 }}>{lastDigit}</strong>
                </div>
              )}
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 10, background: 'linear-gradient(135deg, #0d1816, #0a1413)', border: '1px solid #1e3a34', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
              <div className='eyebrow' style={{ marginBottom: 4, fontSize: 8 }}>Sample size</div>
              <div style={{ fontSize: 20, fontFamily: "'DM Mono', monospace", color: '#e8f2f0', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' }}>{total}</div>
              <div style={{ fontSize: 9, color: '#4a6a62', marginTop: 4 }}>of {windowSize} ticks</div>
            </div>
            <div style={{ padding: '10px 12px', borderRadius: 10, background: 'linear-gradient(135deg, #0d1816, #0a1413)', border: '1px solid #1e3a34', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <i className='live-dot' style={derivConnected ? {} : { background: '#fbbf24', boxShadow: '0 0 8px #fbbf24' }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: derivConnected ? '#2dd4bf' : '#fbbf24', letterSpacing: '0.02em' }}>
                  {derivConnected ? 'Live ticks' : 'Synthetic'}
                </div>
                <div style={{ fontSize: 9, color: '#4a6a62', marginTop: 1 }}>
                  {derivConnected ? 'Real Deriv data' : 'Demo mode'}
                </div>
              </div>
            </div>
          </div>

          {/* Digit gauges — clickable when Matches/Differs/Over/Under selected */}
          <section className='panel' style={{ marginBottom: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
            <div className='panel-title' style={{ marginBottom: 20 }}>
              <div><span className='eyebrow'>Distribution</span><h2>Digits 0–9</h2></div>
              {needsBarrier && <span style={{ fontSize: 10, color: '#a78bfa', fontWeight: 600 }}>Click a digit to set barrier</span>}
            </div>
            <div className='digits-gauges-grid' style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {Array.from({ length: 10 }, (_, d) => (
                <DigitGauge key={d} digit={d} count={counts[d]} total={total} isLast={lastDigit === d}
                  accentColor={DIGIT_COLORS[d]}
                  selected={needsBarrier && selectedBarrier === d}
                  onClick={needsBarrier ? () => setSelectedBarrier(d) : undefined}
                />
              ))}
            </div>
          </section>

          {/* Tick history */}
          {history.length > 0 && (
            <section className='panel' style={{ marginBottom: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.12)' }}>
              <div className='panel-title' style={{ marginBottom: 20 }}><div><span className='eyebrow'>History</span><h2>Last 30 ticks</h2></div></div>
              <TickHistoryRow history={history} barrier={selectedBarrier} />
            </section>
          )}

          {/* Even / Odd quick stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {[
              { label: 'Even', count: evenCount, c: '#2dd4bf', digits: '0,2,4,6,8' },
              { label: 'Odd',  count: oddCount,  c: '#f87171', digits: '1,3,5,7,9' },
            ].map(({ label, count, c, digits }) => {
              const pct = total > 0 ? (count / total * 100) : 50;
              return (
                <div key={label} style={{ padding: '16px 18px', borderRadius: 12, background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))', border: '1px solid #1e3a34', boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, alignItems: 'flex-end' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: c, letterSpacing: '0.02em' }}>{label}</span>
                    <span style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: '#e8f2f0', lineHeight: 1 }}>{pct.toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: c, borderRadius: 4, transition: 'width 0.5s ease', boxShadow: `0 0 10px ${c}40` }} />
                  </div>
                  <div style={{ fontSize: 11, color: '#4a6a62', fontFamily: "'DM Mono', monospace", fontWeight: 500 }}>{count} ticks · {digits}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — trade panel */}
        <div style={{ position: 'sticky', top: 20 }} className='digits-trade-panel'>
          <section className='panel' style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.15)' }}>
            <div><span className='eyebrow'>Trade execution</span><h2 style={{ margin: '4px 0 18px' }}>Place a trade</h2></div>

            {/* Contract type */}
            <div style={{ marginBottom: 18 }}>
              <div className='eyebrow' style={{ marginBottom: 8 }}>Contract type</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                {CONTRACT_TYPES.map(ct => (
                  <button key={ct.type} type='button'
                    onClick={() => { setContractType(ct.type); }}
                    style={{
                      padding: '10px 6px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${contractType === ct.type ? ct.color : '#1e3a34'}`,
                      background: contractType === ct.type ? `rgba(${ct.color === '#2dd4bf' ? '45,212,191' : ct.color === '#f87171' ? '248,113,113' : ct.color === '#f97316' ? '249,115,22' : ct.color === '#3b82f6' ? '59,130,246' : ct.color === '#a78bfa' ? '167,139,250' : '251,191,36'},0.15)` : 'transparent',
                      color: contractType === ct.type ? ct.color : '#718580',
                      transition: 'all 0.15s ease',
                    }}>
                    {ct.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Barrier selector (only when needed) */}
            {needsBarrier && (
              <div style={{ marginBottom: 18 }}>
                <div className='eyebrow' style={{ marginBottom: 8 }}>
                  {contractType === 'DIGITOVER' ? 'Over digit' : contractType === 'DIGITUNDER' ? 'Under digit' : contractType === 'DIGITMATCH' ? 'Matches digit' : 'Differs from digit'}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Array.from({ length: 10 }, (_, d) => (
                    <button key={d} type='button' onClick={() => setSelectedBarrier(d)}
                      style={{
                        width: 36, height: 36, borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                        fontFamily: "'DM Mono', monospace",
                        border: `1px solid ${selectedBarrier === d ? ctMeta.color : '#1e3a34'}`,
                        background: selectedBarrier === d ? `rgba(167,139,250,0.18)` : 'transparent',
                        color: selectedBarrier === d ? ctMeta.color : '#718580',
                        transition: 'all 0.15s ease',
                      }}>{d}</button>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: 11, color: '#4a6a62', fontWeight: 500 }}>
                  {contractType === 'DIGITOVER'  && `Win if last digit > ${selectedBarrier}`}
                  {contractType === 'DIGITUNDER' && `Win if last digit < ${selectedBarrier}`}
                  {contractType === 'DIGITMATCH' && `Win if last digit = ${selectedBarrier}`}
                  {contractType === 'DIGITDIFF'  && `Win if last digit ≠ ${selectedBarrier}`}
                </div>
              </div>
            )}

            {/* Stake */}
            <div style={{ marginBottom: 18 }}>
              <div className='eyebrow' style={{ marginBottom: 8 }}>Stake ({currency})</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                {[0.5, 1, 2, 5, 10, 25].map(v => (
                  <button key={v} type='button' onClick={() => setStake(v)}
                    style={{
                      padding: '6px 10px', borderRadius: 7, fontSize: 11, cursor: 'pointer',
                      fontFamily: "'DM Mono', monospace", fontWeight: 600,
                      border: `1px solid ${stake === v ? '#2dd4bf' : '#1e3a34'}`,
                      background: stake === v ? '#0d2e29' : 'transparent',
                      color: stake === v ? '#2dd4bf' : '#718580',
                      transition: 'all 0.15s ease',
                    }}>${v}</button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: '#718580', fontSize: 12, fontWeight: 600 }}>$</span>
                <input type='number' min={0.5} step={0.5} value={stake}
                  onChange={e => setStake(Math.max(0.5, Number(e.target.value)))}
                  style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: '#0b1816', border: '1px solid #1e3a34', color: '#e0f0ec', fontSize: 13, fontFamily: "'DM Mono', monospace", outline: 'none', transition: 'border-color 0.15s' }}
                />
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: '#4a6a62', fontWeight: 500 }}>
                Balance: {money(balance)} {currency}
              </div>
            </div>

            {/* Duration */}
            <div style={{ marginBottom: 20 }}>
              <div className='eyebrow' style={{ marginBottom: 8 }}>Duration (ticks)</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[1, 3, 5, 10, 15].map(n => (
                  <button key={n} type='button' onClick={() => setDurationTicks(n)}
                    style={{
                      flex: 1, padding: '10px 6px', borderRadius: 8, fontSize: 11, cursor: 'pointer',
                      fontFamily: "'DM Mono', monospace", fontWeight: 600,
                      border: `1px solid ${durationTicks === n ? '#2dd4bf' : '#1e3a34'}`,
                      background: durationTicks === n ? '#0d2e29' : 'transparent',
                      color: durationTicks === n ? '#2dd4bf' : '#718580',
                      transition: 'all 0.15s ease',
                    }}>{n}t</button>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div style={{ padding: '14px 16px', borderRadius: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid #1e3a34', marginBottom: 18, fontSize: 11, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#718580', fontWeight: 600 }}>Contract</span>
                <span style={{ color: ctMeta.color, fontWeight: 700 }}>
                  {ctMeta.label}{needsBarrier ? ` ${selectedBarrier}` : ''} · {instrument.replace('Volatility ', 'V').replace(' Index', '')}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#718580', fontWeight: 600 }}>Stake</span>
                <span style={{ color: '#e8f2f0', fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>{money(stake)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#718580', fontWeight: 600 }}>Duration</span>
                <span style={{ color: '#e8f2f0', fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>{durationTicks} ticks</span>
              </div>
            </div>

            {/* Last result */}
            {lastResult && (
              <div style={{
                padding: '12px 16px', borderRadius: 10, marginBottom: 16,
                background: lastResult.status === 'won' ? 'rgba(45,212,191,0.12)' : 'rgba(248,113,113,0.12)',
                border: `1px solid ${lastResult.status === 'won' ? 'rgba(45,212,191,0.3)' : 'rgba(248,113,113,0.3)'}`,
                color: lastResult.status === 'won' ? '#2dd4bf' : '#f87171',
                fontSize: 13, fontWeight: 700, textAlign: 'center',
                boxShadow: lastResult.status === 'won' ? '0 4px 12px rgba(45,212,191,0.15)' : '0 4px 12px rgba(248,113,113,0.15)',
              }}>
                {lastResult.status === 'won' ? '🎉' : '📉'} {lastResult.status.toUpperCase()} {lastResult.status === 'won' ? '+' : ''}{money(lastResult.profit)}
              </div>
            )}

            {/* Buy button */}
            <button
              type='button'
              disabled={isSubmitting || stake <= 0 || stake > balance}
              onClick={() => void placeTrade()}
              style={{
                width: '100%', padding: '16px 0',
                borderRadius: 10, border: 'none', cursor: isSubmitting ? 'not-allowed' : 'pointer',
                fontSize: 15, fontWeight: 800, letterSpacing: '0.02em',
                background: isSubmitting ? '#1a2c27' : ctMeta.color === '#2dd4bf' ? '#2dd4bf' : ctMeta.color === '#f87171' ? '#f87171' : ctMeta.color,
                color: isSubmitting ? '#4a6a62' : '#060e0d',
                transition: 'all 0.2s ease',
                opacity: stake > balance ? 0.5 : 1,
                boxShadow: isSubmitting ? 'none' : `0 4px 16px ${ctMeta.color}40`,
              }}>
              {isSubmitting
                ? 'Placing trade…'
                : `Buy ${ctMeta.label}${needsBarrier ? ` ${selectedBarrier}` : ''} · ${money(stake)}`}
            </button>

            {!derivConnected && (
              <p style={{ marginTop: 12, fontSize: 11, color: '#4a6a62', textAlign: 'center', lineHeight: 1.6, fontWeight: 500 }}>
                Using synthetic simulation. Connect Deriv to place real trades.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
