import { useState } from 'react';
import { useSettings, type RangeEdge } from '../state/settings';
import { noteLabel } from '../music/notes';
import { listenForHeldNote } from '../audio/rangeFinder';
import { PIANO_HI, PIANO_LO } from './Piano';

const EDGE_LABEL: Record<RangeEdge, string> = { turn: 'Turn around', stop: 'Stop', continue: 'Keep going' };

/**
 * "Range C3–G4" pill that opens a bottom sheet: lowest/highest note, what auto-advance
 * does at the edge, and a sing-to-find flow (hold your lowest note, then your highest).
 */
export function RangePill() {
  const s = useSettings();
  const [open, setOpen] = useState(false);
  const label = s.rangeLow !== null && s.rangeHigh !== null ? `Range ${noteLabel(s.rangeLow)}–${noteLabel(s.rangeHigh)}` : 'Range: any';
  return (
    <>
      <button className={`pill sm${s.rangeLow !== null ? ' accent' : ' ghost'}`} onClick={() => setOpen(true)} title="Vocal range: where auto-advance stops or turns around">
        {label}
      </button>
      {open && <RangeSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function RangeSheet({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const [finding, setFinding] = useState<null | { step: 'low' | 'high'; progress: number; current: number | null }>(null);
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
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ maxHeight: '70vh' }}>
        <div className="sheet-head">
          <div>
            <strong>Vocal range</strong>
            <div className="desc">Auto-advance keeps the whole exercise inside this range.</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="row between">
            <span className="label">Lowest note</span>
            <Stepper value={s.rangeLow} onChange={setLow} fallback={48} />
          </div>
          <div className="row between">
            <span className="label">Highest note</span>
            <Stepper value={s.rangeHigh} onChange={setHigh} fallback={72} />
          </div>
          <div className="setting">
            <div className="title">At the top or bottom</div>
            <div className="seg">
              {(Object.keys(EDGE_LABEL) as RangeEdge[]).map((e) => (
                <button key={e} className={s.rangeEdge === e ? 'on' : ''} onClick={() => s.set({ rangeEdge: e })}>
                  {EDGE_LABEL[e]}
                </button>
              ))}
            </div>
          </div>
          <div className="setting">
            <div className="title">Find it by singing</div>
            {finding ? (
              <>
                <div style={{ fontSize: 13 }}>{finding.step === 'low' ? 'Sing your lowest comfortable note and hold it…' : 'Now your highest comfortable note…'}</div>
                <div className="row">
                  <div className="hold-bar" style={{ position: 'static', flex: 1, borderRadius: 2, height: 6 }}>
                    <div style={{ width: `${finding.progress * 100}%` }} />
                  </div>
                  <span className="mono" style={{ minWidth: 40, textAlign: 'right' }}>
                    {finding.current ? noteLabel(Math.round(finding.current)) : '—'}
                  </span>
                </div>
              </>
            ) : (
              <div className="row">
                <button className="btn primary" onClick={() => void find()}>
                  Find my range
                </button>
                <button className="btn" onClick={() => s.set({ rangeLow: null, rangeHigh: null })}>
                  No limit
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stepper({ value, onChange, fallback }: { value: number | null; onChange: (v: number) => void; fallback: number }) {
  const v = value ?? fallback;
  return (
    <div className="row" style={{ gap: 6 }}>
      <button className="tile-btn" onClick={() => onChange(v - 1)} aria-label="Lower">
        −
      </button>
      <span className="mono" style={{ minWidth: 44, textAlign: 'center', fontWeight: 700, fontSize: 16, color: value === null ? 'var(--dim)' : 'var(--text)' }}>
        {noteLabel(v)}
      </span>
      <button className="tile-btn" onClick={() => onChange(v + 1)} aria-label="Higher">
        +
      </button>
    </div>
  );
}
