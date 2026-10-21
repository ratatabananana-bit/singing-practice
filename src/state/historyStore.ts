import { create } from 'zustand';
import { storage, uid, type RunRecord } from '../storage/db';

const WINDOW_DAYS = 90;

interface HistoryState {
  runs: RunRecord[];
  loaded: boolean;
  load: () => Promise<void>;
  log: (r: Omit<RunRecord, 'id' | 'at'>) => Promise<void>;
  clear: () => Promise<void>;
}

/** Practice history (last 90 days in memory, persisted in IndexedDB). */
export const useHistory = create<HistoryState>()((set, get) => ({
  runs: [],
  loaded: false,
  async load() {
    const since = Date.now() - WINDOW_DAYS * 86_400_000;
    set({ runs: await storage.listRuns(since), loaded: true });
  },
  async log(r) {
    const rec: RunRecord = { ...r, id: uid(), at: Date.now(), avgCents: Number.isFinite(r.avgCents) ? r.avgCents : 0 };
    set({ runs: [rec, ...get().runs] });
    try {
      await storage.addRun(rec);
    } catch {
      /* history is best-effort */
    }
  },
  async clear() {
    await storage.clearRuns();
    set({ runs: [] });
  },
}));

void useHistory.getState().load();
