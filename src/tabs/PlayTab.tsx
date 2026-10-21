import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSettings, type AutoAdvance } from '../state/settings';
import { SCALES, SCALE_BY_ID, buildSequence, isInScale, turnIndex, type Direction } from '../music/scales';
import { centsOff, noteLabel, noteName, octaveOf, clampMidi } from '../music/notes';
import { Sequencer } from '../audio/sequencer';
import { instrument } from '../audio/synth/Instrument';
import { unlockAudio } from '../audio/context';
import { Piano, PIANO_HI, PIANO_LO } from '../components/Piano';
import { BpmPill } from '../components/BpmPill';
import { NoteSlots } from '../components/NoteSlots';
import { useDisplayNote } from '../state/pitchStore';

const ADVANCE_NEXT: Record<AutoAdvance, AutoAdvance> = { off: 'up', up: 'down', down: 'off' };
const ADVANCE_LABEL: Record<AutoAdvance, string> = { off: 'Auto-advance off', up: 'Auto-advance ↑', down: 'Auto-advance ↓' };

export function PlayTab() {
  const s = useSettings();
  const scale = SCALE_BY_ID[s.playScale] ?? SCALES[0];
  const sequence = useMemo(() => buildSequence(s.playRoot, scale, s.playDirection), [s.playRoot, scale, s.playDirection]);
  const turn = turnIndex(scale, s.playDirection);

  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);
  const [introMidi, setIntroMidi] = useState<number | null>(null);
  const seqRef = useRef<Sequencer | null>(null);
  // latest settings for callbacks
  const latest = useRef(s);
  latest.current = s;

  const startRun = useCallback(
    (root: number) => {
      const st = latest.current;
      const sc = SCALE_BY_ID[st.playScale] ?? SCALES[0];
      const seqNotes = buildSequence(root, sc, st.playDirection);
      const sq = seqRef.current!;
      sq.bpm = st.bpm;
      sq.sound = st.sound;
      setPlaying(true);
      void sq.start(seqNotes, st.intro, root);
    },
    [],
  );

  if (!seqRef.current) {
    seqRef.current = new Sequencer({
      onStep: (i) => {
        setIntroMidi(null);
        setStep(i);
      },
      onIntro: (m) => setIntroMidi(m),
      onRunEnd: () => {
        const st = latest.current;
        if (st.autoAdvance === 'off') {
          setPlaying(false);
          setStep(-1);
          return;
        }
        const next = clampMidi(st.playRoot + (st.autoAdvance === 'up' ? 1 : -1), PIANO_LO, PIANO_HI - 12);
        useSettings.getState().set({ playRoot: next });
        startRun(next);
      },
      onStop: () => {
        setPlaying(false);
        setStep(-1);
        setIntroMidi(null);
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

  useEffect(() => () => seqRef.current?.stop(false), []);

  const stop = () => {
    seqRef.current?.stop();
  };
  const togglePlay = () => {
    if (playing) stop();
    else startRun(s.playRoot);
  };
  const restart = () => startRun(s.playRoot);

  const onKey = (midi: number) => {
    seqRef.current?.stop();
    s.set({ playRoot: midi });
    void unlockAudio().then(() => instrument.play(midi, 0.6, latest.current.sound));
  };

  const soundingMidi = introMidi ?? (step >= 0 ? sequence[step] : null);
  const visibleScales = SCALES.filter((sc) => !s.hiddenScales.includes(sc.id));
  const inScale = useCallback((m: number) => isInScale(m, s.playRoot, scale), [s.playRoot, scale]);

  return (
    <>
      <section className="card">
        <div className="row between">
          <div className="row" style={{ gap: 8 }}>
            <span className="label">Now playing</span>
            <PlayTunerPill target={soundingMidi} root={s.playRoot} inScale={inScale} />
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
              {scale.name}
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
        <div className="row between" style={{ marginTop: 12 }}>
          <span className="label">Sequence</span>
          <button className={`pill sm${s.autoAdvance !== 'off' ? ' accent' : ' ghost'}`} onClick={() => s.set({ autoAdvance: ADVANCE_NEXT[s.autoAdvance] })}>
            {ADVANCE_LABEL[s.autoAdvance]}
          </button>
        </div>
        <div className="chips" style={{ marginTop: 6 }}>
          {sequence.map((m, i) => (
            <SeqChip key={i} midi={m} on={i === step} after={i === turn ? '↩' : null} />
          ))}
        </div>
        {introMidi !== null && (
          <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Intro: {noteLabel(introMidi)}
          </div>
        )}
      </section>

      <Piano root={s.playRoot} inScale={inScale} sounding={soundingMidi} onKey={onKey} />

      <section className="card">
        <div className="row between">
          <span className="label">Scale</span>
          <div className="seg">
            {(
              [
                ['up', 'Up'],
                ['down', 'Down'],
                ['upDown', 'Up-down'],
              ] as [Direction, string][]
            ).map(([d, name]) => (
              <button key={d} className={s.playDirection === d ? 'on' : ''} onClick={() => s.set({ playDirection: d })}>
                {name}
              </button>
            ))}
          </div>
        </div>
        <div className="chips" style={{ marginTop: 8 }}>
          {visibleScales.map((sc) => (
            <button key={sc.id} className={`chip${sc.id === scale.id ? ' on' : ''}`} onClick={() => s.set({ playScale: sc.id })}>
              {sc.name}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function SeqChip({ midi, on, after }: { midi: number; on: boolean; after: string | null }) {
  return (
    <>
      <span className={`chip sm${on ? ' sounding' : ''}`}>{noteLabel(midi)}</span>
      {after && <span className="chip sm">{after}</span>}
    </>
  );
}

/**
 * Live tuner pill: fixed-width note display coloured by how the sung note matches the
 * note currently sounding in the sequence. No cents number here.
 */
function PlayTunerPill({ target, root, inScale }: { target: number | null; root: number; inScale: (m: number) => boolean }) {
  const note = useDisplayNote();
  void root;
  let cls = 'pill ghost';
  if (note.midi !== null) {
    if (target === null) cls = 'pill';
    else {
      const c = Math.abs(centsOff(note.freq, target));
      if (note.midi === target && c <= 35) cls = 'pill good';
      else if (note.midi === target || c <= 70) cls = 'pill yellow';
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
