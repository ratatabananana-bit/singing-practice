import { useEffect, useRef } from 'react';
import { isSharp, noteLabel, pitchClass } from '../music/notes';

export const PIANO_LO = 24; // C1
export const PIANO_HI = 96; // C7
const WHITE_W = 34;
const BLACK_W = 22;

export interface PianoProps {
  root?: number | null;
  inScale?: (midi: number) => boolean;
  sounding?: number | null;
  /** Note the singer is on (shown as an underline). */
  sung?: number | null;
  onKey: (midi: number) => void;
  /** Note to keep centered (defaults to root). */
  center?: number | null;
}

function whiteIndex(midi: number): number {
  // number of white keys from PIANO_LO up to (not including) midi
  let n = 0;
  for (let m = PIANO_LO; m < midi; m++) if (!isSharp(m)) n++;
  return n;
}

export function Piano({ root = null, inScale, sounding = null, sung = null, onKey, center }: PianoProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const target = center ?? root;

  useEffect(() => {
    const el = wrap.current;
    if (!el || target === null || target === undefined) return;
    const x = whiteIndex(target) * WHITE_W + WHITE_W / 2;
    const left = Math.max(0, x - el.clientWidth / 2);
    el.scrollTo({ left, behavior: 'smooth' });
  }, [target]);

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

  return (
    <div className="piano-wrap" ref={wrap}>
      <div className="piano" style={{ width: wi * WHITE_W }}>
        {keys
          .filter((k) => !k.black)
          .map((k) => (
            <div key={k.midi} className={cls(k.midi, false)} onPointerDown={() => onKey(k.midi)}>
              {pitchClass(k.midi) === 0 ? noteLabel(k.midi) : ''}
            </div>
          ))}
        {keys
          .filter((k) => k.black)
          .map((k) => (
            <div key={k.midi} className={cls(k.midi, true)} style={{ left: k.x }} onPointerDown={() => onKey(k.midi)} />
          ))}
      </div>
    </div>
  );
}
