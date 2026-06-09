// Interpretation domain — built-in DEFAULT render-config (claude.md §2.3 shape).
// Used until the Finetuning Tool produces data/render_config.json. Style only; structure
// (which layers exist) is the registry, never here. Pure constants -> deterministic.

// 5-stop perceptual gradient (low -> high). Count is IMMUTABLE (spec §6.5). Blue -> teal -> green -> amber -> red.
const NUMERIC_STOPS = ['#2c7bb6', '#00a6ca', '#7fbc41', '#fdae61', '#d7191c'];

// Categorical palette — stable order; assigned to the sorted distinct value set.
const CATEGORICAL_PALETTE = [
  '#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2',
  '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
  '#86bcb6', '#d37295',
];

export const DEFAULT_RENDER_CONFIG = {
  version: 'builtin-1',
  global: {
    background: '#0e1116',
    fog: { enabled: false, color: '#0e1116', near: 100, far: 2000 },
    bloom: { enabled: false, strength: 0.6, radius: 0.3, threshold: 0.6 },
    // Per Rhino mesh class (rendering.md "Per-class fill + line work"). Each: fill {color, opacity}
    // + edge {thickness (px), brightness}. Edge color = the FILL lerped toward white by brightness
    // (no separate edge color). fill.color is the FALLBACK when no active layer colors the mesh
    // (building envelope + rooms). floor (Level) default fill opacity 0 = edges-only (raisable).
    classes: {
      building: { fill: { color: '#9aa4b2', opacity: 0.6 }, edge: { thickness: 1.0, brightness: 0.0 } },
      room: { fill: { color: '#9aa4b2', opacity: 0.92 }, edge: { thickness: 1.0, brightness: 0.4 } },
      floor: { fill: { color: '#6c7686', opacity: 0.0 }, edge: { thickness: 1.0, brightness: 0.15 } },
      context: { fill: { color: '#232b36', opacity: 1.0 }, edge: { thickness: 0.6, brightness: 0.25 } },
    },
    selection: { color: '#ffd166', opacity: 1.0 },
    missingData: { color: '#3a4250', opacity: 0.55 },
    // Scope defaults (tunable). Campus recedes room fill behind the colored building envelopes.
    // (Context inherits shared opacity 1.0 in both scopes → in building view the unselected buildings'
    // envelopes + the WUC backdrop render as context; tune via the Context tab per scope.)
    byScope: {
      campus: { classes: { room: { fill: { opacity: 0.4 } } } },
    },
  },
  // Per-layer overrides are looked up by layer_id; absence -> these category defaults.
  _defaults: {
    numeric: { stops: NUMERIC_STOPS, interpolation: 'linear', opacity: 0.92 },
    categorical: { palette: CATEGORICAL_PALETTE, opacity: 0.92 },
  },
  layers: {}, // empty -> use _defaults for every layer
};

// Deep merge: plain-object values merge RECURSIVELY (so a scope override of `edges.building.thickness`
// keeps sibling `edges.building.color`; a partial `fog`/`bloom`/`colors` keeps its other keys);
// arrays + scalars REPLACE wholesale (e.g. numeric `stops`). interpretation.md "Scope-keyed resolution".
function isPlainObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function mergeStyle(base, over) {
  if (!isPlainObj(over)) return isPlainObj(base) ? { ...base } : over;
  const out = isPlainObj(base) ? { ...base } : {};
  for (const k of Object.keys(over)) {
    const ov = over[k];
    out[k] = (isPlainObj(ov) && isPlainObj(out[k])) ? mergeStyle(out[k], ov) : ov;
  }
  return out;
}

// Resolve the style block for a layer from a (possibly partial / external) render-config.
// Resolution order (later wins): category _defaults[valueType] -> shared layer block ->
// byScope[mode] override. Always falls back to built-in defaults so the viewer runs before the
// tool exists. Campus/building independence lives here (interpretation.md, finetuning_tool.md §2).
export function layerStyle(renderConfig, layerId, valueType, mode) {
  const cfg = renderConfig || DEFAULT_RENDER_CONFIG;
  const defs = (cfg._defaults || DEFAULT_RENDER_CONFIG._defaults)[valueType] ||
    DEFAULT_RENDER_CONFIG._defaults[valueType];
  const shared = (cfg.layers && cfg.layers[layerId]) || {};
  const scoped = (mode && shared.byScope && shared.byScope[mode]) || null;
  const out = mergeStyle(mergeStyle(defs, shared), scoped);
  delete out.byScope;
  return out;
}

export function globalStyle(renderConfig, mode) {
  const cfg = renderConfig || DEFAULT_RENDER_CONFIG;
  const shared = mergeStyle(DEFAULT_RENDER_CONFIG.global, cfg.global || {});
  const scoped = (mode && cfg.global && cfg.global.byScope && cfg.global.byScope[mode]) || null;
  const out = mergeStyle(shared, scoped);
  delete out.byScope;
  return out;
}
