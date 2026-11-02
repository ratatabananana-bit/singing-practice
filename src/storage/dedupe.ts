import type { Bookmark, Section, TrackMeta, TrackRecord } from './db';

/**
 * Track identity. Every import used to mint a fresh id, so re-downloading the same YouTube video
 * (or re-picking the same file) produced a new record with empty markers: the old markers were
 * still in the database but unreachable. Two helpers fix that:
 * - `trackKey` decides when two records are the same song (source id, else name + size).
 * - `mergeMetas` folds the markers/sections of duplicates into one meta.
 */

export type TrackSummary = Omit<TrackRecord, 'blob'>;

/** Same song? Prefer an explicit source key (e.g. "youtube:<id>"), else file name + byte size. */
export function trackKey(t: { name: string; size: number; source?: string }): string {
  return t.source ? `src:${t.source}` : `file:${t.name}:${t.size}`;
}

/** Group track summaries by identity; only groups with 2+ members are returned, newest first inside. */
export function duplicateGroups(tracks: TrackSummary[]): TrackSummary[][] {
  const by = new Map<string, TrackSummary[]>();
  for (const t of tracks) {
    const k = trackKey(t);
    const g = by.get(k) ?? [];
    g.push(t);
    by.set(k, g);
  }
  return [...by.values()].filter((g) => g.length > 1).map((g) => [...g].sort((a, b) => b.addedAt - a.addedAt));
}

const SAME_TIME = 0.05;

/**
 * Merge `others` into `primary`: union of markers (one within 50 ms of an existing marker is
 * dropped) and sections (same name and start = the same section), keeping primary's loop, speed,
 * position and beat grid unless primary has no grid and another does.
 */
export function mergeMetas(primary: TrackMeta, others: TrackMeta[]): TrackMeta {
  const bookmarks: Bookmark[] = [...primary.bookmarks];
  const sections: Section[] = [...(primary.sections ?? [])];
  let beatGrid = primary.beatGrid;
  let beatsPerBar = primary.beatsPerBar;
  for (const o of others) {
    for (const b of o.bookmarks) {
      if (!bookmarks.some((x) => Math.abs(x.time - b.time) < SAME_TIME)) bookmarks.push({ ...b });
    }
    for (const s of o.sections ?? []) {
      if (!sections.some((x) => x.name === s.name && Math.abs(x.start - s.start) < SAME_TIME)) sections.push({ ...s });
    }
    if (!beatGrid && o.beatGrid) {
      beatGrid = o.beatGrid;
      beatsPerBar = o.beatsPerBar;
    }
  }
  bookmarks.sort((a, b) => a.time - b.time);
  return { ...primary, bookmarks, sections, beatGrid, beatsPerBar };
}

/** Which record of a duplicate group to keep: the one with the most markers, newest on a tie. */
export function pickPrimary(group: TrackSummary[], metaOf: (id: string) => TrackMeta | undefined): TrackSummary {
  return [...group].sort((a, b) => {
    const ma = metaOf(a.id)?.bookmarks.length ?? 0;
    const mb = metaOf(b.id)?.bookmarks.length ?? 0;
    return mb - ma || b.addedAt - a.addedAt;
  })[0];
}
