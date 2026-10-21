import { useState } from 'react';
import { formatTimePrecise } from '../music/notes';

export const SECTION_COLORS = ['#ef4444', '#f59e0b', '#f5c542', '#4ade80', '#38bdf8', '#a78bfa'];

export interface SectionDraft {
  name: string;
  color: number;
}

/** Inline editor row for a section: name, colour swatches, optional times and actions. */
export function SectionEditor({
  initial,
  start,
  end,
  onSave,
  onCancel,
  onDelete,
  onRepinStart,
  onRepinEnd,
}: {
  initial: SectionDraft;
  start: number;
  end: number;
  onSave: (d: SectionDraft) => void;
  onCancel?: () => void;
  onDelete?: () => void;
  onRepinStart?: () => void;
  onRepinEnd?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  return (
    <div className="card inner" style={{ padding: 10, borderColor: SECTION_COLORS[color] }}>
      <div className="row">
        <input
          type="text"
          className="grow"
          value={name}
          placeholder="Section name (Verse, Chorus…)"
          autoFocus={!initial.name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSave({ name: name.trim() || 'Section', color })}
          style={{ minHeight: 40 }}
        />
      </div>
      <div className="row" style={{ marginTop: 8, gap: 8 }}>
        {SECTION_COLORS.map((c, i) => (
          <button
            key={c}
            onClick={() => setColor(i)}
            aria-label={`Colour ${i + 1}`}
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: c,
              border: i === color ? '3px solid #fff' : '3px solid transparent',
              boxShadow: i === color ? '0 0 0 2px var(--card)' : 'none',
            }}
          />
        ))}
      </div>
      <div className="row between" style={{ marginTop: 8, fontSize: 12 }}>
        <span className="mono muted">
          {formatTimePrecise(start)} – {formatTimePrecise(end)}
        </span>
        <div className="row" style={{ gap: 6 }}>
          {onRepinStart && (
            <button className="chip sm" onClick={onRepinStart} title="Set start to playhead">
              start ⟲
            </button>
          )}
          {onRepinEnd && (
            <button className="chip sm" onClick={onRepinEnd} title="Set end to playhead">
              end ⟲
            </button>
          )}
        </div>
      </div>
      <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end', gap: 8 }}>
        {onDelete && (
          <button className="btn sm" style={{ color: 'var(--bad)' }} onClick={onDelete}>
            Delete
          </button>
        )}
        {onCancel && (
          <button className="btn sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn sm primary" onClick={() => onSave({ name: name.trim() || 'Section', color })}>
          Save
        </button>
      </div>
    </div>
  );
}
