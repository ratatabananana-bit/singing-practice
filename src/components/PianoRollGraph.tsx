import { useEffect, useRef } from 'react';
import { historyLength, historyIndex, times, midis } from '../state/pitchHistory';
import { isSharp, noteLabel, noteName, octaveOf } from '../music/notes';
import { useSettings } from '../state/settings';
import { smoothTrace } from './traceSmooth';

export interface ReplaySource {
  /** [time, midi] pairs; midi 0 = silent. */
  trace: Float32Array;
  /** Current playback position in seconds. */
  position: () => number;
  duration: number;
}

export interface ReferenceSource {
  /** [time, midi] pairs relative to the take start. */
  trace: Float32Array;
  /** Track position when the take started. */
  trackStart: number;
  /** Current track position and playback speed. */
  trackPos: () => number;
  trackSpeed: () => number;
  playing: () => boolean;
}

export interface PianoRollProps {
  /** px per second scroll speed. */
  speed: number;
  /** A starred take drawn faint under the live trace, aligned to the backing track. */
  reference?: ReferenceSource | null;
  /** When set, draw this take's trace synced to playback instead of the live mic. */
  replay?: ReplaySource | null;
  /** Current audio time (live mode). */
  now: () => number;
  height?: number;
}

const ROWS_EACH_SIDE = 9;
const CENTER_WINDOW_SEC = 4;
const HELD_MIN_SEC = 0.35;
const TIMELINE_H = 16;
const LABEL_W = 34;

/**
 * Piano-roll pitch graph: one row per semitone, trace scrolling right-to-left,
 * held-note bars, timeline on top with a "now" cursor. Auto-centers smoothly.
 */
export function PianoRollGraph({ speed, replay = null, reference = null, now, height = 300 }: PianoRollProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const centerRef = useRef(60);
  const props = useRef({ speed, replay, reference, now });
  props.current = { speed, replay, reference, now };

  useEffect(() => {
    const cv = ref.current!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { speed, replay, reference, now } = props.current;
      const smoothing = useSettings.getState().pitch.graphSmoothing;
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

      // ---- gather points: arrays of (t, midi) oldest→newest within the visible window
      const nowX = w - 36;
      const windowSec = nowX / speed;
      const tNow = replay ? replay.position() : now();
      const tMin = tNow - windowSec;
      const pts: { t: number; m: number }[] = [];
      if (replay) {
        const tr = replay.trace;
        for (let i = 0; i < tr.length; i += 2) {
          const t = tr[i];
          if (t < tMin - 0.2) continue;
          if (t > tNow + 0.05) break;
          pts.push({ t, m: tr[i + 1] });
        }
      } else {
        const n = historyLength();
        for (let i = n - 1; i >= 0; i--) {
          const idx = historyIndex(i);
          const t = times[idx];
          if (t < tMin - 0.2) continue;
          pts.push({ t, m: midis[idx] });
        }
      }

      // ---- auto-center: ease toward the middle of the notes sung in the last few seconds
      // (not the latest frame), so leaps and glitches do not swing the view around.
      let latest = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        if (p.m <= 0) continue;
        if (latest === 0) latest = p.m;
        if (tNow - p.t > CENTER_WINDOW_SEC) break;
        if (p.m < lo) lo = p.m;
        if (p.m > hi) hi = p.m;
      }
      if (latest > 0) {
        const mid = lo <= hi ? (lo + hi) / 2 : latest;
        // keep the latest note inside the view even if the phrase range is wide
        const want = Math.max(latest - (ROWS_EACH_SIDE - 1), Math.min(latest + (ROWS_EACH_SIDE - 1), mid));
        centerRef.current += (want - centerRef.current) * 0.06;
      }
      const center = centerRef.current;
      const rows = ROWS_EACH_SIDE * 2 + 1;
      const graphH = h - TIMELINE_H;
      const rowH = graphH / rows;
      const yOfMidi = (m: number) => TIMELINE_H + graphH / 2 - (m - center) * rowH;
      const xOfT = (t: number) => nowX - (tNow - t) * speed;

      // ---- rows
      const topMidi = Math.ceil(center + ROWS_EACH_SIDE + 1);
      const botMidi = Math.floor(center - ROWS_EACH_SIDE - 1);
      const curRow = latest > 0 ? Math.round(latest) : -1;
      g.font = '10px ui-monospace, monospace';
      g.textBaseline = 'middle';
      for (let m = botMidi; m <= topMidi; m++) {
        const yc = yOfMidi(m);
        const y0 = yc - rowH / 2;
        if (y0 + rowH < TIMELINE_H || y0 > h) continue;
        const oct = octaveOf(m);
        g.fillStyle = oct % 2 === 0 ? '#0e0e11' : '#121216';
        if (m === curRow) g.fillStyle = 'rgba(245,197,66,0.10)';
        g.fillRect(0, y0, w, rowH);
        g.strokeStyle = '#1d1d22';
        g.beginPath();
        g.moveTo(0, y0);
        g.lineTo(w, y0);
        g.stroke();
      }
      // clip graph area
      g.save();
      g.beginPath();
      g.rect(0, TIMELINE_H, w, graphH);
      g.clip();

      // ---- held-note bars
      let runStart = -1;
      let runMidi = 0;
      let runEnd = 0;
      const flush = () => {
        if (runStart >= 0 && runEnd - runStart >= HELD_MIN_SEC) {
          const y = yOfMidi(runMidi);
          g.fillStyle = 'rgba(245,197,66,0.35)';
          g.fillRect(xOfT(runStart), y - rowH / 2 + 2, Math.max(2, (runEnd - runStart) * speed), rowH - 4);
        }
        runStart = -1;
      };
      for (const p of pts) {
        if (p.m > 0 && runStart >= 0 && Math.abs(p.m - runMidi) <= 0.5 && p.t - runEnd < 0.15) {
          runEnd = p.t;
        } else {
          flush();
          if (p.m > 0) {
            runStart = p.t;
            runEnd = p.t;
            runMidi = Math.round(p.m);
          }
        }
      }
      flush();

      // ---- reference take (faint), mapped from track time to screen time
      if (!replay && reference && reference.playing()) {
        const pos = reference.trackPos();
        const spd = Math.max(0.1, reference.trackSpeed());
        const tr = reference.trace;
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(245,197,66,0.35)';
        g.beginPath();
        let pen = false;
        let lastT = 0;
        for (let i = 0; i < tr.length; i += 2) {
          const trackT = reference.trackStart + tr[i];
          const t = tNow - (pos - trackT) / spd;
          if (t < tMin) continue;
          if (t > tNow + 0.05) break;
          const m = tr[i + 1];
          if (m <= 0 || t - lastT > 0.15) pen = false;
          if (m <= 0) continue;
          const x = xOfT(t);
          const y = yOfMidi(m);
          if (!pen) {
            g.moveTo(x, y);
            pen = true;
          } else g.lineTo(x, y);
          lastT = t;
        }
        g.stroke();
      }

      // ---- trace (display smoothing; raw values stay untouched for tuning)
      const sm = smoothTrace(
        pts.map((p) => p.m),
        smoothing,
      );
      g.lineWidth = 2.2;
      g.strokeStyle = replay ? '#7dd3fc' : '#4ade80';
      g.lineCap = 'round';
      g.lineJoin = 'round';
      let penDown = false;
      let lastT = 0;
      let px = 0;
      let py = 0;
      g.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const m = sm[i];
        if (m <= 0 || p.t - lastT > 0.15) penDown = false;
        if (m <= 0) continue;
        const x = xOfT(p.t);
        const y = yOfMidi(m);
        if (!penDown) {
          g.moveTo(x, y);
          penDown = true;
        } else if (smoothing === 3) {
          // Notes: step line along the semitone lane
          g.lineTo(x, py);
          g.lineTo(x, y);
        } else if (smoothing > 0) {
          // curve through midpoints for a continuous line
          g.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        } else g.lineTo(x, y);
        px = x;
        py = y;
        lastT = p.t;
      }
      if (penDown && smoothing > 0 && smoothing !== 3) g.lineTo(px, py);
      g.stroke();
      if (smoothing === 3) {
        // faint raw pitch under the lanes so vibrato is still visible
        g.lineWidth = 1;
        g.strokeStyle = replay ? 'rgba(125,211,252,0.35)' : 'rgba(74,222,128,0.35)';
        g.beginPath();
        penDown = false;
        lastT = 0;
        for (const p of pts) {
          if (p.m <= 0 || p.t - lastT > 0.15) penDown = false;
          if (p.m <= 0) continue;
          const x = xOfT(p.t);
          const y = yOfMidi(p.m);
          if (!penDown) {
            g.moveTo(x, y);
            penDown = true;
          } else g.lineTo(x, y);
          lastT = p.t;
        }
        g.stroke();
      }
      g.restore();

      // ---- row labels on top of the trace (solid gutter so the trace never hides them)
      for (let m = botMidi; m <= topMidi; m++) {
        const yc = yOfMidi(m);
        const y0 = yc - rowH / 2;
        if (y0 + rowH < TIMELINE_H || y0 > h) continue;
        const sharp = isSharp(m);
        g.fillStyle = sharp ? '#060607' : m === curRow ? 'rgba(245,197,66,0.16)' : octaveOf(m) % 2 === 0 ? '#0e0e11' : '#121216';
        g.fillRect(0, Math.max(TIMELINE_H, y0), LABEL_W - 6, rowH);
        g.fillStyle = m === curRow ? '#f5c542' : sharp ? '#4a4a52' : noteName(m) === 'C' ? '#9a9aa4' : '#5c5c66';
        g.fillText(noteLabel(m).replace('#', '♯'), 4, yc);
      }
      g.strokeStyle = '#2b2b32';
      g.beginPath();
      g.moveTo(LABEL_W - 6 + 0.5, TIMELINE_H);
      g.lineTo(LABEL_W - 6 + 0.5, h);
      g.stroke();

      // ---- timeline
      g.fillStyle = '#0a0a0c';
      g.fillRect(0, 0, w, TIMELINE_H);
      g.strokeStyle = '#2b2b32';
      g.beginPath();
      g.moveTo(0, TIMELINE_H - 0.5);
      g.lineTo(w, TIMELINE_H - 0.5);
      g.stroke();
      g.fillStyle = '#6b6b76';
      g.font = '9px ui-monospace, monospace';
      const step = windowSec > 20 ? 5 : windowSec > 8 ? 2 : 1;
      const firstTick = Math.ceil(tMin / step) * step;
      for (let t = Math.max(0, firstTick); t <= tNow + 1; t += step) {
        const x = xOfT(t);
        if (x < LABEL_W || x > w) continue;
        g.fillRect(x, TIMELINE_H - 4, 1, 4);
        const sec = Math.max(0, Math.floor(t));
        g.fillText(`${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`, x + 2, 7);
      }
      // now cursor: small triangle
      g.fillStyle = '#f5c542';
      g.beginPath();
      g.moveTo(nowX - 5, 2);
      g.lineTo(nowX + 5, 2);
      g.lineTo(nowX, TIMELINE_H - 2);
      g.closePath();
      g.fill();
      g.fillRect(nowX - 0.5, TIMELINE_H, 1, graphH);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={ref} className="graph grow" style={{ height }} />;
}
