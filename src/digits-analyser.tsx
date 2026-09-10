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

// Instrument index in synthetic priceFor (same as App.tsx instruments array)
const SYNTH_INDEX: Record<string, number> = {
  'Volatility 10 Index':  0,
  'Volatility 25 Index':  1,
  'Volatility 50 Index':  2,
  'Volatility 75 Index':  3,
  'Volatility 100 Index': 4,
};

const DIGIT_COLORS = [
  '#ef4444','#f97316','#eab308','#84cc16','#22c55e',
  '#14b8a6','#3b82f6','#8b5cf6','#ec4899','#2dd4bf',
];

interface TickPoint { quote: number; digit: number; epoch: number }

function getLastDigit(quote: number, pip: number): number {
  const s = quote.toFixed(pip);
  return Number(s[s.length - 1]);
}

// Synthetic price generator matching App.tsx priceFor exactly
function priceFor(index: number, tick: number) {
  return Number((100 + Math.sin((tick + index * 7) / 4) * 2.5 + Math.cos((tick + index) / 8) * 1.4).toFixed(2));
}

// ─── Circular arc gauge ────────────────────────────────────────────────────────
function DigitGauge({
  digit, count, total, isLast, accentColor,
}: {
  digit: number; count: number; total: number; isLast: boolean; accentColor: string;
}) {
  const pct   = total > 0 ? (count / total) * 100 : 0;
  const R     = 26;
  const sw    = 4;
  const circ  = 2 * Math.PI * R;
  const dash  = circ - (pct / 100) * circ;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
      padding: '10px 4px 8px',
      background: isLast ? 'rgba(45,212,191,0.09)' : 'rgba(255,255,255,0.015)',
      border: `1px solid ${isLast ? 'rgba(45,212,191,0.4)' : '#192620'}`,
      borderRadius: 10, flex: '1 1 68px', maxWidth: 90,
      transition: 'background 0.3s, border-color 0.3s',
      position: 'relative',
    }}>
      {/* Arc SVG */}
      <div style={{ position: 'relative', width: 64, height: 64 }}>
        <svg width={64} height={64} style={{ position: 'absolute', inset: 0 }}>
          <circle cx={32} cy={32} r={R} fill='none' stroke='#1a2c27' strokeWidth={sw} />
          <circle cx={32} cy={32} r={R} fill='none'
            stroke={isLast ? '#2dd4bf' : accentColor}
            strokeWidth={sw}
            strokeDasharray={circ}
            strokeDashoffset={dash}
            strokeLinecap='round'
            transform='rotate(-90 32 32)'
            style={{ transition: 'stroke-dashoffset 0.5s ease, stroke 0.3s' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{
            fontSize: 17, fontWeight: 800, lineHeight: 1,
            fontFamily: "'DM Mono', monospace",
            color: isLast ? '#2dd4bf' : '#cde0da',
          }}>{digit}</span>
          <span style={{ fontSize: 8, color: isLast ? '#2dd4bf' : '#5a7a72', marginTop: 1, fontFamily: "'DM Mono', monospace" }}>
            {pct.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Count */}
      <span style={{ fontSize: 9, color: '#4a6a62', fontFamily: "'DM Mono', monospace" }}>
        {count}
      </span>

      {/* Arrow indicator for last digit */}
      {isLast && (
        <div style={{
          position: 'absolute', bottom: -10, left: '50%', transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
          borderTop: '7px solid #2dd4bf',
        }} />
      )}
    </div>
  );
}

// ─── Tick history coloured squares ────────────────────────────────────────────
function TickHistoryRow({ history }: { history: TickPoint[] }) {
  const visible = history.slice(-30);
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {visible.map((t, i) => (
        <div key={`${t.epoch}-${i}`} style={{
          width: 24, height: 24, borderRadius: 4,
          background: DIGIT_COLORS[t.digit],
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800, fontFamily: "'DM Mono', monospace",
          color: '#000',
          opacity: 0.5 + (i / visible.length) * 0.5,
          border: i === visible.length - 1 ? '2px solid #fff' : '2px solid transparent',
          transition: 'opacity 0.3s',
        }}>
          {t.digit}
        </div>
      ))}
    </div>
  );
}

// ─── Even / Odd bar ───────────────────────────────────────────────────────────
function PredBar({ label, count, total, teal }: { label: string; count: number; total: number; teal: boolean }) {
  const pct = total > 0 ? (count / total) * 100 : 50;
  const c   = teal ? '#2dd4bf' : '#f87171';
  return (
    <div style={{
      flex: 1, padding: '14px 16px 12px',
      background: teal ? 'rgba(45,212,191,0.07)' : 'rgba(239,68,68,0.07)',
      border: `1px solid ${teal ? 'rgba(45,212,191,0.2)' : 'rgba(239,68,68,0.2)'}`,
      borderRadius: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'flex-end' }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: c }}>{label}</span>
        <span style={{ fontSize: 20, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: '#e8f2f0' }}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: c, borderRadius: 3, transition: 'width 0.5s' }} />
      </div>
      <div style={{ marginTop: 6, fontSize: 10, color: '#4a6a62' }}>
        {count} / {total} ticks · digits {teal ? '0, 2, 4, 6, 8' : '1, 3, 5, 7, 9'}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function DigitsAnalyser({
  derivConnected, tick,
}: {
  derivConnected: boolean;
  tick: number;
}) {
  const [instrument, setInstrument] = useState('Volatility 100 Index');
  const [history, setHistory]       = useState<TickPoint[]>([]);
  const [currentQuote, setCurrentQuote] = useState<number | null>(null);
  const [windowSize, setWindowSize] = useState(1000);
  const [barrier, setBarrier]       = useState(5);
  const histRef                     = useRef<TickPoint[]>([]);
  const unsubRef                    = useRef<(() => void) | null>(null);
  const pip                         = PIP_SIZE[instrument] ?? 2;

  // ── Deriv live tick subscription ─────────────────────────────────────────
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
    histRef.current = [];
    setHistory([]);
    setCurrentQuote(null);
    subscribeDerivTicks();
    return () => { if (unsubRef.current) unsubRef.current(); };
  }, [subscribeDerivTicks]);

  // ── Synthetic fallback — feed from App.tsx tick counter ──────────────────
  const synthLastTickRef = useRef(-1);
  useEffect(() => {
    if (derivConnected) return; // live ticks take over
    if (tick === synthLastTickRef.current) return;
    synthLastTickRef.current = tick;

    const idx   = SYNTH_INDEX[instrument] ?? 0;
    const quote = priceFor(idx, tick);
    const digit = getLastDigit(quote, pip);
    const pt: TickPoint = { quote, digit, epoch: tick };
    histRef.current = [...histRef.current.slice(-(windowSize - 1)), pt];
    setHistory([...histRef.current]);
    setCurrentQuote(quote);
  }, [tick, derivConnected, instrument, pip, windowSize]);

  // Reset history when instrument or window size changes
  useEffect(() => {
    histRef.current = [];
    setHistory([]);
    setCurrentQuote(null);
  }, [instrument, windowSize]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const win        = history.slice(-windowSize);
  const counts     = Array(10).fill(0) as number[];
  win.forEach(t => counts[t.digit]++);
  const total      = win.length;
  const lastDigit  = win.length > 0 ? win[win.length - 1].digit : null;
  const evenCount  = [0,2,4,6,8].reduce((s, d) => s + counts[d], 0);
  const oddCount   = [1,3,5,7,9].reduce((s, d) => s + counts[d], 0);
  const overCount  = counts.slice(barrier + 1).reduce((a, b) => a + b, 0);
  const underCount = counts.slice(0, barrier).reduce((a, b) => a + b, 0);

  return (
    <div>
      {/* Header */}
      <div className='page-header'>
        <div>
          <div className='eyebrow'>Live market analysis</div>
          <h1>Digits analyser</h1>
          <p>
            Track last-digit frequency in real time.
            {derivConnected
              ? ' Receiving live Deriv ticks.'
              : ' Using synthetic price data — connect Deriv for live digits.'}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {/* Instrument */}
        <div style={{ flex: '1 1 180px', minWidth: 160 }}>
          <div className='eyebrow' style={{ marginBottom: 5 }}>Instrument</div>
          <select value={instrument} onChange={e => setInstrument(e.target.value)}
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 7,
              background: '#101b19', border: '1px solid #1d2d29',
              color: '#e0f0ec', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
            }}>
            {INSTRUMENTS.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>

        {/* Window */}
        <div>
          <div className='eyebrow' style={{ marginBottom: 5 }}>Ticks window</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {[100, 250, 500, 1000].map(n => (
              <button key={n} type='button' onClick={() => setWindowSize(n)}
                style={{
                  padding: '7px 11px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                  border: `1px solid ${windowSize === n ? '#2dd4bf' : '#1d2d29'}`,
                  background: windowSize === n ? '#0d2e29' : 'transparent',
                  color: windowSize === n ? '#2dd4bf' : '#718580',
                  fontFamily: "'DM Mono', monospace",
                }}>{n}</button>
            ))}
          </div>
        </div>

        {/* Barrier */}
        <div>
          <div className='eyebrow' style={{ marginBottom: 5 }}>Over/Under barrier</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {[3, 4, 5, 6, 7].map(n => (
              <button key={n} type='button' onClick={() => setBarrier(n)}
                style={{
                  padding: '7px 11px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                  border: `1px solid ${barrier === n ? '#f97316' : '#1d2d29'}`,
                  background: barrier === n ? 'rgba(249,115,22,0.1)' : 'transparent',
                  color: barrier === n ? '#f97316' : '#718580',
                  fontFamily: "'DM Mono', monospace",
                }}>{n}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Current tick strip */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <div style={{ padding: '12px 18px', borderRadius: 9, background: '#101b19', border: '1px solid #1d2d29', minWidth: 150 }}>
          <div className='eyebrow' style={{ marginBottom: 3 }}>Current tick</div>
          <div style={{ fontSize: 24, fontFamily: "'DM Mono', monospace", color: '#e8f2f0', fontWeight: 700, lineHeight: 1 }}>
            {currentQuote !== null ? currentQuote.toFixed(pip) : '—'}
          </div>
          {lastDigit !== null && (
            <div style={{ marginTop: 6, fontSize: 12 }}>
              Last digit:{' '}
              <strong style={{ color: DIGIT_COLORS[lastDigit], fontFamily: "'DM Mono', monospace", fontSize: 16 }}>
                {lastDigit}
              </strong>
            </div>
          )}
        </div>

        <div style={{ padding: '12px 18px', borderRadius: 9, background: '#101b19', border: '1px solid #1d2d29', minWidth: 120 }}>
          <div className='eyebrow' style={{ marginBottom: 3 }}>Sample</div>
          <div style={{ fontSize: 24, fontFamily: "'DM Mono', monospace", color: '#e8f2f0', fontWeight: 700, lineHeight: 1 }}>
            {total}
          </div>
          <div style={{ marginTop: 6, fontSize: 10, color: '#4a6a62' }}>of {windowSize} tick window</div>
        </div>

        <div style={{ padding: '12px 18px', borderRadius: 9, background: '#101b19', border: '1px solid #1d2d29', display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className='live-dot' style={derivConnected ? {} : { background: '#fbbf24', boxShadow: '0 0 6px #fbbf24' }} />
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: derivConnected ? '#2dd4bf' : '#fbbf24' }}>
              {derivConnected ? 'Live Deriv ticks' : 'Synthetic data'}
            </div>
            <div style={{ fontSize: 10, color: '#4a6a62', marginTop: 2 }}>
              {derivConnected ? 'Real market data' : 'Connect Deriv for live digits'}
            </div>
          </div>
        </div>
      </div>

      {/* Digit gauges */}
      <section className='panel' style={{ marginBottom: 16 }}>
        <div className='panel-title'>
          <div><span className='eyebrow'>Last-digit distribution</span><h2>Digits 0–9</h2></div>
          {total > 0 && lastDigit !== null && (
            <span style={{ fontSize: 11, color: '#718580' }}>
              Last:{' '}
              <strong style={{ color: DIGIT_COLORS[lastDigit], fontFamily: "'DM Mono', monospace", fontSize: 15 }}>
                {lastDigit}
              </strong>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Array.from({ length: 10 }, (_, d) => (
            <DigitGauge
              key={d}
              digit={d}
              count={counts[d]}
              total={total}
              isLast={lastDigit === d}
              accentColor={DIGIT_COLORS[d]}
            />
          ))}
        </div>
      </section>

      {/* Tick history */}
      {history.length > 0 && (
        <section className='panel' style={{ marginBottom: 16 }}>
          <div className='panel-title'>
            <div><span className='eyebrow'>Recent ticks</span><h2>Last 30 digits</h2></div>
          </div>
          <TickHistoryRow history={history} />
        </section>
      )}

      {/* Even / Odd */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <PredBar label='Even' count={evenCount} total={total} teal />
        <PredBar label='Odd'  count={oddCount}  total={total} teal={false} />
      </div>

      {/* Over / Under */}
      <section className='panel'>
        <div className='panel-title'>
          <div><span className='eyebrow'>Barrier {barrier}</span><h2>Over / Under distribution</h2></div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {[
            { label: `Over ${barrier}`, count: overCount,  pct: total > 0 ? overCount / total * 100 : 50,  c: '#f97316', digits: `${barrier + 1}–9` },
            { label: `Under ${barrier}`, count: underCount, pct: total > 0 ? underCount / total * 100 : 50, c: '#3b82f6', digits: `0–${barrier - 1}` },
          ].map(({ label, count, pct, c, digits }) => (
            <div key={label} style={{
              flex: 1, padding: '14px 16px', borderRadius: 10,
              background: 'rgba(255,255,255,0.02)', border: '1px solid #192620',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'flex-end' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: c }}>{label}</span>
                <span style={{ fontSize: 20, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: '#e8f2f0' }}>
                  {pct.toFixed(1)}%
                </span>
              </div>
              <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: c, borderRadius: 3, transition: 'width 0.5s' }} />
              </div>
              <div style={{ fontSize: 10, color: '#4a6a62' }}>{count} ticks · digits {digits}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
