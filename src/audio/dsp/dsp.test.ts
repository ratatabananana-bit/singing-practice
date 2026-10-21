import { describe, it, expect } from 'vitest';
import { fft } from './fft';
import { denoise } from './denoise';
import { encodeWav, waveformSummary, concatChunks } from './wav';

describe('fft', () => {
  it('round-trips', () => {
    const n = 1024;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 7 * i) / n) + 0.3 * Math.cos((2 * Math.PI * 50 * i) / n);
    const orig = re.slice();
    fft(re, im);
    // bin 7 should be strong
    expect(Math.hypot(re[7], im[7])).toBeGreaterThan(n / 2 - 1);
    fft(re, im, true);
    for (let i = 0; i < n; i += 97) expect(re[i]).toBeCloseTo(orig[i], 4);
  });
});

describe('denoise', () => {
  it('reduces broadband noise more than the tone', () => {
    const sr = 48000;
    const n = sr * 2;
    const clean = new Float32Array(n);
    const noisy = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const tone = t > 0.5 && t < 1.5 ? 0.4 * Math.sin(2 * Math.PI * 220 * t) : 0;
      clean[i] = tone;
      noisy[i] = tone + 0.03 * (Math.random() * 2 - 1);
    }
    const out = denoise(noisy);
    const rms = (b: Float32Array, s: number, e: number) => {
      let q = 0;
      for (let i = s; i < e; i++) q += b[i] * b[i];
      return Math.sqrt(q / (e - s));
    };
    // silent region should get much quieter
    expect(rms(out, 0, sr * 0.4)).toBeLessThan(rms(noisy, 0, sr * 0.4) * 0.5);
    // tone region should keep most of its energy
    expect(rms(out, sr * 0.7, sr * 1.3)).toBeGreaterThan(rms(clean, sr * 0.7, sr * 1.3) * 0.8);
    expect(out.length).toBe(n);
  });
});

describe('wav', () => {
  it('encodes a header and data', async () => {
    const pcm = new Float32Array([0, 0.5, -0.5, 1]);
    const blob = encodeWav([pcm], 48000);
    expect(blob.size).toBe(44 + 8);
    const v = new DataView(await blob.arrayBuffer());
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe('RIFF');
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getInt16(46, true)).toBe(Math.round(0.5 * 0x7fff));
  });
  it('waveform summary has min/max/rms per bin', () => {
    const pcm = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) pcm[i] = Math.sin(i / 10);
    const s = waveformSummary(pcm, 10);
    expect(s.length).toBe(30);
    expect(s[0]).toBeLessThanOrEqual(0);
    expect(s[1]).toBeGreaterThan(0.9);
    expect(s[2]).toBeGreaterThan(0.5);
  });
  it('concat', () => {
    expect(Array.from(concatChunks([new Float32Array([1, 2]), new Float32Array([3])]))).toEqual([1, 2, 3]);
  });
});
