import { unlockAudio } from './context';
import { mic } from './mic/MicService';

/**
 * Measure round-trip latency: play a short click through the speakers and
 * detect when it arrives at the mic. Needs speakers (not earphones).
 * Returns ms, or null when no click was heard.
 */
export async function measureLatency(): Promise<number | null> {
  const ctx = await unlockAudio();
  if (mic.state !== 'running') await mic.start();
  if (mic.state !== 'running') return null;

  const sr = ctx.sampleRate;
  const chunks: { t: number; data: Float32Array }[] = [];
  const unsub = mic.subscribePcm((chunk, _final, time) => {
    chunks.push({ t: time - chunk.length / sr, data: chunk });
  });
  mic.setCapture(true);

  // Let the capture settle, then measure the noise floor.
  await sleep(250);
  const t0 = ctx.currentTime + 0.1;
  const clicks = 4;
  const gap = 0.35;
  for (let i = 0; i < clicks; i++) click(ctx, t0 + i * gap);
  await sleep((clicks * gap + 0.4) * 1000);
  mic.setCapture(false);
  unsub();

  // Flatten
  let n = 0;
  for (const c of chunks) n += c.data.length;
  if (n === 0 || chunks.length === 0) return null;
  const pcm = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    pcm.set(c.data, o);
    o += c.data.length;
  }
  const start = chunks[0].t;

  // Envelope + threshold per click, find first onset after each click time.
  const results: number[] = [];
  const floor = rms(pcm.subarray(0, Math.floor(0.2 * sr)));
  const thr = Math.max(floor * 6, 0.02);
  for (let i = 0; i < clicks; i++) {
    const clickAt = t0 + i * gap;
    const from = Math.floor((clickAt - start) * sr);
    const to = Math.min(pcm.length, from + Math.floor(0.3 * sr));
    for (let j = Math.max(0, from); j < to; j++) {
      if (Math.abs(pcm[j]) > thr) {
        results.push(((j - from) / sr) * 1000);
        break;
      }
    }
  }
  if (results.length < 2) return null;
  results.sort((a, b) => a - b);
  const med = results[Math.floor(results.length / 2)];
  return Math.round(med);
}

function click(ctx: AudioContext, when: number): void {
  const len = Math.floor(ctx.sampleRate * 0.004);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (i < len / 2 ? 1 : -1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 0.9;
  src.connect(g).connect(ctx.destination);
  src.start(when);
}

function rms(b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < b.length; i++) s += b[i] * b[i];
  return Math.sqrt(s / Math.max(1, b.length));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
