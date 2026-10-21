import { getAudioContext, loadWorklet, unlockAudio } from '../context';
import type { PitchFrame } from '../pitch/tracker';
import type { PitchWorkletParams } from '../pitch/pitch.worklet';
import workletUrl from '../pitch/pitch.worklet.ts?worker&url';

export type MicState = 'idle' | 'starting' | 'running' | 'paused' | 'error';
type FrameListener = (f: PitchFrame) => void;
type PcmListener = (chunk: Float32Array, final: boolean, time: number) => void;
type StateListener = (s: MicState, error?: string) => void;

/**
 * Single app-level microphone service.
 * - One getUserMedia session shared by every tab.
 * - Raw input: echo cancellation, noise suppression and auto gain OFF.
 * - A start that resolves after a stop is released (generation counter).
 * - Pitch analysis runs in an AudioWorklet; listeners get ~20 frames/s.
 */
class MicService {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private gen = 0;
  private _state: MicState = 'idle';
  private _error = '';
  private frameListeners = new Set<FrameListener>();
  private pcmListeners = new Set<PcmListener>();
  private stateListeners = new Set<StateListener>();
  private pendingParams: Partial<PitchWorkletParams> = {};
  private captureOn = false;
  /** Wanted-state: the user intent. Used so tab switches never stop the mic. */
  private wanted = false;

  get state(): MicState {
    return this._state;
  }
  get error(): string {
    return this._error;
  }

  onState(cb: StateListener): () => void {
    this.stateListeners.add(cb);
    cb(this._state, this._error);
    return () => this.stateListeners.delete(cb);
  }

  private setState(s: MicState, err = '') {
    this._state = s;
    this._error = err;
    for (const l of this.stateListeners) l(s, err);
  }

  subscribe(cb: FrameListener): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }

  subscribePcm(cb: PcmListener): () => void {
    this.pcmListeners.add(cb);
    return () => this.pcmListeners.delete(cb);
  }

  setParams(p: Partial<PitchWorkletParams>): void {
    this.pendingParams = { ...this.pendingParams, ...p };
    this.node?.port.postMessage({ type: 'params', params: p });
  }

  setCapture(on: boolean): void {
    this.captureOn = on;
    this.node?.port.postMessage({ type: 'capture', on });
  }

  /** Start (or restart) the mic. Safe to call repeatedly. */
  async start(): Promise<void> {
    this.wanted = true;
    if (this._state === 'running' || this._state === 'starting') return;
    const myGen = ++this.gen;
    this.setState('starting');
    try {
      const ctx = await unlockAudio();
      await loadWorklet(workletUrl);
      const fake = fakeMicConfig();
      let stream: MediaStream | null = null;
      if (!fake) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
          },
          video: false,
        });
      }
      if (myGen !== this.gen || !this.wanted) {
        // A stop arrived while we were waiting: release this late start.
        stream?.getTracks().forEach((t) => t.stop());
        return;
      }
      this.stream = stream;
      this.source = stream ? ctx.createMediaStreamSource(stream) : null;
      const inputNode: AudioNode = stream ? this.source! : createFakeMic(ctx, fake!);
      const node = new AudioWorkletNode(ctx, 'pitch-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      node.port.onmessage = (e: MessageEvent) => {
        const m = e.data;
        if (m.type === 'frame') {
          const f: PitchFrame = { time: m.time, freq: m.freq, voiced: m.voiced, clarity: m.clarity, db: m.db, peak: m.peak };
          for (const l of this.frameListeners) l(f);
        } else if (m.type === 'pcm') {
          for (const l of this.pcmListeners) l(m.chunk, m.final, m.time);
        }
      };
      node.port.postMessage({ type: 'params', params: this.pendingParams });
      if (this.captureOn) node.port.postMessage({ type: 'capture', on: true });
      inputNode.connect(node);
      this.fakeNode = stream ? null : inputNode;
      // Keep the worklet alive without feeding it to the speakers.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(sink).connect(ctx.destination);
      this.node = node;
      this.setState('running');
      stream?.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (myGen === this.gen) this.stop();
      });
    } catch (err) {
      if (myGen !== this.gen) return;
      const msg = err instanceof Error ? err.message : String(err);
      this.teardown();
      this.setState('error', msg);
    }
  }

  /** Stop the mic completely (releases the hardware). */
  stop(): void {
    this.wanted = false;
    this.gen++;
    this.teardown();
    this.setState('idle');
  }

  /** User-facing pause: releases the mic but remembers that a resume is expected. */
  pause(): void {
    this.gen++;
    this.teardown();
    this.wanted = false;
    this.setState('paused');
  }

  async resume(): Promise<void> {
    await this.start();
  }

  toggle(): void {
    // A tap while the mic is still starting means "I want it live": leave it alone.
    if (this._state === 'starting') return;
    if (this._state === 'running') this.pause();
    else void this.start();
  }

  private fakeNode: AudioNode | null = null;

  private teardown() {
    try {
      this.node?.port.postMessage({ type: 'capture', on: false });
      this.node?.disconnect();
      this.source?.disconnect();
      this.fakeNode?.disconnect();
    } catch {
      /* ignore */
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = null;
    this.source = null;
    this.stream = null;
    this.fakeNode = null;
  }

  /** The AudioContext the mic graph lives in. */
  get context(): AudioContext {
    return getAudioContext();
  }
}

export const mic = new MicService();

// ---- Dev-only fake microphone: `?fakemic=220` feeds a voice-like oscillator with vibrato
// into the pitch worklet instead of the real mic (the real mic is unavailable in some
// embedded browsers). `window.__fakemic.setFreq(hz)` / `.setLevel(0..1)` change it live.
interface FakeMic {
  freq: number;
  setFreq: (hz: number) => void;
  setLevel: (v: number) => void;
  source?: AudioBufferSourceNode;
  duration?: number;
}
declare global {
  interface Window {
    __fakemic?: FakeMic;
  }
}
/** `?fakemic=220` (oscillator) or `?fakemic=file:/dev/voice.mp3` (looping audio file). */
function fakeMicConfig(): number | string | null {
  if (typeof location === 'undefined') return null;
  const m = /[?&]fakemic=([^&]+)/.exec(location.search);
  if (!m) return null;
  const v = decodeURIComponent(m[1]);
  if (v.startsWith('file:')) return v.slice(5);
  const hz = parseFloat(v);
  return Number.isFinite(hz) ? hz : null;
}
function createFakeMic(ctx: AudioContext, cfg: number | string): AudioNode {
  if (typeof cfg === 'string') return createFileMic(ctx, cfg);
  return createOscMic(ctx, cfg);
}
function createFileMic(ctx: AudioContext, url: string): AudioNode {
  const g = ctx.createGain();
  g.gain.value = 1;
  void fetch(url)
    .then((r) => r.arrayBuffer())
    .then((ab) => ctx.decodeAudioData(ab))
    .then((buf) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(g);
      src.start();
      window.__fakemic = { freq: 0, setFreq: () => {}, setLevel: (v) => g.gain.setTargetAtTime(v, ctx.currentTime, 0.02), source: src, duration: buf.duration };
    });
  return g;
}
function createOscMic(ctx: AudioContext, freq: number): AudioNode {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.5;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = freq * 0.012; // ~±20 cents vibrato
  lfo.connect(lfoGain).connect(osc.frequency);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3000;
  const g = ctx.createGain();
  g.gain.value = 0.3;
  osc.connect(lp).connect(g);
  osc.start();
  lfo.start();
  window.__fakemic = {
    freq,
    setFreq: (hz) => {
      osc.frequency.setTargetAtTime(hz, ctx.currentTime, 0.02);
      lfoGain.gain.value = hz * 0.012;
      window.__fakemic!.freq = hz;
    },
    setLevel: (v) => g.gain.setTargetAtTime(v, ctx.currentTime, 0.02),
  };
  return g;
}
