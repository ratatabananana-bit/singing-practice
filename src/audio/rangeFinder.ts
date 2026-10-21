import { mic } from './mic/MicService';
import { freqToMidi } from '../music/notes';

/**
 * Listen for `seconds` and return the note the singer held most steadily
 * (longest run of frames within ±0.6 semitone, at least `minHold` seconds), or null.
 * Used by the "find my range" flow: sing your lowest, then your highest.
 */
export function listenForHeldNote(seconds = 4, minHold = 0.8, onProgress?: (fraction: number, currentMidi: number | null) => void): Promise<number | null> {
  return new Promise((resolve) => {
    if (mic.state !== 'running') void mic.start();
    const frames: { t: number; m: number }[] = [];
    const t0 = performance.now();
    const unsub = mic.subscribe((f) => {
      frames.push({ t: f.time, m: f.voiced && f.freq > 0 ? freqToMidi(f.freq) : 0 });
      onProgress?.(Math.min(1, (performance.now() - t0) / (seconds * 1000)), frames[frames.length - 1].m || null);
    });
    setTimeout(() => {
      unsub();
      resolve(bestHeldNote(frames, minHold));
    }, seconds * 1000);
  });
}

export function bestHeldNote(frames: { t: number; m: number }[], minHold: number): number | null {
  const acc: { best: { len: number; midi: number } | null } = { best: null };
  let run: { t: number; m: number }[] = [];
  const flush = () => {
    if (run.length >= 2) {
      const ms = run.map((r) => r.m).sort((a, b) => a - b);
      const med = ms[ms.length >> 1];
      const len = run[run.length - 1].t - run[0].t;
      if (len >= minHold && (!acc.best || len > acc.best.len)) acc.best = { len, midi: Math.round(med) };
    }
    run = [];
  };
  for (const f of frames) {
    if (f.m <= 0) {
      flush();
      continue;
    }
    if (run.length && Math.abs(f.m - run[0].m) > 0.6) flush();
    run.push(f);
  }
  flush();
  return acc.best ? acc.best.midi : null;
}
