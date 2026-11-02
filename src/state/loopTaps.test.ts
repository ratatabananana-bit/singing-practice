import { describe, expect, it } from 'vitest';
import { loopTimes, pickAB, tapAction, type LoopState } from './loopTaps';

const off: LoopState = { a: null, b: null, on: false };
const loop = (a: number, b: number): LoopState => ({ a, b, on: true });

describe('marker taps (start = end index)', () => {
  it('jumps when there is only one marker', () => {
    expect(tapAction(0, 0, 1, off, null)).toEqual({ type: 'jump', index: 0 });
  });

  it('first tap loops the one segment starting there and waits for an end', () => {
    expect(tapAction(2, 2, 5, off, null)).toEqual({ type: 'loop', a: 2, b: 3, pending: 2 });
  });

  it('a tap on the last marker loops the last segment', () => {
    expect(tapAction(4, 4, 5, off, null)).toEqual({ type: 'loop', a: 3, b: 4, pending: 3 });
  });

  it('a later marker right after a start tap becomes the end', () => {
    expect(tapAction(4, 4, 5, loop(1, 2), 1)).toEqual({ type: 'loop', a: 1, b: 4, pending: null });
  });

  it('after the end is chosen, any tap is a new start (so the start can be moved)', () => {
    expect(tapAction(3, 3, 5, loop(1, 4), null)).toEqual({ type: 'loop', a: 3, b: 4, pending: 3 });
    expect(tapAction(0, 0, 5, loop(1, 4), null)).toEqual({ type: 'loop', a: 0, b: 1, pending: 0 });
  });

  it('an earlier marker while waiting for an end is a new start', () => {
    expect(tapAction(0, 0, 5, loop(2, 3), 2)).toEqual({ type: 'loop', a: 0, b: 1, pending: 0 });
  });

  it('forgets the pending start when the loop changed underneath it', () => {
    expect(tapAction(4, 4, 5, loop(0, 3), 1)).toEqual({ type: 'loop', a: 4 - 1, b: 4, pending: 3 });
    expect(tapAction(4, 4, 5, { ...loop(1, 2), on: false }, 1)).toEqual({ type: 'loop', a: 3, b: 4, pending: 3 });
  });

  it('tapping the pending start again changes nothing', () => {
    expect(tapAction(1, 1, 5, loop(1, 2), 1)).toEqual({ type: 'none' });
  });
});

describe('segment taps (start = i, end = i + 1)', () => {
  it('first tap loops that segment', () => {
    expect(tapAction(1, 2, 4, off, null)).toEqual({ type: 'loop', a: 1, b: 2, pending: 1 });
  });

  it('a later segment right after extends the end to that segment\u2019s end marker', () => {
    expect(tapAction(2, 3, 4, loop(0, 1), 0)).toEqual({ type: 'loop', a: 0, b: 3, pending: null });
  });

  it('the same segment again changes nothing', () => {
    expect(tapAction(1, 2, 4, loop(1, 2), 1)).toEqual({ type: 'none' });
  });
});

describe('pickAB (A / B buttons on marker rows)', () => {
  it('A keeps the current B when it lies after the picked marker', () => {
    expect(pickAB('A', 1, 5, loop(2, 4))).toEqual({ a: 1, b: 4 });
  });

  it('A with no usable B takes the next marker as B', () => {
    expect(pickAB('A', 1, 5, off)).toEqual({ a: 1, b: 2 });
    expect(pickAB('A', 3, 5, loop(1, 3))).toEqual({ a: 3, b: 4 });
  });

  it('A on the last marker is impossible', () => {
    expect(pickAB('A', 4, 5, off)).toBeNull();
  });

  it('B keeps the current A when it lies before the picked marker', () => {
    expect(pickAB('B', 4, 5, loop(1, 2))).toEqual({ a: 1, b: 4 });
  });

  it('B with no usable A takes the previous marker as A', () => {
    expect(pickAB('B', 2, 5, off)).toEqual({ a: 1, b: 2 });
    expect(pickAB('B', 1, 5, loop(2, 3))).toEqual({ a: 0, b: 1 });
  });

  it('B on the first marker is impossible', () => {
    expect(pickAB('B', 0, 5, off)).toBeNull();
  });

  it('nothing with fewer than two markers', () => {
    expect(pickAB('A', 0, 1, off)).toBeNull();
  });
});

describe('A picked, B cleared', () => {
  it('a later tap becomes B even though there is no loop yet', () => {
    expect(tapAction(3, 3, 5, { a: 1, b: null, on: false }, 1)).toEqual({ type: 'loop', a: 1, b: 3, pending: null });
  });

  it('B alone: A can still be picked by its row button, keeping B', () => {
    expect(pickAB('A', 0, 5, { a: null, b: 3, on: false })).toEqual({ a: 0, b: 3 });
  });
});

describe('loopTimes (marker or temporary ends)', () => {
  const markers = [{ id: 'a', name: '', time: 10 }, { id: 'b', name: '', time: 20 }];
  it('uses marker times when the ends are markers', () => {
    expect(loopTimes({ activeLoop: 0, loopEnd: 1 }, markers)).toEqual([10, 20]);
  });
  it('uses a temporary time for an end that is not a marker', () => {
    expect(loopTimes({ activeLoop: 0, loopEnd: null, tempB: 17.5 }, markers)).toEqual([10, 17.5]);
    expect(loopTimes({ activeLoop: null, loopEnd: 1, tempA: 3 }, markers)).toEqual([3, 20]);
  });
  it('treats a missing loopEnd as the next marker (records from before B was stored)', () => {
    expect(loopTimes({ activeLoop: 0 }, markers)).toEqual([10, 20]);
  });
  it('gives null for an end that is neither', () => {
    expect(loopTimes({ activeLoop: null, loopEnd: null }, markers)).toEqual([null, null]);
    expect(loopTimes({ activeLoop: 5, loopEnd: 1 }, markers)).toEqual([null, 20]);
  });
});
