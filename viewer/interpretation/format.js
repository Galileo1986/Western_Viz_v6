// Interpretation domain — value formatting (PURE). SOP: architecture/interpretation.md.
// One formatter, driven by the slot's unit/value_type. No per-call special cases.

export function format(value, slot) {
  if (value === null || value === undefined || value === '') return '—';
  const unit = slot && slot.unit;
  const vt = slot && slot.value_type;

  if (vt === 'categorical' || unit == null) return String(value);

  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return String(value);

  switch (unit) {
    case 'ratio':
      return `${(n * 100).toFixed(1)}%`;
    case 'sqft':
      return `${Math.round(n).toLocaleString('en-US')} sqft`;
    case 'people':
    case 'sessions/day':
    case 'users/day':
      return `${Math.round(n).toLocaleString('en-US')} ${unit === 'people' ? 'people' : unit}`;
    case 'people*min/sqft':
      return `${n.toFixed(2)} ${unit}`;
    default:
      return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2);
  }
}
