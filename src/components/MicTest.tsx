import { useEffect, useState } from 'react';
import { mic } from '../audio/mic/MicService';
import { getAudioContext } from '../audio/context';
import { usePitchFrame, useMicState } from '../state/pitchStore';
import { noteLabel, freqToNote } from '../music/notes';
import { useSettings } from '../state/settings';

/**
 * Live diagnostics for the microphone path: OS permission, mic state, audio context,
 * level, and what the detector sees. Meant for "the mic doesn't work" reports.
 */
export function MicTest() {
  const { state, error } = useMicState();
  const f = usePitchFrame();
  const silenceDb = useSettings((s) => s.silenceDb);
  const [perm, setPerm] = useState<string>('?');
  const [ctx, setCtx] = useState<{ state: string; rate: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const q = async () => {
      try {
        const p = await navigator.permissions?.query?.({ name: 'microphone' as PermissionName });
        if (alive && p) {
          setPerm(p.state);
          p.onchange = () => alive && setPerm(p.state);
        } else if (alive) setPerm('n/a');
      } catch {
        if (alive) setPerm('n/a');
      }
    };
    void q();
    const t = setInterval(() => {
      const c = getAudioContext();
      setCtx({ state: c.state, rate: c.sampleRate });
    }, 500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const note = f.voiced && f.freq > 0 ? noteLabel(freqToNote(f.freq).midi) : '—';
  const gated = f.db < silenceDb;
  const rows: [string, string, boolean?][] = [
    ['Permission', perm, perm === 'denied'],
    ['Mic', state + (error ? ` · ${error}` : ''), state === 'error'],
    ['Audio', ctx ? `${ctx.state} · ${ctx.rate} Hz` : '—', ctx?.state !== 'running'],
    ['Level', `${Math.round(f.db)} dB${gated ? ` (below gate ${silenceDb} dB)` : ''}`, gated],
    ['Detected', f.voiced ? `${note} · ${f.freq.toFixed(1)} Hz · clarity ${f.clarity.toFixed(2)}` : `nothing · clarity ${f.clarity.toFixed(2)}`, false],
    ['Where', `${navigator.userAgent.includes('wv') ? 'Android app' : 'browser'} · ${innerWidth}×${innerHeight} css px · dpr ${devicePixelRatio}`, false],
  ];
  return (
    <div className="list">
      {rows.map(([k, v, bad]) => (
        <div key={k} className="list-item" style={{ fontSize: 12, minHeight: 36 }}>
          <span className="muted" style={{ width: 80 }}>
            {k}
          </span>
          <span className="mono grow" style={{ color: bad ? 'var(--bad)' : 'var(--text)', overflowWrap: 'anywhere' }}>
            {v}
          </span>
        </div>
      ))}
      <div className="row" style={{ marginTop: 4 }}>
        <button className="btn sm" onClick={() => mic.toggle()}>
          {state === 'running' ? 'Pause mic' : 'Start mic'}
        </button>
        <button
          className="btn sm"
          onClick={() => {
            mic.stop();
            void mic.start();
          }}
        >
          Restart mic
        </button>
      </div>
      <div className="desc">Sing a note: Level should rise well above the gate and Detected should show the note. If Permission says denied, allow the microphone for this app in Android Settings → Apps.</div>
    </div>
  );
}
