import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// Fake audio clock driven by the fake timers (seconds).
const ctx = {
  get currentTime() {
    return Date.now() / 1000;
  },
};
let unlockGate: Promise<void> = Promise.resolve();
vi.mock('./context', () => ({
  getAudioContext: () => ctx,
  unlockAudio: () => unlockGate.then(() => ctx),
}));
vi.mock('./synth/Instrument', () => ({
  instrument: { play: vi.fn(), click: vi.fn(), stopAll: vi.fn(), preload: vi.fn() },
}));

// Node test env: the sequencer schedules through window.* timers.
vi.stubGlobal('window', globalThis);

import { Sequencer, type SequencerEvents } from './sequencer';

function makeEvents(): SequencerEvents {
  return { onStep: vi.fn(), onIntro: vi.fn(), onRunStart: vi.fn(), onRunEnd: vi.fn(), onStop: vi.fn() };
}

describe('Sequencer stop() always tells the UI', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    unlockGate = Promise.resolve();
  });
  afterEach(() => vi.useRealTimers());

  it('notifies onStop when stopped during the gap after the last note', async () => {
    const ev = makeEvents();
    const sq = new Sequencer(ev);
    sq.bpm = 120; // beat = 0.5 s
    await sq.start({ sequence: [60, 62], intro: 'off', root: 60, holdBeats: 1, gapBeats: 1 });
    // Two notes of 0.5 s: the last note ends at ~1.05 s; the run-end callback fires 0.5 s later.
    await vi.advanceTimersByTimeAsync(1200);
    expect(ev.onRunEnd).not.toHaveBeenCalled();
    sq.stop();
    expect(ev.onStop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ev.onRunEnd).not.toHaveBeenCalled();
  });

  it('notifies onStop when stopped before the audio context has unlocked', async () => {
    let release!: () => void;
    unlockGate = new Promise<void>((r) => (release = r));
    const ev = makeEvents();
    const sq = new Sequencer(ev);
    const started = sq.start({ sequence: [60], intro: 'off', root: 60 });
    sq.stop();
    expect(ev.onStop).toHaveBeenCalledTimes(1);
    release();
    await started;
    await vi.advanceTimersByTimeAsync(3000);
    expect(sq.isRunning).toBe(false);
    expect(ev.onStep).not.toHaveBeenCalled();
  });

  it('still ends a run normally when nobody interrupts', async () => {
    const ev = makeEvents();
    const sq = new Sequencer(ev);
    sq.bpm = 120;
    await sq.start({ sequence: [60, 62], intro: 'off', root: 60, holdBeats: 1, gapBeats: 1 });
    await vi.advanceTimersByTimeAsync(2500);
    expect(ev.onRunEnd).toHaveBeenCalledTimes(1);
    expect(ev.onStop).not.toHaveBeenCalled();
  });
});
