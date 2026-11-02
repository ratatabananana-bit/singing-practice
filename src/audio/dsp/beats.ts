import { fft, hann } from './fft';

/**
 * Beat tracking for practice loops: beat times that follow tempo drift, a median BPM, the meter
 * (3 or 4) and which beat is the downbeat. Good enough to snap markers, draw bars and drive a
 * count-in; not a DAW.
 *
 * Pipeline (the standard "spectral flux + dynamic programming" recipe, Ellis 2007):
 * 1. STFT at ~100 frames/s → 40 mel bands → log-compressed spectral flux (half-wave rectified
 *    increase per band). A bass-only flux is kept for the downbeat step.
 * 2. Tempo per 8 s window: autocorrelation of the flux over 50–210 BPM with a log-Gaussian prior
 *    around 110 BPM, top peaks kept, then a Viterbi path across windows that penalises tempo
 *    jumps (so octave flips are rare but real drift is followed). Interpolated to a per-frame period.
 * 3. Beats: dynamic programming that maximises onset strength at beats while keeping each gap
 *    close to the local period (tightness penalty on log(gap/period)).
 * 4. Downbeats: per-beat accent (flux + bass flux + beat-to-beat spectral change); score every
 *    (meter, phase) for meter 4 and 3; 4 wins unless 3 is clearly more periodic.
 */

export interface BeatGrid {
  /** Median tempo. */
  bpm: number;
  /** Seconds of the first beat modulo one period (legacy fixed-grid consumers). */
  offset: number;
  /** 0..1 how peaked the tempo was. */
  confidence: number;
  /** Tracked beat times in seconds, ascending. Missing on grids saved by older versions. */
  beats?: number[];
  /** Beats per bar (3 or 4). */
  beatsPerBar?: number;
  /** Index (0..beatsPerBar-1) of the beat phase that is the downbeat: beats[i] is a bar line when (i - barStart) % beatsPerBar === 0. */
  barStart?: number;
}

const FPS = 100;
const MIN_BPM = 50;
const MAX_BPM = 210;
/** Centre and width (octaves) of the tempo prior. */
const PRIOR_BPM = 110;
const PRIOR_OCTAVES = 1.0;
/** DP penalty weight on log(gap / local period). Higher = stiffer tempo. */
const TIGHTNESS = 100;

interface Envelope {
  /** Spectral flux per frame, local mean removed, ≥ 0. */
  flux: Float32Array;
  /** Flux restricted to the bass bands (< ~180 Hz), same smoothing. */
  bass: Float32Array;
  /** Mel band log energies per frame (for beat-to-beat spectral change). */
  bands: Float32Array[];
  fps: number;
  /** Seconds of frame f's centre. */
  frameTime: (f: number) => number;
}

function hzToMel(f: number): number {
  return 2595 * Math.log10(1 + f / 700);
}
function melToHz(m: number): number {
  return 700 * (10 ** (m / 2595) - 1);
}

/** Triangular mel filterbank over the first `bins` FFT bins. Returns per band [startBin, weights]. */
function melFilters(nBands: number, fftSize: number, sr: number, fMin: number, fMax: number): { start: number; w: Float32Array }[] {
  const bins = fftSize / 2;
  const mLo = hzToMel(fMin);
  const mHi = hzToMel(fMax);
  const edges: number[] = [];
  for (let i = 0; i <= nBands + 1; i++) edges.push((melToHz(mLo + ((mHi - mLo) * i) / (nBands + 1)) / (sr / 2)) * bins);
  const out: { start: number; w: Float32Array }[] = [];
  for (let b = 0; b < nBands; b++) {
    const lo = edges[b];
    const mid = edges[b + 1];
    const hi = edges[b + 2];
    const start = Math.max(0, Math.floor(lo));
    const end = Math.min(bins - 1, Math.ceil(hi));
    const w = new Float32Array(Math.max(1, end - start + 1));
    for (let k = start; k <= end; k++) {
      const v = k < mid ? (k - lo) / Math.max(1e-6, mid - lo) : (hi - k) / Math.max(1e-6, hi - mid);
      w[k - start] = Math.max(0, v);
    }
    out.push({ start, w });
  }
  return out;
}

/** Remove a ±`halfSec` moving average and half-wave rectify. */
function detrend(x: Float32Array, fps: number, halfSec = 0.5): Float32Array {
  const n = x.length;
  const out = new Float32Array(n);
  const k = Math.max(1, Math.round(fps * halfSec));
  // prefix sums for an O(n) moving average
  const ps = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) ps[i + 1] = ps[i] + x[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - k);
    const b = Math.min(n, i + k + 1);
    out[i] = Math.max(0, x[i] - (ps[b] - ps[a]) / (b - a));
  }
  return out;
}

/** Onset envelope (mel spectral flux) at ~100 frames/s. Exported for tests and tooling. */
export function onsetEnvelope(mono: Float32Array, sampleRate: number, fps = FPS): Envelope {
  const hop = Math.max(16, Math.round(sampleRate / fps));
  const realFps = sampleRate / hop;
  // ~90 ms window, power of two
  let N = 256;
  while (N < sampleRate * 0.09) N <<= 1;
  const nFrames = Math.max(0, Math.floor((mono.length - N) / hop) + 1);
  const nBands = 40;
  const fMax = Math.min(8000, sampleRate / 2 - 50);
  const filters = melFilters(nBands, N, sampleRate, 30, fMax);
  const bassBands = filters.filter((f) => ((f.start + f.w.length / 2) / (N / 2)) * (sampleRate / 2) < 180).length;
  const win = hann(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const power = new Float32Array(N / 2);
  const bands: Float32Array[] = new Array(nFrames);
  const flux = new Float32Array(nFrames);
  const bass = new Float32Array(nFrames);
  let prev: Float32Array | null = null;
  for (let f = 0; f < nFrames; f++) {
    const off = f * hop;
    for (let i = 0; i < N; i++) {
      re[i] = mono[off + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    const cur = new Float32Array(nBands);
    for (let b = 0; b < nBands; b++) {
      const { start, w } = filters[b];
      let e = 0;
      for (let j = 0; j < w.length; j++) e += power[start + j] * w[j];
      cur[b] = Math.log1p(e * 1e4);
    }
    bands[f] = cur;
    if (prev) {
      let s = 0;
      let sb = 0;
      for (let b = 0; b < nBands; b++) {
        const d = Math.max(0, cur[b] - prev[b]);
        s += d;
        if (b < bassBands) sb += d;
      }
      flux[f] = s;
      bass[f] = sb;
    }
    prev = cur;
  }
  return {
    flux: detrend(flux, realFps),
    bass: detrend(bass, realFps),
    bands,
    fps: realFps,
    // Where in frame f's window an onset sits when the flux peaks there. Hann weighting puts the
    // steepest energy rise at 3/4 of the window; short real attacks push it a little later.
    // Calibrated on synthetic clicks: 0.875·N leaves < 3 ms bias at 11 kHz (see beats.test.ts).
    frameTime: (f) => (f * hop + 0.875 * N) / sampleRate,
  };
}

/** Log-Gaussian tempo prior, 1 at PRIOR_BPM. */
function tempoPrior(bpm: number): number {
  const x = Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES;
  return Math.exp(-0.5 * x * x);
}

interface TempoCandidate {
  lag: number; // frames
  score: number; // 0..1 relative to the window's strongest
}

/** Top autocorrelation peaks of one window of flux, prior-weighted. Exported for tests. */
export function windowTempo(flux: Float32Array, from: number, to: number, fps: number, top = 4): TempoCandidate[] {
  const minLag = Math.max(2, Math.round((60 / MAX_BPM) * fps));
  const maxLag = Math.round((60 / MIN_BPM) * fps);
  const n = to - from;
  if (n <= maxLag * 2) return [];
  const ac = new Float32Array(maxLag + 2);
  let any = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = from + lag; i < to; i++) s += flux[i] * flux[i - lag];
    ac[lag] = (s / (n - lag)) * tempoPrior((60 * fps) / lag);
    any += ac[lag];
  }
  if (any <= 0) return [];
  const peaks: TempoCandidate[] = [];
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (ac[lag] > ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
      // parabolic refinement
      const y0 = ac[lag - 1];
      const y1 = ac[lag];
      const y2 = ac[lag + 1];
      const d = 2 * (2 * y1 - y0 - y2);
      peaks.push({ lag: d !== 0 ? lag + (y2 - y0) / d : lag, score: y1 });
    }
  }
  // Octave rule: a click train scores the same at the beat period and at twice it. When the
  // half-period peak is nearly as strong, it is the beat (up to 170 BPM; beyond that the slower
  // reading is usually what people tap).
  for (const p of peaks) {
    const half = peaks.find((q) => Math.abs(q.lag - p.lag / 2) < 1.5);
    if (half && (60 * fps) / half.lag <= 170 && half.score >= 0.9 * p.score) half.score = Math.max(half.score, p.score * 1.05);
  }
  peaks.sort((a, b) => b.score - a.score);
  const best = peaks[0]?.score ?? 0;
  if (best <= 0) return [];
  return peaks.slice(0, top).map((p) => ({ lag: p.lag, score: p.score / best }));
}

/**
 * Period (frames) per frame: windowed tempo candidates joined by a Viterbi path that charges
 * for tempo jumps, so a steady song gets one tempo and a drifting one is followed.
 * Returns null when no window had a usable peak. Also returns the tempo confidence.
 */
function localPeriod(flux: Float32Array, fps: number): { period: Float32Array; confidence: number } | null {
  const n = flux.length;
  const winLen = Math.round(fps * 8);
  const hop = Math.round(fps * 2);
  const centres: number[] = [];
  const cands: TempoCandidate[][] = [];
  if (n <= winLen) {
    const c = windowTempo(flux, 0, n, fps);
    if (!c.length) return null;
    centres.push(n / 2);
    cands.push(c);
  } else {
    for (let s = 0; s + winLen <= n; s += hop) {
      const c = windowTempo(flux, s, s + winLen, fps);
      if (c.length) {
        centres.push(s + winLen / 2);
        cands.push(c);
      }
    }
    if (!cands.length) return null;
  }
  // Viterbi over candidate lists. cost = -score + JUMP * |log2(lag_i / lag_prev)|
  const JUMP = 2.5;
  const W = cands.length;
  const cost: number[][] = cands.map((c) => c.map((x) => 1 - x.score));
  const back: number[][] = cands.map((c) => c.map(() => -1));
  for (let w = 1; w < W; w++) {
    for (let j = 0; j < cands[w].length; j++) {
      let bestC = Infinity;
      let bestI = -1;
      for (let i = 0; i < cands[w - 1].length; i++) {
        const c = cost[w - 1][i] + JUMP * Math.abs(Math.log2(cands[w][j].lag / cands[w - 1][i].lag));
        if (c < bestC) {
          bestC = c;
          bestI = i;
        }
      }
      cost[w][j] += bestC;
      back[w][j] = bestI;
    }
  }
  let j = 0;
  for (let k = 1; k < cands[W - 1].length; k++) if (cost[W - 1][k] < cost[W - 1][j]) j = k;
  const path = new Array<number>(W);
  for (let w = W - 1; w >= 0; w--) {
    path[w] = cands[w][j].lag;
    j = back[w][j] >= 0 ? back[w][j] : 0;
  }
  // Interpolate per frame.
  const period = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    if (f <= centres[0]) period[f] = path[0];
    else if (f >= centres[W - 1]) period[f] = path[W - 1];
    else {
      let w = 0;
      while (centres[w + 1] < f) w++;
      const t = (f - centres[w]) / (centres[w + 1] - centres[w]);
      period[f] = path[w] * (1 - t) + path[w + 1] * t;
    }
  }
  // Confidence: how dominant the chosen peak was on average (second peak score is 1 - margin).
  let conf = 0;
  for (let w = 0; w < W; w++) {
    const second = cands[w][1]?.score ?? 0;
    conf += 1 - second;
  }
  return { period, confidence: Math.max(0, Math.min(1, conf / W)) };
}

/** Ellis-style dynamic programming beat placement against a per-frame period. */
function trackBeats(flux: Float32Array, period: Float32Array): number[] {
  const n = flux.length;
  if (n === 0) return [];
  // Normalise onset strength so TIGHTNESS is meaningful across songs.
  let mean = 0;
  for (let i = 0; i < n; i++) mean += flux[i];
  mean /= n;
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (flux[i] - mean) ** 2;
  const std = Math.sqrt(varSum / n) || 1;
  const score = new Float32Array(n);
  for (let i = 0; i < n; i++) score[i] = flux[i] / std;
  const cum = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const P = period[i];
    const lo = Math.max(0, Math.round(i - 2 * P));
    const hi = Math.round(i - P / 2);
    let best = -Infinity;
    let bestJ = -1;
    for (let j = hi; j >= lo; j--) {
      const gap = i - j;
      const l = Math.log(gap / P);
      const c = cum[j] - TIGHTNESS * l * l;
      if (c > best) {
        best = c;
        bestJ = j;
      }
    }
    if (bestJ >= 0 && best > 0) {
      cum[i] = score[i] + best;
      back[i] = bestJ;
    } else cum[i] = score[i];
  }
  // Start backtracking from the best score in the last period.
  let end = n - 1;
  const lastP = Math.round(period[n - 1]);
  for (let i = Math.max(0, n - 1 - lastP); i < n; i++) if (cum[i] > cum[end]) end = i;
  const beats: number[] = [];
  for (let i = end; i >= 0; i = back[i]) {
    beats.push(i);
    if (back[i] < 0) break;
  }
  beats.reverse();
  return beats;
}

/** Per-beat accent: flux and bass flux around the beat plus spectral change from the previous beat. */
function accents(beatFrames: number[], env: Envelope): Float32Array {
  const n = beatFrames.length;
  const out = new Float32Array(n);
  const win = Math.max(1, Math.round(env.fps * 0.03));
  const peak = (arr: Float32Array, f: number) => {
    let m = 0;
    for (let k = Math.max(0, f - win); k <= Math.min(arr.length - 1, f + win); k++) m = Math.max(m, arr[k]);
    return m;
  };
  let fluxMax = 1e-6;
  let bassMax = 1e-6;
  let chMax = 1e-6;
  const fl = new Float32Array(n);
  const bs = new Float32Array(n);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = beatFrames[i];
    fl[i] = peak(env.flux, f);
    bs[i] = peak(env.bass, f);
    if (i > 0) {
      const a = env.bands[Math.min(env.bands.length - 1, beatFrames[i - 1])];
      const b = env.bands[Math.min(env.bands.length - 1, f)];
      let d = 0;
      for (let k = 0; k < a.length; k++) d += Math.abs(b[k] - a[k]);
      ch[i] = d;
    }
    fluxMax = Math.max(fluxMax, fl[i]);
    bassMax = Math.max(bassMax, bs[i]);
    chMax = Math.max(chMax, ch[i]);
  }
  for (let i = 0; i < n; i++) out[i] = fl[i] / fluxMax + 1.5 * (bs[i] / bassMax) + 0.5 * (ch[i] / chMax);
  return out;
}

/** Meter (3 or 4) and downbeat phase from the per-beat accent pattern. */
function detectDownbeats(acc: Float32Array): { beatsPerBar: number; barStart: number } {
  const n = acc.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += acc[i];
  mean /= Math.max(1, n);
  const evalMeter = (bpb: number) => {
    let bestP = 0;
    let bestS = -Infinity;
    for (let p = 0; p < bpb; p++) {
      let s = 0;
      let c = 0;
      for (let i = p; i < n; i += bpb) {
        s += acc[i] - mean;
        c++;
      }
      const v = c ? s / c : 0;
      if (v > bestS) {
        bestS = v;
        bestP = p;
      }
    }
    return { p: bestP, s: bestS };
  };
  let varSum = 0;
  for (let i = 0; i < n; i++) varSum += (acc[i] - mean) ** 2;
  const std = Math.sqrt(varSum / Math.max(1, n));
  const m4 = evalMeter(4);
  const m3 = evalMeter(3);
  // 4/4 unless 3 is clearly more periodic AND the 3-accent is a real effect, not noise: with no
  // accents at all every phase mean sits within a fraction of a standard deviation of zero.
  if (n >= 12 && m3.s > m4.s * 1.25 && m3.s > 0.3 * std) return { beatsPerBar: 3, barStart: m3.p };
  return { beatsPerBar: 4, barStart: m4.p };
}

export function detectBeats(mono: Float32Array, sampleRate: number): BeatGrid | null {
  const env = onsetEnvelope(mono, sampleRate);
  const { flux, fps } = env;
  if (flux.length < fps * 4) return null;
  let total = 0;
  for (let i = 0; i < flux.length; i++) total += flux[i];
  if (total <= 1e-6) return null;
  const lp = localPeriod(flux, fps);
  if (!lp) return null;
  const beatFrames = trackBeats(flux, lp.period);
  if (beatFrames.length < 4) return null;
  const beats = beatFrames.map((f) => Math.max(0, env.frameTime(f)));
  const gaps = beats.slice(1).map((t, i) => t - beats[i]).sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)];
  if (!(medianGap > 0)) return null;
  const bpm = Math.round((60 / medianGap) * 10) / 10;
  const { beatsPerBar, barStart } = detectDownbeats(accents(beatFrames, env));
  const period = 60 / bpm;
  return {
    bpm,
    offset: ((beats[0] % period) + period) % period,
    confidence: lp.confidence,
    beats,
    beatsPerBar,
    barStart,
  };
}

/** Index of the beat nearest to `t` (tracked grids), or null for legacy fixed grids. */
export function nearestBeatIndex(t: number, grid: BeatGrid): number | null {
  const b = grid.beats;
  if (!b || b.length === 0) return null;
  let lo = 0;
  let hi = b.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (b[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(b[lo - 1] - t) <= Math.abs(b[lo] - t)) return lo - 1;
  return lo;
}

/** Beat time for index `i`, extrapolated by the median period beyond the tracked range. */
export function beatTime(i: number, grid: BeatGrid): number {
  const b = grid.beats;
  if (!b || b.length === 0) return grid.offset + (i * 60) / grid.bpm;
  if (i < 0) return b[0] + (i * 60) / grid.bpm;
  if (i >= b.length) return b[b.length - 1] + ((i - b.length + 1) * 60) / grid.bpm;
  return b[i];
}

/** True when beat `i` is a bar line. */
export function isDownbeat(i: number, grid: BeatGrid, beatsPerBar: number): boolean {
  const start = grid.barStart ?? 0;
  const bpb = Math.max(1, beatsPerBar);
  return (((i - start) % bpb) + bpb) % bpb === 0;
}

/** Nearest beat (or subdivision) time to `t`. */
export function snapToBeat(t: number, grid: BeatGrid, subdivision = 1): number {
  const b = grid.beats;
  if (b && b.length >= 2) {
    const i = nearestBeatIndex(t, grid)!;
    if (subdivision <= 1) return b[i];
    // Subdivide the interval `t` falls in.
    const j = t < b[i] ? i - 1 : i;
    const t0 = beatTime(j, grid);
    const t1 = beatTime(j + 1, grid);
    const step = (t1 - t0) / subdivision;
    const k = Math.round((t - t0) / step);
    return Math.max(0, t0 + k * step);
  }
  const period = 60 / grid.bpm / subdivision;
  const k = Math.round((t - grid.offset) / period);
  return Math.max(0, grid.offset + k * period);
}

/** 1-based bar that contains `t` (0 before the first bar line): tracked beats from the downbeat phase, else the fixed period. */
export function barNumber(t: number, grid: BeatGrid, beatsPerBar: number): number {
  const bpb = Math.max(1, beatsPerBar);
  const b = grid.beats;
  if (b && b.length > 0) {
    // Last beat at or before t (the beat the time sits in).
    let lo = 0;
    let hi = b.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (b[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    const i = lo - 1;
    if (i < 0) return 0;
    return Math.floor((i - (grid.barStart ?? 0)) / bpb) + 1;
  }
  const period = 60 / grid.bpm;
  const j = Math.floor((t - grid.offset + 1e-9) / period);
  return j < 0 ? 0 : Math.floor(j / bpb) + 1;
}

/** Length of a span in bars at the grid's median tempo: "8 bars", "4.5 bars", "1 bar". */
export function barsLabel(start: number, end: number, grid: BeatGrid, beatsPerBar: number): string {
  const bar = (60 / grid.bpm) * Math.max(1, beatsPerBar);
  const n = (end - start) / bar;
  const whole = Math.abs(n - Math.round(n)) < 0.05;
  const v = whole ? Math.round(n) : n.toFixed(1);
  return `${v} ${whole && Math.round(n) === 1 ? 'bar' : 'bars'}`;
}
