import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudio, takePlayer } from '../../state/studioStore';
import { useSettings, totalLatencyMs } from '../../state/settings';
import { mic } from '../../audio/mic/MicService';
import { recorder } from '../../audio/recorder/Recorder';
import { denoise } from '../../audio/dsp/denoise';
import { encodeWav, waveformSummary } from '../../audio/dsp/wav';
import { getAudioContext } from '../../audio/context';
import { centsOff } from '../../music/notes';
import { PianoRollGraph, type ReplaySource, type ReferenceSource } from '../../components/PianoRollGraph';
import { trackPlayer, type PlayerSnapshot } from '../../audio/player/TrackPlayer';
import { loopTimes } from '../../state/loopTaps';
import { sortedMarkers } from '../../storage/sections';
import { instrument } from '../../audio/synth/Instrument';
import { LoudnessMeter } from '../../components/LoudnessMeter';
import { NoteSlots } from '../../components/NoteSlots';
import { useDisplayNote, useMicState } from '../../state/pitchStore';
import { usePitchSelector } from '../../state/pitchStore';
import { uid } from '../../storage/db';
import { useTablet } from '../../state/useTablet';

export function MasterCard() {
  const st = useStudio();
  const settings = useSettings();
  const { state: micState } = useMicState();
  const tablet = useTablet();
  const [takePlaying, setTakePlaying] = useState(false);
  useEffect(() => takePlayer.subscribe((s) => setTakePlaying(s.playing)), []);
  // Track transport mirrored here, so the song can be played / looped while recording.
  const [track, setTrack] = useState<PlayerSnapshot>(trackPlayer.state);
  useEffect(() => trackPlayer.subscribe(setTrack), []);
  const [loopA, loopB] = st.meta ? loopTimes(st.meta, sortedMarkers(st.meta)) : [null, null];
  const canLoop = loopA !== null && loopB !== null && loopB > loopA;

  const replayTake = st.replayTakeId ? st.takes.find((t) => t.id === st.replayTakeId) : null;
  const replay = useMemo<ReplaySource | null>(
    () => (replayTake ? { trace: replayTake.trace, position: () => takePlayer.estimatePosition(), duration: replayTake.duration } : null),
    [replayTake],
  );

  const status = st.countdown > 0 ? String(st.countdown) : st.recording ? 'RECORDING' : replayTake && takePlaying ? 'REPLAY' : micState === 'running' ? 'LIVE' : micState === 'starting' ? '…' : 'PAUSED';
  const statusCls = st.countdown > 0 ? 'accent' : st.recording ? 'bad' : status === 'REPLAY' ? 'accent' : status === 'LIVE' ? 'good' : 'ghost';
  const takeStart = useRef(-1);

  // Starred take = reference trace under the live line while the track plays.
  const starred = st.takes.find((t) => t.starred && t.trackId === st.track?.id && (t.trackStart ?? -1) >= 0);
  const reference = useMemo<ReferenceSource | null>(
    () =>
      starred
        ? {
            trace: starred.trace,
            trackStart: starred.trackStart!,
            trackPos: () => trackPlayer.estimatePosition(),
            trackSpeed: () => trackPlayer.state.speed,
            playing: () => trackPlayer.state.playing,
          }
        : null,
    [starred],
  );

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
          trackStart: takeStart.current,
          trackId: st.track?.id ?? null,
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
      if (st.countdown > 0) return;
      if (settings.countIn) {
        // Four clicks at the song tempo (× speed) when known, else 100 BPM, then record.
        const ctx = getAudioContext();
        const grid = useStudio.getState().meta?.beatGrid;
        const bpm = grid && trackPlayer.state.loaded ? grid.bpm * trackPlayer.state.speed : 100;
        const beat = 60 / bpm;
        const t0 = ctx.currentTime + 0.05;
        for (let i = 0; i < 4; i++) instrument.click(t0 + i * beat, i === 0);
        for (let i = 0; i < 4; i++) setTimeout(() => useStudio.setState({ countdown: 4 - i }), i * beat * 1000);
        await new Promise((r) => setTimeout(r, 4 * beat * 1000));
        useStudio.setState({ countdown: 0 });
      }
      // Recording never starts the track. Only a take sung over a running track is aligned to it.
      takeStart.current = trackPlayer.state.loaded && trackPlayer.state.playing ? trackPlayer.estimatePosition() : -1;
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
        <div className="row" style={{ gap: 6 }}>
          {track.loaded && (
            <>
              <button className={`tool master-tp${track.playing ? ' on' : ''}`} onClick={() => trackPlayer.toggle()} aria-label={track.playing ? 'Pause track' : 'Play track'} title={track.playing ? 'Pause the track' : 'Play the track'}>
                {track.playing ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="5" y="4" width="5" height="16" rx="1" />
                    <rect x="14" y="4" width="5" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M7 4l13 8-13 8z" />
                  </svg>
                )}
              </button>
              <button className={`tool master-tp${canLoop && st.meta?.loopOn ? ' on' : ''}`} disabled={!canLoop} onClick={() => st.toggleLoop()} aria-label={st.meta?.loopOn ? 'Loop on' : 'Loop off'} title={!canLoop ? 'Set A and B in the track card to loop' : st.meta?.loopOn ? 'Looping A–B · tap to play through' : 'Tap to loop A–B'}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17 2l4 4-4 4" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <path d="M7 22l-4-4 4-4" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
              </button>
            </>
          )}
          <button data-mic-toggle className={`pill sm ${statusCls}`} onClick={() => (status === 'REPLAY' ? takePlayer.pause() : mic.toggle())}>
            {status}
          </button>
        </div>
      </div>
      <div className="row" style={{ marginTop: 8, alignItems: 'stretch' }}>
        <PianoRollGraph speed={settings.graphSpeed} replay={takePlaying ? replay : null} reference={reference} now={() => getAudioContext().currentTime} height={tablet ? 380 : 300} />
        <MasterMeter height={tablet ? 380 : 300} />
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
      </div>
      <div className="strip" style={{ marginTop: 10 }}>
        <button className={`pill sm${settings.countIn ? ' accent' : ' ghost'}`} onClick={() => settings.set({ countIn: !settings.countIn })} title="Four clicks before recording">
          Count-in {settings.countIn ? 'on' : 'off'}
        </button>
        <button className={`pill sm${settings.autoPlayLastTake ? ' accent' : ' ghost'}`} onClick={() => settings.set({ autoPlayLastTake: !settings.autoPlayLastTake })}>
          Auto-play take {settings.autoPlayLastTake ? 'on' : 'off'}
        </button>
        <button className={`pill sm${settings.denoise ? ' accent' : ' ghost'}`} onClick={() => settings.set({ denoise: !settings.denoise })} title="Clean background noise after recording">
          Denoise {settings.denoise ? 'on' : 'off'}
        </button>
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
function MasterMeter({ height }: { height: number }) {
  const db = usePitchSelector((f) => Math.round(f.db));
  const peak = usePitchSelector((f) => f.peak);
  const frameTime = usePitchSelector((f) => f.time);
  const { state: micState } = useMicState();
  const hold = useRef({ peakDb: -120, at: 0, clipAt: 0, lastFrame: -1 });
  const now = performance.now();
  const live = micState === 'running';
  // Only a *new* frame from a running mic can arm the clip light; a frozen last frame (mic paused
  // or stopped) must not keep it lit on every render.
  const fresh = live && frameTime !== hold.current.lastFrame;
  hold.current.lastFrame = frameTime;
  const peakDb = live && peak > 0 ? 20 * Math.log10(peak) : -120;
  if (peakDb >= hold.current.peakDb || now - hold.current.at > 1500) hold.current = { ...hold.current, peakDb, at: now };
  if (fresh && peak >= 0.985) hold.current.clipAt = now;
  const clip = live && now - hold.current.clipAt < 1200;
  return <LoudnessMeter db={live ? db : -120} peak={hold.current.peakDb} clip={clip} height={height} segments={24} />;
}
