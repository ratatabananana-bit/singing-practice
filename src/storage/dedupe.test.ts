import { describe, expect, it } from 'vitest';
import { duplicateGroups, mergeMetas, pickPrimary, trackKey } from './dedupe';
import type { TrackMeta } from './db';

const meta = (trackId: string, times: number[], extra: Partial<TrackMeta> = {}): TrackMeta => ({
  trackId,
  bookmarks: times.map((t, i) => ({ id: `${trackId}-${i}`, name: `Pin ${i + 1}`, time: t })),
  activeLoop: null,
  loopOn: false,
  speed: 1,
  transpose: 0,
  lastPosition: 0,
  ...extra,
});

describe('track identity', () => {
  it('uses the source key when present, else name + size', () => {
    expect(trackKey({ name: 'a.mp3', size: 10, source: 'youtube:x' })).toBe('src:youtube:x');
    expect(trackKey({ name: 'a.mp3', size: 10 })).toBe('file:a.mp3:10');
    expect(trackKey({ name: 'a.mp3', size: 11 })).not.toBe(trackKey({ name: 'a.mp3', size: 10 }));
  });

  it('groups same-song records, newest first', () => {
    const g = duplicateGroups([
      { id: 'a', name: 'song.mp3', type: '', size: 5, addedAt: 1 },
      { id: 'b', name: 'song.mp3', type: '', size: 5, addedAt: 3 },
      { id: 'c', name: 'other.mp3', type: '', size: 5, addedAt: 2 },
      { id: 'd', name: 'song.mp3', type: '', size: 5, addedAt: 2 },
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].map((t) => t.id)).toEqual(['b', 'd', 'a']);
  });

  it('keeps the record with the most markers', () => {
    const group = [
      { id: 'new', name: 's', type: '', size: 1, addedAt: 3 },
      { id: 'old', name: 's', type: '', size: 1, addedAt: 1 },
    ];
    const metas: Record<string, TrackMeta> = { new: meta('new', [1, 2]), old: meta('old', [1, 2, 3, 4, 5]) };
    expect(pickPrimary(group, (id) => metas[id]).id).toBe('old');
  });
});

describe('mergeMetas', () => {
  it('unions markers and sections, dropping near-duplicates, and keeps a grid', () => {
    const grid = { bpm: 120, offset: 0, confidence: 1, beats: [0, 0.5], beatsPerBar: 4, barStart: 0 };
    const primary = meta('p', [17.2, 44.79, 23.83], { beatGrid: grid, beatsPerBar: 4, lastPosition: 128, activeLoop: 0, loopEnd: 1 });
    const other = meta('o', [48.54, 56.74, 17.21], { sections: [{ id: 's1', name: 'Chorus', color: 1, start: 48.54, end: 56.74 }] });
    const m = mergeMetas(primary, [other]);
    expect(m.bookmarks.map((b) => +b.time.toFixed(2))).toEqual([17.2, 23.83, 44.79, 48.54, 56.74]);
    expect(m.sections).toEqual([{ id: 's1', name: 'Chorus', color: 1, start: 48.54, end: 56.74 }]);
    expect(m.beatGrid).toBe(grid);
    expect(m.lastPosition).toBe(128);
    expect(m.activeLoop).toBe(0);
    expect(m.trackId).toBe('p');
  });

  it('drops a duplicate section with the same name and start', () => {
    const primary = meta('p', [10, 20], { sections: [{ id: 'pv', name: 'Verse', color: 0, start: 10, end: 20 }] });
    const other = meta('o', [30], {
      sections: [
        { id: 'ov', name: 'Verse', color: 0, start: 10.01, end: 20 },
        { id: 'oc', name: 'Chorus', color: 1, start: 20, end: 30 },
      ],
    });
    const m = mergeMetas(primary, [other]);
    expect(m.sections!.map((x) => x.id)).toEqual(['pv', 'oc']);
  });

  it('takes a grid from a duplicate when the primary has none', () => {
    const grid = { bpm: 100, offset: 0, confidence: 1 };
    const m = mergeMetas(meta('p', []), [meta('o', [], { beatGrid: grid, beatsPerBar: 3 })]);
    expect(m.beatGrid).toBe(grid);
    expect(m.beatsPerBar).toBe(3);
  });
});
