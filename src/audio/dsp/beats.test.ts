import { describe, it, expect } from 'vitest';
import { barNumber, barsLabel, detectBeats, snapToBeat, isDownbeat, nearestBeatIndex } from './beats';

/**
 * Synthetic rhythm: sustained chord + a noise burst on every beat. `bpmAt(t)` lets the tempo drift.
 * Every `accentEvery`-th beat (from `accentPhase`) is louder and gets a bass thump, like a kick on 1.
 */
function clickTrack(opts: { seconds: number; bpmAt: (t: number) => number; sr?: number; phase?: number; accentEvery?: number; accentPhase?: number; seed?: number }) {
  const sr = opts.sr ?? 11025;
  const n = Math.round(opts.seconds * sr);
  const out = new Float32Array(n);
  // deterministic noise
  let s = opts.seed ?? 12345;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const beats: number[] = [];
  let t = opts.phase ?? 0.2;
  while (t < opts.seconds) {
    beats.push(t);
    t += 60 / opts.bpmAt(t);
  }
  for (let i = 0; i < n; i++) {
    const tt = i / sr;
    out[i] = 0.12 * (Math.sin(2 * Math.PI * 220 * tt) + Math.sin(2 * Math.PI * 277 * tt));
  }
  const every = opts.accentEvery ?? 0;
  const ph = opts.accentPhase ?? 0;
  beats.forEach((b, k) => {
    const accent = every > 0 && (k - ph) % every === 0;
    const amp = accent ? 0.9 : 0.45;
    const i0 = Math.round(b * sr);
    for (let i = i0; i < Math.min(n, i0 + Math.round(0.03 * sr)); i++) {
      const since = (i - i0) / sr;
      out[i] += amp * (1 - since / 0.03) * (rnd() * 2 - 1);
    }
    if (accent) {
      for (let i = i0; i < Math.min(n, i0 + Math.round(0.1 * sr)); i++) {
        const since = (i - i0) / sr;
        out[i] += 0.8 * Math.exp(-since * 25) * Math.sin(2 * Math.PI * 55 * since);
      }
    }
  });
  return { audio: out, beats, sr };
}

/** Fraction of true beats that have a detected beat within `tol` seconds. */
function hitRate(truth: number[], found: number[], tol: number): number {
  let hits = 0;
  for (const t of truth) if (found.some((f) => Math.abs(f - t) <= tol)) hits++;
  return hits / truth.length;
}

describe('detectBeats', () => {
  it('finds 120 BPM and lands on the beats', () => {
    const { audio, beats, sr } = clickTrack({ seconds: 12, bpmAt: () => 120 });
    const g = detectBeats(audio, sr)!;
    expect(g).not.toBeNull();
    expect(Math.abs(g.bpm - 120)).toBeLessThan(2);
    expect(hitRate(beats.slice(1, -1), g.beats!, 0.035)).toBeGreaterThan(0.9);
  });

  it('finds 92 BPM', () => {
    const { audio, sr } = clickTrack({ seconds: 12, bpmAt: () => 92 });
    const g = detectBeats(audio, sr)!;
    expect(Math.abs(g.bpm - 92)).toBeLessThan(2);
  });

  it('follows a tempo that drifts from 100 to 130 BPM', () => {
    const { audio, beats, sr } = clickTrack({ seconds: 40, bpmAt: (t) => 100 + (30 * t) / 40 });
    const g = detectBeats(audio, sr)!;
    expect(g).not.toBeNull();
    expect(hitRate(beats.slice(2, -2), g.beats!, 0.04)).toBeGreaterThan(0.9);
    // Gaps shrink over time.
    const b = g.beats!;
    const early = b[5] - b[4];
    const late = b[b.length - 5] - b[b.length - 6];
    expect(late).toBeLessThan(early * 0.9);
  });

  it('finds 4/4 and the downbeat phase', () => {
    const { audio, beats, sr } = clickTrack({ seconds: 24, bpmAt: () => 112, accentEvery: 4, accentPhase: 2 });
    const g = detectBeats(audio, sr)!;
    expect(g.beatsPerBar).toBe(4);
    // Every detected downbeat should sit on an accented true beat (k ≡ 2 mod 4).
    const accented = beats.filter((_, k) => (k - 2) % 4 === 0);
    const downs = g.beats!.filter((_, i) => isDownbeat(i, g, g.beatsPerBar!));
    expect(downs.length).toBeGreaterThan(3);
    expect(hitRate(downs, accented, 0.04)).toBeGreaterThan(0.85);
  });

  it('finds 3/4 when the accent comes every third beat', () => {
    const { audio, beats, sr } = clickTrack({ seconds: 24, bpmAt: () => 126, accentEvery: 3, accentPhase: 1 });
    const g = detectBeats(audio, sr)!;
    expect(g.beatsPerBar).toBe(3);
    const accented = beats.filter((_, k) => (k - 1) % 3 === 0);
    const downs = g.beats!.filter((_, i) => isDownbeat(i, g, g.beatsPerBar!));
    expect(hitRate(downs, accented, 0.04)).toBeGreaterThan(0.85);
  });

  it('defaults to 4/4 when nothing is accented', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { audio, sr } = clickTrack({ seconds: 30, bpmAt: () => 118, seed });
      const g = detectBeats(audio, sr)!;
      expect(g.beatsPerBar).toBe(4);
    }
  });

  it('returns null for silence', () => {
    expect(detectBeats(new Float32Array(11025 * 8), 11025)).toBeNull();
  });

  it('snaps to the nearest beat and half beat on a tracked grid', () => {
    const g = { bpm: 120, offset: 0.1, confidence: 1, beats: [0.1, 0.6, 1.1, 1.62, 2.1] };
    expect(snapToBeat(1.08, g)).toBeCloseTo(1.1);
    expect(snapToBeat(1.3, g)).toBeCloseTo(1.1);
    expect(snapToBeat(1.3, g, 2)).toBeCloseTo(1.36);
    expect(nearestBeatIndex(1.7, g)).toBe(3);
  });

  it('snaps on a legacy fixed grid', () => {
    const g = { bpm: 120, offset: 0.1, confidence: 1 };
    expect(snapToBeat(1.08, g)).toBeCloseTo(1.1);
    expect(snapToBeat(1.3, g, 2)).toBeCloseTo(1.35);
  });
});

describe('barNumber', () => {
  it('counts bars from the downbeat phase on a tracked grid', () => {
    const grid = { bpm: 120, offset: 0, confidence: 1, beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], beatsPerBar: 4, barStart: 1 };
    // bar lines at beats 1, 5 → 0.5 s and 2.5 s
    expect(barNumber(0.6, grid, 4)).toBe(1);
    expect(barNumber(2.4, grid, 4)).toBe(1);
    expect(barNumber(2.5, grid, 4)).toBe(2);
    expect(barNumber(3.9, grid, 4)).toBe(2);
  });

  it('is bar 0 before the first downbeat', () => {
    const grid = { bpm: 120, offset: 0, confidence: 1, beats: [0, 0.5, 1, 1.5], beatsPerBar: 4, barStart: 2 };
    expect(barNumber(0.2, grid, 4)).toBe(0);
  });

  it('uses the fixed period on a legacy grid', () => {
    const grid = { bpm: 60, offset: 0.5, confidence: 1 };
    expect(barNumber(0.4, grid, 4)).toBe(0);
    expect(barNumber(0.5, grid, 4)).toBe(1);
    expect(barNumber(4.4, grid, 4)).toBe(1);
    expect(barNumber(4.5, grid, 4)).toBe(2);
  });
});

describe('barsLabel', () => {
  const grid = { bpm: 120, offset: 0, confidence: 1 }; // bar = 2 s at 4/4
  it('whole bars as an integer, otherwise one decimal', () => {
    expect(barsLabel(0, 16, grid, 4)).toBe('8 bars');
    expect(barsLabel(0, 9, grid, 4)).toBe('4.5 bars');
    expect(barsLabel(0, 2.05, grid, 4)).toBe('1 bar');
  });
});
