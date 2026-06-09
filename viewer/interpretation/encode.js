// Interpretation domain — value -> visual encoding (PURE). SOP: architecture/interpretation.md.
// Imports same-domain defaults only. No IO, no DOM, no three.js. Returns plain values.

import { layerStyle, globalStyle } from './defaults.js';

export function classify(value) {
  return value === null || value === undefined ? 'missing' : 'data';
}

// ---- color helpers ---------------------------------------------------------
function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) {
  const c = (x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function lerp(a, b, t) { return a + (b - a) * t; }

// Map normalized t in [0,1] across the immutable 5 stops (linear interpolation).
function gradient(stops, t) {
  if (t <= 0) return stops[0];
  if (t >= 1) return stops[stops.length - 1];
  const seg = t * (stops.length - 1);
  const i = Math.floor(seg);
  const f = seg - i;
  const a = hexToRgb(stops[i]);
  const b = hexToRgb(stops[i + 1]);
  return rgbToHex([lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)]);
}

// ---- buildScale: computed ONCE per layer per scope (determinism) -----------
// `mode` selects the scope's resolved style (byScope override) so campus/building can diverge.
export function buildScale(layer, valueSet, renderConfig, mode) {
  const isNumeric = layer.__value_type === 'numeric';
  if (isNumeric) {
    const style = layerStyle(renderConfig, layer.layer_id, 'numeric', mode);
    const nums = valueSet.filter((v) => v !== null && v !== undefined && typeof v === 'number');
    const min = nums.length ? Math.min(...nums) : 0;
    const max = nums.length ? Math.max(...nums) : 0;
    return { kind: 'numeric', domain: [min, max], stops: style.stops, opacity: style.opacity };
  }
  const style = layerStyle(renderConfig, layer.layer_id, 'categorical', mode);
  const cats = [...new Set(valueSet.filter((v) => v !== null && v !== undefined))]
    .map(String)
    .sort(); // stable, deterministic order -> same data, same colors (spec §6.6)
  // Explicit value->color map (spec §3.1) wins per value; else, if the layer declares a `gradient`
  // (a stops array), each sorted category is sampled evenly across that gradient — so a per-entity
  // layer (e.g. campus_building) spreads a smooth gradient over its members, auto-fitting the count
  // (interpretation.md "Categorical encoding"). Otherwise fall back to the ordered palette by position.
  const explicit = style.colors || null;
  const ramp = (Array.isArray(style.gradient) && style.gradient.length >= 2) ? style.gradient : null;
  const colorMap = new Map();
  const n = cats.length;
  cats.forEach((c, i) => {
    let col;
    if (explicit && explicit[c] != null) col = explicit[c];
    else if (ramp) col = gradient(ramp, n <= 1 ? 0 : i / (n - 1));
    else col = style.palette[i % style.palette.length];
    colorMap.set(c, col);
  });
  return { kind: 'categorical', categories: cats, colorMap, opacity: style.opacity };
}

// ---- encode: one value against a prebuilt scale ----------------------------
export function encode(value, scale, renderConfig, mode) {
  if (value === null || value === undefined) {
    const g = globalStyle(renderConfig, mode).missingData;
    return { class: 'missing', color: g.color, opacity: g.opacity };
  }
  if (scale.kind === 'numeric') {
    const [min, max] = scale.domain;
    const t = max === min ? 0.5 : (value - min) / (max - min); // degenerate domain -> mid stop
    return { color: gradient(scale.stops, t), opacity: scale.opacity };
  }
  const color = scale.colorMap.get(String(value));
  if (!color) {
    const g = globalStyle(renderConfig, mode).missingData;
    return { class: 'missing', color: g.color, opacity: g.opacity };
  }
  return { color, opacity: scale.opacity };
}
