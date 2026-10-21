export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button className="row" onClick={() => onChange(!on)} style={{ gap: 8 }} aria-pressed={on}>
      {label && <span style={{ fontSize: 12, fontWeight: 600, color: on ? 'var(--text)' : 'var(--muted)' }}>{label}</span>}
      <span className={`switch${on ? ' on' : ''}`} />
    </button>
  );
}
