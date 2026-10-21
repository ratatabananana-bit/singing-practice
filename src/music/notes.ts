export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export const A4_MIDI = 69;
export const A4_FREQ = 440;

export function midiToFreq(midi: number, a4 = A4_FREQ): number {
  return a4 * Math.pow(2, (midi - A4_MIDI) / 12);
}

export function freqToMidi(freq: number, a4 = A4_FREQ): number {
  return A4_MIDI + 12 * Math.log2(freq / a4);
}

/** Nearest MIDI note and the signed cents deviation from it. */
export function freqToNote(freq: number, a4 = A4_FREQ): { midi: number; cents: number } {
  const exact = freqToMidi(freq, a4);
  const midi = Math.round(exact);
  return { midi, cents: (exact - midi) * 100 };
}

/** Signed cents from `freq` to the pitch of `targetMidi`. Positive = sharp. */
export function centsOff(freq: number, targetMidi: number, a4 = A4_FREQ): number {
  return (freqToMidi(freq, a4) - targetMidi) * 100;
}

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

export function noteName(midi: number): string {
  return NOTE_NAMES[pitchClass(midi)];
}

export function noteLabel(midi: number): string {
  return `${noteName(midi)}${octaveOf(midi)}`;
}

/** Split a MIDI note into fixed display slots: letter, sharp flag, octave. */
export function noteSlots(midi: number): { letter: string; sharp: boolean; octave: number } {
  const name = noteName(midi);
  return { letter: name[0], sharp: name.length > 1, octave: octaveOf(midi) };
}

export function isSharp(midi: number): boolean {
  return NOTE_NAMES[pitchClass(midi)].length > 1;
}

export function clampMidi(midi: number, lo = 0, hi = 127): number {
  return Math.min(hi, Math.max(lo, midi));
}

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** m:ss.cc */
export function formatTimePrecise(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const c = Math.floor((sec - Math.floor(sec)) * 100);
  return `${m}:${s.toString().padStart(2, '0')}.${c.toString().padStart(2, '0')}`;
}

/** Parse "m:ss.cc", "ss.cc", "m:ss" → seconds, or null. */
export function parseTime(text: string): number | null {
  const t = text.trim();
  const m = /^(?:(\d+):)?(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(t);
  if (!m) return null;
  const min = m[1] ? parseInt(m[1], 10) : 0;
  const sec = parseInt(m[2], 10);
  const fracStr = m[3] ?? '';
  const frac = fracStr ? parseInt(fracStr.padEnd(3, '0').slice(0, 3), 10) / 1000 : 0;
  if (sec >= 60 && m[1]) return null;
  return min * 60 + sec + frac;
}
