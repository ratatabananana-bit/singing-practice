import { useCallback, useEffect, useState } from 'react';
import { useStudio, takePlayer } from '../../state/studioStore';
import { Waveform } from '../../components/Waveform';
import { formatTime } from '../../music/notes';
import type { TakeRecord } from '../../storage/db';

export function TakesList() {
  const takes = useStudio((s) => s.takes);
  return (
    <section className="card">
      <div className="row between">
        <span className="label">Takes</span>
        <span className="dim" style={{ fontSize: 11 }}>
          last 5 kept
        </span>
      </div>
      {takes.length === 0 ? (
        <div className="empty">Record a take to see it here.</div>
      ) : (
        <div className="list" style={{ marginTop: 8 }}>
          {takes.map((t) => (
            <TakeCard key={t.id} take={t} />
          ))}
        </div>
      )}
    </section>
  );
}

function TakeCard({ take }: { take: TakeRecord }) {
  const st = useStudio();
  const isLoaded = st.replayTakeId === take.id;
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  useEffect(() => takePlayer.subscribe((s) => setPlaying(isLoaded && s.playing)), [isLoaded]);
  useEffect(() => {
    if (isLoaded) takePlayer.setLoop(loop, 0, take.duration);
  }, [isLoaded, loop, take.duration]);

  const progress = useCallback(() => (isLoaded ? takePlayer.estimatePosition() / Math.max(0.001, take.duration) : 0), [isLoaded, take.duration]);

  const toggle = async () => {
    if (playing) takePlayer.pause();
    else await st.playTake(take.id);
  };
  const seek = async (frac: number) => {
    if (!isLoaded) await st.playTake(take.id);
    takePlayer.seek(frac * take.duration);
  };

  return (
    <div className={`card inner${isLoaded ? ' on' : ''}`} style={{ padding: 8, borderColor: isLoaded ? 'var(--accent)' : undefined }}>
      <div className="row between">
        <div className="row">
          <span style={{ fontWeight: 700, fontSize: 13 }}>Take {take.number}</span>
          <span className="pill sm ghost mono">{formatTime(take.duration)}</span>
          <span className="dim" style={{ fontSize: 11 }}>
            {new Date(take.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="row">
          <button className={`chip sm${loop ? ' on' : ''}`} onClick={() => setLoop((l) => !l)} title="Loop take">
            ∞
          </button>
          <button className="chip sm" style={{ color: 'var(--bad)' }} onClick={() => void st.deleteTake(take.id)} title="Delete">
            ✕
          </button>
        </div>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className={`btn round${playing ? '' : ' primary'}`} style={{ width: 38, height: 38 }} onClick={() => void toggle()} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="grow">
          <Waveform summary={take.wave} progress={progress} onSeek={(f) => void seek(f)} />
        </div>
      </div>
    </div>
  );
}
