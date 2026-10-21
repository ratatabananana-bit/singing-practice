import { describe, it, expect } from 'vitest';
import { smoothTrace } from './traceSmooth';

describe('smoothTrace', () => {
  it('level 0 only maps silence to 0', () => {
    expect(Array.from(smoothTrace([60, NaN, 0, 61], 0))).toEqual([60, 0, 0, 61]);
  });
  it('level 1 removes a single-frame spike but keeps slow movement', () => {
    const s = smoothTrace([60, 60.1, 48, 60.2, 60.3, 62, 64, 66], 1);
    expect(s[2]).toBeCloseTo(60.1, 3);
    [60.3, 62, 64, 66].forEach((v, i) => expect(s[4 + i]).toBeCloseTo(v, 3));
  });
  it('does not smooth across silence', () => {
    const s = smoothTrace([60, 60, 0, 72, 72], 2);
    expect(s[1]).toBe(60);
    expect(s[2]).toBe(0);
    expect(s[3]).toBe(72);
  });
  it('level 3 snaps to lanes with hysteresis', () => {
    const s = smoothTrace([60.1, 60.4, 60.55, 60.3, 59.7, 61.0, 61.2, 0, 62.4], 3);
    expect(Array.from(s)).toEqual([60, 60, 60, 60, 60, 61, 61, 0, 62]);
  });
  it('level 2 averages lightly', () => {
    const s = smoothTrace([60, 61, 60, 61, 60], 2);
    expect(s[2]).toBeGreaterThan(60);
    expect(s[2]).toBeLessThan(61);
  });
});
