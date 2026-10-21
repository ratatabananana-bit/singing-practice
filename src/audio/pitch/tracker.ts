/**
 * Voiced/unvoiced decision with hysteresis, plus median-of-3 outlier rejection.
 * Pure logic so it can run in the worklet and be unit tested.
 */

export interface TrackerParams {
  /** Clarity needed to START a note. */
  clarityOn: number;
  /** Clarity needed to STAY in a note (lower than clarityOn). */
  clarityOff: number;
  /** dB RMS below which input is silence (user silence gate). */
  silenceDb: number;
  /** Extra frames of grace before dropping to unvoiced. */
  holdFrames: number;
  /** Apply median-of-3 to the frequency output. */
  median: boolean;
  minFreq: number;
  maxFreq: number;
}

export const DEFAULT_TRACKER: TrackerParams = {
  clarityOn: 0.9,
  clarityOff: 0.75,
  silenceDb: -50,
  holdFrames: 2,
  median: true,
  minFreq: 55,
  maxFreq: 1200,
};

export interface RawFrame {
  freq: number;
  clarity: number;
  db: number;
}

export interface PitchFrame {
  /** Seconds (audio-context time of the window end). */
  time: number;
  /** Hz, 0 when unvoiced. */
  freq: number;
  voiced: boolean;
  clarity: number;
  /** RMS loudness in dBFS. */
  db: number;
  /** Peak sample magnitude 0..1 of the last block. */
  peak: number;
}

/** Median of three numbers. */
export function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

/**
 * Median filter of length 3 that only kicks in once the buffer is full.
 * (A median over 2 values returns the larger one — biased, so we pass raw values through until full.)
 */
export class Median3 {
  private buf: number[] = [];
  push(v: number): number {
    this.buf.push(v);
    if (this.buf.length > 3) this.buf.shift();
    if (this.buf.length < 3) return v;
    return median3(this.buf[0], this.buf[1], this.buf[2]);
  }
  reset(): void {
    this.buf = [];
  }
}

export class VoicingTracker {
  private voiced = false;
  private hold = 0;
  private med = new Median3();
  constructor(public params: TrackerParams = { ...DEFAULT_TRACKER }) {}

  update(p: Partial<TrackerParams>): void {
    this.params = { ...this.params, ...p };
  }

  process(raw: RawFrame): { freq: number; voiced: boolean } {
    const p = this.params;
    const loud = raw.db >= p.silenceDb;
    const periodic = raw.freq > 0 && raw.freq >= p.minFreq && raw.freq <= p.maxFreq;
    const clarityOk = this.voiced ? raw.clarity >= p.clarityOff : raw.clarity >= p.clarityOn;
    const good = loud && periodic && clarityOk;

    if (good) {
      this.voiced = true;
      this.hold = p.holdFrames;
      const f = p.median ? this.med.push(raw.freq) : raw.freq;
      return { freq: f, voiced: true };
    }
    if (this.voiced && this.hold > 0 && loud) {
      // Brief dropout mid-note: keep the note alive for a couple of frames.
      this.hold--;
      const last = this.lastFreq();
      if (last > 0) return { freq: last, voiced: true };
    }
    this.voiced = false;
    this.hold = 0;
    this.med.reset();
    return { freq: 0, voiced: false };
  }

  private lastValue = 0;
  private lastFreq(): number {
    return this.lastValue;
  }
  /** Call after process() to remember the emitted frequency for hold frames. */
  remember(freq: number): void {
    if (freq > 0) this.lastValue = freq;
  }
  reset(): void {
    this.voiced = false;
    this.hold = 0;
    this.lastValue = 0;
    this.med.reset();
  }
}
