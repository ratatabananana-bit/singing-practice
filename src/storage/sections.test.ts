import { describe, expect, it } from 'vitest';
import { migrateSections, nextSectionColor, resolveSections, sectionAt, sectionLanes, sortedMarkers, tint } from './sections';
import type { TrackMeta } from './db';

const meta = (times: number[], extra: Partial<TrackMeta> = {}): TrackMeta => ({
  trackId: 't',
  bookmarks: times.map((t, i) => ({ id: `m${i}`, name: `Pin ${i + 1}`, time: t })),
  activeLoop: null,
  loopOn: false,
  speed: 1,
  transpose: 0,
  lastPosition: 0,
  ...extra,
});

describe('resolveSections', () => {
  it('returns sections in time order and drops empty or inverted ones', () => {
    const m = meta([0], {
      sections: [
        { id: 'b', name: 'Chorus', color: 1, start: 20, end: 30 },
        { id: 'a', name: 'Verse', color: 0, start: 10, end: 20 },
        { id: 'x', name: 'Bad', color: 0, start: 15, end: 15 },
        { id: 'y', name: 'Worse', color: 0, start: 40, end: 35 },
      ],
    });
    expect(resolveSections(m).map((s) => s.id)).toEqual(['a', 'b']);
    expect(sortedMarkers(m).map((x) => x.id)).toEqual(['m0']);
  });

  it('finds the section whose bounds match two times within 50 ms', () => {
    const secs = [{ id: 's', name: 'S', color: 0, start: 10, end: 20 }];
    expect(sectionAt(secs, 10.02, 19.97)?.id).toBe('s');
    expect(sectionAt(secs, 10, 21)).toBeUndefined();
    expect(sectionAt(secs, null, 20)).toBeUndefined();
  });
});

describe('migrateSections', () => {
  it('turns marker-bound sections (0.1.5 dev builds) into fixed times, dropping dangling ones', () => {
    const m = meta([10, 20, 30], {
      sections: [
        { id: 'a', name: 'Verse', color: 0, startMarkerId: 'm0', endMarkerId: 'm1' } as never,
        { id: 'gone', name: 'X', color: 0, startMarkerId: 'm0', endMarkerId: 'zz' } as never,
        { id: 'swapped', name: 'Y', color: 0, startMarkerId: 'm2', endMarkerId: 'm1' } as never,
      ],
    });
    const out = migrateSections(m);
    expect(out.sections).toEqual([
      { id: 'a', name: 'Verse', color: 0, start: 10, end: 20 },
      { id: 'swapped', name: 'Y', color: 0, start: 20, end: 30 },
    ]);
    expect(out.bookmarks).toBe(m.bookmarks);
  });

  it('clears the pre-0.1.5 activeSection field', () => {
    const out = migrateSections(meta([0], { sections: [{ id: 's', name: 'S', color: 0, start: 1, end: 2 }], activeSection: 's' }));
    expect(out.activeSection).toBeNull();
    expect(out.sections).toEqual([{ id: 's', name: 'S', color: 0, start: 1, end: 2 }]);
  });

  it('returns the same object when nothing needs migrating', () => {
    const m = meta([1, 2], { sections: [{ id: 's', name: 'S', color: 0, start: 1, end: 2 }] });
    expect(migrateSections(m)).toBe(m);
    const plain = meta([1]);
    expect(migrateSections(plain)).toBe(plain);
  });
});

describe('section palette', () => {
  it('picks the first colour no section uses, else cycles', () => {
    expect(nextSectionColor([])).toBe(0);
    expect(nextSectionColor([0, 1])).toBe(2);
    expect(nextSectionColor([0, 1, 2, 3, 4])).toBe(0);
    expect(nextSectionColor([0, 1, 2, 3, 4, 0])).toBe(1);
  });

  it('turns a palette hex into rgba', () => {
    expect(tint('#e8806f', 0.5)).toBe('rgba(232,128,111,0.5)');
  });
});

describe('sectionLanes', () => {
  const sec = (id: string, start: number, end: number) => ({ id, name: id, color: 0, start, end });
  it('keeps non-overlapping sections in lane 0 and pushes an overlapping one down', () => {
    expect(sectionLanes([sec('a', 0, 10), sec('b', 10, 20), sec('c', 5, 15)])).toEqual([0, 0, 1]);
  });
  it('reuses a lane once it is free', () => {
    expect(sectionLanes([sec('a', 0, 10), sec('b', 5, 12), sec('c', 11, 20)])).toEqual([0, 1, 0]);
  });
  it('is empty for no sections', () => {
    expect(sectionLanes([])).toEqual([]);
  });
});
