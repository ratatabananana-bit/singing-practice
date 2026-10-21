export type ScaleId =
  | 'major'
  | 'naturalMinor'
  | 'harmonicMinor'
  | 'melodicMinor'
  | 'majorPentatonic'
  | 'minorPentatonic'
  | 'blues'
  | 'dorian'
  | 'mixolydian'
  | 'majorArpeggio'
  | 'minorArpeggio'
  | 'chromatic';

export interface ScaleDef {
  id: ScaleId;
  name: string;
  short: string;
  /** Semitone offsets from root within one octave (no octave repeat). */
  intervals: number[];
  /** Semitone offsets used for the exercise (may differ from the full scale). */
  exercise: number[];
}

const S = (id: ScaleId, name: string, short: string, intervals: number[], exercise?: number[]): ScaleDef => ({
  id,
  name,
  short,
  intervals,
  exercise: exercise ?? [...intervals, 12],
});

export const SCALES: ScaleDef[] = [
  // Default Major exercise is five notes (do-re-mi-fa-sol), not a full octave.
  S('major', 'Major', 'maj', [0, 2, 4, 5, 7, 9, 11], [0, 2, 4, 5, 7]),
  S('naturalMinor', 'Natural Minor', 'min', [0, 2, 3, 5, 7, 8, 10], [0, 2, 3, 5, 7]),
  S('harmonicMinor', 'Harmonic Minor', 'harm', [0, 2, 3, 5, 7, 8, 11]),
  S('melodicMinor', 'Melodic Minor', 'mel', [0, 2, 3, 5, 7, 9, 11]),
  S('majorPentatonic', 'Major Pentatonic', 'maj pent', [0, 2, 4, 7, 9]),
  S('minorPentatonic', 'Minor Pentatonic', 'min pent', [0, 3, 5, 7, 10]),
  S('blues', 'Blues', 'blues', [0, 3, 5, 6, 7, 10]),
  S('dorian', 'Dorian', 'dor', [0, 2, 3, 5, 7, 9, 10]),
  S('mixolydian', 'Mixolydian', 'mixo', [0, 2, 4, 5, 7, 9, 10]),
  S('majorArpeggio', 'Major Arpeggio', 'maj arp', [0, 4, 7]),
  S('minorArpeggio', 'Minor Arpeggio', 'min arp', [0, 3, 7]),
  S('chromatic', 'Chromatic', 'chrom', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
];

export const SCALE_BY_ID: Record<ScaleId, ScaleDef> = Object.fromEntries(SCALES.map((s) => [s.id, s])) as Record<
  ScaleId,
  ScaleDef
>;

export type Direction = 'up' | 'down' | 'upDown';

/** Build the MIDI sequence for an exercise at `root`. Up-down does not repeat the top note. */
export function buildSequence(root: number, scale: ScaleDef, direction: Direction): number[] {
  const up = scale.exercise.map((i) => root + i);
  if (direction === 'up') return up;
  const down = [...up].reverse();
  if (direction === 'down') return down;
  return [...up, ...down.slice(1)];
}

/** Index in the sequence at which the direction turns (for the return-arrow chip), or -1. */
export function turnIndex(scale: ScaleDef, direction: Direction): number {
  return direction === 'upDown' ? scale.exercise.length - 1 : -1;
}

export function isInScale(midi: number, root: number, scale: ScaleDef): boolean {
  const pc = (((midi - root) % 12) + 12) % 12;
  return scale.intervals.includes(pc);
}

/** All MIDI notes in [lo, hi] that belong to the scale. */
export function scaleNotesInRange(root: number, scale: ScaleDef, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (isInScale(m, root, scale)) out.push(m);
  return out;
}
