/** Per-note scoring of a sung segment against a target note. Pure, unit-tested. */

export interface NoteScore {
  /** Median cents off target over voiced frames (NaN when nothing was sung). */
  cents: number;
  /** Fraction of voiced frames within tolerance (0..1). */
  precision: number;
  /** Fraction of the note's duration that was voiced (0..1). */
  sustain: number;
  /** Counted as hit. */
  hit: boolean;
  /** 'flat' | 'sharp' | 'ok' | 'none' tendency of the note. */
  tendency: 'flat' | 'sharp' | 'ok' | 'none';
}

export interface ScoreFrame {
  time: number;
  /** Exact MIDI pitch, 0 = silent. */
  midi: number;
}

/**
 * Score frames that fall inside [start, end] against `targetMidi`.
 * `expectedFrames` lets sustain be computed even when frames are sparse.
 */
export function scoreNote(frames: ScoreFrame[], start: number, end: number, targetMidi: number, toleranceCents: number, hopSeconds: number): NoteScore {
  const dur = Math.max(0.001, end - start);
  const expected = Math.max(1, Math.round(dur / hopSeconds));
  const voiced: number[] = [];
  for (const f of frames) {
    if (f.time < start || f.time > end) continue;
    if (f.midi > 0) voiced.push((f.midi - targetMidi) * 100);
  }
  if (voiced.length === 0) return { cents: NaN, precision: 0, sustain: 0, hit: false, tendency: 'none' };
  const sorted = [...voiced].sort((a, b) => a - b);
  const cents = sorted[sorted.length >> 1];
  const within = voiced.filter((c) => Math.abs(c) <= toleranceCents).length;
  const precision = within / voiced.length;
  const sustain = Math.min(1, voiced.length / expected);
  const hit = precision >= 0.5 && sustain >= 0.4;
  const tendency = Math.abs(cents) <= toleranceCents ? 'ok' : cents < 0 ? 'flat' : 'sharp';
  return { cents, precision, sustain, hit, tendency };
}

export interface RunSummary {
  hits: number;
  total: number;
  /** Mean of per-note median cents (signed), NaN when nothing sung. */
  avgCents: number;
  precision: number;
  sustain: number;
  flat: number;
  sharp: number;
}

export function summarizeRun(scores: NoteScore[]): RunSummary {
  const sung = scores.filter((s) => !Number.isNaN(s.cents));
  const total = scores.length;
  const hits = scores.filter((s) => s.hit).length;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  return {
    hits,
    total,
    avgCents: avg(sung.map((s) => s.cents)),
    precision: total ? avg(scores.map((s) => s.precision)) : 0,
    sustain: total ? avg(scores.map((s) => s.sustain)) : 0,
    flat: scores.filter((s) => s.tendency === 'flat').length,
    sharp: scores.filter((s) => s.tendency === 'sharp').length,
  };
}

/** Steadiness of a held note: 1 = perfectly steady, 0 = wobbling ±50 cents or more. */
export function steadiness(centsSeries: number[]): number {
  if (centsSeries.length < 2) return 1;
  const mean = centsSeries.reduce((a, b) => a + b, 0) / centsSeries.length;
  const sd = Math.sqrt(centsSeries.reduce((a, c) => a + (c - mean) ** 2, 0) / centsSeries.length);
  return Math.max(0, Math.min(1, 1 - sd / 50));
}
