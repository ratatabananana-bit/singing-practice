import { fft, hann } from './fft';

/**
 * Offline spectral-gating denoise (like a simple "noise reduction" effect).
 * - Estimate the noise floor per frequency bin from the quietest frames.
 * - Attenuate bins that sit below floor * threshold, with temporal smoothing of the mask.
 * STFT: 2048-point Hann window, 75% overlap, OLA reconstruction.
 */
export function denoise(pcm: Float32Array, opts: { strength?: number; floorPercentile?: number } = {}): Float32Array {
  const N = 2048;
  const H = N / 4;
  const strength = opts.strength ?? 2; // threshold multiplier over the noise floor
  const pct = opts.floorPercentile ?? 0.2;
  if (pcm.length < N * 2) return pcm.slice();

  const win = hann(N);
  const frames = Math.floor((pcm.length - N) / H) + 1;
  const bins = N / 2 + 1;
  const mags = new Array<Float32Array>(frames);
  const res = new Array<Float32Array>(frames);
  const ims = new Array<Float32Array>(frames);

  for (let f = 0; f < frames; f++) {
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    const off = f * H;
    for (let i = 0; i < N; i++) re[i] = pcm[off + i] * win[i];
    fft(re, im);
    const m = new Float32Array(bins);
    for (let k = 0; k < bins; k++) m[k] = Math.hypot(re[k], im[k]);
    mags[f] = m;
    res[f] = re;
    ims[f] = im;
  }

  // Noise floor per bin: mean magnitude over the quietest `pct` of frames (by frame energy).
  const energy = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const m = mags[f];
    for (let k = 0; k < bins; k++) e += m[k] * m[k];
    energy[f] = e;
  }
  const order = Array.from({ length: frames }, (_, i) => i).sort((a, b) => energy[a] - energy[b]);
  const quiet = order.slice(0, Math.max(1, Math.floor(frames * pct)));
  const floor = new Float32Array(bins);
  for (const f of quiet) {
    const m = mags[f];
    for (let k = 0; k < bins; k++) floor[k] += m[k];
  }
  for (let k = 0; k < bins; k++) floor[k] /= quiet.length;

  // Build smoothed masks and resynthesize.
  const out = new Float32Array(pcm.length);
  const norm = new Float32Array(pcm.length);
  let prevMask = new Float32Array(bins).fill(1);
  for (let f = 0; f < frames; f++) {
    const m = mags[f];
    const mask = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      const thr = floor[k] * strength;
      const p = m[k] * m[k];
      let g = thr > 0 ? (p - thr * thr) / Math.max(p, 1e-12) : 1;
      g = Math.max(0.05, Math.min(1, g)); // keep a floor so it does not sound hollow
      mask[k] = g;
    }
    for (let k = 1; k < bins - 1; k++) mask[k] = (mask[k - 1] + mask[k] * 2 + mask[k + 1]) / 4;
    for (let k = 0; k < bins; k++) mask[k] = 0.6 * mask[k] + 0.4 * prevMask[k];
    prevMask = mask;

    const re = res[f];
    const im = ims[f];
    for (let k = 0; k < bins; k++) {
      re[k] *= mask[k];
      im[k] *= mask[k];
      if (k > 0 && k < N / 2) {
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
    }
    fft(re, im, true);
    const off = f * H;
    for (let i = 0; i < N; i++) {
      out[off + i] += re[i] * win[i];
      norm[off + i] += win[i] * win[i];
    }
  }
  for (let i = 0; i < out.length; i++) if (norm[i] > 1e-6) out[i] /= norm[i];
  // Copy any tail not covered by frames.
  const covered = (frames - 1) * H + N;
  for (let i = covered; i < pcm.length; i++) out[i] = pcm[i];
  return out;
}
