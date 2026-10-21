import { getAudioContext, unlockAudio } from './context';
import { instrument } from './synth/Instrument';
import type { IntroMode, SoundMode } from '../state/settings';

export interface SequencerEvents {
  /** Called when a sequence note starts sounding (index into the sequence) or -1 when none. */
  onStep: (index: number, midi: number) => void;
  /** Intro cue note sounding (midi) or null when intro done. */
  onIntro: (midi: number | null) => void;
  /** One full run finished. */
  onRunEnd: () => void;
  onStop: () => void;
}

export interface Scheduled {
  midi: number;
  time: number;
  index: number; // -1 for intro notes, -2 for rest
}

/**
 * Lookahead scheduler for scale exercises.
 * Tempo changes apply to the next note without restarting.
 */
export class Sequencer {
  private timer: number | null = null;
  private uiTimers: number[] = [];
  private nextTime = 0;
  private pos = 0;
  private running = false;
  private phase: 'intro' | 'run' = 'run';
  private sequence: number[] = [];
  private introNotes: number[] = [];

  bpm = 120;
  sound: SoundMode = 'piano';
  private holdBeats = 1;

  constructor(private events: SequencerEvents) {}

  get isRunning(): boolean {
    return this.running;
  }

  private beat(): number {
    return 60 / this.bpm;
  }

  /**
   * Start a run: optional intro cue, then the sequence.
   * `keepTail` leaves the previous run's last note ringing (used when auto-advancing).
   */
  async start(sequence: number[], intro: IntroMode, root: number, keepTail = false, holdBeats = 1): Promise<void> {
    this.stop(false, !keepTail);
    this.holdBeats = Math.max(1, holdBeats);
    await unlockAudio();
    const ctx = getAudioContext();
    this.sequence = sequence;
    this.introNotes = intro === 'off' ? [] : intro === '15' ? [root, root + 7] : [root, root + 4, root + 7];
    instrument.preload(root);
    this.running = true;
    this.pos = 0;
    this.phase = this.introNotes.length ? 'intro' : 'run';
    this.nextTime = ctx.currentTime + 0.05;
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 25);
  }

  /** Stop playback. `cut` silences notes that are still ringing. */
  stop(notify = true, cut = true): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const t of this.uiTimers) clearTimeout(t);
    this.uiTimers = [];
    const was = this.running;
    this.running = false;
    if (cut) instrument.stopAll();
    if (was && notify) this.events.onStop();
  }

  private tick(): void {
    if (!this.running) return;
    const ctx = getAudioContext();
    const lookahead = 0.12;
    while (this.running && this.nextTime < ctx.currentTime + lookahead) {
      this.scheduleNext();
    }
  }

  private scheduleNext(): void {
    const beat = this.beat();
    if (this.phase === 'intro') {
      const n = this.introNotes.length;
      if (this.pos < n) {
        const midi = this.introNotes[this.pos];
        this.emit({ midi, time: this.nextTime, index: -1 }, beat * 0.9);
        this.nextTime += beat;
        this.pos++;
        return;
      }
      if (this.pos === n) {
        // one silent beat
        this.fireAt(this.nextTime, () => this.events.onIntro(null));
        this.nextTime += beat;
        this.pos++;
        return;
      }
      this.phase = 'run';
      this.pos = 0;
    }
    if (this.pos < this.sequence.length) {
      const midi = this.sequence[this.pos];
      const hold = beat * this.holdBeats;
      this.emit({ midi, time: this.nextTime, index: this.pos }, hold * 0.95);
      this.nextTime += hold;
      this.pos++;
      return;
    }
    // run finished: let the last note ring, then one rest beat before notifying
    const lastNoteEnd = this.nextTime;
    const endAt = lastNoteEnd + beat;
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.fireAt(lastNoteEnd, () => this.events.onStep(-1, 0));
    this.fireAt(endAt, () => this.events.onRunEnd());
  }

  private emit(s: Scheduled, dur: number): void {
    instrument.play(s.midi, dur, this.sound, s.time);
    this.fireAt(s.time, () => {
      if (s.index >= 0) this.events.onStep(s.index, s.midi);
      else this.events.onIntro(s.midi);
    });
  }

  private fireAt(audioTime: number, fn: () => void): void {
    const ctx = getAudioContext();
    const ms = Math.max(0, (audioTime - ctx.currentTime) * 1000);
    const t = window.setTimeout(() => {
      this.uiTimers = this.uiTimers.filter((x) => x !== t);
      fn();
    }, ms);
    this.uiTimers.push(t);
  }
}
