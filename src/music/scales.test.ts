import { describe, it, expect } from 'vitest';
import { SCALE_BY_ID, buildSequence, degreeLabel, degreeString, isInScale, turnIndex } from './scales';

describe('scales', () => {
  it('default major exercise is five notes C..G', () => {
    expect(buildSequence(60, SCALE_BY_ID.major, 'up')).toEqual([60, 62, 64, 65, 67]);
  });
  it('up-down does not repeat the top note', () => {
    expect(buildSequence(60, SCALE_BY_ID.major, 'upDown')).toEqual([60, 62, 64, 65, 67, 65, 64, 62, 60]);
    expect(turnIndex(SCALE_BY_ID.major, 'upDown')).toBe(4);
  });
  it('down reverses', () => {
    expect(buildSequence(60, SCALE_BY_ID.majorArpeggio, 'down')).toEqual([72, 67, 64, 60]);
  });
  it('arpeggio spans the octave', () => {
    expect(buildSequence(60, SCALE_BY_ID.majorArpeggio, 'up')).toEqual([60, 64, 67, 72]);
  });
  it('degree labels', () => {
    const d = (id: keyof typeof SCALE_BY_ID) => SCALE_BY_ID[id].exercise.map((i) => degreeLabel(SCALE_BY_ID[id], i));
    expect(d('major')).toEqual(['1', '2', '3', '4', '5']);
    expect(d('majorArpeggio')).toEqual(['1', '3', '5', '8']);
    expect(d('minorPentatonic')).toEqual(['1', '♭3', '4', '5', '♭7', '8']);
    expect(d('naturalMinor')).toEqual(['1', '2', '♭3', '4', '5']);
  });
  it('patterns ignore direction and have no turn', () => {
    expect(buildSequence(60, SCALE_BY_ID.p151, 'upDown')).toEqual([60, 67, 60]);
    expect(turnIndex(SCALE_BY_ID.p151, 'upDown')).toBe(-1);
    expect(degreeString(SCALE_BY_ID.p13581)).toBe('1 3 5 8 5 3 1');
  });
  it('isInScale handles any octave and negative wrap', () => {
    expect(isInScale(64, 60, SCALE_BY_ID.major)).toBe(true);
    expect(isInScale(63, 60, SCALE_BY_ID.major)).toBe(false);
    expect(isInScale(52, 60, SCALE_BY_ID.major)).toBe(true);
    expect(isInScale(63, 60, SCALE_BY_ID.naturalMinor)).toBe(true);
  });
});
