import { describe, it, expect } from 'vitest';
import { mpm, rmsDb } from './mpm';
import { Median3, median3, VoicingTracker } from './tracker';

const SR = 48000;
const N = 2048;
const OPTS = { sampleRate: SR, minFreq: 55, maxFreq: 1200, k: 0.9 };

function sine(freq: number, amp = 0.5, phase = 0): Float32Array {
  const b = new Float32Array(N);
  for (let i = 0; i < N; i++) b[i] = amp * Math.sin(phase + (2 * Math.PI * freq * i) / SR);
  return b;
}

function voiceLike(freq: number, vibratoHz = 5.5, vibratoCents = 40): Float32Array {
  // Harmonic-rich tone with vibrato and a bit of noise.
  const b = new Float32Array(N);
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const f = freq * Math.pow(2, (vibratoCents / 1200) * Math.sin(2 * Math.PI * vibratoHz * t));
    ph += (2 * Math.PI * f) / SR;
    let s = 0;
    for (let h = 1; h <= 8; h++) s += Math.sin(ph * h) / h;
    b[i] = 0.3 * s + 0.01 * (Math.random() * 2 - 1);
  }
  return b;
}

describe('mpm', () => {
  it('detects a pure sine within 1 cent', () => {
    for (const f of [82.4, 110, 220, 261.6, 440, 880]) {
      const r = mpm(sine(f), OPTS);
      expect(Math.abs(1200 * Math.log2(r.freq / f))).toBeLessThan(2);
      expect(r.clarity).toBeGreaterThan(0.95);
    }
  });
  it('tracks a harmonic-rich voice-like tone with vibrato (no octave error)', () => {
    for (const f of [98, 147, 196, 330, 523]) {
      const r = mpm(voiceLike(f), OPTS);
      expect(Math.abs(1200 * Math.log2(r.freq / f))).toBeLessThan(60);
      expect(r.clarity).toBeGreaterThan(0.8);
    }
  });
  it('returns low clarity on noise', () => {
    const b = new Float32Array(N);
    for (let i = 0; i < N; i++) b[i] = Math.random() * 2 - 1;
    const r = mpm(b, OPTS);
    expect(r.clarity).toBeLessThan(0.6);
  });
  it('returns nothing on silence', () => {
    const r = mpm(new Float32Array(N), OPTS);
    expect(r.freq).toBe(0);
    expect(rmsDb(new Float32Array(N))).toBeLessThanOrEqual(-120);
  });
  it('rms dB of a 0.5 amplitude sine is about -9 dB', () => {
    expect(rmsDb(sine(440, 0.5))).toBeCloseTo(-9.03, 0);
  });
});

describe('median', () => {
  it('median3', () => {
    expect(median3(1, 2, 3)).toBe(2);
    expect(median3(3, 1, 2)).toBe(2);
    expect(median3(5, 5, 1)).toBe(5);
  });
  it('passes raw values until buffer is full, then rejects spikes', () => {
    const m = new Median3();
    expect(m.push(100)).toBe(100);
    expect(m.push(900)).toBe(900); // not the larger-of-two bias: raw until full
    expect(m.push(101)).toBe(101); // median of 100,900,101
    expect(m.push(102)).toBe(102); // median of 900,101,102
  });
});

describe('VoicingTracker hysteresis', () => {
  it('needs high clarity to start, lower to stay', () => {
    const t = new VoicingTracker({ clarityOn: 0.9, clarityOff: 0.7, silenceDb: -50, holdFrames: 0, median: false, minFreq: 55, maxFreq: 1200 });
    expect(t.process({ freq: 220, clarity: 0.8, db: -20 }).voiced).toBe(false);
    expect(t.process({ freq: 220, clarity: 0.95, db: -20 }).voiced).toBe(true);
    expect(t.process({ freq: 220, clarity: 0.8, db: -20 }).voiced).toBe(true);
    expect(t.process({ freq: 220, clarity: 0.6, db: -20 }).voiced).toBe(false);
  });
  it('silence gate wins', () => {
    const t = new VoicingTracker();
    expect(t.process({ freq: 220, clarity: 0.99, db: -60 }).voiced).toBe(false);
  });
  it('hold frames bridge a one-frame dropout', () => {
    const t = new VoicingTracker({ clarityOn: 0.9, clarityOff: 0.7, silenceDb: -50, holdFrames: 1, median: false, minFreq: 55, maxFreq: 1200 });
    const a = t.process({ freq: 220, clarity: 0.95, db: -20 });
    t.remember(a.freq);
    const b = t.process({ freq: 0, clarity: 0.2, db: -20 });
    expect(b.voiced).toBe(true);
    expect(b.freq).toBe(220);
    const c = t.process({ freq: 0, clarity: 0.2, db: -20 });
    expect(c.voiced).toBe(false);
  });
});
