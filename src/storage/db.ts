import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BeatGrid } from '../audio/dsp/beats';

export interface Bookmark {
  id: string;
  name: string;
  time: number;
}

export interface TrackRecord {
  id: string;
  name: string;
  type: string;
  size: number;
  addedAt: number;
  blob: Blob;
  /** Where it came from when known, e.g. "youtube:<videoId>"; used to recognise re-imports. */
  source?: string;
}

/**
 * A named, coloured fixed span of the track. Made from the A–B markers, then independent of them:
 * moving a marker never moves a section; its times are edited by typing. (0.1.5 dev builds stored
 * a pair of marker ids instead; `migrateSections` in storage/sections.ts converts those on load.)
 */
export interface Section {
  id: string;
  name: string;
  /** Index into SECTION_COLORS. */
  color: number;
  start: number;
  end: number;
}

export interface TrackMeta {
  trackId: string;
  bookmarks: Bookmark[];
  /** Named, coloured song parts (Verse, Chorus…) that can be looped directly. */
  sections?: Section[];
  /** Pre-0.1.5: id of the looped section; migrated into activeLoop/loopEnd and cleared. */
  activeSection?: string | null;
  /** Index (in time order) of the marker that starts the loop, or null. */
  activeLoop: number | null;
  /** Index of the marker that ends the loop; defaults to activeLoop + 1 when missing. */
  loopEnd?: number | null;
  /** Temporary loop ends in seconds, used when a section is looped and its bound has no marker (never saved as markers). */
  tempA?: number | null;
  tempB?: number | null;
  loopOn: boolean;
  speed: number;
  transpose: number;
  fineCents?: number;
  /** Detected tempo grid (see dsp/beats.ts), null when detection failed, undefined when not run yet. */
  beatGrid?: BeatGrid | null;
  beatsPerBar?: number;
  snapOn?: boolean;
  loopGap?: number;
  lastPosition: number;
}

export interface TakeRecord {
  id: string;
  number: number;
  createdAt: number;
  duration: number;
  sampleRate: number;
  wav: Blob;
  /** Pitch trace: [time, midi] pairs; midi 0 = silent. */
  trace: Float32Array;
  /** Downsampled min/max/rms waveform for the thumbnail. */
  wave: Float32Array;
  /** Starred takes are never evicted and act as the reference trace in the master graph. */
  starred?: boolean;
  /** Track position (seconds) when the take started, if a track was playing; -1 otherwise. */
  trackStart?: number;
  trackId?: string | null;
}

interface SingDB extends DBSchema {
  tracks: { key: string; value: TrackRecord; indexes: { addedAt: number } };
  trackMeta: { key: string; value: TrackMeta };
  takes: { key: string; value: TakeRecord; indexes: { createdAt: number } };
}

let dbp: Promise<IDBPDatabase<SingDB>> | null = null;

function db(): Promise<IDBPDatabase<SingDB>> {
  if (!dbp) {
    dbp = openDB<SingDB>('singing-practice', 3, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          const t = d.createObjectStore('tracks', { keyPath: 'id' });
          t.createIndex('addedAt', 'addedAt');
          d.createObjectStore('trackMeta', { keyPath: 'trackId' });
          const k = d.createObjectStore('takes', { keyPath: 'id' });
          k.createIndex('createdAt', 'createdAt');
        }
        // v2 briefly added a "runs" store (practice history, since removed); drop it if present.
        if (oldVersion < 3 && d.objectStoreNames.contains('runs' as never)) d.deleteObjectStore('runs' as never);
      },
    });
  }
  return dbp;
}

export const MAX_TAKES = 5;

export const storage = {
  async putTrack(rec: TrackRecord): Promise<void> {
    const d = await db();
    await d.put('tracks', rec);
  },
  async getTrack(id: string): Promise<TrackRecord | undefined> {
    const d = await db();
    return d.get('tracks', id);
  },
  async listTracks(): Promise<Omit<TrackRecord, 'blob'>[]> {
    const d = await db();
    const all = await d.getAllFromIndex('tracks', 'addedAt');
    return all.reverse().map(({ blob: _b, ...rest }) => rest);
  },
  async deleteTrack(id: string): Promise<void> {
    const d = await db();
    await d.delete('tracks', id);
    await d.delete('trackMeta', id);
  },
  async getMeta(trackId: string): Promise<TrackMeta> {
    const d = await db();
    return (
      (await d.get('trackMeta', trackId)) ?? {
        trackId,
        bookmarks: [],
        activeLoop: null,
        loopOn: false,
        speed: 1,
        transpose: 0,
        lastPosition: 0,
      }
    );
  },
  async putMeta(meta: TrackMeta): Promise<void> {
    const d = await db();
    await d.put('trackMeta', meta);
  },
  /** Point takes recorded against any of `from` at track `to` (used when duplicate tracks are merged). */
  async remapTakes(from: string[], to: string): Promise<void> {
    const d = await db();
    const all = await d.getAll('takes');
    for (const t of all) if (t.trackId && from.includes(t.trackId)) await d.put('takes', { ...t, trackId: to });
  },
  async putTake(take: TakeRecord): Promise<TakeRecord[]> {
    const d = await db();
    await d.put('takes', take);
    const all = (await d.getAllFromIndex('takes', 'createdAt')).reverse();
    // Keep every starred take plus the newest MAX_TAKES unstarred ones.
    const unstarred = all.filter((t) => !t.starred);
    const evicted = unstarred.slice(MAX_TAKES);
    for (const e of evicted) await d.delete('takes', e.id);
    return all.filter((t) => !evicted.includes(t));
  },
  async listTakes(): Promise<TakeRecord[]> {
    const d = await db();
    return (await d.getAllFromIndex('takes', 'createdAt')).reverse();
  },
  async updateTake(id: string, patch: Partial<TakeRecord>): Promise<void> {
    const d = await db();
    const t = await d.get('takes', id);
    if (t) await d.put('takes', { ...t, ...patch });
  },
  async deleteTake(id: string): Promise<void> {
    const d = await db();
    await d.delete('takes', id);
  },
  async estimate(): Promise<{ usage: number; quota: number } | null> {
    if (!navigator.storage?.estimate) return null;
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  },
};

export function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}
