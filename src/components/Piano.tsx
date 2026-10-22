import { useEffect, useRef, useState } from 'react';
import { isSharp, noteLabel, noteName, octaveOf } from '../music/notes';

export const PIANO_LO = 24; // C1
export const PIANO_HI = 96; // C7
// Key geometry must match global.css (.piano .white / .black), phone vs tablet.
const TABLET = '(min-width: 760px)';
function keyWidths(): { white: number; black: number } {
  const t = typeof window !== 'undefined' && window.matchMedia(TABLET).matches;
  return t ? { white: 46, black: 30 } : { white: 36, black: 24 };
}
const TAP_SLOP = 6; // px of movement before a press becomes a drag

export interface PianoProps {
  root?: number | null;
  inScale?: (midi: number) => boolean;
  sounding?: number | null;
  /** Note the singer is on (shown as an underline). */
  sung?: number | null;
  onKey: (midi: number) => void;
  /** Note to keep in view (defaults to root). Only scrolls when it is off-screen. */
  center?: number | null;
}

function useKeyWidths(): { white: number; black: number } {
  const [w, setW] = useState(keyWidths);
  useEffect(() => {
    const mq = window.matchMedia(TABLET);
    const on = () => setW(keyWidths());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return w;
}

function whiteIndex(midi: number): number {
  let n = 0;
  for (let m = PIANO_LO; m < midi; m++) if (!isSharp(m)) n++;
  return n;
}

/**
 * Scrollable keyboard with natural key colours. Every key is labelled with its note name;
 * notes in the current scale get a dot, the root is yellow, the sounding note green and
 * the note being sung is underlined.
 * Touch scrolls natively; mouse drag scrolls too. A key fires on release only when the
 * pointer did not move. The view only auto-scrolls when the target note is out of view.
 */
export function Piano({ root = null, inScale, sounding = null, sung = null, onKey, center }: PianoProps) {
  const { white: WHITE_W, black: BLACK_W } = useKeyWidths();
  const wrap = useRef<HTMLDivElement>(null);
  const target = center ?? root;
  const firstScroll = useRef(true);
  const tappedRef = useRef<number | null>(null);
  const drag = useRef<{ x: number; scroll: number; moved: boolean; midi: number | null; id: number; mouse: boolean } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el || target === null || target === undefined) return;
    if (tappedRef.current === target) {
      tappedRef.current = null;
      return;
    }
    const x = whiteIndex(target) * WHITE_W + WHITE_W / 2;
    const margin = WHITE_W * 1.5;
    const visible = x > el.scrollLeft + margin && x < el.scrollLeft + el.clientWidth - margin;
    if (visible && !firstScroll.current) return;
    const left = Math.max(0, x - el.clientWidth / 2);
    el.scrollTo({ left, behavior: firstScroll.current ? 'auto' : 'smooth' });
    firstScroll.current = false;
  }, [target, WHITE_W]);

  const keys: { midi: number; black: boolean; x: number }[] = [];
  let wi = 0;
  for (let m = PIANO_LO; m <= PIANO_HI; m++) {
    if (isSharp(m)) {
      keys.push({ midi: m, black: true, x: wi * WHITE_W - BLACK_W / 2 });
    } else {
      keys.push({ midi: m, black: false, x: wi * WHITE_W });
      wi++;
    }
  }

  const cls = (m: number, black: boolean) => {
    const c = [black ? 'black' : 'white'];
    if (inScale && inScale(m)) c.push('in-scale');
    if (m === root) c.push('root');
    if (m === sounding) c.push('sounding');
    if (m === sung) c.push('sung');
    return c.join(' ');
  };

  const midiOf = (t: EventTarget | null): number | null => {
    const el = (t as HTMLElement | null)?.closest?.('[data-midi]') as HTMLElement | null;
    return el ? Number(el.dataset.midi) : null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = wrap.current!;
    const mouse = e.pointerType === 'mouse';
    drag.current = { x: e.clientX, scroll: el.scrollLeft, moved: false, midi: midiOf(e.target), id: e.pointerId, mouse };
    if (mouse) el.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > TAP_SLOP) d.moved = true;
    if (d.mouse && d.moved) wrap.current!.scrollLeft = d.scroll - dx;
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && d.midi !== null) {
      tappedRef.current = d.midi;
      onKey(d.midi);
    }
  };
  const onPointerCancel = () => {
    drag.current = null;
  };

  return (
    <div
      className="piano-wrap"
      ref={wrap}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="piano" style={{ width: wi * WHITE_W }}>
        {keys
          .filter((k) => !k.black)
          .map((k) => (
            <div key={k.midi} className={cls(k.midi, false)} data-midi={k.midi}>
              <span className="key-label">{noteLabel(k.midi)}</span>
            </div>
          ))}
        {keys
          .filter((k) => k.black)
          .map((k) => (
            <div key={k.midi} className={cls(k.midi, true)} style={{ left: k.x }} data-midi={k.midi}>
              <span className="key-label">
                {noteName(k.midi).replace('#', '♯')}
                <small>{octaveOf(k.midi)}</small>
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
