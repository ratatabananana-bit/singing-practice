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
  | 'chromatic'
  // vocal patterns (fixed up-and-down shapes, direction does not apply)
  | 'p151'
  | 'p1351'
  | 'p13581'
  | 'p12321'
  | 'p181'
  | 'p15851'
  | 'pMin1351';

export interface ScaleDef {
  id: ScaleId;
  name: string;
  short: string;
  /** Semitone offsets from root within one octave (no octave repeat); used for "in scale" tests. */
  intervals: number[];
  /** Semitone offsets used for the exercise (may differ from the full scale). */
  exercise: number[];
  /** Fixed pattern: play `exercise` exactly as written, ignore direction. */
  pattern?: boolean;
}

const S = (id: ScaleId, name: string, short: string, intervals: number[], exercise?: number[]): ScaleDef => ({
  id,
  name,
  short,
  intervals,
  exercise: exercise ?? [...intervals, 12],
});
const P = (id: ScaleId, name: string, short: string, intervals: number[], exercise: number[]): ScaleDef => ({
  id,
  name,
  short,
  intervals,
  exercise,
  pattern: true,
});

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];

export const SCALES: ScaleDef[] = [
  // Default Major exercise is five notes (do-re-mi-fa-sol), not a full octave.
  S('major', 'Major', 'maj', MAJOR, [0, 2, 4, 5, 7]),
  S('naturalMinor', 'Natural Minor', 'min', MINOR, [0, 2, 3, 5, 7]),
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
  // Common vocal warm-up patterns (as recommended online by degree numbers).
  P('p151', 'Fifth', '1-5-1', MAJOR, [0, 7, 0]),
  P('p181', 'Octave', '1-8-1', MAJOR, [0, 12, 0]),
  P('p12321', 'Three-note', '1-2-3-2-1', MAJOR, [0, 2, 4, 2, 0]),
  P('p1351', 'Triad', '1-3-5-3-1', MAJOR, [0, 4, 7, 4, 0]),
  P('pMin1351', 'Minor triad', '1-♭3-5-♭3-1', MINOR, [0, 3, 7, 3, 0]),
  P('p13581', 'Octave arpeggio', '1-3-5-8-5-3-1', MAJOR, [0, 4, 7, 12, 7, 4, 0]),
  P('p15851', 'Fifth & octave', '1-5-8-5-1', MAJOR, [0, 7, 12, 7, 0]),
];

export const SCALE_BY_ID: Record<ScaleId, ScaleDef> = Object.fromEntries(SCALES.map((s) => [s.id, s])) as Record<
  ScaleId,
  ScaleDef
>;

const DEGREE_BY_SEMITONE = ['1', '♭2', '2', '♭3', '3', '4', '♭5', '5', '♭6', '6', '♭7', '7'];

/** Scale-degree label for a semitone offset from the root (relative to major): 1, ♭3, 5…; octave = 8. */
export function degreeLabel(_scale: ScaleDef, interval: number): string {
  if (interval === 12) return '8';
  if (interval > 12) return `${degreeLabel(_scale, interval - 12)}'`;
  return DEGREE_BY_SEMITONE[((interval % 12) + 12) % 12];
}

/** "1 2 3 4 5" style summary of an exercise. */
export function degreeString(scale: ScaleDef): string {
  return scale.exercise.map((i) => degreeLabel(scale, i)).join(' ');
}

export type Direction = 'up' | 'down' | 'upDown';

/** Build the MIDI sequence for an exercise at `root`. Up-down does not repeat the top note. Patterns ignore direction. */
export function buildSequence(root: number, scale: ScaleDef, direction: Direction): number[] {
  const up = scale.exercise.map((i) => root + i);
  if (scale.pattern || direction === 'up') return up;
  const down = [...up].reverse();
  if (direction === 'down') return down;
  return [...up, ...down.slice(1)];
}

/** Index in the sequence at which the direction turns (for the return-arrow chip), or -1. */
export function turnIndex(scale: ScaleDef, direction: Direction): number {
  return !scale.pattern && direction === 'upDown' ? scale.exercise.length - 1 : -1;
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
