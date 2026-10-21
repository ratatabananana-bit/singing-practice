import { useSettings, type AutoAdvance, type IntroMode } from '../state/settings';
import { SCALES, degreeString, type Direction, type ScaleDef } from '../music/scales';
import { useHistory } from '../state/historyStore';
import { bestByExercise } from '../music/history';
import { useMemo } from 'react';

export const ADVANCE_NEXT: Record<AutoAdvance, AutoAdvance> = { off: 'up', up: 'down', down: 'off' };
export const ADVANCE_LABEL: Record<AutoAdvance, string> = { off: 'Auto-advance off', up: 'Auto-advance ↑', down: 'Auto-advance ↓' };
export const INTRO_NEXT: Record<IntroMode, IntroMode> = { off: '15', '15': '135', '135': 'off' };
export const INTRO_LABEL: Record<IntroMode, string> = { off: 'Intro off', '15': 'Intro 1–5', '135': 'Intro 1–3–5' };

/** Intro + auto-advance pills (shared by Play and Tune). */
export function RunOptionPills() {
  const intro = useSettings((x) => x.intro);
  const autoAdvance = useSettings((x) => x.autoAdvance);
  const set = useSettings((x) => x.set);
  return (
    <div className="row" style={{ gap: 6 }}>
      <button className={`pill sm${intro !== 'off' ? ' accent' : ' ghost'}`} onClick={() => set({ intro: INTRO_NEXT[intro] })} title="Key cue played before each run">
        {INTRO_LABEL[intro]}
      </button>
      <button className={`pill sm${autoAdvance !== 'off' ? ' accent' : ' ghost'}`} onClick={() => set({ autoAdvance: ADVANCE_NEXT[autoAdvance] })}>
        {ADVANCE_LABEL[autoAdvance]}
      </button>
    </div>
  );
}

/**
 * Exercise picker card: scales with their degree pattern, vocal patterns, and direction.
 * Shared by the Play and Tune tabs so one choice drives both.
 */
export function ExercisePicker() {
  const playScale = useSettings((x) => x.playScale);
  const playDirection = useSettings((x) => x.playDirection);
  const hidden = useSettings((x) => x.hiddenScales);
  const set = useSettings((x) => x.set);
  const scale = SCALES.find((sc) => sc.id === playScale) ?? SCALES[0];
  const visible = SCALES.filter((sc) => !hidden.includes(sc.id));
  const runs = useHistory((h) => h.runs);
  const best = useMemo(() => bestByExercise(runs), [runs]);

  return (
    <section className="card">
      <div className="row between">
        <span className="label">Exercise</span>
        {!scale.pattern && (
          <div className="seg">
            {(
              [
                ['up', 'Up'],
                ['down', 'Down'],
                ['upDown', 'Up-down'],
              ] as [Direction, string][]
            ).map(([d, name]) => (
              <button key={d} className={playDirection === d ? 'on' : ''} onClick={() => set({ playDirection: d })}>
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="chips" style={{ marginTop: 8 }}>
        {visible
          .filter((sc) => !sc.pattern)
          .map((sc) => (
            <ExerciseChip key={sc.id} sc={sc} on={sc.id === scale.id} stars={best.get(sc.id)?.stars ?? 0} onClick={() => set({ playScale: sc.id })} />
          ))}
      </div>
      {visible.some((sc) => sc.pattern) && (
        <>
          <div className="label" style={{ marginTop: 12 }}>
            Patterns
          </div>
          <div className="chips" style={{ marginTop: 6 }}>
            {visible
              .filter((sc) => sc.pattern)
              .map((sc) => (
                <ExerciseChip key={sc.id} sc={sc} on={sc.id === scale.id} stars={best.get(sc.id)?.stars ?? 0} onClick={() => set({ playScale: sc.id })} />
              ))}
          </div>
        </>
      )}
    </section>
  );
}

/** Chip: name plus the degree pattern (1 2 3 4 5) so it matches how exercises are described online. */
function ExerciseChip({ sc, on, stars, onClick }: { sc: ScaleDef; on: boolean; stars: number; onClick: () => void }) {
  return (
    <button className={`chip${on ? ' on' : ''}`} onClick={onClick} style={{ height: 'auto', padding: '5px 10px', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 12 }}>
        {sc.pattern ? sc.short : sc.name}
        {stars > 0 && (
          <span style={{ color: 'var(--accent)', marginLeft: 5, fontSize: 10 }} title="Best result">
            {'★'.repeat(stars)}
          </span>
        )}
      </span>
      <span className="mono" style={{ fontSize: 10, opacity: 0.75, fontWeight: 500 }}>
        {sc.pattern ? sc.name : degreeString(sc)}
      </span>
    </button>
  );
}
