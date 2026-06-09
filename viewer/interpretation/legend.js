// Interpretation domain — legend construction (PURE). SOP: architecture/interpretation.md.
// Built from the prebuilt scale (same scale State.derive uses for styleMap) -> legend always
// matches the render. slot is passed so numeric labels can be formatted with the slot's unit.

import { encode } from './encode.js';
import { format } from './format.js';

export function buildLegend(layer, slot, scale, renderConfig, mode) {
  if (!scale) return { kind: 'missing', entries: [] };

  if (scale.kind === 'numeric') {
    const [min, max] = scale.domain;
    const entries = scale.stops.map((color, i) => {
      const t = scale.stops.length === 1 ? 0 : i / (scale.stops.length - 1);
      const value = min + (max - min) * t;
      return { label: format(value, slot), color };
    });
    return { kind: 'numeric', domain: [min, max], entries };
  }

  // categorical
  const entries = scale.categories.map((c) => ({
    label: c,
    color: encode(c, scale, renderConfig, mode).color,
  }));
  return { kind: 'categorical', entries };
}
