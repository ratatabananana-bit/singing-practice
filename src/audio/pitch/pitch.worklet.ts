/// <reference types="@types/audioworklet" />
import { mpm, rmsDb, peakAbs } from './mpm';
import { VoicingTracker, DEFAULT_TRACKER, type TrackerParams } from './tracker';

declare const sampleRate: number;
declare const currentTime: number;

export interface PitchWorkletParams extends TrackerParams {
  k: number;
  /** Analysis hop in seconds. */
  hopSeconds: number;
  /** Disable detection entirely (loudness still reported). */
  enabled: boolean;
}

export const DEFAULT_WORKLET_PARAMS: PitchWorkletParams = {
  ...DEFAULT_TRACKER,
  k: 0.9,
  hopSeconds: 0.025,
  enabled: true,
};

const WINDOW = 2048;

class PitchProcessor extends AudioWorkletProcessor {
  private ring = new Float32Array(WINDOW);
  private writePos = 0;
  private filled = 0;
  private sinceLast = 0;
  private window = new Float32Array(WINDOW);
  private scratch = new Float32Array(WINDOW);
  private params: PitchWorkletParams = { ...DEFAULT_WORKLET_PARAMS };
  private tracker = new VoicingTracker({ ...DEFAULT_TRACKER });
  private capture = false;
  private captureBuf = new Float32Array(4096);
  private captureLen = 0;
  private blockPeak = 0;
  private prevFreq = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'params') {
        this.params = { ...this.params, ...msg.params };
        // Leaps must agree for ~80 ms regardless of the analysis rate.
        this.params.leapConfirmFrames = Math.max(2, Math.round(0.08 / Math.max(0.01, this.params.hopSeconds)));
        this.tracker.update(this.params);
      } else if (msg.type === 'capture') {
        if (msg.on && !this.capture) {
          this.captureLen = 0;
          this.capture = true;
        } else if (!msg.on && this.capture) {
          this.flushCapture(true);
          this.capture = false;
        }
      } else if (msg.type === 'reset') {
        this.tracker.reset();
      }
    };
  }

  private flushCapture(final: boolean) {
    if (this.captureLen > 0 || final) {
      const chunk = this.captureBuf.slice(0, this.captureLen);
      this.port.postMessage({ type: 'pcm', chunk, final, time: currentTime }, [chunk.buffer]);
      this.captureLen = 0;
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch || ch.length === 0) return true;
    const n = ch.length;

    // ring write
    for (let i = 0; i < n; i++) {
      this.ring[this.writePos] = ch[i];
      this.writePos = (this.writePos + 1) % WINDOW;
    }
    this.filled = Math.min(WINDOW, this.filled + n);
    this.blockPeak = Math.max(this.blockPeak, peakAbs(ch));

    if (this.capture) {
      if (this.captureLen + n > this.captureBuf.length) this.flushCapture(false);
      this.captureBuf.set(ch, this.captureLen);
      this.captureLen += n;
    }

    this.sinceLast += n;
    const hop = Math.max(128, Math.round(sampleRate * this.params.hopSeconds));
    if (this.sinceLast >= hop && this.filled >= WINDOW) {
      this.sinceLast = 0;
      this.analyse();
    }
    return true;
  }

  private analyse() {
    // Unroll ring into window (oldest first).
    const w = this.window;
    const start = this.writePos;
    const tail = WINDOW - start;
    w.set(this.ring.subarray(start), 0);
    w.set(this.ring.subarray(0, start), tail);

    const db = rmsDb(w);
    const peak = this.blockPeak;
    this.blockPeak = 0;

    let freq = 0;
    let clarity = 0;
    let voiced = false;
    if (this.params.enabled && db >= this.params.silenceDb - 6) {
      const r = mpm(
        w,
        { sampleRate, minFreq: this.params.minFreq, maxFreq: this.params.maxFreq, k: this.params.k, prevFreq: this.prevFreq },
        this.scratch,
      );
      clarity = r.clarity;
      const out = this.tracker.process({ freq: r.freq, clarity: r.clarity, db });
      this.tracker.remember(out.freq);
      freq = out.freq;
      voiced = out.voiced;
      this.prevFreq = voiced ? freq : 0;
    } else {
      this.tracker.process({ freq: 0, clarity: 0, db });
      this.prevFreq = 0;
    }
    this.port.postMessage({ type: 'frame', time: currentTime, freq, voiced, clarity, db, peak });
  }
}

registerProcessor('pitch-processor', PitchProcessor);
