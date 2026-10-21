import { mic } from '../mic/MicService';
import { getAudioContext } from '../context';
import { concatChunks } from '../dsp/wav';
import type { PitchFrame } from '../pitch/tracker';
import { freqToMidi } from '../../music/notes';

export interface Recording {
  pcm: Float32Array;
  sampleRate: number;
  duration: number;
  /** [time, midi] pairs relative to recording start; midi 0 = silent. */
  trace: Float32Array;
  /** AudioContext time when the first sample was captured. */
  startedAt: number;
}

/** Leading time trimmed from every take (recorder spin-up click). */
export const TRIM_HEAD_SECONDS = 0.05;

/**
 * Records raw PCM from the shared mic service (no second mic session) and the
 * pitch trace alongside it, aligned by audio-context time.
 */
export class Recorder {
  private chunks: Float32Array[] = [];
  private trace: number[] = [];
  private startTime = 0;
  private firstChunkTime: number | null = null;
  private unsubPcm: (() => void) | null = null;
  private unsubPitch: (() => void) | null = null;
  private _recording = false;
  private resolveStop: ((r: Recording) => void) | null = null;

  get recording(): boolean {
    return this._recording;
  }

  async start(latencyOffsetSec = 0): Promise<void> {
    if (this._recording) return;
    if (mic.state !== 'running') await mic.start();
    if (mic.state !== 'running') throw new Error(mic.error ? `Microphone unavailable: ${mic.error}` : 'Microphone is not running');
    this.chunks = [];
    this.trace = [];
    this.firstChunkTime = null;
    this.startTime = getAudioContext().currentTime;
    this._recording = true;
    this.unsubPcm = mic.subscribePcm((chunk, final, time) => {
      if (this.firstChunkTime === null) this.firstChunkTime = time - chunk.length / getAudioContext().sampleRate;
      if (chunk.length) this.chunks.push(chunk);
      if (final) this.finish(latencyOffsetSec);
    });
    this.unsubPitch = mic.subscribe((f: PitchFrame) => {
      const t = f.time - this.startTime;
      this.trace.push(t, f.voiced && f.freq > 0 ? freqToMidi(f.freq) : 0);
    });
    mic.setCapture(true);
  }

  /** Stop and resolve with the recording. */
  stop(): Promise<Recording> {
    if (!this._recording) return Promise.reject(new Error('not recording'));
    return new Promise<Recording>((resolve) => {
      this.resolveStop = resolve;
      mic.setCapture(false); // worklet flushes with final=true → finish()
      // Safety net if the worklet is gone (mic paused mid-take).
      setTimeout(() => {
        if (this.resolveStop) this.finish(0);
      }, 300);
    });
  }

  private finish(latencyOffsetSec: number): void {
    if (!this._recording) return;
    this._recording = false;
    this.unsubPcm?.();
    this.unsubPitch?.();
    this.unsubPcm = null;
    this.unsubPitch = null;
    const sr = getAudioContext().sampleRate;
    let pcm = concatChunks(this.chunks);
    const trimFrames = Math.min(pcm.length, Math.floor(TRIM_HEAD_SECONDS * sr));
    pcm = pcm.subarray(trimFrames);
    const started = (this.firstChunkTime ?? this.startTime) + trimFrames / sr;
    // Re-base trace to the trimmed audio start, subtracting input latency so the
    // trace lines up with what the singer heard.
    const traceArr = new Float32Array(this.trace.length);
    for (let i = 0; i < this.trace.length; i += 2) {
      traceArr[i] = this.trace[i] + this.startTime - started - latencyOffsetSec;
      traceArr[i + 1] = this.trace[i + 1];
    }
    const rec: Recording = { pcm: pcm.slice(), sampleRate: sr, duration: pcm.length / sr, trace: traceArr, startedAt: started };
    this.chunks = [];
    this.trace = [];
    const r = this.resolveStop;
    this.resolveStop = null;
    r?.(rec);
  }
}

export const recorder = new Recorder();
