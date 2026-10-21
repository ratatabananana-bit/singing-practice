import { describe, it, expect } from 'vitest';
import { starsFor, streakDays, lastDays, bestByExercise } from './history';
import type { RunRecord } from '../storage/db';

const DAY = 86_400_000;
const run = (at: number, hits: number, total: number, precision = 0.9, exerciseId = 'major'): RunRecord => ({
  id: String(at) + exerciseId,
  at,
  tab: 'play',
  exerciseId,
  root: 60,
  bpm: 120,
  hits,
  total,
  avgCents: 0,
  precision,
  sustain: 1,
});

describe('history', () => {
  it('stars', () => {
    expect(starsFor({ hits: 5, total: 5, precision: 0.9 })).toBe(3);
    expect(starsFor({ hits: 5, total: 5, precision: 0.5 })).toBe(2);
    expect(starsFor({ hits: 2, total: 5, precision: 0.9 })).toBe(1);
    expect(starsFor({ hits: 0, total: 5, precision: 0 })).toBe(0);
  });
  it('streak counts consecutive days back from today, tolerating an empty today', () => {
    const now = Date.UTC(2026, 9, 21, 12);
    expect(streakDays([run(now - DAY, 1, 1), run(now - 2 * DAY, 1, 1)], now)).toBe(2);
    expect(streakDays([run(now, 1, 1), run(now - DAY, 1, 1), run(now - 3 * DAY, 1, 1)], now)).toBe(2);
    expect(streakDays([], now)).toBe(0);
  });
  it('lastDays buckets runs per day, oldest first', () => {
    const now = Date.UTC(2026, 9, 21, 12);
    const d = lastDays([run(now, 3, 5), run(now, 2, 5), run(now - 2 * DAY, 5, 5)], 3, now);
    expect(d.map((x) => x.runs)).toEqual([1, 0, 2]);
    expect(d[2].hits).toBe(5);
  });
  it('best per exercise', () => {
    const b = bestByExercise([run(1, 5, 5, 0.9), run(2, 2, 5, 0.9), run(3, 4, 5, 0.9, 'p151')]);
    expect(b.get('major')!.stars).toBe(3);
    expect(b.get('major')!.runs).toBe(2);
    expect(b.get('p151')!.stars).toBe(2);
  });
});
