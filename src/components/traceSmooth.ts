/**
 * Display-only smoothing for pitch traces. Works on a history, so it can look at both
 * neighbours of a point (no lag in the drawn position). Silent frames (value 0 / NaN)
 * break runs so notes never bleed into each other. Never used for tuning decisions.
 *
 * level 0: raw
 * level 1: centred median-of-3 (removes single-frame outliers, keeps vibrato)
 * level 2: median-of-3 then a [1 2 1]/4 centred average (calmer line)
 * level 3: "Notes" — snap to the nearest semitone with hysteresis (karaoke-style lanes):
 *          the lane only changes once the pitch is more than 60 cents away from the
 *          current lane, so vibrato around a note stays on one lane.
 */
export function smoothTrace(values: ArrayLike<number>, level: number): Float32Array {
  if (level >= 3) return snapTrace(values);
  return smoothContinuous(values, level);
}

export function snapTrace(values: ArrayLike<number>): Float32Array {
  const base = smoothContinuous(values, 1);
  const out = new Float32Array(base.length);
  let lane = 0;
  for (let i = 0; i < base.length; i++) {
    const v = base[i];
    if (v <= 0) {
      lane = 0;
      continue;
    }
    if (lane === 0 || Math.abs(v - lane) > 0.6) lane = Math.round(v);
    out[i] = lane;
  }
  return out;
}

function smoothContinuous(values: ArrayLike<number>, level: number): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  const voiced = (v: number) => v > 0 && !Number.isNaN(v);
  for (let i = 0; i < n; i++) out[i] = voiced(values[i]) ? values[i] : 0;
  if (level <= 0 || n < 3) return out;

  const med = new Float32Array(out);
  for (let i = 1; i < n - 1; i++) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    if (b > 0 && a > 0 && c > 0) med[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  if (level === 1) return med;

  const avg = new Float32Array(med);
  for (let i = 1; i < n - 1; i++) {
    const a = med[i - 1];
    const b = med[i];
    const c = med[i + 1];
    if (b > 0 && a > 0 && c > 0) avg[i] = (a + 2 * b + c) / 4;
  }
  return avg;
}
