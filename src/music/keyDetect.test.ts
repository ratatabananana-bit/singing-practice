import { describe, it, expect } from 'vitest';
import { detectKey } from './keyDetect';

function seq(midis: number[], start = 0, step = 0.25) {
  return midis.map((m, i) => ({ midi: m, time: start + i * step }));
}

const C_MAJOR = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 64, 67, 72];

describe('detectKey', () => {
  it('needs enough notes', () => {
    expect(detectKey(seq([60, 62, 64]), 1)).toBeNull();
  });
  it('finds C major from a major scale', () => {
    const g = detectKey(seq(C_MAJOR), 5)!;
    expect(g.root).toBe(0);
    expect(g.mode).toBe('major');
    expect(g.confidence).toBeGreaterThan(0.3);
  });
  it('finds A minor from a minor scale with harmonic leading tone', () => {
    const obs = seq([57, 59, 60, 62, 64, 65, 68, 69, 68, 65, 64, 62, 60, 59, 57, 60, 64, 69]);
    const g = detectKey(obs, 5)!;
    expect(g.root).toBe(9);
    expect(g.mode).toBe('minor');
  });
  it('is not fooled by a consistently flat singer', () => {
    const g = detectKey(seq(C_MAJOR.map((m) => m - 0.45)), 5)!;
    expect(g.root).toBe(0);
    expect(g.mode).toBe('major');
  });
  it('notices a key change thanks to recency weighting', () => {
    const old = seq([60, 62, 64, 65, 67, 69, 71, 72, 60, 64, 67, 72], 0);
    const fresh = seq([66, 68, 70, 71, 73, 75, 77, 78, 66, 70, 73, 78], 3.5);
    const g = detectKey([...old, ...fresh], 6.5)!;
    expect(g.root).toBe(6);
  });
});
