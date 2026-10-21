import { useEffect, useRef } from 'react';
import type { ScheduledNote } from '../audio/sequencer';
import type { NoteScore } from '../music/scoring';
import { historyIndex, historyLength, midis, times } from '../state/pitchHistory';
import { noteLabel } from '../music/notes';
import { useSettings } from '../state/settings';
import { smoothTrace } from './traceSmooth';

export interface RunState {
  notes: ScheduledNote[];
  scores: (NoteScore | null)[];
  /** Latency (s) to shift sung frames back by when aligning to targets. */
  latency: number;
  /** Set once the run's singer pass has started (audio time), 0 = idle. */
  start: number;
  end: number;
  listenPass: boolean;
}

/**
 * One run on a fixed time axis: target blocks (one per note), the sung pitch over them,
 * blocks coloured by score once each note ends. The Singing-Carrots / Erol style view.
 */
export function RunView({ run, now, height = 120 }: { run: React.RefObject<RunState>; now: () => number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const r = run.current!;
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
      const LABEL = 34;
      if (!r.notes.length) {
        g.fillStyle = '#5c5c66';
        g.font = '11px ui-monospace, monospace';
        g.textAlign = 'center';
        g.fillText('Targets show here when you play', w / 2, h / 2 + 4);
        g.textAlign = 'left';
        return;
      }
      const t0 = r.notes[0].time;
      const t1 = r.notes[r.notes.length - 1].time + r.notes[r.notes.length - 1].dur;
      const span = Math.max(0.5, t1 - t0);
      const xOf = (t: number) => LABEL + ((t - t0) / span) * (w - LABEL - 6);
      let lo = Infinity;
      let hi = -Infinity;
      for (const n of r.notes) {
        lo = Math.min(lo, n.midi);
        hi = Math.max(hi, n.midi);
      }
      lo -= 2;
      hi += 2;
      const rowH = h / (hi - lo + 1);
      const yOf = (m: number) => h - (m - lo + 0.5) * rowH;

      // rows + labels
      g.font = '10px ui-monospace, monospace';
      g.textBaseline = 'middle';
      for (let m = lo; m <= hi; m++) {
        const y = yOf(m);
        g.fillStyle = m % 2 === 0 ? '#0e0e11' : '#111115';
        g.fillRect(0, y - rowH / 2, w, rowH);
        g.fillStyle = '#4a4a52';
        g.fillText(noteLabel(m), 3, y);
      }

      // target blocks
      const tNow = now();
      for (let i = 0; i < r.notes.length; i++) {
        const n = r.notes[i];
        const sc = r.scores[i];
        const x0 = xOf(n.time);
        const x1 = xOf(n.time + n.dur);
        const y = yOf(n.midi);
        let fill = 'rgba(245,197,66,0.28)';
        if (sc) fill = sc.hit ? 'rgba(74,222,128,0.45)' : Number.isNaN(sc.cents) ? 'rgba(90,90,100,0.35)' : 'rgba(239,68,68,0.4)';
        else if (tNow >= n.time && tNow < n.time + n.dur) fill = 'rgba(245,197,66,0.55)';
        g.fillStyle = fill;
        g.fillRect(x0, y - rowH / 2 + 1, Math.max(2, x1 - x0 - 1), rowH - 2);
        if (sc && !Number.isNaN(sc.cents)) {
          g.fillStyle = sc.hit ? '#4ade80' : '#f59e0b';
          g.textAlign = 'center';
          g.fillText(`${sc.cents >= 0 ? '+' : '−'}${Math.abs(Math.round(sc.cents))}`, (x0 + x1) / 2, y - rowH / 2 - 6 < 6 ? y + rowH / 2 + 6 : y - rowH / 2 - 6);
          g.textAlign = 'left';
        }
      }

      // sung trace (shifted back by latency so it lines up with what was heard)
      const n = historyLength();
      const pts: { t: number; m: number }[] = [];
      for (let i = n - 1; i >= 0; i--) {
        const idx = historyIndex(i);
        const t = times[idx] - r.latency;
        if (t < t0 - 0.05) continue;
        if (t > t1 + 0.3) break;
        pts.push({ t, m: midis[idx] });
      }
      const sm = smoothTrace(
        pts.map((p) => p.m),
        Math.min(2, useSettings.getState().pitch.graphSmoothing),
      );
      g.strokeStyle = r.listenPass ? 'rgba(125,211,252,0.9)' : '#e8e8ec';
      g.lineWidth = 2;
      g.lineJoin = 'round';
      g.beginPath();
      let pen = false;
      let lastT = 0;
      for (let i = 0; i < pts.length; i++) {
        const m = sm[i];
        if (m <= 0 || pts[i].t - lastT > 0.15) pen = false;
        if (m <= 0) continue;
        const x = xOf(pts[i].t);
        const y = yOf(Math.max(lo - 0.5, Math.min(hi + 0.5, m)));
        if (!pen) {
          g.moveTo(x, y);
          pen = true;
        } else g.lineTo(x, y);
        lastT = pts[i].t;
      }
      g.stroke();

      // now cursor
      if (tNow >= t0 && tNow <= t1 + 0.1) {
        g.fillStyle = '#f5c542';
        g.fillRect(xOf(tNow) - 0.5, 0, 1, h);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [run, now]);

  return <canvas ref={ref} className="graph" style={{ height, width: '100%' }} />;
}
