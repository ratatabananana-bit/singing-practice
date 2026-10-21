import { getAudioContext, loadWorklet, unlockAudio } from '../context';
import workletUrl from './stretch.worklet.ts?worker&url';

export interface PlayerSnapshot {
  loaded: boolean;
  playing: boolean;
  position: number; // seconds
  duration: number;
  speed: number;
  transpose: number;
  loopOn: boolean;
  loopStart: number;
  loopEnd: number;
}

type Listener = (s: PlayerSnapshot) => void;

/**
 * Backing-track player with independent speed/transpose and gapless loop points.
 * Wraps the stretch worklet; exposes a snapshot for the UI.
 */
export class TrackPlayer {
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private snap: PlayerSnapshot = {
    loaded: false,
    playing: false,
    position: 0,
    duration: 0,
    speed: 1,
    transpose: 0,
    loopOn: false,
    loopStart: 0,
    loopEnd: 0,
  };
  private listeners = new Set<Listener>();
  private sampleRate = 48000;
  private lastReportAt = 0;
  private lastReportPos = 0;
  private endedCb: (() => void) | null = null;
  private ready: Promise<void> | null = null;

  get state(): PlayerSnapshot {
    return this.snap;
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    cb(this.snap);
    return () => this.listeners.delete(cb);
  }

  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }

  private emit(p: Partial<PlayerSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    for (const l of this.listeners) l(this.snap);
  }

  private async ensureNode(): Promise<AudioWorkletNode> {
    if (this.node) return this.node;
    if (!this.ready) {
      this.ready = (async () => {
        const ctx = await unlockAudio();
        await loadWorklet(workletUrl);
        this.sampleRate = ctx.sampleRate;
        const node = new AudioWorkletNode(ctx, 'stretch-processor', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        node.port.onmessage = (e: MessageEvent) => {
          const m = e.data;
          if (m.type === 'position') {
            this.lastReportAt = ctx.currentTime;
            this.lastReportPos = m.frames / this.sampleRate;
            this.emit({ position: this.lastReportPos, playing: m.playing });
          } else if (m.type === 'ended') {
            this.emit({ playing: false });
            this.endedCb?.();
          }
        };
        this.gain = ctx.createGain();
        node.connect(this.gain).connect(ctx.destination);
        this.node = node;
      })();
    }
    await this.ready;
    return this.node!;
  }

  /** Decode and load an audio blob. Resolves with the duration. */
  async load(blob: Blob): Promise<number> {
    const node = await this.ensureNode();
    const ctx = getAudioContext();
    const ab = await blob.arrayBuffer();
    const buf = await ctx.decodeAudioData(ab);
    const left = buf.getChannelData(0).slice();
    const right = buf.numberOfChannels > 1 ? buf.getChannelData(1).slice() : left;
    node.port.postMessage({ type: 'load', left, right }, right === left ? [left.buffer] : [left.buffer, right.buffer]);
    this.emit({ loaded: true, playing: false, position: 0, duration: buf.duration, loopOn: false, loopStart: 0, loopEnd: 0 });
    // re-apply speed/transpose
    node.port.postMessage({ type: 'tempo', value: this.snap.speed });
    node.port.postMessage({ type: 'pitch', value: this.snap.transpose });
    return buf.duration;
  }

  unload(): void {
    this.node?.port.postMessage({ type: 'unload' });
    this.emit({ loaded: false, playing: false, position: 0, duration: 0 });
  }

  async play(): Promise<void> {
    const node = await this.ensureNode();
    if (!this.snap.loaded) return;
    node.port.postMessage({ type: 'play' });
    this.emit({ playing: true });
  }

  pause(): void {
    this.node?.port.postMessage({ type: 'pause' });
    this.emit({ playing: false });
  }

  toggle(): void {
    if (this.snap.playing) this.pause();
    else void this.play();
  }

  seek(seconds: number): void {
    const s = Math.max(0, Math.min(this.snap.duration, seconds));
    this.node?.port.postMessage({ type: 'seek', frames: Math.floor(s * this.sampleRate) });
    this.lastReportPos = s;
    this.lastReportAt = getAudioContext().currentTime;
    this.emit({ position: s });
  }

  setSpeed(speed: number): void {
    const v = Math.max(0.25, Math.min(2, speed));
    this.node?.port.postMessage({ type: 'tempo', value: v });
    this.emit({ speed: v });
  }

  setTranspose(semitones: number): void {
    const v = Math.max(-12, Math.min(12, semitones));
    this.node?.port.postMessage({ type: 'pitch', value: v });
    this.emit({ transpose: v });
  }

  setLoop(on: boolean, start: number, end: number): void {
    this.node?.port.postMessage({
      type: 'loop',
      on,
      start: Math.floor(start * this.sampleRate),
      end: Math.floor(end * this.sampleRate),
    });
    this.emit({ loopOn: on, loopStart: start, loopEnd: end });
  }

  /** Smooth position estimate between worklet reports (for rAF-driven UI). */
  estimatePosition(): number {
    if (!this.snap.playing) return this.snap.position;
    const ctx = getAudioContext();
    const dt = ctx.currentTime - this.lastReportAt;
    let p = this.lastReportPos + dt * this.snap.speed;
    if (this.snap.loopOn && this.snap.loopEnd > this.snap.loopStart && p >= this.snap.loopEnd) {
      p = this.snap.loopStart + ((p - this.snap.loopStart) % (this.snap.loopEnd - this.snap.loopStart));
    }
    return Math.min(this.snap.duration, p);
  }

  /** Output latency estimate in seconds. */
  outputLatency(): number {
    const ctx = getAudioContext();
    return (ctx.outputLatency || ctx.baseLatency || 0) + 0.02;
  }
}

export const trackPlayer = new TrackPlayer();
