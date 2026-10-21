/**
 * Beat detection for practice loops: tempo (BPM) and beat phase from an onset-strength
 * envelope. Good enough to snap markers to beats and drive a count-in; not a DAW.
 *
 * 1. Mono signal → short frames; onset strength = half-wave-rectified log-energy difference
 *    across a few bands (cheap spectral flux without an FFT per frame).
 * 2. Tempo: autocorrelation of the onset envelope over 60–200 BPM, with a mild preference
 *    for 90–150 and for the fundamental over its half/double.
 * 3. Phase: pick the beat offset that aligns a comb of beats with the strongest onsets.
 */

export interface BeatGrid {
  bpm: number;
  /** Seconds of the first beat (0 ≤ offset < 60/bpm). */
  offset: number;
  /** 0..1 how peaked the tempo was. */
  confidence: number;
}

const BANDS: [number, number][] = [
  [0, 0.04],
  [0.04, 0.12],
  [0.12, 0.3],
  [0.3, 1],
]; // fractions of Nyquist, used with a tiny DFT per frame

/** Onset envelope at `fps` frames per second. */
export function onsetEnvelope(mono: Float32Array, sampleRate: number, fps = 50): Float32Array {
  const hop = Math.max(32, Math.round(sampleRate / fps));
  const win = hop * 2;
  const n = Math.max(0, Math.floor((mono.length - win) / hop));
  const env = new Float32Array(n);
  let prev = new Float32Array(BANDS.length);
  // 32-point crude band energies via Goertzel-like sums on a decimated window
  const dec = Math.max(1, Math.floor(win / 256));
  const m = Math.floor(win / dec);
  const re = new Float32Array(m);
  for (let f = 0; f < n; f++) {
    const off = f * hop;
    for (let i = 0; i < m; i++) re[i] = mono[off + i * dec];
    const cur = new Float32Array(BANDS.length);
    // energy in bands via a small DFT over k bins
    for (let b = 0; b < BANDS.length; b++) {
      const k0 = Math.max(1, Math.floor((BANDS[b][0] * m) / 2));
      const k1 = Math.max(k0 + 1, Math.floor((BANDS[b][1] * m) / 2));
      let e = 0;
      for (let k = k0; k < k1; k += Math.max(1, Math.floor((k1 - k0) / 6))) {
        let sr = 0;
        let si = 0;
        const w = (2 * Math.PI * k) / m;
        for (let i = 0; i < m; i++) {
          sr += re[i] * Math.cos(w * i);
          si -= re[i] * Math.sin(w * i);
        }
        e += sr * sr + si * si;
      }
      cur[b] = Math.log1p(e * 1e3);
    }
    let flux = 0;
    for (let b = 0; b < BANDS.length; b++) flux += Math.max(0, cur[b] - prev[b]);
    env[f] = flux;
    prev = cur;
  }
  // remove slow trend
  const out = new Float32Array(n);
  const k = Math.round(fps * 0.5);
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) {
      s += env[j];
      c++;
    }
    out[i] = Math.max(0, env[i] - s / c);
  }
  return out;
}

export function detectBeats(mono: Float32Array, sampleRate: number): BeatGrid | null {
  const fps = 50;
  const env = onsetEnvelope(mono, sampleRate, fps);
  if (env.length < fps * 4) return null;
  // tempo via autocorrelation
  const minLag = Math.round((60 / 200) * fps);
  const maxLag = Math.round((60 / 60) * fps);
  let best = -1;
  let bestVal = -Infinity;
  const ac = new Float32Array(maxLag + 1);
  let total = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    const bpm = (60 * fps) / lag;
    // mild preference for 90–150 BPM
    const pref = Math.exp(-0.5 * ((Math.log(bpm / 120) / 0.35) ** 2)) * 0.5 + 0.5;
    ac[lag] = s * pref;
    total += ac[lag];
    if (ac[lag] > bestVal) {
      bestVal = ac[lag];
      best = lag;
    }
  }
  if (best < 0 || bestVal <= 0) return null;
  // refine lag with parabolic interpolation
  let lag = best;
  if (best > minLag && best < maxLag) {
    const y0 = ac[best - 1];
    const y1 = ac[best];
    const y2 = ac[best + 1];
    const d = 2 * (2 * y1 - y0 - y2);
    if (d !== 0) lag = best + (y2 - y0) / d;
  }
  const bpm = (60 * fps) / lag;
  const confidence = Math.max(0, Math.min(1, (bestVal / (total / (maxLag - minLag + 1)) - 1) / 4));

  // phase: comb alignment over one period
  const period = lag;
  let bestPhase = 0;
  let bestScore = -Infinity;
  const steps = Math.max(8, Math.round(period));
  for (let p = 0; p < steps; p++) {
    const ph = (p / steps) * period;
    let s = 0;
    let c = 0;
    for (let t = ph; t < env.length; t += period) {
      const i = Math.round(t);
      if (i < env.length) {
        s += env[i];
        c++;
      }
    }
    const score = c ? s / c : 0;
    if (score > bestScore) {
      bestScore = score;
      bestPhase = ph;
    }
  }
  // The flux spikes in the first frame whose window contains the onset, i.e. up to one
  // window (2 frames) before it; shift the phase forward to compensate.
  const ONSET_LAG_FRAMES = 2;
  const periodSec = 60 / bpm;
  const offset = ((bestPhase + ONSET_LAG_FRAMES) / fps) % periodSec;
  return { bpm: Math.round(bpm * 10) / 10, offset, confidence };
}

/** Nearest beat time to `t` on the grid. */
export function snapToBeat(t: number, grid: BeatGrid, subdivision = 1): number {
  const period = 60 / grid.bpm / subdivision;
  const k = Math.round((t - grid.offset) / period);
  return Math.max(0, grid.offset + k * period);
}
