import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../state/settings';
import { SCALES, SCALE_BY_ID, isInScale, scaleNotesInRange } from '../music/scales';
import { centsOff, freqToMidi, freqToNote, midiToFreq, noteLabel, noteName, octaveOf } from '../music/notes';
import { detectKey, type KeyGuess } from '../music/keyDetect';
import { instrument } from '../audio/synth/Instrument';
import { unlockAudio, getAudioContext } from '../audio/context';
import { mic } from '../audio/mic/MicService';
import { Piano } from '../components/Piano';
import { LoudnessMeter, loudnessStatus } from '../components/LoudnessMeter';
import { useDisplayMidi, useMicState } from '../state/pitchStore';
import { Median3 } from '../audio/pitch/tracker';

const IN_TUNE = 25; // cents
const GRAPH_SECONDS = 7;

interface Nailed {
  midi: number;
  cents: number;
  at: number;
}

export function TuneTab() {
  const s = useSettings();
  const scale = SCALE_BY_ID[s.tuneScale] ?? SCALES[0];

  // Scale mode: the targets walk through the scale from the tapped root.
  const scaleTargets = useMemo(
    () => (s.tuneMode === 'scale' ? scaleNotesInRange(s.tuneTarget, scale, s.tuneTarget, s.tuneTarget + 12) : [s.tuneTarget]),
    [s.tuneMode, s.tuneTarget, scale],
  );
  const [scaleIdx, setScaleIdx] = useState(0);
  const target = scaleTargets[Math.min(scaleIdx, scaleTargets.length - 1)];
  useEffect(() => setScaleIdx(0), [s.tuneTarget, s.tuneMode, s.tuneScale]);

  const [nailed, setNailed] = useState<Nailed[]>([]);
  const [attempting, setAttempting] = useState(false);

  const onNailed = useCallback(
    (midi: number, cents: number) => {
      setNailed((n) => [{ midi, cents, at: Date.now() }, ...n].slice(0, 50));
      if (useSettings.getState().tuneMode === 'scale') setScaleIdx((i) => (i + 1) % scaleTargets.length);
    },
    [scaleTargets.length],
  );

  const playTarget = () => {
    void unlockAudio().then(() => instrument.play(target, 1.2, s.sound));
  };
  const onKey = (midi: number) => {
    s.set({ tuneTarget: midi });
    setScaleIdx(0);
    void unlockAudio().then(() => {
      if (s.tuneMode === 'scale') {
        const notes = scaleNotesInRange(midi, scale, midi, midi + 12);
        const ctx = getAudioContext();
        notes.forEach((n, i) => instrument.play(n, 0.28, s.sound, ctx.currentTime + i * 0.3));
      } else instrument.play(midi, 1.0, s.sound);
    });
  };

  const sungMidi = useDisplayMidi();
  const inScale = useCallback((m: number) => (s.tuneMode === 'scale' ? isInScale(m, s.tuneTarget, scale) : false), [s.tuneMode, s.tuneTarget, scale]);

  return (
    <>
      <TunerCard target={target} onNailed={onNailed} onAttempt={setAttempting} onPlay={playTarget} />

      <div className="row between">
        <div className="seg">
          <button className={s.tuneMode === 'note' ? 'on' : ''} onClick={() => s.set({ tuneMode: 'note' })}>
            One Note
          </button>
          <button className={s.tuneMode === 'scale' ? 'on' : ''} onClick={() => s.set({ tuneMode: 'scale' })}>
            Scale
          </button>
        </div>
        {s.tuneMode === 'scale' && (
          <div className="chips scroll grow">
            {SCALES.filter((sc) => !sc.pattern && !s.hiddenScales.includes(sc.id)).map((sc) => (
              <button key={sc.id} className={`chip sm${sc.id === scale.id ? ' on' : ''}`} onClick={() => s.set({ tuneScale: sc.id })}>
                {sc.short}
              </button>
            ))}
          </div>
        )}
      </div>

      <Piano root={s.tuneTarget} sounding={s.tuneMode === 'scale' ? target : null} sung={sungMidi} inScale={inScale} onKey={onKey} />

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
            {nailed.map((n) => (
              <span key={n.at} className={`chip sm${Math.abs(n.cents) <= 10 ? ' on' : ''}`}>
                {noteLabel(n.midi)}
                <span className="mono" style={{ marginLeft: 5, opacity: 0.8 }}>
                  {n.cents >= 0 ? '+' : '−'}
                  {Math.abs(Math.round(n.cents))}¢
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
}: {
  target: number;
  onNailed: (midi: number, cents: number) => void;
  onAttempt: (attempting: boolean) => void;
  onPlay: () => void;
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

      const inTune = voiced && Math.abs(cents) <= IN_TUNE;
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
        cb.current.onNailed(targetRef.current, avg);
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
  const st = { holdSeconds, silenceDb };
  const semis = Math.round(Math.abs(live.cents) / 100);
  const tuneStatus = !live.voiced
    ? 'Listening'
    : Math.abs(live.cents) <= IN_TUNE
      ? 'In tune'
      : Math.abs(live.cents) > 100
        ? `Far off · ${semis} semitone${semis === 1 ? '' : 's'} ${live.cents < 0 ? 'low' : 'high'}`
        : live.cents < 0
          ? 'Flat'
          : 'Sharp';
  const statusCls = !live.voiced ? 'ghost' : Math.abs(live.cents) <= IN_TUNE ? 'good' : Math.abs(live.cents) > 100 ? 'bad' : 'warn';
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
        <span className={`pill sm ${keyCls}`}>{keyGuess ? `${keyGuess.label} ${Math.round(keyGuess.confidence * 100)}%` : 'key ?'}</span>
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
          <button className="btn sm" style={{ marginTop: 8 }} onClick={onPlay}>
            ▶ Play
          </button>
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
        <TuneGraph histT={histT} histC={histC} target={target} />
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
function TuneGraph({ histT, histC, target }: { histT: React.RefObject<number[]>; histC: React.RefObject<number[]>; target: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
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
      let last = NaN;
      let lastX = -1;
      let lastY = 0;
      for (let i = 0; i < T.length; i++) {
        const x = xOf(T[i]);
        if (x < 0) continue;
        let c = C[i];
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
