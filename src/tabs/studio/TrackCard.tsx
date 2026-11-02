import { useCallback, useEffect, useRef, useState } from 'react';
import { useStudio, loopPair, loopSnapshot, type LoopSnapshot } from '../../state/studioStore';
import { useSettings } from '../../state/settings';
import { trackPlayer, type PlayerSnapshot } from '../../audio/player/TrackPlayer';
import { formatTime, formatTimePrecise, parseTime } from '../../music/notes';
import { LoopTimeline, type LoopTimelineHandle } from '../../components/LoopTimeline';
import { hasNativeYt } from '../../native/ytAudio';
import { SECTION_COLORS, nextSectionColor, resolveSections, sectionAt, sortedMarkers, tint } from '../../storage/sections';
import type { Section } from '../../storage/db';
import { loopTimes, pickAB, tapAction } from '../../state/loopTaps';
import { barNumber, barsLabel } from '../../audio/dsp/beats';

const nativeYt = hasNativeYt();
/** Two taps on the same marker within this window = jump to it. */
const DOUBLE_TAP_MS = 350;

/**
 * Studio track card after the "Studio 3a" design: transport row, loop card (timeline + A/B row),
 * Sections / Markers list, beat grid + loop gap footer. The Master pitch chart and Takes below
 * it are separate cards.
 */
export function TrackCard() {
  const st = useStudio();
  const settings = useSettings();
  const [snap, setSnap] = useState<PlayerSnapshot>(trackPlayer.state);
  const [expanded, setExpanded] = useState<'transpose' | 'speed' | null>(null);
  const [ytOpen, setYtOpen] = useState(false);
  const [ytUrl, setYtUrl] = useState('');
  /** Marker that started a loop and now waits for an end tap (see state/loopTaps.ts). */
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  /** Sections / Markers list tab; null = Sections when any exist, else Markers. */
  const [tab, setTab] = useState<'sections' | 'markers' | null>(null);
  /** Section being edited inline: its name, or its start / end times. */
  const [editSec, setEditSec] = useState<{ id: string; mode: 'name' | 'times' } | null>(null);
  /** Section the playhead is in and the last marker at or before it, refreshed a few times a second. */
  const [now, setNow] = useState<{ section: string | null; marker: number }>({ section: null, marker: -1 });
  const [zoom, setZoom] = useState(1);
  const timeline = useRef<LoopTimelineHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timeEl = useRef<HTMLSpanElement>(null);
  /** Last marker tap, so a second tap on the same marker within DOUBLE_TAP_MS becomes "jump there". */
  const lastMarkerTap = useRef<{ index: number; at: number; before: LoopSnapshot; pending: number | null } | null>(null);

  useEffect(() => trackPlayer.subscribe(setSnap), []);

  // rAF-driven time label (no React state at 60 Hz)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (timeEl.current) timeEl.current.textContent = formatTime(trackPlayer.estimatePosition());
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  const position = useCallback(() => trackPlayer.estimatePosition(), []);
  const meta = st.meta;
  const sorted = meta ? sortedMarkers(meta) : [];
  const [loopA, loopB] = meta ? loopPair(meta) : [null, null];
  /** Picked A / B markers, each possibly empty (the loop only runs when both are set, see loopPair). */
  const aIdx = meta && meta.activeLoop !== null && meta.activeLoop >= 0 && meta.activeLoop < sorted.length ? meta.activeLoop : null;
  const bRaw = meta ? (meta.loopEnd === undefined ? (aIdx !== null ? aIdx + 1 : null) : meta.loopEnd) : null;
  const bIdx = bRaw !== null && bRaw >= 0 && bRaw < sorted.length ? bRaw : null;
  /** A / B as seconds: marker times, or temporary ends from looping a section (light blue, not markers). */
  const [aTime, bTime] = meta ? loopTimes(meta, sorted) : [null, null];
  const tempA = meta && aIdx === null ? meta.tempA ?? null : null;
  const tempB = meta && bIdx === null ? meta.tempB ?? null : null;
  const bothSet = aTime !== null && bTime !== null && bTime > aTime;
  const loopActive = !!meta?.loopOn && bothSet;
  const spans = meta ? resolveSections(meta) : [];
  const pickedSec = sectionAt(spans, aTime, bTime);
  const curTab = tab ?? (spans.length > 0 ? 'sections' : 'markers');
  const grid = meta?.beatGrid ?? null;
  const bpb = meta?.beatsPerBar ?? grid?.beatsPerBar ?? 4;
  const barOf = (t: number) => (grid ? barNumber(t, grid, bpb) : null);
  const bars = (s: number, e: number) => (grid ? barsLabel(s, e, grid, bpb) : null);

  useEffect(() => {
    const id = setInterval(() => {
      const t = trackPlayer.estimatePosition();
      const sp = spans.find((x) => x.start <= t && t < x.end);
      let marker = -1;
      sorted.forEach((m, i) => {
        if (m.time <= t + 0.01) marker = i;
      });
      setNow((cur) => (cur.section === (sp?.id ?? null) && cur.marker === marker ? cur : { section: sp?.id ?? null, marker }));
    }, 250);
    return () => clearInterval(id);
    // spans / sorted derive from meta, which changes identity on every store update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  /** A or B picked (row button, pill or tap): loop that span, drop any pending start. */
  const pickLoop = (r: { a: number; b: number } | null) => {
    if (!r) return;
    st.setLoopRange(r.a, r.b);
    setPendingStart(null);
  };

  /**
   * Taps on pins, no modes (rules in state/loopTaps.ts): tap → loop that one segment and wait for
   * an end; a later tap right after → that is B; any later tap → a new A. Double-tap → jump there,
   * loop left exactly as it was before the first tap (which already ran: single taps feel instant).
   */
  const selectMarker = (i: number) => {
    if (!meta || !sorted[i]) return;
    const t = performance.now();
    const prev = lastMarkerTap.current;
    if (prev && prev.index === i && t - prev.at < DOUBLE_TAP_MS) {
      lastMarkerTap.current = null;
      setPendingStart(prev.pending);
      st.restoreLoop(prev.before);
      trackPlayer.seek(sorted[i].time);
      return;
    }
    lastMarkerTap.current = { index: i, at: t, before: loopSnapshot(meta), pending: pendingStart };
    const act = tapAction(i, i, sorted.length, { a: aIdx, b: bIdx, on: meta.loopOn }, pendingStart);
    if (act.type === 'jump') trackPlayer.seek(sorted[i].time);
    else if (act.type === 'loop') {
      st.setLoopRange(act.a, act.b);
      setPendingStart(act.pending);
    }
  };

  /** Set A/B by index, as a running loop when the pair is forward, else as single picks. */
  const pickOrSet = (a: number | null, b: number | null) => {
    if (a !== null && b !== null && a < b) pickLoop({ a, b });
    else {
      st.setLoopEnds(a, b);
      setPendingStart(a !== null && b === null ? a : null);
    }
  };

  /** Loop a section: an end with a marker within 50 ms uses it, otherwise a temporary (light-blue) end. */
  const loopSection = (sp: Section) => {
    if (!meta) return;
    if (pickedSec?.id === sp.id && loopActive) {
      st.setLoopOn(false);
      return;
    }
    st.setLoopFromSection(sp.start, sp.end);
    setPendingStart(null);
  };

  const newSectionFromAB = () => {
    if (!meta || loopA === null || loopB === null) return;
    const name = `Section ${spans.length + 1}`;
    const id = st.addSection({ name, color: nextSectionColor(spans.map((x) => x.color)), start: sorted[loopA].time, end: sorted[loopB].time });
    setTab('sections');
    setEditSec({ id, mode: 'name' });
  };

  // Loop card header
  const loopName = !meta ? '' : bothSet ? (pickedSec ? pickedSec.name : 'Marker loop') : 'No loop';
  const loopStr = bothSet ? `${formatTimePrecise(aTime!)} – ${formatTimePrecise(bTime!)}` : '—';
  const abStatus = bothSet ? bars(aTime!, bTime!) ?? '' : aTime !== null ? 'Now pick B' : bTime !== null ? 'Now pick A' : 'Pick A and B';
  const dotColor = bothSet ? (loopActive ? (pickedSec ? SECTION_COLORS[pickedSec.color % SECTION_COLORS.length] : 'var(--s-yellow)') : 'var(--s-dim)') : 'var(--s-dim)';
  /** Pill text: "5 · 0:48.54" for a marker, "~ 0:48.54" for a temporary end, "–" for none. */
  const abStr = (i: number | null, temp: number | null) => (i !== null ? `${i + 1} · ${formatTimePrecise(sorted[i].time)}` : temp !== null ? `~ ${formatTimePrecise(temp)}` : '–');

  return (
    <section className="st-studio">
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

      {/* track name + load buttons */}
      <div className="st-trackrow">
        <div className="st-trackname">
          <div className="st-eyebrow">TRACK</div>
          <div className="st-name">{st.track ? st.track.name : <span className="st-muted">No track loaded</span>}</div>
        </div>
        <div className="st-loadbtns">
          <button className="st-btn" onClick={() => fileRef.current?.click()} disabled={st.busy}>
            {st.busy ? 'Loading…' : 'Load track'}
          </button>
          <button className={`st-btn${ytOpen ? ' on' : ''}`} onClick={() => setYtOpen((o) => !o)} disabled={st.busy} title={nativeYt ? 'Fetch the audio of a YouTube video (yt-dlp runs on this device)' : 'Fetch the audio of a YouTube video through the helper on your PC'}>
            YouTube link
          </button>
          {settings.lastTrackId && (!st.track || st.track.id !== settings.lastTrackId) && (
            <button className="st-btn" onClick={() => void st.loadLast()} disabled={st.busy}>
              Last track
            </button>
          )}
        </div>
      </div>
      {ytOpen && (
        <form
          className="st-ytrow"
          onSubmit={(e) => {
            e.preventDefault();
            if (ytUrl.trim()) void st.loadYouTube(ytUrl).then(() => setYtOpen(false));
          }}
        >
          <input type="text" className="st-input" inputMode="url" placeholder="https://youtube.com/watch?v=…" value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} />
          <button className="st-btn primary" type="submit" disabled={st.busy || !ytUrl.trim()}>
            {st.busy ? st.busyText ?? 'Fetching…' : 'Load'}
          </button>
          {st.busy && nativeYt && (
            <button className="st-btn" type="button" onClick={() => void st.cancelYouTube()} title="Stop the download">
              Cancel
            </button>
          )}
        </form>
      )}
      {st.error && (
        <div className="banner bad" style={{ margin: '8px 20px 0' }} onClick={() => st.setError(null)}>
          {st.error}
        </div>
      )}

      {snap.loaded && meta && (
        <>
          {/* transport: play · big time · KEY · SPEED */}
          <div className="st-transport">
            <button className="st-play" onClick={() => trackPlayer.toggle()} aria-label={snap.playing ? 'Pause' : 'Play'}>
              {snap.playing ? (
                <>
                  <span className="st-pause-bar" />
                  <span className="st-pause-bar" />
                </>
              ) : (
                <span className="st-play-tri" />
              )}
            </button>
            <div className="st-time">
              <span className="st-time-big mono" ref={timeEl}>
                0:00
              </span>
              <span className="st-time-of mono">of {formatTime(snap.duration)}</span>
            </div>
            <div className="st-spacer" />
            <Stepper
              label="KEY"
              value={`${snap.transpose > 0 ? '+' : ''}${snap.transpose}`}
              on={expanded === 'transpose'}
              onDown={() => setTranspose(Math.max(-12, snap.transpose - 1))}
              onUp={() => setTranspose(Math.min(12, snap.transpose + 1))}
              onTap={() => setExpanded((v) => (v === 'transpose' ? null : 'transpose'))}
            />
            <Stepper
              label="SPEED"
              value={`${Math.round(snap.speed * 100)}%`}
              on={expanded === 'speed'}
              onDown={() => setSpeed(Math.max(0.25, Math.round((snap.speed - 0.05) * 100) / 100))}
              onUp={() => setSpeed(Math.min(2, Math.round((snap.speed + 0.05) * 100) / 100))}
              onTap={() => setExpanded((v) => (v === 'speed' ? null : 'speed'))}
            />
          </div>
          {expanded === 'transpose' && (
            <div className="st-expand">
              <span className="st-muted">Fine</span>
              <input type="range" min={-50} max={50} step={1} value={snap.fineCents} onChange={(e) => setFine(parseInt(e.target.value, 10))} />
              <span className="mono" style={{ minWidth: 42, textAlign: 'right' }}>
                {snap.fineCents >= 0 ? '+' : '−'}
                {Math.abs(snap.fineCents)}¢
              </span>
              <button className="st-chip" onClick={() => setFine(0)}>
                0
              </button>
            </div>
          )}
          {expanded === 'speed' && (
            <div className="st-expand wrap">
              <button className={`st-chip${st.trainer.on ? ' on' : ''}`} onClick={() => st.setTrainer({ on: !st.trainer.on })} title="Raise the speed a little after every loop pass">
                Trainer {st.trainer.on ? 'on' : 'off'}
              </button>
              {st.trainer.on && (
                <>
                  <span className="st-muted">from</span>
                  <PctStep value={st.trainer.startPct} onChange={(v) => { st.setTrainer({ startPct: v }); setSpeed(v / 100); }} />
                  <span className="st-muted">to</span>
                  <PctStep value={st.trainer.targetPct} onChange={(v) => st.setTrainer({ targetPct: v })} />
                  <span className="st-muted">step</span>
                  <PctStep value={st.trainer.stepPct} onChange={(v) => st.setTrainer({ stepPct: Math.max(1, v) })} min={1} max={25} />
                  <span className="st-dim">per loop pass</span>
                </>
              )}
            </div>
          )}

          {/* loop card */}
          <div className="st-card st-loop">
            <div className="st-loop-head">
              <span className="st-dot" style={{ background: dotColor }} />
              <span className="st-loop-name">{loopName}</span>
              <span className="mono st-muted st-nowrap">{loopStr}</span>
              <span className="mono st-muted st-nowrap">· {abStatus}</span>
              <div className="st-zoom">
                <button className="st-icon" onClick={() => timeline.current?.zoomOut()} aria-label="Zoom out" disabled={zoom <= 1.01}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14" />
                  </svg>
                </button>
                <span className="st-zoom-val mono">{zoom.toFixed(1)}×</span>
                <button className="st-icon" onClick={() => timeline.current?.zoomIn()} aria-label="Zoom in">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </button>
                <button className="st-icon st-reset" onClick={() => timeline.current?.reset()} disabled={zoom <= 1.01} title="Show the whole track">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
                  </svg>
                  Reset
                </button>
              </div>
            </div>
            <div className="st-loop-body">
              <LoopTimeline
                ref={timeline}
                duration={snap.duration}
                markers={sorted}
                aIdx={aIdx}
                bIdx={bIdx}
                tempA={tempA}
                tempB={tempB}
                loopOn={meta.loopOn}
                pendingIndex={pendingStart}
                position={position}
                onSeek={(sec) => trackPlayer.seek(sec)}
                onMoveMarker={(id, sec) => st.updateBookmark(id, { time: sec })}
                onSelectMarker={selectMarker}
                sections={spans}
                activeSection={loopActive ? (pickedSec?.id ?? null) : null}
                onSelectSection={(id) => {
                  const sp = spans.find((x) => x.id === id);
                  if (sp) loopSection(sp);
                }}
                grid={grid}
                beatsPerBar={bpb}
                onZoomChange={setZoom}
              />
            </div>
            <div className="st-loop-foot">
              <button className="st-btn" onClick={() => st.addBookmark(trackPlayer.estimatePosition())} title="Drop a marker at the playhead">
                + Marker
              </button>
              <span className="st-vr" aria-hidden="true" />
              <button className={`st-ab${aTime !== null ? ' on' : ''}${tempA !== null ? ' temp' : ''}`} disabled={aTime === null} onClick={() => aTime !== null && trackPlayer.seek(aTime)} title={aIdx !== null ? `A = marker ${aIdx + 1} · tap to jump there` : tempA !== null ? 'A = temporary (section start, no marker) · tap to jump there' : 'A not set · tap a marker'}>
                <span className="st-ab-letter">A</span>
                <span className="mono">{abStr(aIdx, tempA)}</span>
              </button>
              <button className={`st-ab${bTime !== null ? ' on' : ''}${tempB !== null ? ' temp' : ''}`} disabled={bTime === null} onClick={() => bTime !== null && trackPlayer.seek(bTime)} title={bIdx !== null ? `B = marker ${bIdx + 1} · tap to jump there` : tempB !== null ? 'B = temporary (section end, no marker) · tap to jump there' : 'B not set · tap a later marker'}>
                <span className="st-ab-letter">B</span>
                <span className="mono">{abStr(bIdx, tempB)}</span>
              </button>
              <button className={`st-icon st-loopbtn${bothSet && meta.loopOn ? ' on' : ''}`} disabled={!bothSet} onClick={() => st.toggleLoop()} aria-label={meta.loopOn ? 'Loop on' : 'Loop off'} title={!bothSet ? 'Set A and B to loop' : meta.loopOn ? 'Looping A–B · tap to play through (A and B stay)' : 'Tap to loop A–B'}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 2l4 4-4 4" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <path d="M7 22l-4-4 4-4" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
              </button>
              <div className="st-spacer" />
              {grid && (
                <button className={`st-btn st-snap${meta.snapOn ? ' on' : ''}`} onClick={() => st.setMeta({ snapOn: !meta.snapOn })} title={`Snap markers to the beat (${grid.bpm} BPM, ${bpb}/4 detected)`}>
                  Snap beat
                </button>
              )}
            </div>
          </div>

          {/* sections / markers list */}
          <div className="st-card st-list">
            <div className="st-tabs">
              <button className={curTab === 'sections' ? 'on' : ''} onClick={() => setTab('sections')}>
                Sections <span className="mono st-count">{spans.length}</span>
              </button>
              <button className={curTab === 'markers' ? 'on' : ''} onClick={() => setTab('markers')}>
                Markers <span className="mono st-count">{sorted.length}</span>
              </button>
            </div>
            <div className="st-list-body">
              {curTab === 'sections' ? (
                <>
                  <button className="st-newsec" disabled={!bothSet} onClick={newSectionFromAB}>
                    <span className="st-newsec-ico">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                    <span className="st-newsec-label">New section from A–B</span>
                    <span className="st-spacer" />
                    <span className="mono st-dim st-nowrap">{bothSet ? loopStr : 'Set A and B first'}</span>
                  </button>
                  {spans.map((sp) => {
                    const c = SECTION_COLORS[sp.color % SECTION_COLORS.length];
                    const on = loopActive && pickedSec?.id === sp.id;
                    return (
                      <SectionRow
                        key={sp.id}
                        name={sp.name}
                        color={c}
                        start={sp.start}
                        end={sp.end}
                        duration={snap.duration}
                        bars={bars(sp.start, sp.end)}
                        on={on}
                        now={now.section === sp.id}
                        editing={editSec?.id === sp.id ? editSec.mode : null}
                        onTap={() => loopSection(sp)}
                        onEditName={() => setEditSec({ id: sp.id, mode: 'name' })}
                        onEditTimes={() => setEditSec({ id: sp.id, mode: 'times' })}
                        onDone={() => setEditSec(null)}
                        onRename={(name) => {
                          st.updateSection(sp.id, { name: name.trim() || sp.name });
                          setEditSec(null);
                        }}
                        onTimes={(start, end) => st.updateSection(sp.id, { start, end })}
                        onRemove={() => {
                          st.removeSection(sp.id);
                          if (editSec?.id === sp.id) setEditSec(null);
                        }}
                      />
                    );
                  })}
                </>
              ) : (
                sorted.map((m, i) => {
                  const inSec = spans.find((x) => x.start <= m.time && m.time < x.end);
                  const loop = { a: aIdx, b: bIdx, on: meta.loopOn };
                  const isA = i === aIdx;
                  const isB = i === bIdx;
                  const bar = barOf(m.time);
                  return (
                    <div key={m.id} className={`st-mrow${isA || isB ? ' ab' : i === now.marker ? ' cur' : ''}`}>
                      <span className={`st-num${i === now.marker ? ' now' : ''}`}>{i + 1}</span>
                      <button className="st-mrow-main" onClick={() => trackPlayer.seek(m.time)} title="Jump here">
                        <span className="mono st-mrow-time">{formatTimePrecise(m.time)}</span>
                        <span className="st-mrow-sub">
                          <span className="st-mrow-dot" style={{ background: inSec ? SECTION_COLORS[inSec.color % SECTION_COLORS.length] : 'var(--s-dim)' }} />
                          {inSec ? inSec.name : '—'}
                          {bar !== null && ` · bar ${bar}`}
                        </span>
                      </button>
                      <button
                        className={`st-abbtn${isA ? ' on' : ''}`}
                        disabled={!isA && pickAB('A', i, sorted.length, loop) === null}
                        onClick={() => (isA ? pickOrSet(null, bIdx) : pickLoop(pickAB('A', i, sorted.length, loop)))}
                        title={isA ? 'A · tap to clear' : 'Make this marker A'}
                      >
                        A
                      </button>
                      <button
                        className={`st-abbtn${isB ? ' on' : ''}`}
                        disabled={!isB && pickAB('B', i, sorted.length, loop) === null}
                        onClick={() => (isB ? pickOrSet(aIdx, null) : pickLoop(pickAB('B', i, sorted.length, loop)))}
                        title={isB ? 'B · tap to clear' : 'Make this marker B'}
                      >
                        B
                      </button>
                      <button className="st-icon st-del" onClick={() => st.removeBookmark(m.id)} title="Delete marker">
                        ×
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* beat grid + loop gap */}
          <div className="st-card st-foot">
            <span>
              Beat grid{' '}
              {grid ? (
                <button className="mono st-foot-val" onClick={() => st.detectBeats()} title="Tap to detect the tempo again">
                  {grid.bpm} BPM · {bpb}/4
                </button>
              ) : meta.beatGrid === null ? (
                <button className="st-foot-val" onClick={() => st.detectBeats()} title="Tap to try again">
                  none found
                </button>
              ) : (
                <span className="st-foot-val">detecting…</span>
              )}
            </span>
            <div className="st-foot-gap">
              <span>Loop gap</span>
              <div className="st-seg">
              {[0, 1, 2].map((g) => (
                <button key={g} className={`mono${snap.loopGap === g ? ' on' : ''}`} onClick={() => setGap(g)} title="Pause before the loop restarts">
                  {g}s
                </button>
              ))}
              </div>
            </div>
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
  function setFine(c: number) {
    trackPlayer.setFineCents(c);
    st.setMeta({ fineCents: trackPlayer.state.fineCents });
  }
  function setGap(sec: number) {
    trackPlayer.setLoopGap(sec);
    st.setMeta({ loopGap: trackPlayer.state.loopGap });
  }
}

/** − value/label + stepper (KEY, SPEED). Tapping the value opens the extra row (fine tune / trainer). */
function Stepper({ label, value, on, onDown, onUp, onTap }: { label: string; value: string; on: boolean; onDown: () => void; onUp: () => void; onTap: () => void }) {
  return (
    <div className={`st-stepper${on ? ' on' : ''}`}>
      <button onClick={onDown} aria-label={`${label} down`}>
        −
      </button>
      <button className="st-stepper-val" onClick={onTap} title="More">
        <span className="mono">{value}</span>
        <span className="st-stepper-lbl">{label}</span>
      </button>
      <button onClick={onUp} aria-label={`${label} up`}>
        +
      </button>
    </div>
  );
}

function PctStep({ value, onChange, min = 25, max = 200 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <span className="row" style={{ gap: 2 }}>
      <button className="st-chip" onClick={() => onChange(Math.max(min, value - 5))}>
        −
      </button>
      <span className="mono" style={{ minWidth: 38, textAlign: 'center', fontWeight: 700 }}>
        {value}%
      </span>
      <button className="st-chip" onClick={() => onChange(Math.min(max, value + 5))}>
        +
      </button>
    </span>
  );
}

/**
 * One section in the Sections tab: colour bar, name, NOW, range, bars, then pencil (rename
 * inline), sliders (type the start / end times inline), trash. Tap the row = loop it.
 */
function SectionRow({
  name,
  color,
  start,
  end,
  duration,
  bars,
  on,
  now,
  editing,
  onTap,
  onEditName,
  onEditTimes,
  onDone,
  onRename,
  onTimes,
  onRemove,
}: {
  name: string;
  color: string;
  start: number;
  end: number;
  duration: number;
  bars: string | null;
  on: boolean;
  now: boolean;
  editing: 'name' | 'times' | null;
  onTap: () => void;
  onEditName: () => void;
  onEditTimes: () => void;
  onDone: () => void;
  onRename: (name: string) => void;
  onTimes: (start: number, end: number) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const [tStart, setTStart] = useState(formatTimePrecise(start));
  const [tEnd, setTEnd] = useState(formatTimePrecise(end));
  useEffect(() => setDraft(name), [name, editing]);
  useEffect(() => {
    setTStart(formatTimePrecise(start));
    setTEnd(formatTimePrecise(end));
  }, [start, end, editing]);
  /** Commit typed times; a bad or inverted pair is ignored (the fields snap back). */
  const commitTimes = () => {
    const a = parseTime(tStart);
    const b = parseTime(tEnd);
    if (a !== null && b !== null && a >= 0 && b <= duration + 0.01 && b - a >= 0.05) onTimes(a, Math.min(duration, b));
    else {
      setTStart(formatTimePrecise(start));
      setTEnd(formatTimePrecise(end));
    }
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div className="st-srow" style={{ background: on ? tint(color, 0.1) : undefined }} onClick={() => !editing && onTap()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && !editing && onTap()}>
      <span className="st-srow-bar" style={{ background: color }} />
      <div className="st-srow-name">
        {editing === 'times' ? (
          <span className="st-srow-times" onClick={stop}>
            <input className="st-srow-input mono" value={tStart} inputMode="decimal" autoFocus onFocus={(e) => e.target.select()} onChange={(e) => setTStart(e.target.value)} onBlur={commitTimes} onKeyDown={(e) => e.key === 'Enter' && commitTimes()} aria-label="Start time" />
            <span className="st-dim">–</span>
            <input className="st-srow-input mono" value={tEnd} inputMode="decimal" onFocus={(e) => e.target.select()} onChange={(e) => setTEnd(e.target.value)} onBlur={commitTimes} onKeyDown={(e) => e.key === 'Enter' && commitTimes()} aria-label="End time" />
          </span>
        ) : editing === 'name' ? (
          <input
            className="st-srow-input"
            value={draft}
            autoFocus
            onFocus={(e) => e.target.select()}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={() => onRename(draft)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRename(draft);
              if (e.key === 'Escape') onRename(name);
            }}
          />
        ) : (
          <>
            <span className="st-srow-title">{name}</span>
            {now && <span className="st-now">NOW</span>}
          </>
        )}
      </div>
      {editing !== 'times' && <span className="mono st-muted st-nowrap st-srow-range">{`${formatTime(start)} – ${formatTime(end)}`}</span>}
      {editing !== 'times' && <span className="mono st-dim st-nowrap st-srow-bars">{bars ?? ''}</span>}
      <div className="st-srow-acts" onClick={(e) => e.stopPropagation()}>
        {editing ? (
          <button className="st-icon lit" onClick={() => (editing === 'name' ? onRename(draft) : onDone())} aria-label="Done">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
          </button>
        ) : (
          <>
            <button className="st-icon" onClick={onEditName} aria-label="Rename">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 20h4L19 9l-4-4L4 16v4z" />
                <path d="M13.5 6.5l4 4" />
              </svg>
            </button>
            <button className="st-icon" onClick={onEditTimes} aria-label="Edit start and end times" title="Type the start and end times">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 8h16M4 16h16" />
                <circle cx="9" cy="8" r="2.2" fill="var(--s-card)" />
                <circle cx="15" cy="16" r="2.2" fill="var(--s-card)" />
              </svg>
            </button>
          </>
        )}
        <button className="st-icon" onClick={onRemove} aria-label="Delete section">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 7h16" />
            <path d="M9 7V4h6v3" />
            <path d="M6 7l1 13h10l1-13" />
          </svg>
        </button>
      </div>
    </div>
  );
}
