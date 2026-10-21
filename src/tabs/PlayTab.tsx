import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings, totalLatencyMs, type PlayMode, type RunGap } from '../state/settings';
import { SCALES, SCALE_BY_ID, buildSequence, degreeLabel, degreeString, isInScale, turnIndex } from '../music/scales';
import { ExercisePicker, RunOptionPills } from '../components/ExercisePicker';
import { centsOff, noteLabel, noteName, octaveOf, clampMidi } from '../music/notes';
import { Sequencer, type ScheduledNote } from '../audio/sequencer';
import { instrument } from '../audio/synth/Instrument';
import { getAudioContext, unlockAudio } from '../audio/context';
import { Piano, PIANO_HI, PIANO_LO } from '../components/Piano';
import { BpmPill } from '../components/BpmPill';
import { NoteSlots } from '../components/NoteSlots';
import { RangePill } from '../components/RangeControl';
import { RunView, type RunState } from '../components/RunView';
import { useDisplayNote } from '../state/pitchStore';
import { historyIndex, historyLength, midis, times } from '../state/pitchHistory';
import { scoreNote, summarizeRun, type NoteScore, type RunSummary } from '../music/scoring';

const MODE_NEXT: Record<PlayMode, PlayMode> = { along: 'listen', listen: 'along' };
const MODE_LABEL: Record<PlayMode, string> = { along: 'Sing along', listen: 'Listen, then sing' };
const GAP_NEXT: Record<RunGap, RunGap> = { none: 'beat', beat: 'bar', bar: 'none' };
const GAP_LABEL: Record<RunGap, string> = { none: 'Gap: none', beat: 'Gap: 1 beat', bar: 'Gap: 1 bar' };
const GAP_BEATS: Record<RunGap, number> = { none: 0.25, beat: 1, bar: 4 };

export function PlayTab() {
  const s = useSettings();
  const scale = SCALE_BY_ID[s.playScale] ?? SCALES[0];
  const sequence = useMemo(() => buildSequence(s.playRoot, scale, s.playDirection), [s.playRoot, scale, s.playDirection]);
  const turn = turnIndex(scale, s.playDirection);

  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);
  const [introMidi, setIntroMidi] = useState<number | null>(null);
  const [listening, setListening] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [edgeNote, setEdgeNote] = useState<string | null>(null);
  const seqRef = useRef<Sequencer | null>(null);
  const runRef = useRef<RunState>({ notes: [], scores: [], latency: 0, start: 0, end: 0, listenPass: false });
  const scoreTimers = useRef<number[]>([]);
  const advanceDir = useRef<1 | -1>(1);
  // latest settings for callbacks
  const latest = useRef(s);
  latest.current = s;

  const clearScoreTimers = () => {
    for (const t of scoreTimers.current) clearTimeout(t);
    scoreTimers.current = [];
  };

  const startRun = useCallback((root: number, keepTail = false) => {
    const st = latest.current;
    const sc = SCALE_BY_ID[st.playScale] ?? SCALES[0];
    const seqNotes = buildSequence(root, sc, st.playDirection);
    const sq = seqRef.current!;
    sq.bpm = st.bpm;
    sq.sound = st.sound;
    setPlaying(true);
    setSummary(null);
    clearScoreTimers();
    runRef.current = { notes: [], scores: [], latency: 0, start: 0, end: 0, listenPass: false };
    void sq.start({
      sequence: seqNotes,
      intro: st.intro,
      root,
      keepTail,
      holdBeats: sc.holdBeats ?? 1,
      listenFirst: st.playMode === 'listen',
      gapBeats: GAP_BEATS[st.runGap],
    });
  }, []);

  /** Next root for auto-advance respecting the vocal range and edge rule, or null to stop. */
  const nextRoot = useCallback((root: number): number | null => {
    const st = latest.current;
    const sc = SCALE_BY_ID[st.playScale] ?? SCALES[0];
    if (st.autoAdvance === 'off') return null;
    if (advanceDir.current === 1 && st.autoAdvance === 'down') advanceDir.current = -1;
    if (st.rangeLow === null || st.rangeHigh === null || st.rangeEdge === 'continue') {
      const dir = st.autoAdvance === 'up' ? 1 : -1;
      return clampMidi(root + dir, PIANO_LO, PIANO_HI - 12);
    }
    const span = Math.max(...sc.exercise);
    const fits = (r: number) => r >= st.rangeLow! && r + span <= st.rangeHigh!;
    let dir = advanceDir.current;
    let cand = root + dir;
    if (!fits(cand)) {
      if (st.rangeEdge === 'stop') return null;
      // turn around
      dir = (dir * -1) as 1 | -1;
      advanceDir.current = dir;
      cand = root + dir;
      if (!fits(cand)) return null;
      setEdgeNote(dir === -1 ? 'Top of range: coming back down' : 'Bottom of range: going back up');
    } else setEdgeNote(null);
    return cand;
  }, []);

  if (!seqRef.current) {
    seqRef.current = new Sequencer({
      onStep: (i) => {
        setIntroMidi(null);
        setStep(i);
      },
      onIntro: (m) => setIntroMidi(m),
      onRunStart: (notes: ScheduledNote[], listenPass: boolean) => {
        const st = latest.current;
        const ctx = getAudioContext();
        const latency = totalLatencyMs(st) / 1000 + (ctx.outputLatency || ctx.baseLatency || 0);
        runRef.current = { notes, scores: notes.map(() => null), latency, start: notes[0].time, end: notes[notes.length - 1].time + notes[notes.length - 1].dur, listenPass };
        setListening(false);
        // Score each note shortly after it ends (plus latency so the sung frames have arrived).
        clearScoreTimers();
        notes.forEach((n, i) => {
          const at = n.time + n.dur + latency + 0.08;
          const ms = Math.max(0, (at - ctx.currentTime) * 1000);
          scoreTimers.current.push(
            window.setTimeout(() => {
              const frames: { time: number; midi: number }[] = [];
              const len = historyLength();
              for (let k = 0; k < len; k++) {
                const idx = historyIndex(k);
                const t = times[idx] - latency;
                if (t < n.time - 0.05) break;
                frames.push({ time: t, midi: midis[idx] });
              }
              const tol = latest.current.toleranceCents + 10;
              runRef.current.scores[i] = scoreNote(frames, n.time + 0.05, n.time + n.dur, n.midi, tol, latest.current.pitch.hopMs / 1000);
            }, ms),
          );
        });
      },
      onRunEnd: () => {
        const st = latest.current;
        const scores = runRef.current.scores.map((x) => x ?? ({ cents: NaN, precision: 0, sustain: 0, hit: false, tendency: 'none' } as NoteScore));
        if (scores.length) setSummary(summarizeRun(scores));
        const next = nextRoot(st.playRoot);
        if (next === null) {
          setPlaying(false);
          setStep(-1);
          return;
        }
        useSettings.getState().set({ playRoot: next });
        startRun(next, true);
      },
      onStop: () => {
        setPlaying(false);
        setStep(-1);
        setIntroMidi(null);
        setListening(false);
        clearScoreTimers();
      },
    });
  }

  // tempo / sound changes apply live
  useEffect(() => {
    if (seqRef.current) {
      seqRef.current.bpm = s.bpm;
      seqRef.current.sound = s.sound;
    }
  }, [s.bpm, s.sound]);

  useEffect(
    () => () => {
      seqRef.current?.stop(false);
      clearScoreTimers();
    },
    [],
  );

  const stop = () => seqRef.current?.stop();
  const togglePlay = () => {
    if (playing) stop();
    else {
      advanceDir.current = s.autoAdvance === 'down' ? -1 : 1;
      setEdgeNote(null);
      startRun(s.playRoot);
    }
  };
  const restart = () => {
    advanceDir.current = s.autoAdvance === 'down' ? -1 : 1;
    startRun(s.playRoot);
  };

  const onKey = (midi: number) => {
    seqRef.current?.stop();
    s.set({ playRoot: midi });
    void unlockAudio().then(() => instrument.play(midi, 0.6, latest.current.sound));
  };

  // Listen pass indicator: chips walk during the demo, "listen" state shows until the singer pass.
  useEffect(() => {
    if (playing && s.playMode === 'listen' && runRef.current.notes.length === 0) setListening(true);
  }, [playing, s.playMode, step]);

  const soundingMidi = introMidi ?? (step >= 0 ? sequence[step] : null);
  const chipNotes = s.playDirection === 'down' && !scale.pattern ? [...scale.exercise].reverse() : scale.exercise;
  const chipRoot = s.playRoot;
  const chipStep = step < 0 ? -1 : turn >= 0 && step > turn ? 2 * turn - step : step;
  const inScale = useCallback((m: number) => isInScale(m, s.playRoot, scale), [s.playRoot, scale]);
  const now = useCallback(() => getAudioContext().currentTime, []);

  return (
    <>
      <section className="card">
        <div className="row between">
          <div className="row" style={{ gap: 8 }}>
            <span className="label">Now playing</span>
            <PlayTunerPill target={soundingMidi} inScale={inScale} tolerance={s.toleranceCents + 10} />
          </div>
          <BpmPill bpm={s.bpm} onChange={(bpm) => s.set({ bpm })} />
        </div>
        <div className="row between" style={{ marginTop: 10 }}>
          <div>
            <div className="big-note">
              {noteName(s.playRoot).replace('#', '')}
              {noteName(s.playRoot).includes('#') && <sup>♯</sup>}
              <small>{octaveOf(s.playRoot)}</small>
            </div>
            <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
              {scale.pattern ? `${scale.name} ${scale.short}` : scale.name}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn round" onClick={restart} aria-label="Restart">
              <RestartIcon />
            </button>
            <button className={`btn round lg${playing ? '' : ' primary'}`} onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
          </div>
        </div>
        <div className="row between wrap" style={{ marginTop: 12 }}>
          <span className="label">Sequence</span>
          <div className="row wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <button className={`pill sm${s.playMode === 'listen' ? ' accent' : ' ghost'}`} onClick={() => s.set({ playMode: MODE_NEXT[s.playMode] })} title="Sing with the piano, or hear the run once then sing it with a click">
              {MODE_LABEL[s.playMode]}
            </button>
            <RunOptionPills />
            <RangePill />
            <button className="pill sm ghost" onClick={() => s.set({ runGap: GAP_NEXT[s.runGap] })} title="Rest between runs">
              {GAP_LABEL[s.runGap]}
            </button>
          </div>
        </div>
        <div className="chips" style={{ marginTop: 6 }}>
          {chipNotes.map((offset, i) => (
            <span key={i} className={`chip sm${i === chipStep ? (listening ? ' on' : ' sounding') : ''}`} title={degreeLabel(scale, offset)}>
              {noteLabel(chipRoot + offset)}
            </span>
          ))}
          {turn >= 0 && <span className={`chip sm${step > turn ? ' on' : ''}`}>↩</span>}
        </div>
        <div className="row between" style={{ marginTop: 8 }}>
          <span className="dim" style={{ fontSize: 11 }}>
            {listening ? 'Listen…' : scale.pattern ? scale.short : degreeString(scale)}
            {!listening && turn >= 0 ? ' and back' : ''}
            {!listening && (scale.holdBeats ?? 1) > 1 ? ` · ${scale.holdBeats} beats per note, slide between` : ''}
          </span>
          <SingTarget target={soundingMidi} />
        </div>
        <div style={{ marginTop: 8 }}>
          <RunView run={runRef} now={now} height={120} />
        </div>
        {(summary || edgeNote || introMidi !== null) && (
          <div className="row wrap" style={{ marginTop: 8, gap: 6 }}>
            {summary && (
              <>
                <span className={`pill sm ${summary.hits === summary.total ? 'good' : summary.hits >= summary.total / 2 ? 'warn' : 'bad'} mono`}>
                  {summary.hits}/{summary.total} hit
                </span>
                {!Number.isNaN(summary.avgCents) && (
                  <span className="pill sm ghost mono">
                    avg {summary.avgCents >= 0 ? '+' : '−'}
                    {Math.abs(Math.round(summary.avgCents))}¢
                  </span>
                )}
                <span className="pill sm ghost mono">
                  precision {Math.round(summary.precision * 100)}% · sustain {Math.round(summary.sustain * 100)}%
                </span>
                {summary.flat + summary.sharp > 0 && (
                  <span className="pill sm ghost">{summary.flat > summary.sharp ? `${summary.flat} flat` : `${summary.sharp} sharp`}</span>
                )}
              </>
            )}
            {edgeNote && <span className="pill sm accent">{edgeNote}</span>}
            {introMidi !== null && <span className="pill sm ghost">Intro: {noteLabel(introMidi)}</span>}
          </div>
        )}
      </section>

      <Piano root={s.playRoot} inScale={inScale} sounding={soundingMidi} onKey={onKey} />

      <ExercisePicker />
    </>
  );
}

/** "Sing: E4" target readout so a beginner always knows which note to aim for. */
function SingTarget({ target }: { target: number | null }) {
  return (
    <span className="row" style={{ gap: 6, fontSize: 11 }}>
      <span className="dim">Sing</span>
      <span className="mono" style={{ fontWeight: 700, minWidth: 30, textAlign: 'right', color: target === null ? 'var(--dim)' : 'var(--accent)' }}>
        {target === null ? '—' : noteLabel(target)}
      </span>
    </span>
  );
}

/**
 * Live tuner pill: fixed-width note display coloured by how the sung note matches the
 * note currently sounding in the sequence. No cents number here.
 */
function PlayTunerPill({ target, inScale, tolerance }: { target: number | null; inScale: (m: number) => boolean; tolerance: number }) {
  const note = useDisplayNote();
  let cls = 'pill ghost';
  if (note.midi !== null) {
    if (target === null) cls = 'pill';
    else {
      const c = Math.abs(centsOff(note.freq, target));
      if (note.midi === target && c <= tolerance) cls = 'pill good';
      else if (note.midi === target || c <= tolerance * 2) cls = 'pill yellow';
      else if (inScale(note.midi)) cls = 'pill warn';
      else cls = 'pill bad';
    }
  }
  return (
    <span className={cls} style={{ width: 74, justifyContent: 'center' }}>
      <NoteSlots midi={note.midi} size={15} />
    </span>
  );
}

function PlayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}
function RestartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </svg>
  );
}
