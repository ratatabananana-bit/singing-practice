import { useEffect, useRef, useState } from 'react';

const MIN = 40;
const MAX = 240;
const PRESETS: [string, number][] = [
  ['Slow', 72],
  ['Medium', 120],
  ['Fast', 168],
];

export function BpmPill({ bpm, onChange }: { bpm: number; onChange: (bpm: number) => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const taps = useRef<number[]>([]);
  const holdTimer = useRef<number | null>(null);
  const holdInterval = useRef<number | null>(null);
  const latest = useRef(bpm);
  latest.current = bpm;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const set = (v: number) => onChange(Math.min(MAX, Math.max(MIN, Math.round(v))));

  const startHold = (delta: number) => {
    set(latest.current + delta);
    stopHold();
    holdTimer.current = window.setTimeout(() => {
      holdInterval.current = window.setInterval(() => set(latest.current + delta), 70);
    }, 400);
  };
  const stopHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (holdInterval.current) clearInterval(holdInterval.current);
    holdTimer.current = null;
    holdInterval.current = null;
  };
  useEffect(() => stopHold, []);

  const tap = () => {
    const now = performance.now();
    const t = taps.current;
    if (t.length && now - t[t.length - 1] > 2000) t.length = 0;
    t.push(now);
    if (t.length > 6) t.shift();
    if (t.length >= 2) {
      const intervals = t.slice(1).map((v, i) => v - t[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      set(60000 / avg);
    }
  };

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button className={`pill${open ? ' accent' : ''}`} onClick={() => setOpen((o) => !o)}>
        <span className="mono">{bpm}</span> BPM
      </button>
      {open && (
        <div className="popover">
          <div className="stepper">
            <button
              className="btn round"
              onPointerDown={() => startHold(-1)}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              aria-label="Slower"
            >
              −
            </button>
            <span className="val mono">{bpm}</span>
            <button
              className="btn round"
              onPointerDown={() => startHold(1)}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              aria-label="Faster"
            >
              +
            </button>
          </div>
          <div className="row" style={{ marginTop: 10, justifyContent: 'center' }}>
            {PRESETS.map(([name, v]) => (
              <button key={name} className={`chip${bpm === v ? ' on' : ''}`} onClick={() => set(v)}>
                {name}
              </button>
            ))}
          </div>
          <button className="btn" style={{ width: '100%', marginTop: 10 }} onPointerDown={tap}>
            Tap tempo
          </button>
        </div>
      )}
    </div>
  );
}
