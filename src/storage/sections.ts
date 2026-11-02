import type { Bookmark, Section, TrackMeta } from './db';

/**
 * Sections are fixed spans of the track (start / end seconds) with a name and a colour. They are
 * created from the A–B markers and then stay put: moving a marker never moves a section; the
 * section's times are edited by typing them. These helpers sort / validate them and convert
 * records from the 0.1.5 dev builds, where a section was bound to two marker ids.
 */

/** Two times closer than this are "the same" (section bounds vs loop ends, duplicate markers). */
export const SAME_TIME_SEC = 0.05;

/** Section palette (Studio 3a design): coral, teal, violet, green, blue. `Section.color` indexes it. */
export const SECTION_COLORS = ['#e8806f', '#3fb8b0', '#9a8ce6', '#8fbf6a', '#6c9fe0'];

export function sortedMarkers(meta: Pick<TrackMeta, 'bookmarks'>): Bookmark[] {
  return [...meta.bookmarks].sort((a, b) => a.time - b.time);
}

/** Sections in time order; ones with no positive length are left out. */
export function resolveSections(meta: Pick<TrackMeta, 'sections'>): Section[] {
  return (meta.sections ?? []).filter((s) => s.end > s.start).sort((x, y) => x.start - y.start || x.end - y.end);
}

/** The section whose bounds are the given two times (within 50 ms), if any. */
export function sectionAt(sections: Section[], start: number | null, end: number | null): Section | undefined {
  if (start === null || end === null) return undefined;
  return sections.find((s) => Math.abs(s.start - start) < SAME_TIME_SEC && Math.abs(s.end - end) < SAME_TIME_SEC);
}

/** 0.1.5 dev builds stored sections as a pair of marker ids. */
interface MarkerBoundSection {
  id: string;
  name: string;
  color: number;
  startMarkerId: string;
  endMarkerId: string;
}

/**
 * Convert marker-bound sections into fixed times (a section whose marker is gone is dropped,
 * swapped bounds are put in order) and clear the pre-0.1.5 `activeSection` field. Returns the
 * input untouched when there is nothing to do.
 */
export function migrateSections(meta: TrackMeta): TrackMeta {
  const raw = (meta.sections ?? []) as unknown as (Section | MarkerBoundSection)[];
  const bound = raw.some((s) => 'startMarkerId' in s);
  if (!bound && !meta.activeSection) return meta;
  const byId = new Map(meta.bookmarks.map((m) => [m.id, m.time]));
  const sections: Section[] = [];
  for (const s of raw) {
    if (!('startMarkerId' in s)) {
      sections.push(s);
      continue;
    }
    const a = byId.get(s.startMarkerId);
    const b = byId.get(s.endMarkerId);
    if (a === undefined || b === undefined || a === b) continue;
    sections.push({ id: s.id, name: s.name, color: s.color, start: Math.min(a, b), end: Math.max(a, b) });
  }
  return { ...meta, sections, activeSection: null };
}

/** Colour for a new section: the first palette entry no section uses, else cycle by count. */
export function nextSectionColor(used: number[]): number {
  const n = SECTION_COLORS.length;
  const taken = new Set(used.map((c) => ((c % n) + n) % n));
  for (let i = 0; i < n; i++) if (!taken.has(i)) return i;
  return used.length % n;
}

/** "#rrggbb" → "rgba(r,g,b,a)". */
export function tint(hex: string, alpha: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${alpha})`;
}

/**
 * Lane of each section for drawing: sections that overlap in time go on separate rows. Lanes are
 * assigned by start time (first lane whose last section has ended), returned in input order.
 */
export function sectionLanes(sections: Section[]): number[] {
  const order = sections.map((_, i) => i).sort((p, q) => sections[p].start - sections[q].start || sections[p].end - sections[q].end);
  const laneEnd: number[] = [];
  const lanes = new Array<number>(sections.length).fill(0);
  for (const i of order) {
    const s = sections[i];
    let lane = laneEnd.findIndex((e) => e <= s.start + 1e-6);
    if (lane < 0) lane = laneEnd.length;
    laneEnd[lane] = s.end;
    lanes[i] = lane;
  }
  return lanes;
}
