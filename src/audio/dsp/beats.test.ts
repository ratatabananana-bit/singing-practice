import { describe, it, expect } from 'vitest';
import { detectBeats, snapToBeat } from './beats';

function clickTrack(bpm: number, seconds: number, sr = 22050, phase = 0.2): Float32Array {
  const n = seconds * sr;
  const out = new Float32Array(n);
  const period = 60 / bpm;
  // sustained chord underneath + short noise bursts on each beat
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    out[i] = 0.15 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t));
    const since = (t - phase) % period;
    if (since >= 0 && since < 0.02) out[i] += 0.8 * (1 - since / 0.02) * (Math.random() * 2 - 1);
  }
  return out;
}

describe('detectBeats', () => {
  it('finds 120 BPM and the beat phase', () => {
    const g = detectBeats(clickTrack(120, 12), 22050)!;
    expect(g).not.toBeNull();
    expect(Math.abs(g.bpm - 120)).toBeLessThan(2);
    const period = 60 / g.bpm;
    const err = Math.abs(((g.offset - 0.2) % period) + period) % period;
    expect(Math.min(err, period - err)).toBeLessThan(0.04);
  });
  it('finds 92 BPM', () => {
    const g = detectBeats(clickTrack(92, 12), 22050)!;
    expect(Math.abs(g.bpm - 92)).toBeLessThan(2);
  });
  it('returns null for silence', () => {
    expect(detectBeats(new Float32Array(22050 * 8), 22050)).toBeNull();
  });
  it('snaps to the nearest beat and half beat', () => {
    const g = { bpm: 120, offset: 0.1, confidence: 1 };
    expect(snapToBeat(1.08, g)).toBeCloseTo(1.1);
    expect(snapToBeat(1.3, g)).toBeCloseTo(1.1);
    expect(snapToBeat(1.3, g, 2)).toBeCloseTo(1.35);
  });
});
