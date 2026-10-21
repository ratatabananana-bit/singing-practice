import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

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
}

export interface TrackMeta {
  trackId: string;
  bookmarks: Bookmark[];
  /** Index (in time order) of the marker that starts the loop, or null. */
  activeLoop: number | null;
  /** Index of the marker that ends the loop; defaults to activeLoop + 1 when missing. */
  loopEnd?: number | null;
  loopOn: boolean;
  speed: number;
  transpose: number;
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
}

interface SingDB extends DBSchema {
  tracks: { key: string; value: TrackRecord; indexes: { addedAt: number } };
  trackMeta: { key: string; value: TrackMeta };
  takes: { key: string; value: TakeRecord; indexes: { createdAt: number } };
}

let dbp: Promise<IDBPDatabase<SingDB>> | null = null;

function db(): Promise<IDBPDatabase<SingDB>> {
  if (!dbp) {
    dbp = openDB<SingDB>('singing-practice', 1, {
      upgrade(d) {
        const t = d.createObjectStore('tracks', { keyPath: 'id' });
        t.createIndex('addedAt', 'addedAt');
        d.createObjectStore('trackMeta', { keyPath: 'trackId' });
        const k = d.createObjectStore('takes', { keyPath: 'id' });
        k.createIndex('createdAt', 'createdAt');
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
  async putTake(take: TakeRecord): Promise<TakeRecord[]> {
    const d = await db();
    await d.put('takes', take);
    const all = (await d.getAllFromIndex('takes', 'createdAt')).reverse();
    const evicted = all.slice(MAX_TAKES);
    for (const e of evicted) await d.delete('takes', e.id);
    return all.slice(0, MAX_TAKES);
  },
  async listTakes(): Promise<TakeRecord[]> {
    const d = await db();
    return (await d.getAllFromIndex('takes', 'createdAt')).reverse();
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
