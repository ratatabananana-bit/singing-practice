import { describe, it, expect } from 'vitest';
import { scoreNote, summarizeRun, steadiness } from './scoring';

const frames = (start: number, n: number, midi: number | ((i: number) => number), hop = 0.025) =>
  Array.from({ length: n }, (_, i) => ({ time: start + i * hop, midi: typeof midi === 'function' ? midi(i) : midi }));

describe('scoreNote', () => {
  it('hits a note sung in tune for the whole duration', () => {
    const s = scoreNote(frames(1, 20, 60.05), 1, 1.5, 60, 20, 0.025);
    expect(s.hit).toBe(true);
    expect(s.cents).toBeCloseTo(5);
    expect(s.precision).toBe(1);
    expect(s.sustain).toBeCloseTo(1);
    expect(s.tendency).toBe('ok');
  });
  it('flat note is not a hit and reports tendency', () => {
    const s = scoreNote(frames(1, 20, 59.6), 1, 1.5, 60, 20, 0.025);
    expect(s.hit).toBe(false);
    expect(s.tendency).toBe('flat');
  });
  it('silence gives no score', () => {
    const s = scoreNote(frames(1, 20, 0), 1, 1.5, 60, 20, 0.025);
    expect(Number.isNaN(s.cents)).toBe(true);
    expect(s.sustain).toBe(0);
    expect(s.tendency).toBe('none');
  });
  it('a short correct blip does not count as sustained', () => {
    const s = scoreNote(frames(1, 3, 60), 1, 1.5, 60, 20, 0.025);
    expect(s.precision).toBe(1);
    expect(s.sustain).toBeLessThan(0.4);
    expect(s.hit).toBe(false);
  });
  it('ignores frames outside the window', () => {
    const s = scoreNote([...frames(0, 10, 48), ...frames(1, 20, 60)], 1, 1.5, 60, 20, 0.025);
    expect(s.cents).toBe(0);
  });
});

describe('summarizeRun', () => {
  it('counts hits and bias', () => {
    const a = scoreNote(frames(1, 20, 60), 1, 1.5, 60, 20, 0.025);
    const b = scoreNote(frames(2, 20, 61.6), 2, 2.5, 62, 20, 0.025);
    const c = scoreNote(frames(3, 20, 0), 3, 3.5, 64, 20, 0.025);
    const r = summarizeRun([a, b, c]);
    expect(r.total).toBe(3);
    expect(r.hits).toBe(1);
    expect(r.flat).toBe(1);
    expect(r.sharp).toBe(0);
  });
});

describe('steadiness', () => {
  it('is 1 for a flat line and lower for wobble', () => {
    expect(steadiness([5, 5, 5, 5])).toBe(1);
    expect(steadiness([-30, 30, -30, 30])).toBeLessThan(0.5);
  });
});
