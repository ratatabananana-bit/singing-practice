import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio, takePlayer } from '../../state/studioStore';
import { useSettings, totalLatencyMs } from '../../state/settings';
import { mic } from '../../audio/mic/MicService';
import { recorder } from '../../audio/recorder/Recorder';
import { denoise } from '../../audio/dsp/denoise';
import { encodeWav, waveformSummary } from '../../audio/dsp/wav';
import { getAudioContext } from '../../audio/context';
import { centsOff } from '../../music/notes';
import { PianoRollGraph, type ReplaySource } from '../../components/PianoRollGraph';
import { LoudnessMeter } from '../../components/LoudnessMeter';
import { NoteSlots } from '../../components/NoteSlots';
import { Switch } from '../../components/Switch';
import { useDisplayNote, useMicState } from '../../state/pitchStore';
import { usePitchSelector } from '../../state/pitchStore';
import { uid } from '../../storage/db';

export function MasterCard() {
  const st = useStudio();
  const settings = useSettings();
  const { state: micState } = useMicState();
  const [takePlaying, setTakePlaying] = useState(false);
  useEffect(() => takePlayer.subscribe((s) => setTakePlaying(s.playing)), []);

  const replayTake = st.replayTakeId ? st.takes.find((t) => t.id === st.replayTakeId) : null;
  const replay = useMemo<ReplaySource | null>(
    () => (replayTake ? { trace: replayTake.trace, position: () => takePlayer.estimatePosition(), duration: replayTake.duration } : null),
    [replayTake],
  );

  const status = st.recording ? 'RECORDING' : replayTake && takePlaying ? 'REPLAY' : micState === 'running' ? 'LIVE' : micState === 'starting' ? '…' : 'PAUSED';
  const statusCls = st.recording ? 'bad' : status === 'REPLAY' ? 'accent' : status === 'LIVE' ? 'good' : 'ghost';

  const toggleRecord = async () => {
    if (st.recording) {
      useStudio.setState({ recording: false, processing: true });
      try {
        const rec = await recorder.stop();
        let pcm = rec.pcm;
        if (settings.denoise) pcm = denoise(pcm);
        const wav = encodeWav([pcm], rec.sampleRate);
        const number = (st.takes[0]?.number ?? 0) + 1;
        const take = {
          id: uid(),
          number,
          createdAt: Date.now(),
          duration: pcm.length / rec.sampleRate,
          sampleRate: rec.sampleRate,
          wav,
          trace: rec.trace,
          wave: waveformSummary(pcm, 160),
        };
        await st.addTake(take);
        if (settings.autoPlayLastTake) await useStudio.getState().playTake(take.id);
      } catch (e) {
        st.setError(e instanceof Error ? e.message : String(e));
      } finally {
        useStudio.setState({ processing: false });
      }
    } else {
      if (replayTake) st.stopTake();
      await recorder.start(totalLatencyMs(settings) / 1000);
      useStudio.setState({ recording: true });
    }
  };

  return (
    <section className="card">
      <div className="row between">
        <div className="row">
          <span className="label">Master</span>
          <CompactTuner />
        </div>
        <button className={`pill sm ${statusCls}`} onClick={() => (status === 'REPLAY' ? takePlayer.pause() : mic.toggle())}>
          {status}
        </button>
      </div>
      <div className="row" style={{ marginTop: 8, alignItems: 'stretch' }}>
        <PianoRollGraph speed={settings.graphSpeed} replay={takePlaying ? replay : null} now={() => getAudioContext().currentTime} height={300} />
        <MasterMeter />
      </div>
      <div className="divider" />
      <div className="row between">
        <div className="row">
          <button className={`record-btn${st.recording ? ' on' : ''}`} onClick={() => void toggleRecord()} disabled={st.processing} aria-label="Record" />
          <div>
            <div className="label" style={{ color: st.recording ? 'var(--bad)' : undefined }}>
              {st.processing ? 'Saving…' : st.recording ? 'Recording' : 'Ready'}
            </div>
            <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>
              {st.recording ? 'Tap to stop' : 'Tap to record a take'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          <Switch on={settings.autoPlayLastTake} onChange={(v) => settings.set({ autoPlayLastTake: v })} label="Auto-play last take" />
          <Switch on={settings.denoise} onChange={(v) => settings.set({ denoise: v })} label="Denoise" />
        </div>
      </div>
    </section>
  );
}

/** Chromatic tuner with cents readout (fixed slots). */
function CompactTuner() {
  const n = useDisplayNote();
  const cents = n.midi !== null && n.freq > 0 ? Math.round(centsOff(n.freq, n.midi)) : null;
  const cls = cents === null ? 'ghost' : Math.abs(cents) <= 10 ? 'good' : Math.abs(cents) <= 25 ? 'yellow' : 'warn';
  return (
    <span className={`pill sm ${cls}`} style={{ width: 104, justifyContent: 'space-between' }}>
      <NoteSlots midi={n.midi} size={13} />
      <span className="mono" style={{ width: 34, textAlign: 'right', display: 'inline-block' }}>
        {cents === null ? '' : `${cents >= 0 ? '+' : '−'}${Math.abs(cents)}¢`}
      </span>
    </span>
  );
}

/** Loudness meter with peak hold and CLIP badge. */
function MasterMeter() {
  const db = usePitchSelector((f) => Math.round(f.db));
  const peak = usePitchSelector((f) => f.peak);
  const hold = useRef({ peakDb: -120, at: 0, clipAt: 0 });
  const now = performance.now();
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -120;
  if (peakDb >= hold.current.peakDb || now - hold.current.at > 1500) hold.current = { ...hold.current, peakDb, at: now };
  if (peak >= 0.985) hold.current.clipAt = now;
  const clip = now - hold.current.clipAt < 1200;
  return <LoudnessMeter db={db} peak={hold.current.peakDb} clip={clip} height={300} segments={24} />;
}
