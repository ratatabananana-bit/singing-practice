import { useState } from 'react';
import { useSettings, DEFAULT_PITCH_DEBUG, type IntroMode, type SoundMode } from '../state/settings';
import { SCALES } from '../music/scales';
import { measureLatency } from '../audio/latency';
import { Switch } from './Switch';
import { MicTest } from './MicTest';

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const [measuring, setMeasuring] = useState(false);
  const [measureMsg, setMeasureMsg] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  const runMeasure = async () => {
    setMeasuring(true);
    setMeasureMsg(null);
    try {
      const ms = await measureLatency();
      if (ms === null) setMeasureMsg('No click heard. Use speakers (not earphones) and turn the volume up.');
      else {
        s.set({ measuredLatencyMs: ms });
        setMeasureMsg(`Measured ${ms} ms round trip.`);
      }
    } catch (e) {
      setMeasureMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setMeasuring(false);
    }
  };

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet">
        <div className="sheet-head">
          <strong>Settings</strong>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          <div className="setting">
            <div className="title">Visible scales</div>
            <div className="chips">
              {SCALES.map((sc) => {
                const hidden = s.hiddenScales.includes(sc.id);
                const lastVisible = !hidden && SCALES.length - s.hiddenScales.length <= 1;
                return (
                  <button key={sc.id} className={`chip sm${hidden ? '' : ' on'}`} disabled={lastVisible} onClick={() => s.toggleScaleHidden(sc.id)}>
                    {sc.pattern ? sc.short : sc.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="setting">
            <div className="title">Sound</div>
            <div className="seg">
              {(
                [
                  ['piano', 'Piano'],
                  ['vocal', 'Vocal'],
                  ['flute', 'Flute'],
                ] as [SoundMode, string][]
              ).map(([id, name]) => (
                <button key={id} className={s.sound === id ? 'on' : ''} onClick={() => s.set({ sound: id })}>
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="setting">
            <div className="title">Scale intro</div>
            <div className="desc">Cue the key before each run (and before each auto-advanced key).</div>
            <div className="seg">
              {(
                [
                  ['off', 'Off'],
                  ['15', '1–5'],
                  ['135', '1–3–5'],
                ] as [IntroMode, string][]
              ).map(([id, name]) => (
                <button key={id} className={s.intro === id ? 'on' : ''} onClick={() => s.set({ intro: id })}>
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="setting">
            <div className="title">Tuner</div>
            <Slider label="In-tune tolerance" value={s.toleranceCents} min={5} max={30} step={5} unit="¢" onChange={(v) => s.set({ toleranceCents: v })} />
            <div className="desc">Tune tab counts a note in tune within this; the Play tab pill allows 10¢ more. Most tuner apps default to 10–20¢.</div>
            <Slider label="Hold duration" value={s.holdSeconds} min={0.5} max={5} step={0.1} unit="s" onChange={(v) => s.set({ holdSeconds: v })} />
            <Slider label="Silence gate" value={s.silenceDb} min={-80} max={-20} step={1} unit="dB" onChange={(v) => s.set({ silenceDb: v })} />
            <div className="desc">Below the gate, input counts as silence everywhere (tuner, graphs, takes).</div>
            <Slider label="Graph speed (Studio)" value={s.graphSpeed} min={20} max={200} step={5} unit="px/s" onChange={(v) => s.set({ graphSpeed: v })} />
            <div className="row between" style={{ fontSize: 12 }}>
              <span className="muted">Graph line</span>
              <div className="seg">
                {(
                  [
                    [0, 'Raw'],
                    [1, 'Steady'],
                    [2, 'Smooth'],
                    [3, 'Notes'],
                  ] as [number, string][]
                ).map(([v, name]) => (
                  <button key={v} className={s.pitch.graphSmoothing === v ? 'on' : ''} onClick={() => s.setPitch({ graphSmoothing: v })}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <div className="desc">Display only. Steady drops single-frame glitches, Smooth also rounds the line, Notes snaps to semitone lanes like a karaoke game. Tuning always uses raw pitch.</div>
          </div>

          <div className="setting">
            <div className="title">Input latency</div>
            <div className="desc">Plays a click and listens for it. Needs speakers, not earphones. Used to line up recorded pitch with what you heard.</div>
            <div className="row">
              <button className="btn sm" onClick={() => void runMeasure()} disabled={measuring}>
                {measuring ? 'Listening…' : 'Measure'}
              </button>
              <span className="mono muted" style={{ fontSize: 12 }}>
                {s.measuredLatencyMs === null ? 'not measured' : `${s.measuredLatencyMs} ms`}
              </span>
              <button className="chip sm" onClick={() => s.set({ measuredLatencyMs: null, latencyOffsetMs: 0 })}>
                reset
              </button>
            </div>
            {measureMsg && <div className="desc">{measureMsg}</div>}
            <Slider label="Manual offset" value={s.latencyOffsetMs} min={-200} max={400} step={5} unit="ms" onChange={(v) => s.set({ latencyOffsetMs: v })} />
          </div>

          <div className="setting">
            <div className="title">YouTube helper</div>
            <div className="desc">Runs on your PC (npm run server). Leave empty on the PC; on a phone enter the PC address, e.g. http://192.168.0.79:5174</div>
            <input type="text" inputMode="url" placeholder="http://<pc-ip>:5174" value={s.ytHelperUrl} onChange={(e) => s.set({ ytHelperUrl: e.target.value })} style={{ minHeight: 40 }} />
          </div>

          <div className="setting">
            <div className="title">Mic test</div>
            <MicTest />
          </div>

          <div className="setting">
            <button className="row between" style={{ width: '100%' }} onClick={() => setDebugOpen((o) => !o)}>
              <span className="title">Debug: pitch detection</span>
              <span className="muted">{debugOpen ? '▴' : '▾'}</span>
            </button>
            {debugOpen && (
              <>
                <Switch on={s.pitch.enabled} onChange={(v) => s.setPitch({ enabled: v })} label="Detection enabled" />
                <Switch on={s.pitch.median} onChange={(v) => s.setPitch({ median: v })} label="Median-of-3 on frequency" />
                <Slider label="Clarity to start a note" value={s.pitch.clarityOn} min={0.5} max={0.99} step={0.01} onChange={(v) => s.setPitch({ clarityOn: v, clarityOff: Math.min(s.pitch.clarityOff, v) })} />
                <Slider label="Clarity to stay in a note" value={s.pitch.clarityOff} min={0.3} max={0.99} step={0.01} onChange={(v) => s.setPitch({ clarityOff: Math.min(v, s.pitch.clarityOn) })} />
                <Slider label="Hold frames (dropout bridge)" value={s.pitch.holdFrames} min={0} max={6} step={1} onChange={(v) => s.setPitch({ holdFrames: v })} />
                <Slider label="Min frequency" value={s.pitch.minFreq} min={30} max={200} step={1} unit="Hz" onChange={(v) => s.setPitch({ minFreq: v })} />
                <Slider label="Max frequency" value={s.pitch.maxFreq} min={400} max={2000} step={10} unit="Hz" onChange={(v) => s.setPitch({ maxFreq: v })} />
                <Slider label="MPM peak threshold k" value={s.pitch.k} min={0.5} max={0.99} step={0.01} onChange={(v) => s.setPitch({ k: v })} />
                <Slider label="Analysis hop" value={s.pitch.hopMs} min={20} max={100} step={5} unit="ms" onChange={(v) => s.setPitch({ hopMs: v })} />
                <Slider label="Tune tab smoothing (frames)" value={s.pitch.tuneSmoothing} min={1} max={8} step={1} onChange={(v) => s.setPitch({ tuneSmoothing: v })} />
                <button className="btn sm" onClick={() => s.setPitch({ ...DEFAULT_PITCH_DEBUG })}>
                  Reset to defaults
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="row between" style={{ fontSize: 12 }}>
        <span className="muted">{label}</span>
        <span className="mono">
          {Number.isInteger(step) ? value : value.toFixed(step < 0.1 ? 2 : 1)}
          {unit && ` ${unit}`}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}
