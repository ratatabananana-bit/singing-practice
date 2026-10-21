import { describe, it, expect } from 'vitest';
import { bestHeldNote } from './rangeFinder';

describe('bestHeldNote', () => {
  it('returns the longest steadily held note', () => {
    const f: { t: number; m: number }[] = [];
    let t = 0;
    for (let i = 0; i < 10; i++) f.push({ t: (t += 0.05), m: 60 + (i % 2) * 0.2 }); // 0.5 s on C4
    for (let i = 0; i < 4; i++) f.push({ t: (t += 0.05), m: 0 });
    for (let i = 0; i < 30; i++) f.push({ t: (t += 0.05), m: 55.1 }); // 1.5 s on G3
    expect(bestHeldNote(f, 0.8)).toBe(55);
  });
  it('returns null when nothing was held long enough', () => {
    const f = Array.from({ length: 6 }, (_, i) => ({ t: i * 0.05, m: 60 }));
    expect(bestHeldNote(f, 0.8)).toBeNull();
  });
});
