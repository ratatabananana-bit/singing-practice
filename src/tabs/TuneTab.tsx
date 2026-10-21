import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../state/settings';
import { SCALES, SCALE_BY_ID, buildSequence, degreeString, isInScale, turnIndex } from '../music/scales';
import { centsOff, clampMidi, freqToMidi, freqToNote, midiToFreq, noteLabel, noteName, octaveOf } from '../music/notes';
import { detectKey, type KeyGuess } from '../music/keyDetect';
import { instrument } from '../audio/synth/Instrument';
import { unlockAudio, getAudioContext } from '../audio/context';
import { mic } from '../audio/mic/MicService';
import { Piano, PIANO_HI, PIANO_LO } from '../components/Piano';
import { ExercisePicker, RunOptionPills } from '../components/ExercisePicker';
import { LoudnessMeter, loudnessStatus } from '../components/LoudnessMeter';
import { useDisplayMidi, useMicState } from '../state/pitchStore';
import { Median3 } from '../audio/pitch/tracker';
import { smoothTrace } from '../components/traceSmooth';
import { steadiness } from '../music/scoring';
import { RangePill } from '../components/RangeControl';

const GRAPH_SECONDS = 7;

interface Nailed {
  midi: number;
  cents: number;
  /** 0..1, 1 = perfectly steady during the hold. */
  steady: number;
  at: number;
}

export function TuneTab() {
  const s = useSettings();
  const scale = SCALE_BY_ID[s.playScale] ?? SCALES[0];
  const scaleMode = s.tuneMode === 'scale';

  // Exercise mode walks through the same exercise as the Play tab (exercise, direction,
  // intro and auto-advance are shared settings). The tapped key is the root.
  const sequence = useMemo(
    () => (scaleMode ? buildSequence(s.tuneTarget, scale, s.playDirection) : [s.tuneTarget]),
    [scaleMode, s.tuneTarget, scale, s.playDirection],
  );
  const [idx, setIdx] = useState(0);
  const target = sequence[Math.min(idx, sequence.length - 1)];
  const turn = turnIndex(scale, s.playDirection);
  useEffect(() => setIdx(0), [s.tuneTarget, s.tuneMode, s.playScale, s.playDirection]);

  const [nailed, setNailed] = useState<Nailed[]>([]);
  const [attempting, setAttempting] = useState(false);

  /** Cue a key: intro notes if set, otherwise just the root. */
  const cueKey = useCallback((root: number) => {
    const st = useSettings.getState();
    void unlockAudio().then(() => {
      const ctx = getAudioContext();
      const notes = st.intro === 'off' ? [root] : st.intro === '15' ? [root, root + 7] : [root, root + 4, root + 7];
      notes.forEach((n, i) => instrument.play(n, 0.45, st.sound, ctx.currentTime + i * 0.5));
    });
  }, []);

  /** Move to the next target; at the end of the run, auto-advance the key or start over. */
  const advance = useCallback(() => {
    const st = useSettings.getState();
    const sc = SCALE_BY_ID[st.playScale] ?? SCALES[0];
    const n = buildSequence(st.tuneTarget, sc, st.playDirection).length;
    setIdx((i) => {
      if (i + 1 < n) return i + 1;
      if (st.autoAdvance !== 'off') {
        const next = clampMidi(st.tuneTarget + (st.autoAdvance === 'up' ? 1 : -1), PIANO_LO, PIANO_HI - 12);
        st.set({ tuneTarget: next });
        cueKey(next);
      }
      return 0;
    });
  }, [cueKey]);

  const onNailed = useCallback(
    (midi: number, cents: number, steady: number) => {
      setNailed((n) => [{ midi, cents, steady, at: Date.now() }, ...n].slice(0, 50));
      if (useSettings.getState().tuneMode === 'scale') advance();
    },
    [advance],
  );

  const playTarget = () => {
    void unlockAudio().then(() => instrument.play(target, 1.2, s.sound));
  };
  const onKey = (midi: number) => {
    s.set({ tuneTarget: midi });
    setIdx(0);
    if (scaleMode) cueKey(midi);
    else void unlockAudio().then(() => instrument.play(midi, 1.0, s.sound));
  };

  const sungMidi = useDisplayMidi();
  const inScale = useCallback((m: number) => (scaleMode ? isInScale(m, s.tuneTarget, scale) : false), [scaleMode, s.tuneTarget, scale]);
  const chipStep = turn >= 0 && idx > turn ? 2 * turn - idx : idx;
  const chipNotes = s.playDirection === 'down' && !scale.pattern ? [...scale.exercise].reverse() : scale.exercise;

  return (
    <>
      <TunerCard
        target={target}
        onNailed={onNailed}
        onAttempt={setAttempting}
        onPlay={playTarget}
        progress={scaleMode ? { i: idx, n: sequence.length } : null}
        onNext={scaleMode ? advance : undefined}
      />

      <div className="row between">
        <div className="seg">
          <button className={!scaleMode ? 'on' : ''} onClick={() => s.set({ tuneMode: 'note' })}>
            One Note
          </button>
          <button className={scaleMode ? 'on' : ''} onClick={() => s.set({ tuneMode: 'scale' })}>
            Exercise
          </button>
        </div>
        {scaleMode && (
          <div className="row" style={{ gap: 6 }}>
            <RunOptionPills />
            <RangePill />
          </div>
        )}
      </div>

      {scaleMode && (
        <section className="card" style={{ padding: '8px 12px' }}>
          <div className="row between">
            <span className="label">Sequence</span>
            <span className="dim" style={{ fontSize: 11 }}>
              {scale.pattern ? scale.short : degreeString(scale)}
              {turn >= 0 ? ' and back' : ''} · nail each note to move on
            </span>
          </div>
          <div className="chips" style={{ marginTop: 6 }}>
            {chipNotes.map((offset, i) => (
              <span key={i} className={`chip sm${i === chipStep ? ' sounding' : ''}`}>
                {noteLabel(s.tuneTarget + offset)}
              </span>
            ))}
            {turn >= 0 && <span className={`chip sm${idx > turn ? ' on' : ''}`}>↩</span>}
          </div>
        </section>
      )}

      <Piano root={s.tuneTarget} sounding={scaleMode ? target : null} sung={sungMidi} inScale={inScale} onKey={onKey} />

      {scaleMode && <ExercisePicker />}

      <section className="card">
        <div className="row between">
          <span className="label">Session</span>
          <span className="pill sm ghost mono">
            {nailed.length} / {nailed.length + (attempting ? 1 : 0)} nailed
          </span>
        </div>
        {nailed.length === 0 ? (
          <div className="empty">Hold a note to log it.</div>
        ) : (
          <div className="chips" style={{ marginTop: 8 }}>
            <SessionBias nailed={nailed} />
            {nailed.map((n) => (
              <span key={n.at} className={`chip sm${Math.abs(n.cents) <= 10 ? ' on' : ''}`} title={`steadiness ${Math.round(n.steady * 100)}%`}>
                {noteLabel(n.midi)}
                <span className="mono" style={{ marginLeft: 5, opacity: 0.8 }}>
                  {n.cents >= 0 ? '+' : '−'}
                  {Math.abs(Math.round(n.cents))}¢
                </span>
                <span className="mono" style={{ marginLeft: 5, opacity: 0.6, fontSize: 10 }}>
                  {n.steady >= 0.8 ? '▬' : n.steady >= 0.5 ? '〰' : '≈'}
                </span>
              </span>
            ))}
            <button className="chip sm" onClick={() => setNailed([])}>
              clear
            </button>
          </div>
        )}
      </section>
    </>
  );
}

interface Live {
  cents: number; // smoothed; NaN when silent
  voiced: boolean;
  freq: number;
  db: number;
  hold: number; // 0..1
}
const QUIET: Live = { cents: NaN, voiced: false, freq: 0, db: -120, hold: 0 };

/**
 * The tuner card subscribes to the mic directly, so 20 Hz updates re-render
 * only this card and not the piano or session list.
 */
function TunerCard({
  target,
  onNailed,
  onAttempt,
  onPlay,
  progress,
  onNext,
}: {
  target: number;
  onNailed: (midi: number, cents: number, steady: number) => void;
  onAttempt: (attempting: boolean) => void;
  onPlay: () => void;
  progress: { i: number; n: number } | null;
  onNext?: () => void;
}) {
  const { state: micState } = useMicState();
  const [live, setLive] = useState<Live>(QUIET);
  const [keyGuess, setKeyGuess] = useState<KeyGuess | null>(null);
  const histT = useRef<number[]>([]);
  const histC = useRef<number[]>([]);
  const targetRef = useRef(target);
  targetRef.current = target;
  const cb = useRef({ onNailed, onAttempt });
  cb.current = { onNailed, onAttempt };

  useEffect(() => {
    const med = new Median3();
    let ma: number[] = [];
    let hold = 0;
    let lastT: number | null = null;
    let nailCents: number[] = [];
    let attempting = false;
    const keyObs: { midi: number; time: number }[] = [];

    const unsub = mic.subscribe((f) => {
      const st = useSettings.getState();
      const now = f.time;
      const dt = lastT === null ? 0 : Math.min(0.25, now - lastT);
      lastT = now;
      let cents = NaN;
      let voiced = false;
      if (f.voiced && f.freq > 0 && f.db >= st.silenceDb) {
        const raw = centsOff(f.freq, targetRef.current);
        const m = med.push(raw);
        ma.push(m);
        const len = Math.max(1, st.pitch.tuneSmoothing);
        while (ma.length > len) ma.shift();
        cents = ma.reduce((a, b) => a + b, 0) / ma.length;
        voiced = true;
        keyObs.push({ midi: freqToMidi(f.freq), time: now });
        if (keyObs.length > 600) keyObs.splice(0, keyObs.length - 600);
      } else {
        med.reset();
        ma = [];
      }
      histT.current.push(now);
      histC.current.push(voiced ? cents : NaN);
      while (histT.current.length && now - histT.current[0] > GRAPH_SECONDS + 1) {
        histT.current.shift();
        histC.current.shift();
      }

      const tol = st.toleranceCents;
      const inTune = voiced && Math.abs(cents) <= tol;
      if (inTune) {
        hold = Math.min(1, hold + dt / st.holdSeconds);
        nailCents.push(cents);
      } else {
        hold = Math.max(0, hold - dt / (st.holdSeconds * 2.5));
        if (hold === 0) nailCents = [];
      }
      const nowAttempting = hold > 0;
      if (nowAttempting !== attempting) {
        attempting = nowAttempting;
        cb.current.onAttempt(attempting);
      }
      if (hold >= 1) {
        const avg = nailCents.length ? nailCents.reduce((a, b) => a + b, 0) / nailCents.length : 0;
        cb.current.onNailed(targetRef.current, avg, steadiness(nailCents));
        nailCents = [];
        hold = 0;
        med.reset();
        ma = [];
      }
      setLive({ cents, voiced, freq: f.voiced ? f.freq : 0, db: f.db, hold });
    });
    const keyTimer = setInterval(() => setKeyGuess(detectKey(keyObs, getAudioContext().currentTime)), 500);
    return () => {
      unsub();
      clearInterval(keyTimer);
    };
  }, []);

  const holdSeconds = useSettings((x) => x.holdSeconds);
  const silenceDb = useSettings((x) => x.silenceDb);
  const tolerance = useSettings((x) => x.toleranceCents);
  const st = { holdSeconds, silenceDb };
  const semis = Math.round(Math.abs(live.cents) / 100);
  const tuneStatus = !live.voiced
    ? 'Listening'
    : Math.abs(live.cents) <= tolerance
      ? 'In tune'
      : Math.abs(live.cents) > 100
        ? `Far off · ${semis} semitone${semis === 1 ? '' : 's'} ${live.cents < 0 ? 'low' : 'high'}`
        : live.cents < 0
          ? 'Flat'
          : 'Sharp';
  const statusCls = !live.voiced ? 'ghost' : Math.abs(live.cents) <= tolerance ? 'good' : Math.abs(live.cents) > 100 ? 'bad' : 'warn';
  const keyCls = !keyGuess ? 'ghost' : keyGuess.confidence > 0.6 ? 'good' : keyGuess.confidence > 0.35 ? 'warn' : 'ghost';

  return (
    <section className="card" style={{ paddingTop: 14 }}>
      <div className="hold-bar">
        <div style={{ width: `${live.hold * 100}%` }} />
      </div>
      <div className="row between">
        <div className="row">
          <span className="label">Target</span>
          <button className={`pill sm ${micState === 'running' ? 'good' : micState === 'starting' ? 'warn' : 'ghost'}`} onClick={() => mic.toggle()}>
            {micState === 'running' ? 'LIVE' : micState === 'starting' ? '…' : 'PAUSED'}
          </button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {progress && (
            <span className="pill sm ghost mono">
              {progress.i + 1} / {progress.n}
            </span>
          )}
          <span className={`pill sm ${keyCls}`}>{keyGuess ? `${keyGuess.label} ${Math.round(keyGuess.confidence * 100)}%` : 'key ?'}</span>
        </div>
      </div>
      <div className="row" style={{ marginTop: 8, alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 96 }}>
          <div className="big-note">
            {noteName(target).replace('#', '')}
            {noteName(target).includes('#') && <sup>♯</sup>}
            <small>{octaveOf(target)}</small>
          </div>
          <div className="dim mono" style={{ fontSize: 11, marginTop: 4 }}>
            {midiToFreq(target).toFixed(1)} Hz
          </div>
          <div className="row" style={{ marginTop: 8, gap: 6 }}>
            <button className="btn sm" onClick={onPlay}>
              ▶ Play
            </button>
            {onNext && (
              <button className="btn sm" onClick={onNext} title="Skip to the next note">
                Next ›
              </button>
            )}
          </div>
        </div>
        <div className="grow">
          <div className="label">You</div>
          <div className="mono" style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1, color: live.voiced ? 'var(--text)' : 'var(--dim)' }}>
            {live.voiced ? `${live.cents >= 0 ? '+' : '−'}${Math.abs(Math.round(live.cents))}¢` : '—'}
          </div>
          <div className="muted mono" style={{ fontSize: 12 }}>
            {live.voiced ? (
              <>
                <span style={{ color: 'var(--text)', fontWeight: 700 }}>{noteLabel(freqToNote(live.freq).midi)}</span> · {live.freq.toFixed(1)} Hz
              </>
            ) : (
              '— Hz'
            )}
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 10, alignItems: 'stretch' }}>
        <TuneGraph histT={histT} histC={histC} target={target} tolerance={tolerance} />
        <LoudnessMeter db={live.db} height={150} />
      </div>
      <div className="row wrap" style={{ marginTop: 8 }}>
        <span className={`pill sm ${statusCls}`}>{tuneStatus}</span>
        <span className="pill sm ghost">{loudnessStatus(live.db, st.silenceDb)}</span>
        <span className="pill sm ghost mono">
          hold {(live.hold * st.holdSeconds).toFixed(1)}s / {st.holdSeconds.toFixed(1)}s
        </span>
      </div>
    </section>
  );
}

/** Scrolling cents-deviation graph (~7 s). Holds the last value when silent. */
function TuneGraph({ histT, histC, target, tolerance }: { histT: React.RefObject<number[]>; histC: React.RefObject<number[]>; target: number; tolerance: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const tolRef = useRef(tolerance);
  tolRef.current = tolerance;
  useEffect(() => {
    const cv = ref.current!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (w === 0 || h === 0) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const g = cv.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const range = 250; // ±2.5 semitones visible
      const yOf = (c: number) => h / 2 - (c / range) * (h / 2);
      g.fillStyle = 'rgba(74,222,128,0.12)';
      const IN_TUNE = tolRef.current;
      g.fillRect(0, yOf(IN_TUNE), w, yOf(-IN_TUNE) - yOf(IN_TUNE));
      g.strokeStyle = '#2b2b32';
      g.lineWidth = 1;
      g.font = '10px ui-monospace, monospace';
      g.fillStyle = '#5c5c66';
      for (const st of [-2, -1, 1, 2]) {
        const y = yOf(st * 100);
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
        g.fillText(`${noteLabel(targetRef.current + st)}  ${st > 0 ? '+' : ''}${st}`, 4, y - 3);
      }
      g.fillStyle = '#8b8b96';
      g.fillText(noteLabel(targetRef.current), 4, h / 2 - 3);
      g.setLineDash([4, 4]);
      g.strokeStyle = '#8b8b96';
      g.beginPath();
      g.moveTo(0, h / 2);
      g.lineTo(w, h / 2);
      g.stroke();
      g.setLineDash([]);

      const T = histT.current!;
      const C = histC.current!;
      if (!T.length) return;
      const now = T[T.length - 1];
      const xOf = (t: number) => w - 12 - ((now - t) / GRAPH_SECONDS) * (w - 12);
      // display smoothing (signed cents → offset so silence can stay 0)
      const OFF = 10000;
      const sm = smoothTrace(
        C.map((c) => (Number.isNaN(c) ? 0 : c + OFF)),
        useSettings.getState().pitch.graphSmoothing,
      );
      let last = NaN;
      let lastX = -1;
      let lastY = 0;
      for (let i = 0; i < T.length; i++) {
        const x = xOf(T[i]);
        if (x < 0) continue;
        let c = sm[i] > 0 ? sm[i] - OFF : NaN;
        let silent = false;
        if (Number.isNaN(c)) {
          if (Number.isNaN(last)) continue;
          c = last;
          silent = true;
        }
        const y = yOf(Math.max(-range, Math.min(range, c)));
        if (lastX >= 0) {
          g.strokeStyle = silent ? '#4a4a52' : Math.abs(c) <= IN_TUNE ? '#4ade80' : '#f59e0b';
          g.lineWidth = silent ? 1.2 : 2;
          g.beginPath();
          g.moveTo(lastX, lastY);
          g.lineTo(x, y);
          g.stroke();
        }
        lastX = x;
        lastY = y;
        last = c;
      }
      if (lastX >= 0) {
        g.fillStyle = Number.isNaN(C[C.length - 1]) ? '#6b6b76' : Math.abs(last) <= IN_TUNE ? '#4ade80' : '#f59e0b';
        g.beginPath();
        g.arc(lastX, lastY, 4, 0, Math.PI * 2);
        g.fill();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [histT, histC]);
  return <canvas ref={ref} className="graph grow" style={{ height: 150 }} />;
}

/** Flat / sharp / precise counts for the session (the diagnostic Singing Carrots users praise). */
function SessionBias({ nailed }: { nailed: Nailed[] }) {
  const tol = useSettings((x) => x.toleranceCents);
  const precise = nailed.filter((n) => Math.abs(n.cents) <= tol / 2).length;
  const flat = nailed.filter((n) => n.cents < -tol / 2).length;
  const sharp = nailed.filter((n) => n.cents > tol / 2).length;
  const avg = nailed.reduce((a, n) => a + n.cents, 0) / nailed.length;
  const steady = nailed.reduce((a, n) => a + n.steady, 0) / nailed.length;
  return (
    <span className="pill sm ghost mono" style={{ width: '100%', justifyContent: 'space-between' }}>
      <span>
        {precise} precise · {flat} flat · {sharp} sharp
      </span>
      <span>
        avg {avg >= 0 ? '+' : '−'}
        {Math.abs(Math.round(avg))}¢ · steady {Math.round(steady * 100)}%
      </span>
    </span>
  );
}
