import { useSyncExternalStore } from 'react';
import { mic } from '../audio/mic/MicService';
import type { PitchFrame } from '../audio/pitch/tracker';
import { useSettings } from './settings';

/**
 * Latest pitch frame, fanned out to UI subscribers.
 * Components subscribe with selectors so only the pill/graph that changed re-renders.
 */
const SILENT: PitchFrame = { time: 0, freq: 0, voiced: false, clarity: 0, db: -120, peak: 0 };
let latest: PitchFrame = SILENT;
const listeners = new Set<() => void>();

mic.subscribe((f) => {
  latest = f;
  for (const l of listeners) l();
});

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getLatestPitch(): PitchFrame {
  return latest;
}

export function usePitchFrame(): PitchFrame {
  return useSyncExternalStore(subscribe, getLatestPitch, () => SILENT);
}

/** Subscribe with a selector; re-render only when the selected value changes (Object.is). */
export function usePitchSelector<T>(sel: (f: PitchFrame) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => sel(latest),
    () => sel(SILENT),
  );
}

/**
 * Glanceable note: median of the last 3 detected (rounded) notes to kill single-frame
 * glitches. No frequency smoothing (that lags). Null when silent.
 */
export interface DisplayNote {
  midi: number | null;
  /** Raw (unsmoothed) frequency of the latest frame, 0 when silent. */
  freq: number;
  db: number;
}
const SILENT_NOTE: DisplayNote = { midi: null, freq: 0, db: -120 };
let displayNote: DisplayNote = SILENT_NOTE;
const noteBuf: number[] = [];
const noteListeners = new Set<() => void>();
mic.subscribe((f) => {
  let midi: number | null = null;
  if (f.voiced && f.freq > 0) {
    const m = Math.round(69 + 12 * Math.log2(f.freq / 440));
    noteBuf.push(m);
    if (noteBuf.length > 3) noteBuf.shift();
    if (noteBuf.length === 3) {
      const [a, b, c] = noteBuf;
      midi = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    } else midi = m;
  } else {
    noteBuf.length = 0;
  }
  const next: DisplayNote = { midi, freq: f.voiced ? f.freq : 0, db: f.db };
  if (next.midi !== displayNote.midi || next.freq !== displayNote.freq || Math.abs(next.db - displayNote.db) > 0.5) {
    displayNote = next;
    for (const l of noteListeners) l();
  }
});
export function useDisplayNote(): DisplayNote {
  return useSyncExternalStore(
    (cb) => {
      noteListeners.add(cb);
      return () => noteListeners.delete(cb);
    },
    () => displayNote,
    () => SILENT_NOTE,
  );
}
/** Only the note number (re-renders only when the note changes). */
export function useDisplayMidi(): number | null {
  return useSyncExternalStore(
    (cb) => {
      noteListeners.add(cb);
      return () => noteListeners.delete(cb);
    },
    () => displayNote.midi,
    () => null,
  );
}

// Mic state as a React hook
let micState = mic.state;
let micError = '';
const micListeners = new Set<() => void>();
mic.onState((s, e) => {
  micState = s;
  micError = e ?? '';
  for (const l of micListeners) l();
});
export function useMicState(): { state: typeof micState; error: string } {
  const s = useSyncExternalStore(
    (cb) => {
      micListeners.add(cb);
      return () => micListeners.delete(cb);
    },
    () => micState,
    () => 'idle' as const,
  );
  return { state: s, error: micError };
}

// Push pitch-engine settings into the worklet whenever they change.
function pushParams() {
  const s = useSettings.getState();
  mic.setParams({
    enabled: s.pitch.enabled,
    clarityOn: s.pitch.clarityOn,
    clarityOff: s.pitch.clarityOff,
    holdFrames: s.pitch.holdFrames,
    median: s.pitch.median,
    minFreq: s.pitch.minFreq,
    maxFreq: s.pitch.maxFreq,
    k: s.pitch.k,
    hopSeconds: s.pitch.hopMs / 1000,
    silenceDb: s.silenceDb,
  });
}
pushParams();
useSettings.subscribe((s, prev) => {
  if (s.pitch !== prev.pitch || s.silenceDb !== prev.silenceDb) pushParams();
});
