/**
 * McLeod Pitch Method (MPM).
 * Normalised square difference function + key-maximum picking with parabolic interpolation.
 * Pure function: safe to run inside an AudioWorklet.
 */

export interface MpmOptions {
  sampleRate: number;
  minFreq: number;
  maxFreq: number;
  /** Key-maximum pick threshold k (0..1). Lower favours lower octaves. */
  k: number;
}

export interface MpmResult {
  /** Detected frequency in Hz, or 0 when nothing periodic was found. */
  freq: number;
  /** Peak NSDF value 0..1 (periodicity "clarity"). */
  clarity: number;
}

export function nsdf(buf: Float32Array, tauMin: number, tauMax: number, out: Float32Array): void {
  const n = buf.length;
  for (let tau = 0; tau <= tauMax; tau++) {
    if (tau < tauMin && tau !== 0) {
      out[tau] = 0;
      continue;
    }
    let acf = 0;
    let m = 0;
    const lim = n - tau;
    for (let j = 0; j < lim; j++) {
      const a = buf[j];
      const b = buf[j + tau];
      acf += a * b;
      m += a * a + b * b;
    }
    out[tau] = m > 0 ? (2 * acf) / m : 0;
  }
}

export function mpm(buf: Float32Array, opts: MpmOptions, scratch?: Float32Array): MpmResult {
  const n = buf.length;
  const tauMax = Math.min(n - 2, Math.floor(opts.sampleRate / opts.minFreq));
  const tauMin = Math.max(2, Math.floor(opts.sampleRate / opts.maxFreq));
  const nsd = scratch && scratch.length > tauMax ? scratch : new Float32Array(tauMax + 1);
  nsdf(buf, tauMin, tauMax, nsd);

  // Key maxima between positive-going zero crossings, starting after the first negative dip.
  const maxPos: number[] = [];
  let pos = tauMin;
  // skip until nsdf goes negative
  while (pos < tauMax && nsd[pos] > 0) pos++;
  while (pos < tauMax) {
    // skip negative region
    while (pos < tauMax && nsd[pos] <= 0) pos++;
    let best = -1;
    let bestVal = -Infinity;
    while (pos < tauMax && nsd[pos] > 0) {
      if (nsd[pos] > bestVal) {
        bestVal = nsd[pos];
        best = pos;
      }
      pos++;
    }
    if (best > 0) maxPos.push(best);
  }
  if (maxPos.length === 0) return { freq: 0, clarity: 0 };

  let highest = -Infinity;
  for (const p of maxPos) highest = Math.max(highest, nsd[p]);
  const thresh = opts.k * highest;
  let chosen = -1;
  for (const p of maxPos) {
    if (nsd[p] >= thresh) {
      chosen = p;
      break;
    }
  }
  if (chosen <= 0) return { freq: 0, clarity: 0 };

  // Parabolic interpolation around the chosen peak.
  const y0 = nsd[chosen - 1];
  const y1 = nsd[chosen];
  const y2 = chosen + 1 <= tauMax ? nsd[chosen + 1] : y1;
  const denom = 2 * (2 * y1 - y0 - y2);
  const delta = denom !== 0 ? (y2 - y0) / denom : 0;
  const tau = chosen + Math.max(-1, Math.min(1, delta));
  const clarity = Math.max(0, Math.min(1, y1 - ((y2 - y0) * delta) / 4));
  const freq = opts.sampleRate / tau;
  if (freq < opts.minFreq || freq > opts.maxFreq) return { freq: 0, clarity };
  return { freq, clarity };
}

export function rmsDb(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  const rms = Math.sqrt(s / buf.length);
  return rms > 0 ? Math.max(-120, 20 * Math.log10(rms)) : -120;
}

export function peakAbs(buf: Float32Array): number {
  let p = 0;
  for (let i = 0; i < buf.length; i++) {
    const a = Math.abs(buf[i]);
    if (a > p) p = a;
  }
  return p;
}
