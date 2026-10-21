import { useEffect, useRef } from 'react';

/**
 * Filled min/max waveform with a softer RMS envelope, plus a playhead.
 * `summary` = [min,max,rms] triples per column (see waveformSummary).
 */
export function Waveform({
  summary,
  progress,
  onSeek,
  height = 48,
}: {
  summary: Float32Array;
  /** 0..1 or a function returning it (for rAF-driven playhead). */
  progress: () => number;
  onSeek?: (frac: number) => void;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
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
      const bins = summary.length / 3;
      const mid = h / 2;
      const amp = h / 2 - 2;
      // min/max body
      g.fillStyle = '#3d3d46';
      g.beginPath();
      for (let b = 0; b < bins; b++) {
        const x = (b / bins) * w;
        g.lineTo(x, mid - summary[b * 3 + 1] * amp);
      }
      for (let b = bins - 1; b >= 0; b--) {
        const x = (b / bins) * w;
        g.lineTo(x, mid - summary[b * 3] * amp);
      }
      g.closePath();
      g.fill();
      // rms envelope
      g.fillStyle = '#9a9aa4';
      g.beginPath();
      for (let b = 0; b < bins; b++) {
        const x = (b / bins) * w;
        g.lineTo(x, mid - summary[b * 3 + 2] * amp * 1.4);
      }
      for (let b = bins - 1; b >= 0; b--) {
        const x = (b / bins) * w;
        g.lineTo(x, mid + summary[b * 3 + 2] * amp * 1.4);
      }
      g.closePath();
      g.fill();
      // playhead
      const p = progress();
      if (p > 0) {
        g.fillStyle = 'rgba(245,197,66,0.18)';
        g.fillRect(0, 0, p * w, h);
        g.fillStyle = '#f5c542';
        g.fillRect(p * w - 1, 0, 2, h);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [summary, progress]);

  return (
    <canvas
      ref={ref}
      className="wave"
      style={{ height }}
      onPointerDown={(e) => {
        if (!onSeek) return;
        const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
        onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
      }}
    />
  );
}
