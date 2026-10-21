export const SWEET_LO = -30;
export const SWEET_HI = -12;
const MIN_DB = -60;
const MAX_DB = 0;

export function loudnessStatus(db: number, gate: number): string {
  if (db < gate) return 'Too quiet';
  if (db < SWEET_LO) return 'A touch soft';
  if (db <= SWEET_HI) return 'Good level';
  if (db <= -5) return 'A touch hot';
  return 'Too loud';
}

export function LoudnessMeter({
  db,
  peak = null,
  clip = false,
  segments = 16,
  height = 150,
}: {
  db: number;
  peak?: number | null;
  clip?: boolean;
  segments?: number;
  height?: number;
}) {
  const toIdx = (v: number) => Math.round(((Math.min(MAX_DB, Math.max(MIN_DB, v)) - MIN_DB) / (MAX_DB - MIN_DB)) * segments);
  const lit = toIdx(db);
  const peakIdx = peak === null ? -1 : Math.max(0, toIdx(peak) - 1);
  const segH = Math.max(3, (height - (segments - 1) * 2) / segments);
  return (
    <div className="meter" style={{ height }} title={`${db.toFixed(0)} dB`}>
      {Array.from({ length: segments }, (_, i) => {
        const segDb = MIN_DB + ((i + 0.5) / segments) * (MAX_DB - MIN_DB);
        const cls = ['on'];
        if (segDb >= SWEET_LO && segDb <= SWEET_HI) cls.push('sweet');
        if (segDb > -6) cls.push('hot');
        const on = i < lit;
        return <i key={i} style={{ height: segH }} className={i === peakIdx ? 'peak' : on ? cls.join(' ') : ''} />;
      })}
      {clip && (
        <span
          className="pill bad sm"
          style={{ position: 'absolute', top: -26, left: '50%', transform: 'translateX(-50%)', height: 18, fontSize: 9, padding: '0 5px' }}
        >
          CLIP
        </span>
      )}
    </div>
  );
}
