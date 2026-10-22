import { create } from 'zustand';
import { storage, uid, type Bookmark, type Section, type TakeRecord, type TrackMeta } from '../storage/db';
import { trackPlayer, TrackPlayer } from '../audio/player/TrackPlayer';
import { useSettings } from './settings';
import { instrument } from '../audio/synth/Instrument';
import BeatWorker from '../audio/dsp/beats.worker?worker';
import { snapToBeat, type BeatGrid } from '../audio/dsp/beats';
import * as pitchHistory from './pitchHistory';

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
  /** Speed trainer: raise speed by stepPct after each loop pass until targetPct. */
  trainer: { on: boolean; startPct: number; targetPct: number; stepPct: number };
  /** Count-in in progress (clicks left), 0 = none. */
  countdown: number;

  loadFile: (file: File) => Promise<void>;
  /** Fetch audio for a YouTube link through the local helper server, then load it like a file. */
  loadYouTube: (url: string) => Promise<void>;
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
  /** Loop between any two markers (time-order indices). */
  setLoopRange: (a: number, b: number) => void;
  addSection: (s: Omit<Section, 'id'>) => string;
  updateSection: (id: string, patch: Partial<Section>) => void;
  removeSection: (id: string) => void;
  /** Loop a section (seeks to its start); null clears the section loop. */
  loopSection: (id: string | null) => void;
  setLoopOn: (on: boolean) => void;
  refreshTakes: () => Promise<void>;
  addTake: (take: TakeRecord) => Promise<void>;
  deleteTake: (id: string) => Promise<void>;
  playTake: (id: string) => Promise<void>;
  stopTake: () => void;
  setError: (e: string | null) => void;
  /** Run beat detection on the loaded track (also runs automatically after load). */
  detectBeats: () => void;
  /** Snap a time to the beat grid when snapping is on. */
  snap: (t: number) => number;
  /** Make the beat nearest to `t` a bar line. */
  setDownbeat: (t: number) => void;
  setTrainer: (t: Partial<StudioState['trainer']>) => void;
  toggleStar: (id: string) => Promise<void>;
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

/** Active loop as [startIndex, endIndex] in time order, or [null, null]. */
export function loopPair(meta: TrackMeta): [number | null, number | null] {
  const a = meta.activeLoop;
  if (a === null || a < 0) return [null, null];
  const b = meta.loopEnd ?? a + 1;
  if (b <= a || b >= meta.bookmarks.length) return [null, null];
  return [a, b];
}

function applyLoop(meta: TrackMeta) {
  const sorted = [...meta.bookmarks].sort((a, b) => a.time - b.time);
  const sec = meta.activeSection ? meta.sections?.find((x) => x.id === meta.activeSection) : undefined;
  const [i, j] = loopPair(meta);
  if (meta.loopOn && sec && sec.end > sec.start) {
    trackPlayer.setLoop(true, sec.start, sec.end);
  } else if (meta.loopOn && i !== null && j !== null && j < sorted.length) {
    trackPlayer.setLoop(true, sorted[i].time, sorted[j].time);
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
  trainer: { on: false, startPct: 70, targetPct: 100, stepPct: 5 },
  countdown: 0,

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
    if (meta.beatGrid === undefined) get().detectBeats();
    trackPlayer.setSpeed(meta.speed);
    trackPlayer.setTranspose(meta.transpose);
    trackPlayer.setFineCents(meta.fineCents ?? 0);
    trackPlayer.setLoopGap(meta.loopGap ?? 0);
    applyLoop(meta);
  },

  async loadYouTube(url) {
    set({ busy: true, error: null });
    try {
      const base = ytHelperBase();
      if (!base && !isDevServer()) {
        throw new Error('Set the helper address first: Settings → YouTube helper → http://<pc-ip>:5174 (with "npm run server" running on the PC).');
      }
      const r = await fetch(`${base}/api/yt?url=${encodeURIComponent(url.trim())}`);
      if (!r.ok) throw new Error((await r.text()) || `helper replied ${r.status}`);
      const ctype = r.headers.get('Content-Type') || '';
      if (!ctype.startsWith('audio/')) {
        throw new Error(`The helper address did not return audio (got ${ctype || 'unknown'}). Check Settings → YouTube helper points at the PC running "npm run server".`);
      }
      const title = decodeURIComponent(r.headers.get('X-Title') || 'YouTube audio');
      const ext = r.headers.get('X-Ext') || (ctype.includes('mpeg') ? 'mp3' : 'm4a');
      const blob = await r.blob();
      await get().loadFile(new File([blob], `${title}.${ext}`, { type: blob.type || ctype }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({
        busy: false,
        error: /Failed to fetch|NetworkError|Load failed|502|503/.test(msg)
          ? 'Could not reach the YouTube helper. On the PC run "npm run server"; on a phone or tablet set its address in Settings → YouTube helper (same Wi-Fi).'
          : `YouTube: ${msg}`,
      });
    }
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
    if (meta.beatGrid === undefined) get().detectBeats();
    trackPlayer.setSpeed(meta.speed);
    trackPlayer.setTranspose(meta.transpose);
    trackPlayer.setFineCents(meta.fineCents ?? 0);
    trackPlayer.setLoopGap(meta.loopGap ?? 0);
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
    const bm: Bookmark = { id: uid(), name: `Pin ${n}`, time: get().snap(time) };
    get().setMeta({ bookmarks: [...meta.bookmarks, bm] });
  },
  updateBookmark(id, patch) {
    const meta = get().meta;
    if (!meta) return;
    if (patch.time !== undefined) patch = { ...patch, time: get().snap(patch.time) };
    const next = { ...meta, bookmarks: meta.bookmarks.map((b) => (b.id === id ? { ...b, ...patch } : b)) };
    set({ meta: next });
    persistMeta(next);
    applyLoop(next);
  },
  removeBookmark(id) {
    const meta = get().meta;
    if (!meta) return;
    const next = { ...meta, bookmarks: meta.bookmarks.filter((b) => b.id !== id), activeLoop: null, loopEnd: null, loopOn: false };
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
    const next = { ...meta, bookmarks: [], activeLoop: null, loopEnd: null, loopOn: false };
    set({ meta: next });
    persistMeta(next);
    applyLoop(next);
  },
  cycleLoop() {
    const meta = get().meta;
    if (!meta) return;
    const sections = Math.max(0, meta.bookmarks.length - 1);
    if (sections === 0) return;
    const [curA] = loopPair(meta);
    const cur = meta.loopOn && curA !== null ? curA : -1;
    const nextIdx = cur + 1 < sections ? cur + 1 : null;
    if (nextIdx === null) get().setLoopOn(false);
    else get().setActiveLoop(nextIdx);
  },
  setActiveLoop(index) {
    const meta = get().meta;
    if (!meta) return;
    const next = { ...meta, activeLoop: index, loopEnd: index !== null ? index + 1 : null, loopOn: index !== null ? true : meta.loopOn, activeSection: null };
    set({ meta: next });
    persistMeta(next);
    applyLoop(next);
    if (index !== null) {
      const sorted = [...next.bookmarks].sort((a, b) => a.time - b.time);
      if (sorted[index]) trackPlayer.seek(sorted[index].time);
    }
  },
  addSection(sec) {
    const meta = get().meta;
    if (!meta) return '';
    const id = uid();
    const next = { ...meta, sections: [...(meta.sections ?? []), { ...sec, id }] };
    set({ meta: next });
    persistMeta(next);
    return id;
  },
  updateSection(id, patch) {
    const meta = get().meta;
    if (!meta) return;
    if (patch.start !== undefined) patch = { ...patch, start: get().snap(patch.start) };
    if (patch.end !== undefined) patch = { ...patch, end: get().snap(patch.end) };
    const next = { ...meta, sections: (meta.sections ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)) };
    set({ meta: next });
    persistMeta(next);
    applyLoop(next);
  },
  removeSection(id) {
    const meta = get().meta;
    if (!meta) return;
    const next = { ...meta, sections: (meta.sections ?? []).filter((x) => x.id !== id), activeSection: meta.activeSection === id ? null : meta.activeSection };
    set({ meta: next });
    persistMeta(next);
    applyLoop(next);
  },
  loopSection(id) {
    const meta = get().meta;
    if (!meta) return;
    const next = { ...meta, activeSection: id, loopOn: id !== null ? true : meta.loopOn };
    set({ meta: next });
    persistMeta(next);
    applyLoop(next);
    const sec = id ? next.sections?.find((x) => x.id === id) : undefined;
    if (sec) trackPlayer.seek(sec.start);
  },
  setLoopRange(a, b) {
    const meta = get().meta;
    if (!meta) return;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (lo === hi) return;
    const next = { ...meta, activeLoop: lo, loopEnd: hi, loopOn: true, activeSection: null };
    set({ meta: next });
    persistMeta(next);
    applyLoop(next);
    const sorted = [...next.bookmarks].sort((x, y) => x.time - y.time);
    if (sorted[lo]) trackPlayer.seek(sorted[lo].time);
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
  detectBeats() {
    const meta = get().meta;
    const prev = trackPlayer.getMonoPreview();
    if (!meta || !prev) return;
    const trackId = meta.trackId;
    const w = new BeatWorker();
    w.onmessage = (e: MessageEvent<BeatGrid | null>) => {
      w.terminate();
      const cur = get().meta;
      if (!cur || cur.trackId !== trackId) return;
      const next = { ...cur, beatGrid: e.data, beatsPerBar: cur.beatsPerBar ?? 4 };
      set({ meta: next });
      persistMeta(next);
    };
    w.postMessage({ mono: prev.data, sampleRate: prev.sampleRate });
  },
  snap(t) {
    const meta = get().meta;
    if (!meta?.snapOn || !meta.beatGrid) return t;
    return snapToBeat(t, meta.beatGrid);
  },
  setDownbeat(t) {
    const meta = get().meta;
    if (!meta?.beatGrid) return;
    const period = 60 / meta.beatGrid.bpm;
    const k = Math.round((t - meta.beatGrid.offset) / period);
    const bar = meta.beatsPerBar ?? 4;
    // keep the beat phase, shift the bar phase so beat k is a downbeat
    const barOffset = ((k % bar) + bar) % bar;
    const next = { ...meta, beatGrid: { ...meta.beatGrid, offset: meta.beatGrid.offset + barOffset * period - Math.floor((meta.beatGrid.offset + barOffset * period) / (period * bar)) * period * bar } };
    set({ meta: next });
    persistMeta(next);
  },
  setTrainer: (t) => set({ trainer: { ...get().trainer, ...t } }),
  async toggleStar(id) {
    const take = get().takes.find((x) => x.id === id);
    if (!take) return;
    const starred = !take.starred;
    await storage.updateTake(id, { starred });
    set({ takes: get().takes.map((x) => (x.id === id ? { ...x, starred } : x)) });
  },
}));

// Speed trainer: after each loop pass, step the speed toward the target.
trackPlayer.onWrap(() => {
  const st = useStudio.getState();
  if (!st.trainer.on) return;
  const cur = Math.round(trackPlayer.state.speed * 100);
  if (cur >= st.trainer.targetPct) return;
  const next = Math.min(st.trainer.targetPct, cur + st.trainer.stepPct);
  trackPlayer.setSpeed(next / 100);
  st.setMeta({ speed: next / 100 });
});

/** True when served by the Vite dev server (which proxies /api to the helper). */
function isDevServer(): boolean {
  return typeof location !== 'undefined' && /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.)/.test(location.origin) && location.port === '5173';
}

/** Helper base URL: same origin in dev (Vite proxies /api), else the PC's address saved in settings. */
function ytHelperBase(): string {
  const custom = useSettings.getState().ytHelperUrl.trim();
  if (custom) return custom.replace(/\/$/, '');
  return '';
}

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
  (window as unknown as { __dev: unknown }).__dev = { useStudio, trackPlayer, takePlayer, useSettings, instrument, pitchHistory };
}
