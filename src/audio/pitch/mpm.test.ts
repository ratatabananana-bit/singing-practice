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
  it('FFT nsdf matches the direct nsdf', async () => {
    const { nsdf, nsdfFft } = await import('./mpm');
    const b = voiceLike(220);
    const a = new Float32Array(900);
    const f = new Float32Array(900);
    nsdf(b, 40, 872, a);
    nsdfFft(b, 40, 872, f);
    let maxErr = 0;
    for (let i = 40; i <= 872; i++) maxErr = Math.max(maxErr, Math.abs(a[i] - f[i]));
    expect(maxErr).toBeLessThan(1e-3);
  });
  it('continuity hint resolves an ambiguous octave toward the previous pitch', () => {
    // 220 Hz with a weak 110 Hz subharmonic: NSDF has a 0.95 peak at 220 and 1.0 at 110,
    // so plain MPM (k = 0.9) picks 220 while a previous pitch of 110 pulls it to 110.
    const b = new Float32Array(N);
    for (let i = 0; i < N; i++) b[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.08 * Math.sin((2 * Math.PI * 110 * i) / SR);
    const plain = mpm(b, { ...OPTS, k: 0.9 });
    const withPrev = mpm(b, { ...OPTS, k: 0.9, prevFreq: 110 });
    const same = mpm(b, { ...OPTS, k: 0.9, prevFreq: 220 });
    expect(Math.abs(1200 * Math.log2(plain.freq / 220))).toBeLessThan(30);
    expect(Math.abs(1200 * Math.log2(withPrev.freq / 110))).toBeLessThan(30);
    expect(Math.abs(1200 * Math.log2(same.freq / 220))).toBeLessThan(30);
  });
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
  const P = { clarityOn: 0.9, clarityOff: 0.7, silenceDb: -50, holdFrames: 0, leapConfirmFrames: 2, median: false, minFreq: 55, maxFreq: 1200 };
  const run = (t: VoicingTracker, f: { freq: number; clarity: number; db: number }) => {
    const r = t.process(f);
    t.remember(r.freq);
    return r;
  };
  it('needs high clarity to start, lower to stay', () => {
    const t = new VoicingTracker({ ...P });
    expect(run(t, { freq: 220, clarity: 0.8, db: -20 }).voiced).toBe(false);
    expect(run(t, { freq: 220, clarity: 0.95, db: -20 }).voiced).toBe(false); // onset frame 1
    expect(run(t, { freq: 220, clarity: 0.95, db: -20 }).voiced).toBe(true); // confirmed
    expect(run(t, { freq: 220, clarity: 0.8, db: -20 }).voiced).toBe(true);
    expect(run(t, { freq: 220, clarity: 0.6, db: -20 }).voiced).toBe(false);
  });
  it('silence gate wins', () => {
    const t = new VoicingTracker();
    expect(run(t, { freq: 220, clarity: 0.99, db: -60 }).voiced).toBe(false);
  });
  it('a sub-octave first frame at onset is dropped', () => {
    const t = new VoicingTracker({ ...P });
    expect(run(t, { freq: 110, clarity: 0.95, db: -20 }).voiced).toBe(false);
    expect(run(t, { freq: 220, clarity: 0.95, db: -20 }).voiced).toBe(false); // disagrees → restart onset
    const r = run(t, { freq: 221, clarity: 0.95, db: -20 });
    expect(r.voiced).toBe(true);
    expect(r.freq).toBe(221);
  });
  it('hold frames bridge a one-frame dropout', () => {
    const t = new VoicingTracker({ ...P, holdFrames: 1 });
    run(t, { freq: 220, clarity: 0.95, db: -20 });
    run(t, { freq: 220, clarity: 0.95, db: -20 });
    const b = run(t, { freq: 0, clarity: 0.2, db: -20 });
    expect(b.voiced).toBe(true);
    expect(b.freq).toBe(220);
    const c = run(t, { freq: 0, clarity: 0.2, db: -20 });
    expect(c.voiced).toBe(false);
  });
  it('a single-frame octave glitch mid-note is held, a real leap is accepted next frame', () => {
    const t = new VoicingTracker({ ...P });
    run(t, { freq: 220, clarity: 0.95, db: -20 });
    run(t, { freq: 220, clarity: 0.95, db: -20 });
    expect(run(t, { freq: 110, clarity: 0.95, db: -20 }).freq).toBe(220); // glitch held
    expect(run(t, { freq: 220, clarity: 0.95, db: -20 }).freq).toBe(220);
    expect(run(t, { freq: 440, clarity: 0.95, db: -20 }).freq).toBe(220); // leap: wait one frame
    expect(run(t, { freq: 442, clarity: 0.95, db: -20 }).freq).toBe(442); // confirmed leap
  });
  it('a two-frame glitch is rejected when three confirming frames are required', () => {
    const t = new VoicingTracker({ ...P, leapConfirmFrames: 3 });
    run(t, { freq: 220, clarity: 0.95, db: -20 });
    run(t, { freq: 220, clarity: 0.95, db: -20 });
    expect(run(t, { freq: 440, clarity: 0.95, db: -20 }).freq).toBe(220);
    expect(run(t, { freq: 441, clarity: 0.95, db: -20 }).freq).toBe(220);
    expect(run(t, { freq: 220, clarity: 0.95, db: -20 }).freq).toBe(220); // back: glitch never shown
    expect(run(t, { freq: 440, clarity: 0.95, db: -20 }).freq).toBe(220);
    expect(run(t, { freq: 440, clarity: 0.95, db: -20 }).freq).toBe(220);
    expect(run(t, { freq: 440, clarity: 0.95, db: -20 }).freq).toBe(440); // third frame: real leap
  });
});
