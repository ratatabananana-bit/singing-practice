import { mic } from '../audio/mic/MicService';
import { freqToMidi } from '../music/notes';

/**
 * Rolling history of pitch frames for graphs (no React re-renders; canvases read it in rAF).
 * Stores [time, midi(0=silent), db] triples for the last `SECONDS`.
 */
const SECONDS = 90;
const CAP = Math.ceil((SECONDS * 1000) / 20); // generous for fast hop settings
export const times = new Float64Array(CAP);
export const midis = new Float32Array(CAP);
export const dbs = new Float32Array(CAP);
let head = 0; // next write index
let count = 0;

export function historyLength(): number {
  return count;
}
/** i = 0 is the newest. */
export function historyAt(i: number): { time: number; midi: number; db: number } {
  const idx = (head - 1 - i + CAP) % CAP;
  return { time: times[idx], midi: midis[idx], db: dbs[idx] };
}
export function historyIndex(i: number): number {
  return (head - 1 - i + CAP) % CAP;
}

mic.subscribe((f) => {
  times[head] = f.time;
  midis[head] = f.voiced && f.freq > 0 ? freqToMidi(f.freq) : 0;
  dbs[head] = f.db;
  head = (head + 1) % CAP;
  if (count < CAP) count++;
});
