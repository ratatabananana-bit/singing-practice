import { useEffect, useRef } from 'react';
import type { Bookmark, Section } from '../storage/db';
import { SECTION_COLORS } from './SectionEditor';

/**
 * Track timeline with numbered markers (sorted by time), the active loop span shaded,
 * and a playhead. Tap the bar to seek; drag a marker to move it.
 */
export function LoopTimeline({
  duration,
  markers,
  loopA,
  loopB,
  pending,
  loopOn,
  position,
  onSeek,
  onMoveMarker,
  onSelectMarker,
  sections = [],
  activeSection = null,
  onSelectSection,
  grid = null,
  beatsPerBar = 4,
}: {
  duration: number;
  /** Sorted by time. */
  markers: Bookmark[];
  loopA: number | null;
  loopB: number | null;
  /** Marker index tapped as the start of a new range, waiting for the end marker. */
  pending: number | null;
  loopOn: boolean;
  /** Current position in seconds (called every frame). */
  position: () => number;
  onSeek: (sec: number) => void;
  onMoveMarker: (id: string, sec: number) => void;
  onSelectMarker: (index: number) => void;
  sections?: Section[];
  activeSection?: string | null;
  onSelectSection?: (id: string) => void;
  grid?: { bpm: number; offset: number } | null;
  beatsPerBar?: number;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; moved: boolean; index: number } | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (head.current && duration > 0) head.current.style.left = `${(position() / duration) * 100}%`;
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [position, duration]);

  const secAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };
  const pct = (sec: number) => (duration > 0 ? (sec / duration) * 100 : 0);

  const a = loopA !== null ? markers[loopA] : undefined;
  const b = loopB !== null ? markers[loopB] : undefined;

  return (
    <div
      className="timeline"
      ref={bar}
      onPointerDown={(e) => {
        if (drag.current) return;
        onSeek(secAt(e.clientX));
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        d.moved = true;
        onMoveMarker(d.id, secAt(e.clientX));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) onSelectMarker(d.index);
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      }}
      onPointerCancel={() => (drag.current = null)}
    >
      <div className="timeline-track" />
      {grid && duration > 0 && (
        <>
          <div
            className="timeline-beats"
            style={{
              backgroundSize: `${((60 / grid.bpm) / duration) * 100}% 100%`,
              backgroundPosition: `${(grid.offset / duration) * 100}% 0`,
            }}
          />
          <div
            className="timeline-bars"
            style={{
              backgroundSize: `${(((60 / grid.bpm) * beatsPerBar) / duration) * 100}% 100%`,
              backgroundPosition: `${(grid.offset / duration) * 100}% 0`,
            }}
          />
        </>
      )}
      {a && b && (
        <div className={`timeline-loop${loopOn ? ' on' : ''}`} style={{ left: `${pct(a.time)}%`, width: `${pct(b.time) - pct(a.time)}%` }} />
      )}
      {sections.map((sec) => (
        <button
          key={sec.id}
          className={`timeline-section${sec.id === activeSection ? ' on' : ''}`}
          style={{ left: `${pct(sec.start)}%`, width: `${Math.max(1, pct(sec.end) - pct(sec.start))}%`, background: SECTION_COLORS[sec.color] }}
          onPointerDown={(e) => {
            e.stopPropagation();
            onSelectSection?.(sec.id);
          }}
          title={sec.name}
        >
          {sec.name}
        </button>
      ))}
      <div className="timeline-head" ref={head} />
      {markers.map((m, i) => (
        <button
          key={m.id}
          className={`timeline-pin${i === loopA || i === loopB ? ' on' : ''}${i === pending ? ' pending' : ''}`}
          style={{ left: `${pct(m.time)}%` }}
          onPointerDown={(e) => {
            e.stopPropagation();
            drag.current = { id: m.id, moved: false, index: i };
            bar.current!.setPointerCapture(e.pointerId);
          }}
          title={m.name}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}
