import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Bookmark, Section } from '../storage/db';
import { SECTION_COLORS, sectionLanes, tint } from '../storage/sections';
import { isDownbeat, type BeatGrid } from '../audio/dsp/beats';

/** Two taps on the bar within this window = zoom toggle. */
const DOUBLE_TAP_MS = 350;
/** Smallest visible window in seconds (max zoom). */
const MIN_VIEW_SEC = 1;
/** Pointer travel before a press on the bar counts as a scrub instead of a tap. */
const SCRUB_SLOP_PX = 6;
/** Zoom step for the − / + buttons (view length × this). */
const ZOOM_STEP = 0.6;

export interface LoopTimelineHandle {
  zoomIn(): void;
  zoomOut(): void;
  reset(): void;
}

/**
 * Track timeline after the Studio 3a design: numbered pins (A / B show their letter) on stems
 * above the track bar, one row, well clear of the bar; the loop as a yellow bar on the track; a
 * ruler of beat / bar ticks with bar numbers; a row of section bands with names; a white playhead
 * with a dot. When zoomed, an overview strip below shows the window.
 *
 * Gestures: tap the bar = seek · press and drag the bar = scrub (playhead follows the finger) ·
 * pinch = zoom · double-tap the bar = zoom in 4× there / back · ctrl+wheel = zoom · wheel = pan ·
 * drag the overview strip = pan · drag a pin = move the marker · tap a pin = loop logic
 * (TrackCard) · tap a section band = loop it.
 */
export const LoopTimeline = forwardRef<
  LoopTimelineHandle,
  {
    duration: number;
    /** Sorted by time. */
    markers: Bookmark[];
    /** Picked A / B marker indices (either may be null). */
    aIdx: number | null;
    bIdx: number | null;
    /** Temporary A / B in seconds (looping a section whose bound has no marker); drawn light blue, not markers. */
    tempA?: number | null;
    tempB?: number | null;
    loopOn: boolean;
    /** Marker that started a loop and is waiting for an end tap (halo). */
    pendingIndex?: number | null;
    /** Current position in seconds (called every frame). */
    position: () => number;
    onSeek: (sec: number) => void;
    onMoveMarker: (id: string, sec: number) => void;
    onSelectMarker: (index: number) => void;
    /** Time order. */
    sections?: Section[];
    activeSection?: string | null;
    onSelectSection?: (id: string) => void;
    grid?: BeatGrid | null;
    beatsPerBar?: number;
    /** Called when the zoom factor changes (1 = whole track). */
    onZoomChange?: (zoom: number) => void;
  }
>(function LoopTimeline(
  { duration, markers, aIdx, bIdx, tempA = null, tempB = null, loopOn, pendingIndex = null, position, onSeek, onMoveMarker, onSelectMarker, sections = [], activeSection = null, onSelectSection, grid = null, beatsPerBar = 4, onZoomChange },
  ref,
) {
  const bar = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const played = useRef<HTMLDivElement>(null);
  const ovHead = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; moved: boolean; index: number } | null>(null);
  // Visible window: [start, start + len] seconds. len 0 = whole track.
  const [view, setView] = useState({ start: 0, len: 0 });
  const [width, setWidth] = useState(0);
  const pointers = useRef(new Map<number, number>()); // pointerId → clientX
  const pinch = useRef<{ dist: number; midX: number; start: number; len: number } | null>(null);
  /** A press on the bar: becomes a scrub once the finger travels, else a tap on release. */
  const press = useRef<{ x0: number; moved: boolean; pinched: boolean } | null>(null);
  const lastBarTap = useRef<{ at: number; x: number } | null>(null);
  const lastPos = useRef(-1);

  const len = view.len > 0 ? Math.min(view.len, duration) : duration;
  const start = Math.max(0, Math.min(view.start, Math.max(0, duration - len)));
  const zoom = len > 0 ? duration / len : 1;
  const viewRef = useRef({ start, len });
  viewRef.current = { start, len };

  // New track → full view.
  useEffect(() => setView({ start: 0, len: 0 }), [duration]);
  useEffect(() => onZoomChange?.(zoom), [zoom, onZoomChange]);

  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  // Playhead + played part + follow-while-playing (page flip when the head leaves a zoomed view).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (duration <= 0) return;
      const p = position();
      const v = viewRef.current;
      const pc = ((p - v.start) / v.len) * 100;
      if (head.current) {
        head.current.style.left = `${pc}%`;
        head.current.style.opacity = pc < -0.5 || pc > 100.5 ? '0' : '1';
      }
      if (played.current) played.current.style.width = `${Math.max(0, Math.min(100, pc))}%`;
      if (ovHead.current) ovHead.current.style.left = `${(p / duration) * 100}%`;
      const moving = lastPos.current >= 0 && Math.abs(p - lastPos.current) > 1e-4;
      lastPos.current = p;
      if (moving && v.len < duration && pointers.current.size === 0 && (p < v.start || p > v.start + v.len)) {
        setView({ start: Math.max(0, Math.min(duration - v.len, p - v.len * 0.1)), len: v.len });
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [position, duration]);

  // Wheel: ctrl+wheel zooms around the cursor, plain wheel pans. Needs a non-passive listener.
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (duration <= 0) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const at = v.start + ((e.clientX - r.left) / r.width) * v.len;
        zoomAround(at, (e.clientX - r.left) / r.width, v.len * Math.exp(e.deltaY * 0.002));
      } else if (v.len < duration) {
        const d = (e.deltaX || e.deltaY) * (v.len / r.width);
        setView({ start: Math.max(0, Math.min(duration - v.len, v.start + d)), len: v.len });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  /** Set the window so that `atSec` stays under the fraction `frac` of the bar width. */
  const zoomAround = (atSec: number, frac: number, newLen: number) => {
    const l = Math.max(MIN_VIEW_SEC, Math.min(duration, newLen));
    if (l >= duration) {
      setView({ start: 0, len: 0 });
      return;
    }
    setView({ start: Math.max(0, Math.min(duration - l, atSec - frac * l)), len: l });
  };

  // Zoom buttons: around the playhead when it is in view, else around the middle.
  useImperativeHandle(ref, () => {
    const centre = () => {
      const v = viewRef.current;
      const p = position();
      return p >= v.start && p <= v.start + v.len ? p : v.start + v.len / 2;
    };
    return {
      zoomIn: () => {
        const v = viewRef.current;
        const c = centre();
        zoomAround(c, (c - v.start) / v.len, v.len * ZOOM_STEP);
      },
      zoomOut: () => {
        const v = viewRef.current;
        const c = centre();
        zoomAround(c, (c - v.start) / v.len, v.len / ZOOM_STEP);
      },
      reset: () => setView({ start: 0, len: 0 }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  const secAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, start + ((clientX - r.left) / r.width) * len));
  };
  const pct = (sec: number) => (len > 0 ? ((sec - start) / len) * 100 : 0);
  const visible = (sec: number) => sec >= start - len * 0.02 && sec <= start + len * 1.02;

  // ---- ruler: beat ticks, bar ticks, bar numbers every `step` bars so labels never crowd ----
  const ticks: { t: number; kind: 'beat' | 'minor' | 'major'; n?: number }[] = [];
  if (grid && duration > 0 && len > 0 && width > 0) {
    const period = 60 / grid.bpm;
    const bpb = Math.max(1, beatsPerBar);
    const barLen = period * bpb;
    const nBars = len / barLen;
    const maxLabels = Math.max(6, Math.floor(width / 58));
    const step = [1, 2, 4, 8, 16, 32].find((k) => nBars / k <= maxLabels) ?? 32;
    const showBeats = nBars <= 24;
    const showMinors = nBars <= 48;
    const push = (t: number, barIndex: number | null, isBar: boolean) => {
      if (t < start - period || t > start + len + period) return;
      if (isBar && barIndex !== null) {
        if (((barIndex % step) + step) % step === 0) ticks.push({ t, kind: 'major', n: barIndex + 1 });
        else if (showMinors || barIndex % 4 === 0) ticks.push({ t, kind: 'minor' });
      } else if (showBeats) ticks.push({ t, kind: 'beat' });
    };
    if (grid.beats && grid.beats.length >= 2) {
      const b = grid.beats;
      const barStart = grid.barStart ?? 0;
      let lo = 0;
      let hi = b.length;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (b[m] < start - period) lo = m + 1;
        else hi = m;
      }
      for (let i = lo; i < b.length && b[i] <= start + len + period; i++) {
        const down = isDownbeat(i, grid, bpb);
        push(b[i], down ? Math.floor((i - barStart) / bpb) : null, down);
      }
    } else {
      const j0 = Math.max(0, Math.ceil((start - grid.offset) / period) - 1);
      const j1 = Math.floor((start + len - grid.offset) / period) + 1;
      for (let j = j0; j <= j1; j++) {
        const t = grid.offset + j * period;
        if (t < 0 || t > duration) continue;
        push(t, j % bpb === 0 ? j / bpb : null, j % bpb === 0);
      }
    }
  }

  const aTime = aIdx !== null && markers[aIdx] ? markers[aIdx].time : tempA;
  const bTime = bIdx !== null && markers[bIdx] ? markers[bIdx].time : tempB;
  const loopVisible = aTime !== null && bTime !== null && bTime > aTime && bTime >= start && aTime <= start + len;
  const lanes = sectionLanes(sections);
  const laneCount = lanes.length ? Math.max(...lanes) + 1 : 1;

  const capture = (pointerId: number) => {
    try {
      bar.current?.setPointerCapture(pointerId);
    } catch {
      /* pointer already gone (or synthetic) */
    }
  };
  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* not captured (throws NotFoundError), nothing to release */
    }
  };

  // Overview strip (zoomed only): drag to move the window.
  const ovDrag = useRef(false);
  const ovTo = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const c = ((clientX - r.left) / r.width) * duration;
    setView({ start: Math.max(0, Math.min(duration - len, c - len / 2)), len });
  };

  return (
    <div className="st-tl-wrap">
      <div
        className="st-tl"
        ref={bar}
        style={{ height: 150 + (laneCount - 1) * 24 }}
        onPointerDown={(e) => {
          pointers.current.set(e.pointerId, e.clientX);
          if (drag.current) return;
          capture(e.pointerId);
          if (pointers.current.size === 2) {
            const [x1, x2] = [...pointers.current.values()];
            pinch.current = { dist: Math.max(1, Math.abs(x2 - x1)), midX: (x1 + x2) / 2, start, len };
            if (press.current) press.current.pinched = true;
            return;
          }
          press.current = { x0: e.clientX, moved: false, pinched: false };
        }}
        onPointerMove={(e) => {
          if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, e.clientX);
          const d = drag.current;
          if (d) {
            d.moved = true;
            onMoveMarker(d.id, secAt(e.clientX));
            return;
          }
          const pz = pinch.current;
          if (pz && pointers.current.size >= 2) {
            const [x1, x2] = [...pointers.current.values()];
            const dist = Math.max(1, Math.abs(x2 - x1));
            const mid = (x1 + x2) / 2;
            const r = bar.current!.getBoundingClientRect();
            const atSec = pz.start + ((pz.midX - r.left) / r.width) * pz.len;
            zoomAround(atSec, (mid - r.left) / r.width, pz.len / (dist / pz.dist));
            return;
          }
          const p = press.current;
          if (p && !p.pinched) {
            if (Math.abs(e.clientX - p.x0) > SCRUB_SLOP_PX) p.moved = true;
            // Scrub: the playhead follows the finger.
            if (p.moved) onSeek(secAt(e.clientX));
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (d) {
            drag.current = null;
            endPointer(e);
            if (!d.moved) onSelectMarker(d.index);
            return;
          }
          const p = press.current;
          press.current = null;
          const wasPinch = !!pinch.current || !!p?.pinched;
          endPointer(e);
          if (!p || p.moved || wasPinch || duration <= 0) return;
          const now = performance.now();
          const prev = lastBarTap.current;
          const sec = secAt(e.clientX);
          if (prev && now - prev.at < DOUBLE_TAP_MS && Math.abs(prev.x - e.clientX) < 24) {
            lastBarTap.current = null;
            const r = bar.current!.getBoundingClientRect();
            if (zoom > 1.01) setView({ start: 0, len: 0 });
            else zoomAround(sec, (e.clientX - r.left) / r.width, duration / 4);
            return;
          }
          lastBarTap.current = { at: now, x: e.clientX };
          onSeek(sec);
        }}
        onPointerCancel={(e) => {
          drag.current = null;
          press.current = null;
          endPointer(e);
        }}
      >
        {/* pins: one row, later ones on top when they overlap */}
        {markers.map((m, i) => {
          if (!visible(m.time)) return null;
          const picked = i === aIdx || i === bIdx;
          return (
            <button
              key={m.id}
              className={`st-pin${picked ? ' picked' : ''}${i === pendingIndex ? ' pending' : ''}`}
              style={{ left: `${pct(m.time)}%` }}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (pointers.current.size > 0 || pinch.current) return;
                drag.current = { id: m.id, moved: false, index: i };
                capture(e.pointerId);
              }}
              title={m.name}
            >
              <span className="st-pin-c">{i === aIdx ? 'A' : i === bIdx ? 'B' : i + 1}</span>
              <span className="st-pin-stem" />
            </button>
          );
        })}
        {/* temporary A / B: a light-blue pin at a time with no marker */}
        {([
          ['A', tempA],
          ['B', tempB],
        ] as const).map(([letter, t]) =>
          t !== null && visible(t) ? (
            <span key={letter} className="st-pin temp" style={{ left: `${pct(t)}%` }} title={`Temporary ${letter} (not a marker)`}>
              <span className="st-pin-c">{letter}</span>
              <span className="st-pin-stem" />
            </span>
          ) : null,
        )}
        {/* track + played + loop */}
        <div className="st-track" />
        <div className="st-played" ref={played} />
        {loopVisible && <div className={`st-loopbar${loopOn ? ' on' : ''}`} style={{ left: `${Math.max(0, pct(aTime!))}%`, width: `${Math.min(100, pct(bTime!)) - Math.max(0, pct(aTime!))}%` }} />}
        {/* ruler */}
        <div className="st-ruler">
          {ticks.map((k) => (
            <div key={`${k.kind}${k.t}`} className={`st-tick ${k.kind}`} style={{ left: `${pct(k.t)}%` }}>
              {k.n !== undefined && <span>{k.n}</span>}
            </div>
          ))}
        </div>
        {/* sections */}
        <div className="st-secrow" style={{ height: 38 + (laneCount - 1) * 24 }}>
          {sections.map((sec, idx) => {
              if (sec.end < start || sec.start > start + len) return null;
              const l = Math.max(0, pct(sec.start));
              const w = Math.min(100, pct(sec.end)) - l;
              const c = SECTION_COLORS[sec.color % SECTION_COLORS.length];
              const on = sec.id === activeSection;
              return (
                <button
                  key={sec.id}
                  className="st-secband"
                  style={{ left: `${l}%`, width: `${w}%`, top: lanes[idx] * 24 }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onSelectSection?.(sec.id);
                  }}
                  title={sec.name}
                >
                  <span className="st-secband-bar" style={{ background: on ? c : tint(c, 0.5) }} />
                  <span className="st-secband-name" style={{ color: on ? 'var(--s-text)' : c, opacity: w >= 4.5 ? 1 : 0 }}>
                    {sec.name}
                  </span>
                </button>
              );
            })}
        </div>
        {/* playhead */}
        <div className="st-head" ref={head}>
          <span className="st-head-dot" />
        </div>
      </div>
      {zoom > 1.01 && (
        <div
          className="st-ov"
          onPointerDown={(e) => {
            ovDrag.current = true;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            ovTo(e.clientX, e.currentTarget as HTMLElement);
          }}
          onPointerMove={(e) => ovDrag.current && ovTo(e.clientX, e.currentTarget as HTMLElement)}
          onPointerUp={() => (ovDrag.current = false)}
          onPointerCancel={() => (ovDrag.current = false)}
        >
          <div className="st-ov-track" />
          <div className="st-ov-win" style={{ left: `${(start / duration) * 100}%`, width: `${(len / duration) * 100}%` }} />
          <div className="st-ov-head" ref={ovHead} />
        </div>
      )}
    </div>
  );
});
