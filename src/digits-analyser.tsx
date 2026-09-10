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
  const R    = 26; const sw = 4;
  const circ = 2 * Math.PI * R;
  const dash = circ - (pct / 100) * circ;
  const clickable = !!onClick;

  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
        padding: '10px 4px 10px',
        background: selected ? 'rgba(167,139,250,0.15)' : isLast ? 'rgba(45,212,191,0.08)' : 'rgba(255,255,255,0.015)',
        border: `1px solid ${selected ? '#a78bfa' : isLast ? 'rgba(45,212,191,0.4)' : '#192620'}`,
        borderRadius: 10, flex: '1 1 68px', maxWidth: 90,
        transition: 'all 0.2s',
        cursor: clickable ? 'pointer' : 'default',
        position: 'relative',
        boxShadow: selected ? '0 0 0 2px rgba(167,139,250,0.3)' : 'none',
      }}>
      <div style={{ position: 'relative', width: 64, height: 64 }}>
        <svg width={64} height={64} style={{ position: 'absolute', inset: 0 }}>
          <circle cx={32} cy={32} r={R} fill='none' stroke='#1a2c27' strokeWidth={sw} />
          <circle cx={32} cy={32} r={R} fill='none'
            stroke={selected ? '#a78bfa' : isLast ? '#2dd4bf' : accentColor}
            strokeWidth={sw}
            strokeDasharray={circ} strokeDashoffset={dash}
            strokeLinecap='round' transform='rotate(-90 32 32)'
            style={{ transition: 'stroke-dashoffset 0.5s, stroke 0.2s' }}
          />
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 17, fontWeight: 800, lineHeight: 1, fontFamily: "'DM Mono', monospace", color: selected ? '#c4b5fd' : isLast ? '#2dd4bf' : '#cde0da' }}>{digit}</span>
          <span style={{ fontSize: 8, color: selected ? '#a78bfa' : isLast ? '#2dd4bf' : '#5a7a72', marginTop: 1, fontFamily: "'DM Mono', monospace" }}>{pct.toFixed(1)}%</span>
        </div>
      </div>
      <span style={{ fontSize: 9, color: '#4a6a62', fontFamily: "'DM Mono', monospace" }}>{count}</span>
      {isLast && !selected && (
        <div style={{ position: 'absolute', bottom: -9, left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '7px solid #2dd4bf' }} />
      )}
      {selected && (
        <div style={{ position: 'absolute', bottom: -9, left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '7px solid #a78bfa' }} />
      )}
    </div>
  );
}

// ─── Tick history squares ─────────────────────────────────────────────────────
function TickHistoryRow({ history }: { history: TickPoint[] }) {
  const visible = history.slice(-30);
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {visible.map((t, i) => (
        <div key={`${t.epoch}-${i}`} style={{
          width: 24, height: 24, borderRadius: 4,
          background: DIGIT_COLORS[t.digit],
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: '#000',
          opacity: 0.5 + (i / visible.length) * 0.5,
          border: i === visible.length - 1 ? '2px solid #fff' : '2px solid transparent',
        }}>{t.digit}</div>
      ))}
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
      <div className='page-header'>
        <div>
          <div className='eyebrow'>Live market analysis & trading</div>
          <h1>Digits trader</h1>
          <p>
            Analyse digit frequency and trade Even/Odd, Over/Under, Matches/Differs directly.
            {!derivConnected && ' Connect Deriv for live data and real trade execution.'}
          </p>
        </div>
      </div>

      {/* Main layout: stats left, trade panel right */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>

        {/* LEFT — analysis */}
        <div>
          {/* Controls */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 170px' }}>
              <div className='eyebrow' style={{ marginBottom: 4 }}>Instrument</div>
              <select value={instrument} onChange={e => setInstrument(e.target.value)} style={{ width: '100%', padding: '8px 10px', borderRadius: 7, background: '#101b19', border: '1px solid #1d2d29', color: '#e0f0ec', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>
                {INSTRUMENTS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <div className='eyebrow' style={{ marginBottom: 4 }}>Window</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[100, 250, 500, 1000].map(n => (
                  <button key={n} type='button' onClick={() => setWindowSize(n)} style={{ padding: '6px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer', border: `1px solid ${windowSize === n ? '#2dd4bf' : '#1d2d29'}`, background: windowSize === n ? '#0d2e29' : 'transparent', color: windowSize === n ? '#2dd4bf' : '#718580', fontFamily: "'DM Mono', monospace" }}>{n}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Current tick */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
            <div style={{ padding: '10px 16px', borderRadius: 9, background: '#101b19', border: '1px solid #1d2d29' }}>
              <div className='eyebrow' style={{ marginBottom: 2 }}>Current tick</div>
              <div style={{ fontSize: 22, fontFamily: "'DM Mono', monospace", color: '#e8f2f0', fontWeight: 700, lineHeight: 1 }}>
                {currentQuote !== null ? currentQuote.toFixed(pip) : '—'}
              </div>
              {lastDigit !== null && (
                <div style={{ marginTop: 4, fontSize: 11 }}>
                  Last digit: <strong style={{ color: DIGIT_COLORS[lastDigit], fontFamily: "'DM Mono', monospace", fontSize: 15 }}>{lastDigit}</strong>
                </div>
              )}
            </div>
            <div style={{ padding: '10px 16px', borderRadius: 9, background: '#101b19', border: '1px solid #1d2d29' }}>
              <div className='eyebrow' style={{ marginBottom: 2 }}>Sample</div>
              <div style={{ fontSize: 22, fontFamily: "'DM Mono', monospace", color: '#e8f2f0', fontWeight: 700, lineHeight: 1 }}>{total}</div>
              <div style={{ fontSize: 10, color: '#4a6a62', marginTop: 4 }}>of {windowSize} ticks</div>
            </div>
            <div style={{ padding: '10px 14px', borderRadius: 9, background: '#101b19', border: '1px solid #1d2d29', display: 'flex', alignItems: 'center', gap: 8 }}>
              <i className='live-dot' style={derivConnected ? {} : { background: '#fbbf24', boxShadow: '0 0 6px #fbbf24' }} />
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: derivConnected ? '#2dd4bf' : '#fbbf24' }}>
                  {derivConnected ? 'Live ticks' : 'Synthetic'}
                </div>
                <div style={{ fontSize: 9, color: '#4a6a62', marginTop: 1 }}>
                  {derivConnected ? 'Real Deriv data' : 'Demo mode'}
                </div>
              </div>
            </div>
          </div>

          {/* Digit gauges — clickable when Matches/Differs/Over/Under selected */}
          <section className='panel' style={{ marginBottom: 14 }}>
            <div className='panel-title'>
              <div><span className='eyebrow'>Distribution</span><h2>Digits 0–9</h2></div>
              {needsBarrier && <span style={{ fontSize: 10, color: '#a78bfa' }}>Click a digit to set the barrier</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
            <section className='panel' style={{ marginBottom: 14 }}>
              <div className='panel-title'><div><span className='eyebrow'>Recent ticks</span><h2>Last 30 digits</h2></div></div>
              <TickHistoryRow history={history} />
            </section>
          )}

          {/* Even / Odd quick stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Even', count: evenCount, c: '#2dd4bf', digits: '0,2,4,6,8' },
              { label: 'Odd',  count: oddCount,  c: '#f87171', digits: '1,3,5,7,9' },
            ].map(({ label, count, c, digits }) => {
              const pct = total > 0 ? (count / total * 100) : 50;
              return (
                <div key={label} style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid #192620' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7, alignItems: 'flex-end' }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: c }}>{label}</span>
                    <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "'DM Mono', monospace", color: '#e8f2f0' }}>{pct.toFixed(1)}%</span>
                  </div>
                  <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden', marginBottom: 5 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: c, borderRadius: 3, transition: 'width 0.5s' }} />
                  </div>
                  <div style={{ fontSize: 10, color: '#4a6a62' }}>{count} ticks · {digits}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — trade panel */}
        <div style={{ position: 'sticky', top: 20 }}>
          <section className='panel'>
            <div><span className='eyebrow'>Trade execution</span><h2 style={{ margin: '4px 0 16px' }}>Place a trade</h2></div>

            {/* Contract type */}
            <div style={{ marginBottom: 14 }}>
              <div className='eyebrow' style={{ marginBottom: 6 }}>Contract type</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
                {CONTRACT_TYPES.map(ct => (
                  <button key={ct.type} type='button'
                    onClick={() => { setContractType(ct.type); }}
                    style={{
                      padding: '8px 4px', borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${contractType === ct.type ? ct.color : '#1d2d29'}`,
                      background: contractType === ct.type ? `rgba(${ct.color === '#2dd4bf' ? '45,212,191' : ct.color === '#f87171' ? '248,113,113' : ct.color === '#f97316' ? '249,115,22' : ct.color === '#3b82f6' ? '59,130,246' : ct.color === '#a78bfa' ? '167,139,250' : '251,191,36'},0.12)` : 'transparent',
                      color: contractType === ct.type ? ct.color : '#718580',
                      transition: 'all 0.15s',
                    }}>
                    {ct.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Barrier selector (only when needed) */}
            {needsBarrier && (
              <div style={{ marginBottom: 14 }}>
                <div className='eyebrow' style={{ marginBottom: 6 }}>
                  {contractType === 'DIGITOVER' ? 'Over digit' : contractType === 'DIGITUNDER' ? 'Under digit' : contractType === 'DIGITMATCH' ? 'Matches digit' : 'Differs from digit'}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {Array.from({ length: 10 }, (_, d) => (
                    <button key={d} type='button' onClick={() => setSelectedBarrier(d)}
                      style={{
                        width: 30, height: 30, borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        fontFamily: "'DM Mono', monospace",
                        border: `1px solid ${selectedBarrier === d ? ctMeta.color : '#1d2d29'}`,
                        background: selectedBarrier === d ? `rgba(167,139,250,0.15)` : 'transparent',
                        color: selectedBarrier === d ? ctMeta.color : '#718580',
                      }}>{d}</button>
                  ))}
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: '#4a6a62' }}>
                  {contractType === 'DIGITOVER'  && `Win if last digit > ${selectedBarrier}`}
                  {contractType === 'DIGITUNDER' && `Win if last digit < ${selectedBarrier}`}
                  {contractType === 'DIGITMATCH' && `Win if last digit = ${selectedBarrier}`}
                  {contractType === 'DIGITDIFF'  && `Win if last digit ≠ ${selectedBarrier}`}
                </div>
              </div>
            )}

            {/* Stake */}
            <div style={{ marginBottom: 14 }}>
              <div className='eyebrow' style={{ marginBottom: 6 }}>Stake ({currency})</div>
              <div style={{ display: 'flex', gap: 5, marginBottom: 6, flexWrap: 'wrap' }}>
                {[0.5, 1, 2, 5, 10, 25].map(v => (
                  <button key={v} type='button' onClick={() => setStake(v)}
                    style={{
                      padding: '5px 9px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      fontFamily: "'DM Mono', monospace",
                      border: `1px solid ${stake === v ? '#2dd4bf' : '#1d2d29'}`,
                      background: stake === v ? '#0d2e29' : 'transparent',
                      color: stake === v ? '#2dd4bf' : '#718580',
                    }}>${v}</button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#718580', fontSize: 11 }}>$</span>
                <input type='number' min={0.5} step={0.5} value={stake}
                  onChange={e => setStake(Math.max(0.5, Number(e.target.value)))}
                  style={{ flex: 1, padding: '7px 10px', borderRadius: 6, background: '#0b1918', border: '1px solid #1d2d29', color: '#e0f0ec', fontSize: 12, fontFamily: "'DM Mono', monospace", outline: 'none' }}
                />
              </div>
              <div style={{ marginTop: 4, fontSize: 10, color: '#4a6a62' }}>
                Balance: {money(balance)} {currency}
              </div>
            </div>

            {/* Duration */}
            <div style={{ marginBottom: 16 }}>
              <div className='eyebrow' style={{ marginBottom: 6 }}>Duration (ticks)</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[1, 3, 5, 10, 15].map(n => (
                  <button key={n} type='button' onClick={() => setDurationTicks(n)}
                    style={{
                      flex: 1, padding: '7px 4px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                      fontFamily: "'DM Mono', monospace",
                      border: `1px solid ${durationTicks === n ? '#2dd4bf' : '#1d2d29'}`,
                      background: durationTicks === n ? '#0d2e29' : 'transparent',
                      color: durationTicks === n ? '#2dd4bf' : '#718580',
                    }}>{n}t</button>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.2)', border: '1px solid #1d2d29', marginBottom: 14, fontSize: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#718580' }}>Contract</span>
                <span style={{ color: ctMeta.color, fontWeight: 700 }}>
                  {ctMeta.label}{needsBarrier ? ` ${selectedBarrier}` : ''} · {instrument.replace('Volatility ', 'V').replace(' Index', '')}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#718580' }}>Stake</span>
                <span style={{ color: '#e8f2f0', fontFamily: "'DM Mono', monospace" }}>{money(stake)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#718580' }}>Duration</span>
                <span style={{ color: '#e8f2f0', fontFamily: "'DM Mono', monospace" }}>{durationTicks} ticks</span>
              </div>
            </div>

            {/* Last result */}
            {lastResult && (
              <div style={{
                padding: '8px 12px', borderRadius: 7, marginBottom: 12,
                background: lastResult.status === 'won' ? 'rgba(45,212,191,0.08)' : 'rgba(248,113,113,0.08)',
                border: `1px solid ${lastResult.status === 'won' ? 'rgba(45,212,191,0.25)' : 'rgba(248,113,113,0.25)'}`,
                color: lastResult.status === 'won' ? '#2dd4bf' : '#f87171',
                fontSize: 12, fontWeight: 700, textAlign: 'center',
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
                width: '100%', padding: '13px 0',
                borderRadius: 8, border: 'none', cursor: isSubmitting ? 'not-allowed' : 'pointer',
                fontSize: 14, fontWeight: 800,
                background: isSubmitting ? '#1a2c27' : ctMeta.color === '#2dd4bf' ? '#2dd4bf' : ctMeta.color === '#f87171' ? '#f87171' : ctMeta.color,
                color: isSubmitting ? '#4a6a62' : '#060e0d',
                transition: 'all 0.15s',
                opacity: stake > balance ? 0.5 : 1,
              }}>
              {isSubmitting
                ? 'Placing trade…'
                : `Buy ${ctMeta.label}${needsBarrier ? ` ${selectedBarrier}` : ''} · ${money(stake)}`}
            </button>

            {!derivConnected && (
              <p style={{ marginTop: 8, fontSize: 10, color: '#4a6a62', textAlign: 'center', lineHeight: 1.5 }}>
                Using synthetic simulation. Connect Deriv to place real trades.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
