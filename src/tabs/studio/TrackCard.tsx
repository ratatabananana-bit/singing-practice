import { useEffect, useRef, useState } from 'react';
import { useStudio } from '../../state/studioStore';
import { useSettings } from '../../state/settings';
import { trackPlayer, type PlayerSnapshot } from '../../audio/player/TrackPlayer';
import { formatTime, formatTimePrecise, parseTime } from '../../music/notes';
import { Switch } from '../../components/Switch';

export function TrackCard() {
  const st = useStudio();
  const settings = useSettings();
  const expanded = settings.studioExpanded;
  const [snap, setSnap] = useState<PlayerSnapshot>(trackPlayer.state);
  const fileRef = useRef<HTMLInputElement>(null);
  const timeEl = useRef<HTMLSpanElement>(null);
  const seekEl = useRef<HTMLInputElement>(null);
  const scrubbing = useRef(false);

  useEffect(() => trackPlayer.subscribe(setSnap), []);

  // rAF-driven time label + seek bar (no React state at 60 Hz)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = trackPlayer.estimatePosition();
      if (timeEl.current) timeEl.current.textContent = formatTime(p);
      if (seekEl.current && !scrubbing.current) seekEl.current.value = String(p);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  const meta = st.meta;
  const sorted = meta ? [...meta.bookmarks].sort((a, b) => a.time - b.time) : [];
  const loops = sorted.slice(0, -1).map((b, i) => ({ i, a: b, b: sorted[i + 1] }));

  return (
    <section className="card">
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void st.loadFile(f);
          e.target.value = '';
        }}
      />
      <div className="row between">
        <div className="row grow" style={{ minWidth: 0 }}>
          <span className="label">Track</span>
          <span className="grow" style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {st.track ? st.track.name : <span className="dim">No track loaded</span>}
          </span>
        </div>
        <button className="pill sm ghost" onClick={() => settings.set({ studioExpanded: !expanded })}>
          {expanded ? 'Less ▴' : 'More ▾'}
        </button>
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={st.busy}>
          {st.busy ? 'Loading…' : 'Load track'}
        </button>
        {settings.lastTrackId && (!st.track || st.track.id !== settings.lastTrackId) && (
          <button className="btn sm" onClick={() => void st.loadLast()} disabled={st.busy}>
            Select last track
          </button>
        )}
      </div>
      {st.error && (
        <div className="banner bad" style={{ marginTop: 8 }} onClick={() => st.setError(null)}>
          {st.error}
        </div>
      )}

      {snap.loaded && (
        <>
          <div className="row" style={{ marginTop: 10 }}>
            <button className={`btn round${snap.playing ? '' : ' primary'}`} onClick={() => trackPlayer.toggle()} aria-label={snap.playing ? 'Pause' : 'Play'}>
              {snap.playing ? '❚❚' : '▶'}
            </button>
            <div className="grow">
              <input
                ref={seekEl}
                className="seek"
                type="range"
                min={0}
                max={snap.duration}
                step={0.01}
                defaultValue={0}
                onPointerDown={() => (scrubbing.current = true)}
                onPointerUp={() => (scrubbing.current = false)}
                onChange={(e) => trackPlayer.seek(parseFloat(e.target.value))}
              />
              <div className="row between mono dim" style={{ fontSize: 11 }}>
                <span ref={timeEl}>0:00</span>
                <span>{formatTime(snap.duration)}</span>
              </div>
            </div>
          </div>
          <div className="row wrap" style={{ marginTop: 6 }}>
            <span className={`pill sm${meta?.loopOn && meta.activeLoop !== null ? ' accent' : ' ghost'}`}>
              {meta?.loopOn && meta.activeLoop !== null && loops[meta.activeLoop]
                ? `Loop ${loops[meta.activeLoop].a.name} → ${loops[meta.activeLoop].b.name}`
                : 'No loop'}
            </span>
            {snap.speed !== 1 && <span className="pill sm warn mono">{snap.speed.toFixed(2)}×</span>}
            {snap.transpose !== 0 && (
              <span className="pill sm warn mono">
                {snap.transpose > 0 ? '+' : ''}
                {snap.transpose} st
              </span>
            )}
          </div>
        </>
      )}

      {expanded && snap.loaded && meta && (
        <>
          <div className="divider" />
          <div className="row between">
            <span className="label">Speed</span>
            <span className="mono" style={{ fontSize: 12 }}>
              {snap.speed.toFixed(2)}×
            </span>
            <button className="chip sm" onClick={() => setSpeed(1)}>
              reset
            </button>
          </div>
          <input type="range" min={0.5} max={1.5} step={0.01} value={snap.speed} onChange={(e) => setSpeed(parseFloat(e.target.value))} />
          <div className="row between" style={{ marginTop: 6 }}>
            <span className="label">Transpose</span>
            <div className="row">
              <button className="btn sm" onClick={() => setTranspose(snap.transpose - 1)}>
                −
              </button>
              <span className="mono" style={{ minWidth: 44, textAlign: 'center', fontWeight: 700 }}>
                {snap.transpose > 0 ? '+' : ''}
                {snap.transpose}
              </span>
              <button className="btn sm" onClick={() => setTranspose(snap.transpose + 1)}>
                +
              </button>
              <button className="chip sm" onClick={() => setTranspose(0)}>
                reset
              </button>
            </div>
          </div>

          <div className="divider" />
          <div className="row between">
            <span className="label">Bookmarks</span>
            <div className="row">
              <button className="chip sm" onClick={() => st.sortBookmarks()} disabled={meta.bookmarks.length < 2}>
                sort by time
              </button>
              <button className="btn sm primary" onClick={() => st.addBookmark(trackPlayer.estimatePosition())}>
                + Pin here
              </button>
            </div>
          </div>
          <div className="list" style={{ marginTop: 8 }}>
            {meta.bookmarks.length === 0 && <div className="empty">Drop a pin at the playhead to mark a spot.</div>}
            {meta.bookmarks.map((b) => (
              <BookmarkRow key={b.id} id={b.id} name={b.name} time={b.time} />
            ))}
          </div>

          <div className="divider" />
          <div className="row between">
            <span className="label">Loop sections</span>
            <Switch on={meta.loopOn} onChange={(v) => st.setLoopOn(v)} label={meta.loopOn ? 'Loop on' : 'Loop off'} />
          </div>
          <div className="chips" style={{ marginTop: 8 }}>
            {loops.length === 0 && <div className="empty">Add two or more pins to make a section.</div>}
            {loops.map((l) => (
              <button key={l.i} className={`chip sm${meta.activeLoop === l.i ? ' on' : ''}`} onClick={() => st.setActiveLoop(meta.activeLoop === l.i ? null : l.i)}>
                {l.a.name} → {l.b.name}
                <span className="mono dim" style={{ marginLeft: 6 }}>
                  {formatTime(l.a.time)}–{formatTime(l.b.time)}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );

  function setSpeed(v: number) {
    trackPlayer.setSpeed(v);
    st.setMeta({ speed: trackPlayer.state.speed });
  }
  function setTranspose(v: number) {
    trackPlayer.setTranspose(v);
    st.setMeta({ transpose: trackPlayer.state.transpose });
  }
}

function BookmarkRow({ id, name, time }: { id: string; name: string; time: number }) {
  const st = useStudio();
  const [editing, setEditing] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const commitTime = () => {
    if (editing !== null) {
      const t = parseTime(editing);
      if (t !== null) st.updateBookmark(id, { time: Math.max(0, Math.min(trackPlayer.state.duration, t)) });
    }
    setEditing(null);
  };
  return (
    <div className="list-item">
      {nameEdit === null ? (
        <button className="grow" style={{ textAlign: 'left', fontWeight: 600, fontSize: 13 }} onClick={() => setNameEdit(name)}>
          {name}
        </button>
      ) : (
        <input
          type="text"
          className="grow"
          value={nameEdit}
          autoFocus
          onChange={(e) => setNameEdit(e.target.value)}
          onBlur={() => {
            if (nameEdit.trim()) st.updateBookmark(id, { name: nameEdit.trim() });
            setNameEdit(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}
      {editing === null ? (
        <button className="chip sm mono" onClick={() => setEditing(formatTimePrecise(time))} title="Edit time">
          {formatTimePrecise(time)}
        </button>
      ) : (
        <input
          type="text"
          className="mono"
          style={{ width: 84 }}
          value={editing}
          autoFocus
          inputMode="decimal"
          onChange={(e) => setEditing(e.target.value)}
          onBlur={commitTime}
          onKeyDown={(e) => e.key === 'Enter' && commitTime()}
        />
      )}
      <button className="chip sm" title="Re-pin to playhead" onClick={() => st.updateBookmark(id, { time: trackPlayer.estimatePosition() })}>
        ⟲
      </button>
      <button className="chip sm" title="Jump" onClick={() => trackPlayer.seek(time)}>
        ↦
      </button>
      <button className="chip sm danger" title="Delete" onClick={() => st.removeBookmark(id)} style={{ color: 'var(--bad)' }}>
        ✕
      </button>
    </div>
  );
}
