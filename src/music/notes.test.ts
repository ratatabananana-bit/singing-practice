import { describe, it, expect } from 'vitest';
import { midiToFreq, freqToMidi, freqToNote, centsOff, noteLabel, noteSlots, isSharp, parseTime, formatTimePrecise } from './notes';

describe('notes', () => {
  it('A4 is 440 Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(freqToMidi(440)).toBeCloseTo(69);
  });
  it('C4 is ~261.63 Hz', () => {
    expect(midiToFreq(60)).toBeCloseTo(261.63, 1);
  });
  it('rounds to nearest note with signed cents', () => {
    const n = freqToNote(445);
    expect(n.midi).toBe(69);
    expect(n.cents).toBeGreaterThan(0);
    expect(n.cents).toBeLessThan(25);
    expect(freqToNote(430).cents).toBeLessThan(0);
  });
  it('cents off target', () => {
    expect(centsOff(440, 69)).toBeCloseTo(0);
    expect(centsOff(midiToFreq(69.25), 69)).toBeCloseTo(25);
  });
  it('labels and slots', () => {
    expect(noteLabel(60)).toBe('C4');
    expect(noteLabel(61)).toBe('C#4');
    expect(noteSlots(61)).toEqual({ letter: 'C', sharp: true, octave: 4 });
    expect(isSharp(61)).toBe(true);
    expect(isSharp(62)).toBe(false);
  });
  it('time parsing and formatting', () => {
    expect(parseTime('1:05.25')).toBeCloseTo(65.25);
    expect(parseTime('05.5')).toBeCloseTo(5.5);
    expect(parseTime('2:00')).toBe(120);
    expect(parseTime('abc')).toBeNull();
    expect(formatTimePrecise(65.25)).toBe('1:05.25');
  });
});
