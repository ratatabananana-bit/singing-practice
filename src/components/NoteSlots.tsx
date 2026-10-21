import { noteSlots } from '../music/notes';

/**
 * Fixed-width note display: letter / sharp / octave each in its own slot so
 * nothing shifts when a sharp appears. `midi` null shows a dash.
 */
export function NoteSlots({ midi, size = 16 }: { midi: number | null; size?: number }) {
  const s = midi === null ? null : noteSlots(midi);
  return (
    <span className="note-slots" style={{ fontSize: size }}>
      <span>{s ? s.letter : '–'}</span>
      <span className="sharp">{s?.sharp ? '♯' : ''}</span>
      <span className="oct">{s ? s.octave : ''}</span>
    </span>
  );
}
