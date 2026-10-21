import { create } from 'zustand';
import { storage, uid, type Bookmark, type TakeRecord, type TrackMeta } from '../storage/db';
import { trackPlayer, TrackPlayer } from '../audio/player/TrackPlayer';
import { useSettings } from './settings';
import { instrument } from '../audio/synth/Instrument';

/** Second player instance for takes (so a take can play over / instead of the track). */
export const takePlayer = new TrackPlayer();

export interface StudioState {
  track: { id: string; name: string } | null;
  meta: TrackMeta | null;
  takes: TakeRecord[];
  recording: boolean;
  processing: boolean;
  /** Take currently loaded into the take player (for replay in the Master graph). */
  replayTakeId: string | null;
  error: string | null;
  busy: boolean;

  loadFile: (file: File) => Promise<void>;
  loadLast: () => Promise<void>;
  setMeta: (patch: Partial<TrackMeta>) => void;
  addBookmark: (time: number) => void;
  updateBookmark: (id: string, patch: Partial<Bookmark>) => void;
  removeBookmark: (id: string) => void;
  sortBookmarks: () => void;
  clearBookmarks: () => void;
  /** Cycle the active loop: section 0 → 1 → … → off. */
  cycleLoop: () => void;
  setActiveLoop: (index: number | null) => void;
  setLoopOn: (on: boolean) => void;
  refreshTakes: () => Promise<void>;
  addTake: (take: TakeRecord) => Promise<void>;
  deleteTake: (id: string) => Promise<void>;
  playTake: (id: string) => Promise<void>;
  stopTake: () => void;
  setError: (e: string | null) => void;
}

let persistTimer: number | null = null;
let pendingMeta: TrackMeta | null = null;
function persistMeta(meta: TrackMeta) {
  pendingMeta = meta;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = window.setTimeout(flushMeta, 300);
}
function flushMeta() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  if (pendingMeta) {
    void storage.putMeta(pendingMeta);
    pendingMeta = null;
  }
}
// Don't lose a pin dropped right before the app is closed or backgrounded.
window.addEventListener('pagehide', flushMeta);
window.addEventListener('beforeunload', flushMeta);
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flushMeta());

function applyLoop(meta: TrackMeta) {
  const sorted = [...meta.bookmarks].sort((a, b) => a.time - b.time);
  const i = meta.activeLoop;
  if (meta.loopOn && i !== null && i >= 0 && i + 1 < sorted.length) {
    trackPlayer.setLoop(true, sorted[i].time, sorted[i + 1].time);
  } else {
    trackPlayer.setLoop(false, 0, 0);
  }
}

export const useStudio = create<StudioState>()((set, get) => ({
  track: null,
  meta: null,
  takes: [],
  recording: false,
  processing: false,
  replayTakeId: null,
  error: null,
  busy: false,

  async loadFile(file) {
    set({ busy: true, error: null });
    const id = uid();
    try {
      await trackPlayer.load(file);
    } catch (e) {
      set({ busy: false, error: `Could not decode "${file.name}": ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    let saved = true;
    try {
      await storage.putTrack({ id, name: file.name, type: file.type, size: file.size, addedAt: Date.now(), blob: file });
    } catch (e) {
      saved = false;
      set({ error: `Track loaded but not saved for next time (${e instanceof Error ? e.message : 'storage full?'})` });
    }
    const meta = await storage.getMeta(id);
    useSettings.getState().set({ lastTrackId: saved ? id : null });
    set({ track: { id, name: file.name }, meta, busy: false });
    trackPlayer.setSpeed(meta.speed);
    trackPlayer.setTranspose(meta.transpose);
    applyLoop(meta);
  },

  async loadLast() {
    const id = useSettings.getState().lastTrackId;
    if (!id) return;
    set({ busy: true, error: null });
    const rec = await storage.getTrack(id);
    if (!rec) {
      set({ busy: false, error: 'Last track is no longer stored.' });
      useSettings.getState().set({ lastTrackId: null });
      return;
    }
    try {
      await trackPlayer.load(rec.blob);
    } catch (e) {
      set({ busy: false, error: `Could not decode "${rec.name}": ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    const meta = await storage.getMeta(id);
    set({ track: { id, name: rec.name }, meta, busy: false });
    trackPlayer.setSpeed(meta.speed);
    trackPlayer.setTranspose(meta.transpose);
    applyLoop(meta);
    if (meta.lastPosition > 0) trackPlayer.seek(meta.lastPosition);
  },

  setMeta(patch) {
    const meta = get().meta;
    if (!meta) return;
    const next = { ...meta, ...patch };
    set({ meta: next });
    persistMeta(next);
  },

  addBookmark(time) {
    const meta = get().meta;
    if (!meta) return;
    const n = meta.bookmarks.length + 1;
    const bm: Bookmark = { id: uid(), name: `Pin ${n}`, time };
    get().setMeta({ bookmarks: [...meta.bookmarks, bm] });
  },
  updateBookmark(id, patch) {
    const meta = get().meta;
    if (!meta) return;
    const next = { ...meta, bookmarks: meta.bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
    set({ meta: next });
    persistMeta(next);
    applyLoop(next);
  },
  removeBookmark(id) {
    const meta = get().meta;
    if (!meta) return;
    const next = { ...meta, bookmarks: meta.bookmarks.filter((b) => b.id !== id), activeLoop: null, loopOn: false };
    set({ meta: next });
    persistMeta(next);
    applyLoop(next);
  },
  sortBookmarks() {
    const meta = get().meta;
    if (!meta) return;
    get().setMeta({ bookmarks: [...meta.bookmarks].sort((a, b) => a.time - b.time) });
  },
  clearBookmarks() {
    const meta = get().meta;
    if (!meta) return;
    const next = { ...meta, bookmarks: [], activeLoop: null, loopOn: false };
    set({ meta: next });
    persistMeta(next);
    applyLoop(next);
  },
  cycleLoop() {
    const meta = get().meta;
    if (!meta) return;
    const sections = Math.max(0, meta.bookmarks.length - 1);
    if (sections === 0) return;
    const cur = meta.loopOn && meta.activeLoop !== null ? meta.activeLoop : -1;
    const nextIdx = cur + 1 < sections ? cur + 1 : null;
    if (nextIdx === null) get().setLoopOn(false);
    else get().setActiveLoop(nextIdx);
  },
  setActiveLoop(index) {
    const meta = get().meta;
    if (!meta) return;
    const next = { ...meta, activeLoop: index, loopOn: index !== null ? true : meta.loopOn };
    set({ meta: next });
    persistMeta(next);
    applyLoop(next);
    if (index !== null) {
      const sorted = [...next.bookmarks].sort((a, b) => a.time - b.time);
      if (sorted[index]) trackPlayer.seek(sorted[index].time);
    }
  },
  setLoopOn(on) {
    const meta = get().meta;
    if (!meta) return;
    const next = { ...meta, loopOn: on };
    set({ meta: next });
    persistMeta(next);
    applyLoop(next);
  },

  async refreshTakes() {
    set({ takes: await storage.listTakes() });
  },
  async addTake(take) {
    try {
      const takes = await storage.putTake(take);
      const evicted = get().takes.filter((t) => !takes.some((k) => k.id === t.id));
      if (evicted.some((t) => t.id === get().replayTakeId)) get().stopTake();
      set({ takes });
    } catch (e) {
      set({ error: `Take recorded but not saved (${e instanceof Error ? e.message : 'storage full?'})`, takes: [take, ...get().takes].slice(0, 5) });
    }
  },
  async deleteTake(id) {
    if (get().replayTakeId === id) get().stopTake();
    await storage.deleteTake(id);
    set({ takes: get().takes.filter((t) => t.id !== id) });
  },
  async playTake(id) {
    const take = get().takes.find((t) => t.id === id);
    if (!take) return;
    if (get().replayTakeId !== id) {
      await takePlayer.load(take.wav);
      set({ replayTakeId: id });
    }
    await takePlayer.play();
  },
  stopTake() {
    takePlayer.pause();
    takePlayer.unload();
    set({ replayTakeId: null });
  },
  setError: (e) => set({ error: e }),
}));

// Remember playback position per track.
let posTimer = 0;
trackPlayer.subscribe((snap) => {
  const now = performance.now();
  if (now - posTimer < 2000) return;
  posTimer = now;
  const st = useStudio.getState();
  if (st.meta && snap.loaded && Math.abs(st.meta.lastPosition - snap.position) > 1) {
    const next = { ...st.meta, lastPosition: snap.position };
    useStudio.setState({ meta: next });
    persistMeta(next);
  }
});

void useStudio.getState().refreshTakes();

// Dev hooks for driving the app from the console / automated checks.
if (import.meta.env.DEV) {
  (window as unknown as { __dev: unknown }).__dev = { useStudio, trackPlayer, takePlayer, useSettings, instrument };
}
