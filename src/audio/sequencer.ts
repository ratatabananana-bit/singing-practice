import { getAudioContext, unlockAudio } from './context';
import { instrument } from './synth/Instrument';
import type { IntroMode, SoundMode } from '../state/settings';

export interface ScheduledNote {
  index: number;
  midi: number;
  /** AudioContext time the note starts. */
  time: number;
  /** Seconds the note is held. */
  dur: number;
}

export interface SequencerEvents {
  /** Called when a sequence note starts sounding (index into the sequence) or -1 when none. */
  onStep: (index: number, midi: number) => void;
  /** Intro cue note sounding (midi) or null when intro done. */
  onIntro: (midi: number | null) => void;
  /** A run (the pass the singer should sing on) is about to start; `notes` has its full schedule. */
  onRunStart?: (notes: ScheduledNote[], listenPass: boolean) => void;
  /** One full run finished. */
  onRunEnd: () => void;
  onStop: () => void;
}

export interface RunOptions {
  sequence: number[];
  intro: IntroMode;
  root: number;
  /** Leave the previous run's last note ringing (auto-advance). */
  keepTail?: boolean;
  /** Beats each note is held. */
  holdBeats?: number;
  /** Play the melody once first, then a pass with clicks only for the singer. */
  listenFirst?: boolean;
  /** Rest after the run, in beats. */
  gapBeats?: number;
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
  private phase: 'intro' | 'demo' | 'run' = 'run';
  private sequence: number[] = [];
  private introNotes: number[] = [];
  private holdBeats = 1;
  private listenFirst = false;
  private gapBeats = 1;
  private runNotes: ScheduledNote[] = [];

  bpm = 120;
  sound: SoundMode = 'piano';

  constructor(private events: SequencerEvents) {}

  get isRunning(): boolean {
    return this.running;
  }

  private beat(): number {
    return 60 / this.bpm;
  }

  /** Start a run: optional intro cue, optional listen pass, then the sequence. */
  async start(o: RunOptions): Promise<void> {
    this.stop(false, !o.keepTail);
    this.holdBeats = Math.max(1, o.holdBeats ?? 1);
    this.listenFirst = !!o.listenFirst;
    this.gapBeats = o.gapBeats ?? 1;
    await unlockAudio();
    const ctx = getAudioContext();
    this.sequence = o.sequence;
    this.introNotes = o.intro === 'off' ? [] : o.intro === '15' ? [o.root, o.root + 7] : [o.root, o.root + 4, o.root + 7];
    instrument.preload(o.root);
    this.running = true;
    this.pos = 0;
    this.phase = this.introNotes.length ? 'intro' : this.listenFirst ? 'demo' : 'run';
    this.nextTime = ctx.currentTime + 0.05;
    this.runNotes = [];
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
        this.emit({ index: -1, midi, time: this.nextTime, dur: beat * 0.9 }, true);
        this.nextTime += beat;
        this.pos++;
        return;
      }
      if (this.pos === n) {
        this.fireAt(this.nextTime, () => this.events.onIntro(null));
        this.nextTime += beat;
        this.pos++;
        return;
      }
      this.phase = this.listenFirst ? 'demo' : 'run';
      this.pos = 0;
    }
    const hold = beat * this.holdBeats;
    if (this.phase === 'demo') {
      // Listen pass: melody plays, chips follow, nothing is scored.
      if (this.pos < this.sequence.length) {
        this.emit({ index: this.pos, midi: this.sequence[this.pos], time: this.nextTime, dur: hold * 0.95 }, true);
        this.nextTime += hold;
        this.pos++;
        return;
      }
      // one rest beat, then the singer's pass
      this.fireAt(this.nextTime, () => this.events.onStep(-1, 0));
      this.nextTime += beat;
      this.phase = 'run';
      this.pos = 0;
    }
    if (this.pos === 0 && this.runNotes.length === 0) {
      // Pre-compute the whole singer pass so the UI can draw target blocks ahead of time.
      let t = this.nextTime;
      this.runNotes = this.sequence.map((midi, index) => {
        const n = { index, midi, time: t, dur: hold * 0.95 };
        t += hold;
        return n;
      });
      this.events.onRunStart?.(this.runNotes, this.listenFirst);
    }
    if (this.pos < this.sequence.length) {
      const n = this.runNotes[this.pos];
      // In listen mode the singer's pass gets a click per note instead of the melody.
      this.emit({ ...n, time: this.nextTime }, !this.listenFirst);
      this.nextTime += hold;
      this.pos++;
      return;
    }
    // run finished: let the last note ring, then the gap before notifying
    const lastNoteEnd = this.nextTime;
    const endAt = lastNoteEnd + beat * Math.max(0.25, this.gapBeats);
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.fireAt(lastNoteEnd, () => this.events.onStep(-1, 0));
    this.fireAt(endAt, () => this.events.onRunEnd());
  }

  private emit(n: ScheduledNote, sound: boolean): void {
    if (sound) instrument.play(n.midi, n.dur, this.sound, n.time);
    else instrument.click(n.time);
    this.fireAt(n.time, () => {
      if (n.index >= 0) this.events.onStep(n.index, n.midi);
      else this.events.onIntro(n.midi);
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
