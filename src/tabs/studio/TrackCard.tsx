import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudio, loopPair } from '../../state/studioStore';
import { useSettings } from '../../state/settings';
import { trackPlayer, type PlayerSnapshot } from '../../audio/player/TrackPlayer';
import { formatTime, formatTimePrecise, parseTime } from '../../music/notes';
import { LoopTimeline } from '../../components/LoopTimeline';

export function TrackCard() {
  const st = useStudio();
  const settings = useSettings();
  const [snap, setSnap] = useState<PlayerSnapshot>(trackPlayer.state);
  const [editMarkers, setEditMarkers] = useState(false);
  const [bigTile, setBigTile] = useState<'transpose' | 'speed' | null>(null);
  const [clearArmed, setClearArmed] = useState(false);
  useEffect(() => {
    if (!clearArmed) return;
    const t = setTimeout(() => setClearArmed(false), 3000);
    return () => clearTimeout(t);
  }, [clearArmed]);
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

  const position = useCallback(() => trackPlayer.estimatePosition(), []);
  const meta = st.meta;
  const sorted = meta ? [...meta.bookmarks].sort((a, b) => a.time - b.time) : [];
  const sections = Math.max(0, sorted.length - 1);
  const [loopA, loopB] = meta ? loopPair(meta) : [null, null];
  const loopActive = !!meta?.loopOn && loopA !== null && loopB !== null;
  const [pending, setPending] = useState<number | null>(null);
  useEffect(() => setPending(null), [st.track?.id]);
  const loopLabel = pending !== null ? `${pending + 1}–?` : loopA !== null && loopB !== null ? `${loopA + 1}–${loopB + 1}` : 'Loop';

  /**
   * Marker taps: first tap picks the start, second tap (another marker) picks the end.
   * Tapping the same marker twice just jumps to it.
   */
  const selectMarker = (i: number) => {
    if (!meta) return;
    if (pending === null) {
      setPending(i);
      trackPlayer.seek(sorted[i].time);
      return;
    }
    if (pending === i) {
      setPending(null);
      trackPlayer.seek(sorted[i].time);
      return;
    }
    st.setLoopRange(pending, i);
    setPending(null);
  };

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
        <div className="row grow" style={{ minWidth: 0, alignItems: 'flex-start' }}>
          <span className="label" style={{ lineHeight: '18px' }}>
            Track
          </span>
          <span className="grow clamp2" style={{ fontSize: 13, fontWeight: 600, lineHeight: '18px' }}>
            {st.track ? st.track.name : <span className="dim">No track loaded</span>}
          </span>
        </div>
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

      {snap.loaded && meta && (
        <>
          {/* transport */}
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
            <button
              className={`pill${loopActive || pending !== null ? ' accent' : ' ghost'} mono`}
              onContextMenu={(e) => e.preventDefault()}
              onClick={() => st.cycleLoop()}
              disabled={sections === 0}
              title="Cycle through sections"
              style={{ minWidth: 56, justifyContent: 'center' }}
            >
              ⟲ {loopLabel}
            </button>
          </div>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <StepTile
              label="Transpose"
              value={`${snap.transpose > 0 ? '+' : ''}${snap.transpose}`}
              changed={snap.transpose !== 0}
              raw={snap.transpose}
              min={-12}
              max={12}
              step={1}
              big={bigTile === 'transpose'}
              onBig={(v) => setBigTile(v ? 'transpose' : null)}
              onSet={(v) => setTranspose(v)}
              onReset={() => setTranspose(0)}
            />
            <StepTile
              label="Speed"
              value={`${Math.round(snap.speed * 100)}%`}
              changed={snap.speed !== 1}
              raw={snap.speed}
              min={0.25}
              max={2}
              step={0.05}
              big={bigTile === 'speed'}
              onBig={(v) => setBigTile(v ? 'speed' : null)}
              onSet={(v) => setSpeed(Math.round(v * 100) / 100)}
              onReset={() => setSpeed(1)}
            />
          </div>
          {bigTile === 'speed' && (
            <div className="row wrap" style={{ marginTop: 6, gap: 6, fontSize: 12 }}>
              <button className={`pill sm${st.trainer.on ? ' accent' : ' ghost'}`} onClick={() => st.setTrainer({ on: !st.trainer.on })} title="Raise the speed a little after every loop pass">
                Trainer {st.trainer.on ? 'on' : 'off'}
              </button>
              {st.trainer.on && (
                <>
                  <span className="muted">from</span>
                  <PctStep value={st.trainer.startPct} onChange={(v) => { st.setTrainer({ startPct: v }); setSpeed(v / 100); }} />
                  <span className="muted">to</span>
                  <PctStep value={st.trainer.targetPct} onChange={(v) => st.setTrainer({ targetPct: v })} />
                  <span className="muted">step</span>
                  <PctStep value={st.trainer.stepPct} onChange={(v) => st.setTrainer({ stepPct: Math.max(1, v) })} min={1} max={25} />
                  <span className="dim">per loop pass</span>
                </>
              )}
            </div>
          )}
          {bigTile === 'transpose' && (
            <div className="row" style={{ marginTop: 6, gap: 8, fontSize: 12 }}>
              <span className="muted">Fine</span>
              <input type="range" min={-50} max={50} step={1} value={snap.fineCents} onChange={(e) => setFine(parseInt(e.target.value, 10))} />
              <span className="mono" style={{ minWidth: 42, textAlign: 'right' }}>
                {snap.fineCents >= 0 ? '+' : '−'}
                {Math.abs(snap.fineCents)}¢
              </span>
              <button className="chip sm" onClick={() => setFine(0)}>
                0
              </button>
            </div>
          )}

          {/* markers + loop */}
          <LoopTimeline
            duration={snap.duration}
            markers={sorted}
            loopA={loopA}
            loopB={loopB}
            pending={pending}
            loopOn={meta.loopOn}
            position={position}
            onSeek={(sec) => trackPlayer.seek(sec)}
            onMoveMarker={(id, sec) => st.updateBookmark(id, { time: sec })}
            onSelectMarker={selectMarker}
          />
          <div className="row between" style={{ marginTop: 4 }}>
            <div className="row" style={{ gap: 6 }}>
              <button className="tool" onClick={() => st.addBookmark(trackPlayer.estimatePosition())} title="Add marker at playhead">
                +
              </button>
              <button className={`tool${meta.loopOn ? ' on' : ''}`} onClick={() => st.setLoopOn(!meta.loopOn)} disabled={sections === 0} title="Loop on/off">
                ⟲
              </button>
              <button
                className={`tool${snap.loopGap > 0 ? ' on' : ''}`}
                onClick={() => setGap(snap.loopGap >= 2 ? 0 : snap.loopGap + 1)}
                disabled={sections === 0}
                title="Pause before the loop restarts: 0 / 1 / 2 s"
                style={{ width: 'auto', padding: '0 8px', fontSize: 11 }}
              >
                gap {snap.loopGap}s
              </button>
              <button className={`tool${editMarkers ? ' on' : ''}`} onClick={() => setEditMarkers((v) => !v)} disabled={sorted.length === 0} title="Edit markers">
                ✎
              </button>
            </div>
            <button
              className={`tool${clearArmed ? ' danger' : ''}`}
              onClick={() => {
                if (clearArmed) {
                  st.clearBookmarks();
                  setClearArmed(false);
                } else setClearArmed(true);
              }}
              disabled={sorted.length === 0}
              title="Clear all markers"
              style={clearArmed ? { width: 'auto', padding: '0 10px', fontSize: 12 } : { color: 'var(--bad)' }}
            >
              {clearArmed ? 'Clear all markers?' : '✕'}
            </button>
          </div>
          {sorted.length === 0 ? (
            <div className="empty">Tap + to drop a marker at the playhead. Then tap a start marker and an end marker to loop between them.</div>
          ) : (
            <div className="chips scroll" style={{ marginTop: 8 }}>
              {sorted.map((m, i) => {
                const on = i === loopA || i === loopB;
                return (
                  <button key={m.id} className={`marker-chip${on ? ' on' : ''}${i === pending ? ' pending' : ''}`} onClick={() => selectMarker(i)} title="Tap a start marker, then an end marker">
                    <span className="row" style={{ gap: 6 }}>
                      <span className="num">{i + 1}</span>
                      {!/^Pin \d+$/.test(m.name) && (
                        <span style={{ fontSize: 11, fontWeight: 600, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                      )}
                    </span>
                    <span className="t">{formatTimePrecise(m.time)}</span>
                  </button>
                );
              })}
            </div>
          )}
          {editMarkers && sorted.length > 0 && (
            <div className="list" style={{ marginTop: 8 }}>
              {sorted.map((b, i) => (
                <BookmarkRow key={b.id} index={i} id={b.id} name={b.name} time={b.time} />
              ))}
            </div>
          )}
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
  function setFine(c: number) {
    trackPlayer.setFineCents(c);
    st.setMeta({ fineCents: trackPlayer.state.fineCents });
  }
  function setGap(sec: number) {
    trackPlayer.setLoopGap(sec);
    st.setMeta({ loopGap: trackPlayer.state.loopGap });
  }
}

function PctStep({ value, onChange, min = 25, max = 200 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <span className="row" style={{ gap: 2 }}>
      <button className="chip sm" onClick={() => onChange(Math.max(min, value - 5))}>
        −
      </button>
      <span className="mono" style={{ minWidth: 38, textAlign: 'center', fontWeight: 700 }}>
        {value}%
      </span>
      <button className="chip sm" onClick={() => onChange(Math.min(max, value + 5))}>
        +
      </button>
    </span>
  );
}

/** Compact −/value/+ tile; the corner button expands it into a full row with a slider. */
function StepTile({
  label,
  value,
  changed,
  raw,
  min,
  max,
  step,
  big,
  onBig,
  onSet,
  onReset,
}: {
  label: string;
  value: string;
  changed: boolean;
  raw: number;
  min: number;
  max: number;
  step: number;
  big: boolean;
  onBig: (big: boolean) => void;
  onSet: (v: number) => void;
  onReset: () => void;
}) {
  const color = changed ? 'var(--accent)' : 'var(--text)';
  if (big) {
    return (
      <div className="tile" style={{ flexBasis: '100%' }}>
        <div className="row between">
          <button className="tool" onClick={() => onBig(false)} title="Shrink" style={{ width: 28, height: 26 }}>
            ⤡
          </button>
          <span className="label">{label}</span>
          <button className="mono" style={{ fontSize: 18, fontWeight: 700, color, minWidth: 52, textAlign: 'center' }} onClick={onReset} title="Tap to reset">
            {value}
          </button>
          <button className="tool" onClick={onReset} title="Reset" style={{ width: 28, height: 26 }}>
            ↺
          </button>
        </div>
        <div className="row" style={{ marginTop: 2 }}>
          <button className="tile-btn" onClick={() => onSet(Math.max(min, raw - step))} aria-label={`${label} down`}>
            <MinusIcon />
          </button>
          <input type="range" min={min} max={max} step={step} value={raw} onChange={(e) => onSet(parseFloat(e.target.value))} />
          <button className="tile-btn" onClick={() => onSet(Math.min(max, raw + step))} aria-label={`${label} up`}>
            <PlusIcon />
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="tile grow">
      <div className="row between" style={{ gap: 4 }}>
        <button className="tile-btn" onClick={() => onSet(Math.max(min, raw - step))} aria-label={`${label} down`}>
          <MinusIcon />
        </button>
        <button className="mono" style={{ fontSize: 18, fontWeight: 700, color, minWidth: 52 }} onClick={onReset} title="Tap to reset">
          {value}
        </button>
        <button className="tile-btn" onClick={() => onSet(Math.min(max, raw + step))} aria-label={`${label} up`}>
          <PlusIcon />
        </button>
      </div>
      <div className="row" style={{ justifyContent: 'center', gap: 6, marginTop: 2 }}>
        <span className="label">{label}</span>
        <button className="tile-expand" onClick={() => onBig(true)} title="Expand" aria-label={`Expand ${label}`} style={{ width: 28, height: 28 }}>
          ⤢
        </button>
      </div>
    </div>
  );
}

function MinusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="2" y="6" width="10" height="2" rx="1" fill="currentColor" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="2" y="6" width="10" height="2" rx="1" fill="currentColor" />
      <rect x="6" y="2" width="2" height="10" rx="1" fill="currentColor" />
    </svg>
  );
}

function BookmarkRow({ index, id, name, time }: { index: number; id: string; name: string; time: number }) {
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
      <span className="num marker-chip" style={{ padding: 0, minWidth: 0, border: 'none', background: 'none' }}>
        <span className="num">{index + 1}</span>
      </span>
      {nameEdit === null ? (
        <button className="grow" style={{ textAlign: 'left', fontWeight: 600, fontSize: 13 }} onClick={() => setNameEdit(name)} title="Rename">
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
      <button className="chip sm" title="Delete" onClick={() => st.removeBookmark(id)} style={{ color: 'var(--bad)' }}>
        ✕
      </button>
    </div>
  );
}
