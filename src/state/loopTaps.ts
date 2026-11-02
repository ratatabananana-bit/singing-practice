/**
 * Marker / segment tap rules for the Studio loop, with no modes:
 * - tap a marker (or a segment chip): loop that one segment starting there, and wait for an end
 * - tap a later marker right after: that becomes the end
 * - any later tap: a new start (this is how the start gets moved)
 * - double-tap: jump (handled by the caller, which undoes the first tap's loop change)
 *
 * The "waiting for an end" state is the index of the start marker; it is only honoured while the
 * loop still is that one segment, so anything else that changes the loop forgets it.
 */

export interface LoopState {
  /** Start / end marker indices in time order, or null when there is no loop. */
  a: number | null;
  b: number | null;
  on: boolean;
}

export type TapAction = { type: 'jump'; index: number } | { type: 'loop'; a: number; b: number; pending: number | null } | { type: 'none' };

/**
 * @param startIdx marker the tap would start a loop at (a marker tap: the marker; a segment tap: its first marker)
 * @param endIdx marker the tap would end a loop at (a marker tap: the marker; a segment tap: its last marker)
 * @param count number of markers
 * @param pendingStart start marker of the previous start-tap, or null
 */
export function tapAction(startIdx: number, endIdx: number, count: number, loop: LoopState, pendingStart: number | null): TapAction {
  if (count < 2) return { type: 'jump', index: startIdx };
  // Waiting for B: A was just picked and B is still its default neighbour (or was cleared).
  const waiting = pendingStart !== null && loop.a === pendingStart && (loop.b === null || (loop.on && loop.b === pendingStart + 1));
  if (waiting) {
    if (startIdx === pendingStart) return { type: 'none' };
    if (endIdx > pendingStart) return { type: 'loop', a: pendingStart, b: endIdx, pending: null };
  }
  const a = Math.min(startIdx, count - 2);
  return { type: 'loop', a, b: a + 1, pending: a };
}

/**
 * A / B buttons on a marker row: make marker `i` the loop start (A) or end (B), keeping the other
 * end when it still makes a forward span, else taking the neighbouring marker. Null when impossible
 * (A on the last marker, B on the first, fewer than two markers).
 */
export function pickAB(which: 'A' | 'B', i: number, count: number, loop: LoopState): { a: number; b: number } | null {
  if (count < 2) return null;
  if (which === 'A') {
    if (i >= count - 1) return null;
    return { a: i, b: loop.b !== null && loop.b > i ? loop.b : i + 1 };
  }
  if (i <= 0) return null;
  return { a: loop.a !== null && loop.a < i ? loop.a : i - 1, b: i };
}

/**
 * The loop's A and B as seconds: a marker's time when that end is a marker index, else the
 * temporary time set by looping a section whose bound has no marker (`tempA` / `tempB`), else
 * null. `loopEnd` undefined = record from before B was stored (B = the next marker).
 */
export function loopTimes(
  loop: { activeLoop: number | null; loopEnd?: number | null; tempA?: number | null; tempB?: number | null },
  markers: { time: number }[],
): [number | null, number | null] {
  const a = loop.activeLoop;
  const aOk = a !== null && a >= 0 && a < markers.length;
  const bIdx = loop.loopEnd === undefined ? (aOk ? a + 1 : null) : loop.loopEnd;
  const bOk = bIdx !== null && bIdx >= 0 && bIdx < markers.length;
  return [aOk ? markers[a].time : loop.tempA ?? null, bOk ? markers[bIdx].time : loop.tempB ?? null];
}
