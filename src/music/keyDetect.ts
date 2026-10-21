import { NOTE_NAMES } from './notes';

// Krumhansl-Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export interface KeyGuess {
  root: number; // pitch class 0..11
  mode: 'major' | 'minor';
  confidence: number; // 0..1
  label: string; // e.g. "C maj"
}

export interface KeyObservation {
  /** Exact (unrounded) MIDI pitch. */
  midi: number;
  /** Seconds. */
  time: number;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const d = Math.sqrt(da * db);
  return d === 0 ? 0 : num / d;
}

/**
 * Guess the key from recent sung pitches.
 * - Exponential recency weighting (half-life `halfLife` s) so key changes are noticed quickly.
 * - Removes the singer's average tuning offset before rounding so a consistently flat
 *   singer is not read into the wrong key.
 */
export function detectKey(obs: KeyObservation[], now: number, halfLife = 3, window = 10): KeyGuess | null {
  const recent = obs.filter((o) => now - o.time <= window);
  if (recent.length < 8) return null;

  // Estimate global tuning bias (circular mean of fractional deviation, in semitone units).
  let sx = 0;
  let sy = 0;
  for (const o of recent) {
    const frac = o.midi - Math.round(o.midi); // -0.5..0.5
    const ang = frac * 2 * Math.PI;
    sx += Math.cos(ang);
    sy += Math.sin(ang);
  }
  const bias = Math.atan2(sy, sx) / (2 * Math.PI); // semitones

  const hist = new Array<number>(12).fill(0);
  for (const o of recent) {
    const age = now - o.time;
    const w = Math.pow(0.5, age / halfLife);
    const pc = ((Math.round(o.midi - bias) % 12) + 12) % 12;
    hist[pc] += w;
  }

  let best: KeyGuess | null = null;
  let second = -Infinity;
  for (let r = 0; r < 12; r++) {
    for (const mode of ['major', 'minor'] as const) {
      const prof = mode === 'major' ? MAJOR : MINOR;
      const rotated = new Array<number>(12);
      for (let i = 0; i < 12; i++) rotated[(i + r) % 12] = prof[i];
      const c = pearson(hist, rotated);
      if (!best || c > best.confidence) {
        if (best) second = Math.max(second, best.confidence);
        best = { root: r, mode, confidence: c, label: `${NOTE_NAMES[r]} ${mode === 'major' ? 'maj' : 'min'}` };
      } else if (c > second) {
        second = c;
      }
    }
  }
  if (!best) return null;
  // Confidence: correlation strength, penalised when the runner-up is close.
  const margin = Math.max(0, best.confidence - second);
  const conf = Math.max(0, Math.min(1, best.confidence * 0.6 + margin * 2));
  return { ...best, confidence: conf };
}
