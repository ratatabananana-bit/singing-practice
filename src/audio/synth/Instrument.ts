import { getAudioContext } from '../context';
import { midiToFreq } from '../../music/notes';
import type { SoundMode } from '../../state/settings';

const SALAMANDER_BASE = 'https://tonejs.github.io/audio/salamander/';
// Sparse sample set: one every 3 semitones, A0..C8.
const SAMPLE_NOTES: { name: string; midi: number }[] = [];
{
  const names = ['A', 'C', 'Ds', 'Fs'];
  const offsets = [9, 0, 3, 6];
  for (let oct = 0; oct <= 7; oct++) {
    for (let i = 0; i < names.length; i++) {
      const midi = (oct + 1) * 12 + offsets[i];
      if (midi < 21 || midi > 108) continue;
      SAMPLE_NOTES.push({ name: `${names[i]}${oct}`, midi });
    }
  }
  SAMPLE_NOTES.push({ name: 'C8', midi: 108 });
}

export interface Voice {
  stop(when?: number): void;
}

/**
 * Shared instrument: sampled grand piano (Salamander), synthesized "vocal aah", flute.
 * Falls back to a simple tone while samples are loading or offline.
 */
class Instrument {
  private samples = new Map<number, AudioBuffer>();
  private loading = new Map<number, Promise<AudioBuffer | null>>();
  private master: GainNode | null = null;
  private active = new Set<{ stop: (when?: number) => void }>();
  private vowelBuffer: AudioBuffer | null = null;

  private out(): GainNode {
    const ctx = getAudioContext();
    if (!this.master) {
      this.master = ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(ctx.destination);
    }
    return this.master;
  }

  private nearestSample(midi: number): { name: string; midi: number } {
    let best = SAMPLE_NOTES[0];
    for (const s of SAMPLE_NOTES) if (Math.abs(s.midi - midi) < Math.abs(best.midi - midi)) best = s;
    return best;
  }

  private loadSample(midi: number): Promise<AudioBuffer | null> {
    const s = this.nearestSample(midi);
    const cached = this.samples.get(s.midi);
    if (cached) return Promise.resolve(cached);
    let p = this.loading.get(s.midi);
    if (!p) {
      p = fetch(`${SALAMANDER_BASE}${s.name}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        .then((ab) => getAudioContext().decodeAudioData(ab))
        .then((buf) => {
          this.samples.set(s.midi, buf);
          return buf;
        })
        .catch(() => null)
        .finally(() => this.loading.delete(s.midi));
      this.loading.set(s.midi, p);
    }
    return p;
  }

  /** Warm the sample cache around a note (non-blocking). */
  preload(midi: number, spread = 12): void {
    for (let m = midi - spread; m <= midi + spread; m += 3) void this.loadSample(m);
  }

  private preloadingAll = false;
  /** Fetch the whole sample set in the background (a few at a time) so no key ever falls back to the beep. */
  preloadAll(): void {
    if (this.preloadingAll) return;
    this.preloadingAll = true;
    // Vocal range first (C2..C6), then the extremes.
    const order = [...SAMPLE_NOTES].sort((a, b) => Math.abs(a.midi - 60) - Math.abs(b.midi - 60));
    const run = async () => {
      for (let i = 0; i < order.length; i += 3) {
        await Promise.all(order.slice(i, i + 3).map((s) => this.loadSample(s.midi)));
      }
    };
    void run();
  }

  /** Nearest sample that is already decoded (any distance), or null. */
  private nearestLoaded(midi: number): { midi: number; buf: AudioBuffer } | null {
    let best: { midi: number; buf: AudioBuffer } | null = null;
    for (const [m, buf] of this.samples) {
      if (!best || Math.abs(m - midi) < Math.abs(best.midi - midi)) best = { midi: m, buf };
    }
    return best;
  }

  /**
   * Play a note. `duration` in seconds; `when` is an AudioContext time (default now).
   * Returns a handle that can stop the note early.
   */
  play(midi: number, duration: number, mode: SoundMode, when?: number, velocity = 1): Voice {
    const ctx = getAudioContext();
    const t0 = when ?? ctx.currentTime;
    if (mode === 'piano') {
      const s = this.nearestSample(midi);
      const buf = this.samples.get(s.midi);
      if (buf) return this.playSample(buf, s.midi, midi, duration, t0, velocity);
      void this.loadSample(midi);
      this.preloadAll();
      // Still a piano while the exact sample downloads: pitch-shift the nearest loaded one.
      const near = this.nearestLoaded(midi);
      if (near) return this.playSample(near.buf, near.midi, midi, duration, t0, velocity);
      return this.playFallback(midi, duration, t0, velocity);
    }
    if (mode === 'vocal') return this.playVocal(midi, duration, t0, velocity);
    return this.playFlute(midi, duration, t0, velocity);
  }

  stopAll(): void {
    const now = getAudioContext().currentTime;
    for (const v of this.active) v.stop(now);
    this.active.clear();
  }

  private track(v: Voice, endTime: number): Voice {
    this.active.add(v);
    const ms = Math.max(0, (endTime - getAudioContext().currentTime) * 1000 + 600);
    setTimeout(() => this.active.delete(v), ms);
    return v;
  }

  private playSample(buf: AudioBuffer, sampleMidi: number, midi: number, duration: number, t0: number, vel: number): Voice {
    const ctx = getAudioContext();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, (midi - sampleMidi) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * vel, t0);
    const rel = 0.25;
    g.gain.setValueAtTime(0.9 * vel, t0 + duration);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration + rel);
    src.connect(g).connect(this.out());
    src.start(t0);
    src.stop(t0 + duration + rel + 0.05);
    const stop = (when = ctx.currentTime) => {
      try {
        g.gain.cancelScheduledValues(when);
        g.gain.setValueAtTime(g.gain.value, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.08);
        src.stop(when + 0.1);
      } catch {
        /* already stopped */
      }
    };
    return this.track({ stop }, t0 + duration + rel);
  }

  private playFallback(midi: number, duration: number, t0: number, vel: number): Voice {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.5 * vel, t0 + 0.01);
    g.gain.setTargetAtTime(0.25 * vel, t0 + 0.05, 0.3);
    g.gain.setValueAtTime(0.25 * vel, t0 + duration);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + duration + 0.15);
    osc.connect(g).connect(this.out());
    osc.start(t0);
    osc.stop(t0 + duration + 0.2);
    const stop = (when = ctx.currentTime) => {
      try {
        g.gain.cancelScheduledValues(when);
        g.gain.setValueAtTime(g.gain.value, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
        osc.stop(when + 0.08);
      } catch {
        /* ignore */
      }
    };
    return this.track({ stop }, t0 + duration + 0.2);
  }

  private vowelSource(): AudioBuffer {
    // One cycle of a harmonic-rich waveform (rolled-off harmonics) used as a glottal source.
    if (this.vowelBuffer) return this.vowelBuffer;
    const ctx = getAudioContext();
    const n = 2048;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let h = 1; h <= 40; h++) s += Math.sin((2 * Math.PI * h * i) / n) / Math.pow(h, 1.1);
      d[i] = s * 0.3;
    }
    this.vowelBuffer = buf;
    return buf;
  }

  private playVocal(midi: number, duration: number, t0: number, vel: number): Voice {
    const ctx = getAudioContext();
    const f0 = midiToFreq(midi);
    const src = ctx.createBufferSource();
    src.buffer = this.vowelSource();
    src.loop = true;
    src.playbackRate.value = (f0 * 2048) / ctx.sampleRate;
    // gentle vibrato
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.2;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.004 * src.playbackRate.value; // ~0.4% rate → ~7 cents
    lfo.connect(lfoGain).connect(src.playbackRate);
    lfo.start(t0 + 0.2);
    // "aah" formants, scaled a little with pitch so high notes don't sound hollow
    const scale = Math.min(1.6, Math.max(1, f0 / 220));
    const formants: [number, number, number][] = [
      [730 * scale, 1.0, 8],
      [1090 * scale, 0.5, 10],
      [2440 * scale, 0.25, 12],
      [3400 * scale, 0.12, 14],
    ];
    const mix = ctx.createGain();
    for (const [fc, amp, q] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(fc, ctx.sampleRate / 2 - 100);
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = amp;
      src.connect(bp).connect(g).connect(mix);
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.9 * vel, t0 + 0.07);
    env.gain.setValueAtTime(0.9 * vel, t0 + duration);
    env.gain.linearRampToValueAtTime(0, t0 + duration + 0.12);
    mix.connect(env).connect(this.out());
    src.start(t0);
    src.stop(t0 + duration + 0.2);
    lfo.stop(t0 + duration + 0.2);
    const stop = (when = ctx.currentTime) => {
      try {
        env.gain.cancelScheduledValues(when);
        env.gain.setValueAtTime(env.gain.value, when);
        env.gain.linearRampToValueAtTime(0, when + 0.08);
        src.stop(when + 0.1);
        lfo.stop(when + 0.1);
      } catch {
        /* ignore */
      }
    };
    return this.track({ stop }, t0 + duration + 0.2);
  }

  private playFlute(midi: number, duration: number, t0: number, vel: number): Voice {
    const ctx = getAudioContext();
    const f0 = midiToFreq(midi);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.6 * vel, t0 + 0.06);
    env.gain.setValueAtTime(0.6 * vel, t0 + duration);
    env.gain.linearRampToValueAtTime(0, t0 + duration + 0.1);
    env.connect(this.out());
    const oscs: OscillatorNode[] = [];
    const partials: [number, number][] = [
      [1, 1],
      [2, 0.35],
      [3, 0.15],
      [4, 0.05],
    ];
    for (const [h, a] of partials) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f0 * h;
      const g = ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(env);
      o.start(t0);
      o.stop(t0 + duration + 0.15);
      oscs.push(o);
    }
    // vibrato on the fundamental group
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5;
    const lg = ctx.createGain();
    lg.gain.value = f0 * 0.006;
    lfo.connect(lg);
    for (const o of oscs) lg.connect(o.frequency);
    lfo.start(t0 + 0.15);
    lfo.stop(t0 + duration + 0.15);
    // breath noise
    const nb = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = nb;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'bandpass';
    nf.frequency.value = Math.min(f0 * 2, 8000);
    nf.Q.value = 2;
    const ng = ctx.createGain();
    ng.gain.value = 0.03;
    noise.connect(nf).connect(ng).connect(env);
    noise.start(t0);
    noise.stop(t0 + duration + 0.15);
    const stop = (when = ctx.currentTime) => {
      try {
        env.gain.cancelScheduledValues(when);
        env.gain.setValueAtTime(env.gain.value, when);
        env.gain.linearRampToValueAtTime(0, when + 0.06);
        for (const o of oscs) o.stop(when + 0.08);
        lfo.stop(when + 0.08);
        noise.stop(when + 0.08);
      } catch {
        /* ignore */
      }
    };
    return this.track({ stop }, t0 + duration + 0.15);
  }
}

export const instrument = new Instrument();
