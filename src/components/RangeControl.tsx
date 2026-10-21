import { useEffect, useRef, useState } from 'react';
import { useSettings, type RangeEdge } from '../state/settings';
import { noteLabel } from '../music/notes';
import { listenForHeldNote } from '../audio/rangeFinder';
import { PIANO_HI, PIANO_LO } from './Piano';

const EDGE_LABEL: Record<RangeEdge, string> = { turn: 'Turn around', stop: 'Stop', continue: 'Keep going' };

/**
 * "Range C3–G4" pill with a popover: low/high steppers, what auto-advance does at the
 * edge, and a sing-to-find flow (hold your lowest note, then your highest).
 */
export function RangePill() {
  const s = useSettings();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const [finding, setFinding] = useState<null | { step: 'low' | 'high'; progress: number; current: number | null }>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const label = s.rangeLow !== null && s.rangeHigh !== null ? `${noteLabel(s.rangeLow)}–${noteLabel(s.rangeHigh)}` : 'Range: any';
  const clamp = (v: number) => Math.max(PIANO_LO, Math.min(PIANO_HI, v));
  const setLow = (v: number) => s.set({ rangeLow: clamp(v), rangeHigh: Math.max(clamp(v) + 2, s.rangeHigh ?? clamp(v) + 12) });
  const setHigh = (v: number) => s.set({ rangeHigh: clamp(v), rangeLow: Math.min(clamp(v) - 2, s.rangeLow ?? clamp(v) - 12) });

  const find = async () => {
    setFinding({ step: 'low', progress: 0, current: null });
    const low = await listenForHeldNote(4, 0.8, (p, m) => setFinding({ step: 'low', progress: p, current: m }));
    setFinding({ step: 'high', progress: 0, current: null });
    const high = await listenForHeldNote(4, 0.8, (p, m) => setFinding({ step: 'high', progress: p, current: m }));
    setFinding(null);
    if (low !== null && high !== null && high > low) s.set({ rangeLow: low, rangeHigh: high });
    else if (low !== null) setLow(low);
    else if (high !== null) setHigh(high);
  };

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button className={`pill sm${s.rangeLow !== null ? ' accent' : ' ghost'}`} onClick={() => setOpen((o) => !o)} title="Vocal range for auto-advance">
        {label}
      </button>
      {open && (
        <div className="popover" style={{ minWidth: 250 }}>
          <div className="row between">
            <span className="label">Lowest</span>
            <Stepper value={s.rangeLow} onChange={setLow} fallback={48} />
          </div>
          <div className="row between" style={{ marginTop: 6 }}>
            <span className="label">Highest</span>
            <Stepper value={s.rangeHigh} onChange={setHigh} fallback={72} />
          </div>
          <div className="row between" style={{ marginTop: 10 }}>
            <span className="label">At the edge</span>
            <div className="seg">
              {(Object.keys(EDGE_LABEL) as RangeEdge[]).map((e) => (
                <button key={e} className={s.rangeEdge === e ? 'on' : ''} onClick={() => s.set({ rangeEdge: e })}>
                  {EDGE_LABEL[e]}
                </button>
              ))}
            </div>
          </div>
          <div className="desc" style={{ marginTop: 6 }}>
            Auto-advance checks the exercise&apos;s highest and lowest note against this range.
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            {finding ? (
              <div className="grow">
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {finding.step === 'low' ? 'Sing your lowest comfortable note and hold it…' : 'Now your highest comfortable note…'}
                </div>
                <div className="row" style={{ marginTop: 4 }}>
                  <div className="hold-bar" style={{ position: 'static', flex: 1, borderRadius: 2 }}>
                    <div style={{ width: `${finding.progress * 100}%` }} />
                  </div>
                  <span className="mono" style={{ minWidth: 36, textAlign: 'right' }}>
                    {finding.current ? noteLabel(Math.round(finding.current)) : '—'}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <button className="btn sm primary" onClick={() => void find()}>
                  Find my range
                </button>
                <button className="chip sm" onClick={() => s.set({ rangeLow: null, rangeHigh: null })}>
                  no limit
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stepper({ value, onChange, fallback }: { value: number | null; onChange: (v: number) => void; fallback: number }) {
  const v = value ?? fallback;
  return (
    <div className="row" style={{ gap: 4 }}>
      <button className="chip sm" onClick={() => onChange(v - 1)}>
        −
      </button>
      <span className="mono" style={{ minWidth: 40, textAlign: 'center', fontWeight: 700, color: value === null ? 'var(--dim)' : 'var(--text)' }}>
        {noteLabel(v)}
      </span>
      <button className="chip sm" onClick={() => onChange(v + 1)}>
        +
      </button>
    </div>
  );
}
