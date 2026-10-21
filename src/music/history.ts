import type { RunRecord } from '../storage/db';

/** Stars for one run: 3 = nearly all hit and precise, 2 = most, 1 = some, 0 = none. */
export function starsFor(run: Pick<RunRecord, 'hits' | 'total' | 'precision'>): 0 | 1 | 2 | 3 {
  if (run.total === 0) return 0;
  const ratio = run.hits / run.total;
  if (ratio >= 0.9 && run.precision >= 0.75) return 3;
  if (ratio >= 0.7) return 2;
  if (ratio >= 0.4) return 1;
  return 0;
}

/** Local calendar day key (YYYY-MM-DD) for a timestamp. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Consecutive days with at least one run, counting back from today (or yesterday if today is empty). */
export function streakDays(runs: RunRecord[], now = Date.now()): number {
  const days = new Set(runs.map((r) => dayKey(r.at)));
  if (days.size === 0) return 0;
  const DAY = 86_400_000;
  let cursor = now;
  if (!days.has(dayKey(cursor))) cursor -= DAY;
  let n = 0;
  while (days.has(dayKey(cursor))) {
    n++;
    cursor -= DAY;
  }
  return n;
}

export interface DayStat {
  key: string;
  runs: number;
  hits: number;
}

/** Per-day totals for the last `days` days, oldest first. */
export function lastDays(runs: RunRecord[], days: number, now = Date.now()): DayStat[] {
  const DAY = 86_400_000;
  const out: DayStat[] = [];
  for (let i = days - 1; i >= 0; i--) out.push({ key: dayKey(now - i * DAY), runs: 0, hits: 0 });
  const idx = new Map(out.map((d, i) => [d.key, i]));
  for (const r of runs) {
    const i = idx.get(dayKey(r.at));
    if (i === undefined) continue;
    out[i].runs++;
    out[i].hits += r.hits;
  }
  return out;
}

/** Best stars and best hit ratio per exercise. */
export function bestByExercise(runs: RunRecord[]): Map<string, { stars: 0 | 1 | 2 | 3; runs: number; bestRatio: number }> {
  const m = new Map<string, { stars: 0 | 1 | 2 | 3; runs: number; bestRatio: number }>();
  for (const r of runs) {
    if (r.tab !== 'play') continue;
    const cur = m.get(r.exerciseId) ?? { stars: 0 as const, runs: 0, bestRatio: 0 };
    const st = starsFor(r);
    m.set(r.exerciseId, {
      stars: Math.max(cur.stars, st) as 0 | 1 | 2 | 3,
      runs: cur.runs + 1,
      bestRatio: Math.max(cur.bestRatio, r.total ? r.hits / r.total : 0),
    });
  }
  return m;
}
