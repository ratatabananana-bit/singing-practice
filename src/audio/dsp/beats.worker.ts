import { detectBeats } from './beats';

self.onmessage = (e: MessageEvent<{ mono: Float32Array; sampleRate: number }>) => {
  const { mono, sampleRate } = e.data;
  const grid = detectBeats(mono, sampleRate);
  (self as unknown as Worker).postMessage(grid);
};
