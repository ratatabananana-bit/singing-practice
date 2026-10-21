import { useMemo, useState } from 'react';
import { useHistory } from '../state/historyStore';
import { useSettings } from '../state/settings';
import { dayKey, lastDays, starsFor, streakDays } from '../music/history';
import { SCALE_BY_ID } from '../music/scales';
import { noteLabel } from '../music/notes';
import type { ScaleId } from '../music/scales';

/**
 * Practice history: today's progress toward the daily goal, streak, a 14-day activity
 * strip, and the last runs. Carrots-style goal/streak, Erol-style stars.
 */
export function HistoryCard({ tab }: { tab: 'play' | 'tune' }) {
  const runs = useHistory((h) => h.runs);
  const goal = useSettings((s) => s.dailyGoal);
  const set = useSettings((s) => s.set);
  const [open, setOpen] = useState(false);

  const mine = useMemo(() => runs.filter((r) => r.tab === tab), [runs, tab]);
  const todayKey = dayKey(Date.now());
  const today = mine.filter((r) => dayKey(r.at) === todayKey);
  const todayHits = today.reduce((a, r) => a + r.hits, 0);
  const streak = streakDays(mine);
  const days = useMemo(() => lastDays(mine, 14), [mine]);
  const maxHits = Math.max(1, ...days.map((d) => d.hits));
  const unit = tab === 'play' ? 'notes hit' : 'notes nailed';
  const pct = Math.min(1, todayHits / Math.max(1, goal));

  return (
    <section className="card">
      <div className="row between">
        <div className="row">
          <span className="label">Progress</span>
          <span className={`pill sm ${streak > 0 ? 'accent' : 'ghost'}`} title="Consecutive days practised">
            🔥 {streak} day{streak === 1 ? '' : 's'}
          </span>
        </div>
        <button className="pill sm ghost" onClick={() => setOpen((o) => !o)}>
          {open ? 'Less ▴' : 'More ▾'}
        </button>
      </div>
      <div className="row" style={{ marginTop: 8, alignItems: 'center' }}>
        <div className="grow">
          <div className="row between" style={{ fontSize: 12 }}>
            <span>
              Today: <b className="mono">{todayHits}</b> / {goal} {unit}
            </span>
            <span className="dim mono">{today.length} {tab === 'play' ? 'runs' : 'notes'}</span>
          </div>
          <div className="hold-bar" style={{ position: 'static', marginTop: 4, height: 6, borderRadius: 3 }}>
            <div style={{ width: `${pct * 100}%`, background: pct >= 1 ? 'var(--good)' : 'var(--accent)' }} />
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 8, gap: 3 }} title="Last 14 days">
        {days.map((d) => (
          <div
            key={d.key}
            className="grow"
            style={{
              height: 18,
              borderRadius: 3,
              background: d.runs === 0 ? 'var(--card3)' : `rgba(245,197,66,${0.3 + 0.7 * (d.hits / maxHits)})`,
              outline: d.key === todayKey ? '1px solid var(--muted)' : 'none',
            }}
          />
        ))}
      </div>
      {open && (
        <>
          <div className="row between" style={{ marginTop: 10, fontSize: 12 }}>
            <span className="muted">Daily goal</span>
            <div className="row">
              {[20, 50, 100, 200].map((g) => (
                <button key={g} className={`chip sm${goal === g ? ' on' : ''}`} onClick={() => set({ dailyGoal: g })}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <div className="label" style={{ marginTop: 10 }}>
            Recent
          </div>
          {mine.length === 0 ? (
            <div className="empty">Nothing yet. Finish a run and it shows up here.</div>
          ) : (
            <div className="list" style={{ marginTop: 6 }}>
              {mine.slice(0, 8).map((r) => {
                const ex = SCALE_BY_ID[r.exerciseId as ScaleId];
                const stars = starsFor(r);
                return (
                  <div key={r.id} className="list-item" style={{ fontSize: 12 }}>
                    <span className="grow" style={{ fontWeight: 600 }}>
                      {ex ? (ex.pattern ? ex.short : ex.name) : r.exerciseId} <span className="dim mono">{noteLabel(r.root)}</span>
                    </span>
                    <span className="mono muted">
                      {r.hits}/{r.total}
                      {Number.isFinite(r.avgCents) && r.total > 0 ? ` · ${r.avgCents >= 0 ? '+' : '−'}${Math.abs(Math.round(r.avgCents))}¢` : ''}
                    </span>
                    <span style={{ color: 'var(--accent)', minWidth: 36, textAlign: 'right' }}>{'★'.repeat(stars)}<span className="dim">{'★'.repeat(3 - stars)}</span></span>
                    <span className="dim mono">{new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
            <button className="chip sm" style={{ color: 'var(--bad)' }} onClick={() => void useHistory.getState().clear()}>
              clear history
            </button>
          </div>
        </>
      )}
    </section>
  );
}
