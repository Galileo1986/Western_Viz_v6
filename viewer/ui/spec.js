// UI Layer 1 — the INFORMATION contract. SOP: architecture/skins.md.
//
// buildSpec(vm, ctx) → Spec : a PURE function producing an ordered list of BLOCKS, each carrying
// already-resolved, already-formatted values + a semantic `type` + `region` + action descriptors —
// NEVER markup, classes, or colors-as-style. This decides WHICH blocks exist and WHAT they say; the
// skin (templates + css) decides only how they look. A cosmetic layer physically cannot alter a
// number because it only ever receives these resolved values.
//
// This is also the structure handed to the design assistant so it understands the groups of data it
// is visualizing (data-aware UI design) — same source of truth, no second description.
//
// Faithful to the current viewer/ui/ui.js render functions (block order = DOM order). `ctx` carries
// UI-only navigation memory (the remembered building target for the Scope→Building button) that is
// not part of the data view-model.

import { enterBuilding, scopeUp, setLayer, clearSelection, setSpotlight } from '../state/actions.js';

// Layer-menu family order (user decision 2026-06-07): four categories, every layer in exactly one.
// Categorical (classification) → Performance (utilization) → Analytical (diagnostics + portfolio)
// → Reconciliation (data-reconciliation / provenance).
const FAMILY_ORDER = ['Categorical', 'Performance', 'Analytical', 'Reconciliation'];
// DISPLAY-only short labels (the internal family KEY stays the registry value — used for grouping,
// family_analysis, validation). 'Reconciliation' (14ch) overflows the family tab → show 'Reconciled'.
// Tab↔panel pairing stays correct (both render from the same mapped value). Edit here to relabel.
const FAMILY_LABEL = { Reconciliation: 'Reconciled' };

// formatting (ported verbatim from ui.js so values match pixel-for-pixel)
function fmtVal(v, unit) {
  if (v == null) return '';
  if (unit === 'ratio') return (v * 100).toFixed(1) + '%';
  if (unit === 'sqft') return Math.round(v).toLocaleString('en-US');
  return (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
}

// ---- donut geometry (UImigration.md §11) -----------------------------------
// Pre-compute SVG ring geometry as RESOLVED display values (same class as bar `pct` widths) so the skin
// can draw a donut declaratively via `repeat` over an <svg>. Ported from sandbox svgPie()/_shade().
const DONUT_GEO = { W: 260, H: 150, cx: 72, cy: 76, r: 64, ir: 42 };
const DONUT_PALETTE = ['#c8f24a', '#6fb3d6', '#d68f6f', '#9a7fd6', '#d6c86f', '#6fd6a3', '#7f8488', '#c96f9a', '#86bcb6', '#d37295'];
const rnd = (n) => Math.round(n * 100) / 100;
function shadeHex(hex, amt) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return hex;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const to = amt >= 0 ? 255 : 0, t = Math.min(1, Math.abs(amt));
  const mix = (c) => Math.round(c + (to - c) * t).toString(16).padStart(2, '0');
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}
// interpolate a value t∈[0,1] across gradient stops (mirrors interpretation/encode.js gradient) — used
// to color each numeric bar by its value so the chart matches the legend (sandbox figureColors).
function hexRgb(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function gradientHex(stops, t) {
  if (!stops || !stops.length) return null;
  if (stops.length === 1 || t <= 0) return stops[0];
  if (t >= 1) return stops[stops.length - 1];
  const seg = t * (stops.length - 1), i = Math.floor(seg), f = seg - i;
  const a = hexRgb(stops[i]), b = hexRgb(stops[i + 1]);
  const c = (x) => Math.round(x).toString(16).padStart(2, '0');
  return `#${c(a[0] + (b[0] - a[0]) * f)}${c(a[1] + (b[1] - a[1]) * f)}${c(a[2] + (b[2] - a[2]) * f)}`;
}
function resolveDonut(fig, colorByLabel) {
  const all = (fig.series || []).filter((s) => typeof s.value === 'number' && s.value > 0);
  const shown = all.slice(0, SERIES_CAP);
  const { W, H, cx, cy, r, ir } = DONUT_GEO;
  const rc = (r + ir) / 2;
  const total = shown.reduce((a, s) => a + s.value, 0) || 1;
  let acc = -Math.PI / 2;
  const slices = shown.map((s, i) => {
    const a0 = acc, span = (s.value / total) * Math.PI * 2, a1 = a0 + span; acc = a1;
    const base = colorByLabel[s.label] || DONUT_PALETTE[i % DONUT_PALETTE.length];
    const large = span > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const xi0 = cx + ir * Math.cos(a0), yi0 = cy + ir * Math.sin(a0), xi1 = cx + ir * Math.cos(a1), yi1 = cy + ir * Math.sin(a1);
    const d = `M ${rnd(x0)} ${rnd(y0)} A ${r} ${r} 0 ${large} 1 ${rnd(x1)} ${rnd(y1)} `
            + `L ${rnd(xi1)} ${rnd(yi1)} A ${ir} ${ir} 0 ${large} 0 ${rnd(xi0)} ${rnd(yi0)} Z`;
    let gx1, gy1, gx2, gy2;
    if (span > 5.9) { gx1 = cx - r; gy1 = cy - r; gx2 = cx + r; gy2 = cy + r; }
    else { gx1 = cx + rc * Math.cos(a0); gy1 = cy + rc * Math.sin(a0); gx2 = cx + rc * Math.cos(a1); gy2 = cy + rc * Math.sin(a1); }
    const useGrad = /^#[0-9a-fA-F]{6}$/.test(base);
    const gradId = `pg_${fig.figure_id}_${i}`;
    return {
      d, gradId, fill: useGrad ? `url(#${gradId})` : base,
      c0: shadeHex(base, 0.32), c1: shadeHex(base, -0.28),
      gx1: rnd(gx1), gy1: rnd(gy1), gx2: rnd(gx2), gy2: rnd(gy2),
      label: (s.label || '').slice(0, 16), pct: Math.round((s.value / total) * 100), swatch: base,
    };
  });
  const legend = [];
  slices.forEach((sl, i) => {
    const ly = 14 + i * 16;
    if (ly > H - 6) return;
    legend.push({ label: sl.label, pct: sl.pct, swatch: sl.swatch, ly, ry: ly - 7 });
  });
  return {
    kind: 'donut', isPie: true, title: fig.title || fig.figure_id,
    W, H, shadowId: `pgsh_${fig.figure_id}`, slices, legend,
    moreCount: all.length > shown.length ? all.length - shown.length : 0,
    caption: fig.caption || '', insight: fig.insight || '',
  };
}

// resolve one figure to a render-ready block-figure (stat cells | bars | donut), matching renderChart().
const SERIES_CAP = 12;
function resolveFigure(fig, opts = {}) {
  const series = fig.series || [];
  if (fig.type === 'stat') {
    return {
      kind: 'stat', isStat: true, title: fig.title || fig.figure_id,
      cells: series.map((s) => ({ value: fmtVal(s.value, fig.unit), label: s.label })),
      caption: fig.caption || '', insight: fig.insight || '',
    };
  }
  // categorical layer → donut regardless of the figure's `type` (e.g. campus_building/space_category/
  // college figures are type:bar but render as a donut); numeric layers → bars. (UImigration.md §11)
  if (opts.donut && fig.type !== 'stat') return resolveDonut(fig, opts.colorByLabel || {});
  // bar / pie → horizontal bars (pie = share of total); cap rows, surface what's hidden
  const total = series.reduce((a, s) => a + (typeof s.value === 'number' ? s.value : 0), 0) || 1;
  const max = (fig.domain && fig.domain[1]) || Math.max(1, ...series.map((s) => s.value || 0));
  const shown = series.slice(0, SERIES_CAP);
  // per-bar color from the active numeric layer's gradient (sandbox: bars match the legend), else lime
  const stops = opts.numericStops;
  const vals = shown.map((s) => s.value);
  const lo = fig.domain ? fig.domain[0] : Math.min(0, ...vals);
  const hi = fig.domain ? fig.domain[1] : Math.max(1, ...vals);
  const dd = (hi - lo) || 1;
  const bars = shown.map((s) => {
    const pct = fig.type === 'pie' ? (s.value / total) : (s.value / max);
    const bar = {
      label: s.label,
      pct: Math.max(1, Math.round(pct * 100)),
      value: fig.type === 'pie' ? `${Math.round((s.value / total) * 100)}%` : fmtVal(s.value, fig.unit),
    };
    if (stops && stops.length) bar.color = gradientHex(stops, Math.max(0, Math.min(1, (s.value - lo) / dd)));
    return bar;
  });
  return {
    kind: 'bars', isBars: true, title: fig.title || fig.figure_id, bars,
    moreCount: series.length > shown.length ? series.length - shown.length : 0,
    caption: fig.caption || '', insight: fig.insight || '',
  };
}

// ---- per-family chart styles (user decision 2026-06-08) ---------------------------------------
// One visual language per layer family; the chart shows VALUES ONLY — color/position decodes through
// the layer's legend (no category text repeated between legend and chart). Geometry is pre-resolved
// here (same posture as the donut) so the skin stays declarative.
//   Categorical   → Treemap        (area = value, colored by the categorical legend swatch)
//   Performance   → Bullet bars     (length+hue domain-relative, against the gradient legend scale)
//   Analytical    → Stepped columns (ordered bands / per-building skyline, banded or gradient color)
//   Reconciliation→ Unit dot matrix (1 dot ≈ N, colored by the provenance legend swatch)

const TREE_W = 300, TREE_H = 158;
// Categorical → strip/slice treemap. Value labels only; colors join the categorical legend by label.
// EXPERIMENT (reversible): `spot` = { clickable, value } — when clickable (campus room-paint categorical
// layer) each cell becomes a spotlight toggle; the active cell is flagged, the rest dimmed.
function resolveTreemap(fig, colorByLabel, spot) {
  const all = (fig.series || []).filter((s) => typeof s.value === 'number' && s.value > 0)
    .sort((a, b) => b.value - a.value);
  const shown = all.slice(0, SERIES_CAP);
  const out = [];
  (function layout(list, X, Y, Wd, Hd) {
    if (!list.length) return;
    if (list.length === 1) { out.push({ s: list[0], X, Y, Wd, Hd }); return; }
    const t = list.reduce((a, s) => a + s.value, 0); let acc = 0, i = 0;
    for (; i < list.length; i++) { acc += list[i].value; if (acc >= t / 2) { i++; break; } }
    const a = list.slice(0, i), b = list.slice(i), ta = a.reduce((s, x) => s + x.value, 0);
    if (Wd >= Hd) { const w = Wd * ta / t; layout(a, X, Y, w, Hd); layout(b, X + w, Y, Wd - w, Hd); }
    else { const h = Hd * ta / t; layout(a, X, Y, Wd, h); layout(b, X, Y + h, Wd, Hd - h); }
  })(shown, 0, 0, TREE_W, TREE_H);
  const clickable = !!(spot && spot.clickable);
  const active = spot && spot.value != null ? spot.value : null;
  const rects = out.map((o, i) => {
    const big = o.Wd > 40 && o.Hd > 18;
    const isActive = clickable && active != null && o.s.label === active;
    return {
      x: rnd(o.X + 1), y: rnd(o.Y + 1), w: rnd(Math.max(0, o.Wd - 2)), h: rnd(Math.max(0, o.Hd - 2)),
      fill: colorByLabel[o.s.label] || DONUT_PALETTE[i % DONUT_PALETTE.length],
      value: fmtVal(o.s.value, fig.unit), showLabel: big,
      tx: rnd(o.X + o.Wd / 2), ty: rnd(o.Y + o.Hd / 2 + 3),
      // EXPERIMENT (reversible): per-cell spotlight toggle. Clicking sets the spotlight to this category
      // (or clears it when re-clicking the active one). `active`/`dim` drive the chart's own emphasis.
      label: o.s.label,
      clickable,
      action: clickable ? setSpotlight(isActive ? null : o.s.label) : null,
      active: isActive,
      dim: clickable && active != null && !isActive,
    };
  });
  return {
    kind: 'treemap', isTreemap: true, title: fig.title || fig.figure_id, W: TREE_W, H: TREE_H, rects,
    moreCount: all.length > shown.length ? all.length - shown.length : 0,
    caption: fig.caption || '', insight: fig.insight || '',
  };
}

// Performance → bullet bars: each bar fills domain-relative (0–100% of the figure domain), colored by
// the same numeric gradient as the legend. Each row carries the series `label` (the referent — building
// ID at campus, zone/room at building scope) so the reader can tell what each bar is (user 2026-06-08).
function resolveBullet(fig, numericStops) {
  const series = fig.series || [];
  const shown = series.slice(0, SERIES_CAP);
  const lo = fig.domain ? fig.domain[0] : Math.min(0, ...shown.map((s) => s.value));
  const hi = fig.domain ? fig.domain[1] : Math.max(1, ...shown.map((s) => s.value));
  const dd = (hi - lo) || 1;
  const stops = (numericStops && numericStops.length) ? numericStops : null;
  // Trim the redundant leading "<building code>:" from building-scope zone labels
  // (RWC:FL1:CooperHall:Clsrm → FL1:CooperHall:Clsrm). Campus labels are bare codes with no ':' → untouched.
  const trim = (s) => (s && s.includes(':')) ? s.slice(s.indexOf(':') + 1) : (s || '');
  const bars = shown.map((s) => {
    const t = Math.max(0, Math.min(1, (s.value - lo) / dd));
    return { label: trim(s.label), pct: Math.max(1, Math.round(t * 100)), value: fmtVal(s.value, fig.unit),
      color: stops ? gradientHex(stops, t) : '#c8f24a' };
  });
  // ONE label-gutter width for the whole chart (so bars stay aligned) sized to the longest label: short
  // campus codes → narrow gutter (bars sit right next to the codes), longer zone labels → wider. Capped +
  // ellipsized by CSS. (user 2026-06-08: extend bullets toward the codes / close the dark gap.)
  // `ch` is the width of "0"; uppercase building codes (RWC, VMC, CDHP) have wider glyphs (W/M), so add
  // generous padding to avoid clipping short codes to "R…"/"V…". Long zone labels still cap + ellipsize.
  const maxLen = bars.reduce((m, b) => Math.max(m, b.label.length), 0);
  const labelCh = Math.min(22, Math.max(4, maxLen) + 2.5);
  return {
    kind: 'bullet', isBullet: true, title: fig.title || fig.figure_id, bars, labelCh,
    domainLabel: `${fmtVal(lo, fig.unit)} – ${fmtVal(hi, fig.unit)}`,
    moreCount: series.length > shown.length ? series.length - shown.length : 0,
    caption: fig.caption || '', insight: fig.insight || '',
  };
}

// Analytical → stepped columns: ordered bands (or a per-building skyline), height = value. Banded
// categoricals color via the legend swatch; numeric layers color by the gradient. Values shown only
// when few enough columns to fit.
const COL_H = 120;
function resolveColumns(fig, colorByLabel, numericStops) {
  const series = (fig.series || []).filter((s) => typeof s.value === 'number');
  const shown = series.slice(0, SERIES_CAP);
  const max = Math.max(1, ...shown.map((s) => s.value));
  const lo = fig.domain ? fig.domain[0] : 0;
  const hi = fig.domain ? fig.domain[1] : max;
  const dd = (hi - lo) || 1;
  const stops = (numericStops && numericStops.length) ? numericStops : null;
  const showVals = shown.length <= 8;
  const cols = shown.map((s, i) => ({
    h: Math.max(3, Math.round(s.value / max * COL_H)),
    color: colorByLabel[s.label]
      || (stops ? gradientHex(stops, Math.max(0, Math.min(1, (s.value - lo) / dd))) : DONUT_PALETTE[i % DONUT_PALETTE.length]),
    value: fmtVal(s.value, fig.unit), showVal: showVals,
  }));
  return {
    kind: 'columns', isColumns: true, title: fig.title || fig.figure_id, cols,
    moreCount: series.length > shown.length ? series.length - shown.length : 0,
    caption: fig.caption || '', insight: fig.insight || '',
  };
}

// Reconciliation → unit dot matrix: 1 dot ≈ N rooms, colored by the provenance legend swatch. A
// dominant bucket + long tail still reads (rare buckets get at least the proportional dot count).
function resolveDotMatrix(fig, colorByLabel) {
  const all = (fig.series || []).filter((s) => typeof s.value === 'number' && s.value > 0);
  const total = all.reduce((a, s) => a + s.value, 0) || 1;
  const per = Math.max(1, Math.ceil(total / 120));
  const dots = [];
  all.forEach((s, i) => {
    const c = colorByLabel[s.label] || DONUT_PALETTE[i % DONUT_PALETTE.length];
    const n = Math.round(s.value / per);
    for (let k = 0; k < n && dots.length < 160; k++) dots.push({ color: c });
  });
  return {
    kind: 'dotmatrix', isDots: true, title: fig.title || fig.figure_id, dots,
    per: per.toLocaleString('en-US'), total: total.toLocaleString('en-US'),
    moreCount: 0, caption: fig.caption || '', insight: fig.insight || '',
  };
}

// route a figure to its family's chart style (stat figures always stay stat tiles).
function resolveByFamily(fig, family, { colorByLabel, numericStops, spot }) {
  if (fig.type === 'stat') return resolveFigure(fig, {});
  if (family === 'Performance') return resolveBullet(fig, numericStops);
  if (family === 'Analytical') {
    // A vertical "skyline" can't show 15 per-building values legibly (no room for value labels), so
    // many-item analytical figures (deferred maintenance, FCNI, GSF, age, replacement, stories) render
    // as horizontal labeled bars — building ID + value readable. Few-item ordered bands stay as stepped
    // columns. (user 2026-06-08: analytical charts showed graphics with no value to read.)
    const n = (fig.series || []).filter((s) => typeof s.value === 'number').length;
    if (n > 8) return resolveBullet(fig, numericStops);
    return resolveColumns(fig, colorByLabel, numericStops);
  }
  if (family === 'Reconciliation') return resolveDotMatrix(fig, colorByLabel);
  return resolveTreemap(fig, colorByLabel, spot); // Categorical (default) — `spot` adds the spotlight toggle
}

export function buildSpec(vm, ctx = {}) {
  const blocks = [];
  const mode = vm.scope.mode;
  const buildingSelected = !!(vm.selection && vm.selection.kind === 'building');
  const push = (b) => blocks.push(b);

  // ---- RAIL (order matches the UI sandbox: Scope · Building · Layer · Legend · prose · figure · insight)
  const content = vm.content || {};
  const activeId = vm.activeLayer && vm.activeLayer.layer_id;
  const activeLabel = activeId
    ? (((vm.applicableLayers || []).find((l) => l.layer_id === activeId) || {}).label
        || vm.activeLayer.display_name || '')
    : '';
  const buildTarget = ctx.buildingTarget || (vm.focus && vm.focus.code) || null;
  // legend view-model — declared up here because the infographic block (below) colors its chart from it;
  // the legend BLOCK itself is pushed last in the rail (user order 2026-06-08).
  const lg = vm.legend;

  // 1. scope segmented control — always (no hint line; sandbox)
  push({
    id: 'scope', type: 'segmented', region: 'rail', required: true,
    title: 'Scope',
    options: [
      { id: 'campus', label: 'Campus', active: mode !== 'building', action: scopeUp() },
      { id: 'building', label: 'Building', active: mode === 'building',
        action: buildTarget ? enterBuilding(buildTarget) : null },
    ],
  });

  // 2. building selector — BOTH scopes (sandbox). Title "Building" at campus, "Focus" in building scope.
  //    No meta line (sandbox showMeta:false).
  const focusCode = vm.focus ? vm.focus.code : '';
  const focusBuilding = vm.buildings.find((b) => b.code === focusCode);
  push({
    id: 'building-select', type: 'select', region: 'rail', required: true,
    title: mode === 'building' ? 'Focus' : 'Building',
    // `valueLabel` + per-option `active`/`action` drive the viewer_v2 custom <details> dropdown
    // (skin_minimal). `value` + `options[].value/label` + `actions.change` keep the legacy default skin's
    // native <select> working — both consume the same block (additive, backward compatible).
    valueLabel: focusBuilding ? `${focusBuilding.code} · ${focusBuilding.name}` : 'Select a building…',
    options: [
      ...(vm.focus ? [] : [{ value: '', label: 'Select a building…' }]),
      ...vm.buildings.map((b) => ({
        value: b.code,
        label: `${b.code} · ${b.name}` + (b.hasGeometry ? '' : ' (no model)'),
        active: b.code === focusCode,
        action: enterBuilding(b.code),
      })),
    ],
    value: vm.focus ? vm.focus.code : '',
    actions: { change: (value) => (value ? enterBuilding(value) : null) },
  });

  // 3. layer chips — grouped by family (always, when layers apply)
  if (vm.applicableLayers && vm.applicableLayers.length) {
    const byFamily = new Map();
    for (const l of vm.applicableLayers) {
      if (!byFamily.has(l.family)) byFamily.set(l.family, []);
      byFamily.get(l.family).push(l);
    }
    const families = [...byFamily.keys()].sort((a, b) => FAMILY_ORDER.indexOf(a) - FAMILY_ORDER.indexOf(b));
    push({
      id: 'layers', type: 'chip-groups', region: 'rail', required: true,
      title: 'Layer',
      groups: families.map((fam) => ({
        family: FAMILY_LABEL[fam] || fam, // display label (short); tab↔panel pair on this same value
        chips: byFamily.get(fam).map((l) => ({
          id: l.layer_id, label: l.label, active: l.layer_id === activeId,
          action: setLayer(l.layer_id),
        })),
      })),
    });
  }

  // RAIL ORDER (user decision 2026-06-08): layer description → infographic → legend.
  // The legend block is built last (below, after the Key-takeaway insight) so it renders at the bottom.

  // 4. per-layer narrative prose (sandbox: heading = the layer name, body = its blurb), BOTH scopes.
  //    No section title (flat); heading is the active layer's label. When the active layer has no authored
  //    blurb (e.g. campus_building / room_use — content not regenerated), fall back to the scope's overview
  //    so the slot between legend and infographic is never empty.
  if (vm.activeLayer) {
    const blurb = content.layerBlurb;
    if (blurb && blurb.prose) {
      push({
        id: 'layer-prose', type: 'prose-titled', region: 'rail', required: false,
        sectionTitle: '', headline: activeLabel, prose: blurb.prose,
      });
    } else if (content.overview && content.overview.prose) {
      push({
        id: 'layer-prose', type: 'prose-titled', region: 'rail', required: false,
        sectionTitle: '', headline: content.overview.title || activeLabel, prose: content.overview.prose,
      });
    }
  }

  // 7. insights — the #infographics rail-section (ONE bordered section, the primary chart only).
  //    The campus headline stat is NOT here anymore — it is the "At a glance" overlay card (§6.2).
  const shown = (content.infographics || []).filter((f) => f.figure_id === content.primaryFigureId);
  if (shown.length) {
    // one chart style per layer family (user 2026-06-08); colors join the legend by label/value so
    // the chart shows VALUES ONLY (no category text repeated). Geometry pre-resolved by resolveByFamily.
    const family = (vm.activeLayer && vm.activeLayer.family) || 'Categorical';
    const colorByLabel = {};
    if (lg && lg.entries) for (const e of lg.entries) colorByLabel[e.label] = e.color;
    const numericStops = (lg && lg.kind === 'numeric' && lg.entries) ? lg.entries.map((e) => e.color) : null;
    // EXPERIMENT (reversible): the treemap cells become spotlight toggles for categorical layers — at campus
    // when they paint rooms (College / Space Category), and in building scope always (Division / Room Use /
    // Space Category / College). Otherwise the chart stays a plain, non-interactive treemap.
    const spot = {
      clickable: family === 'Categorical'
        && ((mode === 'campus' && vm.campusRender === 'rooms') || mode === 'building'),
      value: vm.spotlight ? vm.spotlight.value : null,
    };
    const figs = shown.map((f) => {
      const r = resolveByFamily(f, family, { colorByLabel, numericStops, spot });
      r.title = ''; // no figure eyebrow — the layer name already shows in the selector/legend/prose (user 2026-06-06)
      return r;
    });
    push({
      id: 'insights', type: 'figures', region: 'rail', required: false,
      sectionTitle: '', figures: figs, // no "Insights" heading (sandbox)
    });
  }

  // 9. legend — numeric (gradient + cascade) or categorical (swatches).
  if (vm.activeLayer && lg && lg.entries && lg.entries.length) {
    const label = vm.activeLayer.label || vm.activeLayer.display_name;
    if (lg.kind === 'numeric') {
      const block = {
        id: 'legend', type: 'legend-numeric', region: 'rail', required: false,
        label, stops: lg.entries.map((e) => e.color),
        gradientCss: `linear-gradient(to right, ${lg.entries.map((e) => e.color).join(',')})`,
        minLabel: lg.entries[0].label, maxLabel: lg.entries[lg.entries.length - 1].label,
      };
      if (lg.cascade) {
        const c = lg.cascade;
        block.cascade = {
          line: `Cascade: ${c.zone} zone · ${c.section} section · ${c.floor} floor · ${c.na} n/a`,
          nLine: `n = ${c.nEffective} effective`,
        };
      }
      push(block);
    } else {
      const entries = lg.entries.map((e) => ({ color: e.color, label: e.label }));
      push({
        id: 'legend', type: 'legend-categorical', region: 'rail', required: false,
        // many categories (e.g. campus "Building") → two-column swatch grid so the legend stays short
        label, entries, swatchClass: entries.length > 6 ? 'swatches two-col' : 'swatches',
      });
    }
  }

  // 10. per-layer "Key takeaway" insight — the active layer's primary infographic insight string.
  //     LAST block in the rail in BOTH modes (user decision 2026-06-08). Reuses
  //     content.infographics[primaryFigureId].insight (no new pipeline field).
  if (vm.activeLayer && content.primaryFigureId) {
    const primary = (content.infographics || []).find((f) => f.figure_id === content.primaryFigureId);
    const text = primary && primary.insight;
    if (text) {
      push({
        id: 'insight', type: 'insight', region: 'rail', required: false,
        eyebrow: 'Key takeaway', text,
      });
    }
  }

  // ---- READINGS (right, floating corner cards — matches the UI sandbox) ----
  // Campus + a building selected → that building's cards (content already switched to it in derive):
  //   At a glance (stats) → building-info card (no narrative) → Overview (narrative).
  // Campus + nothing selected → empty. Building scope → building header + room card on selection.
  const sel = vm.selection;
  if (mode === 'campus' && buildingSelected) {
    // campus: ONLY the building-info card (At-a-glance + Overview cards removed per user request)
    const block = {
      id: 'building-card', type: 'building-card', region: 'readings', required: true,
      identity: { code: sel.code, name: sel.name },
      rows: [
        { name: 'Rooms', value: Number(sel.roomCount || 0).toLocaleString('en-US') },
        { name: 'Total sqft', value: sel.totalSqftFormatted || '—' },
        ...(sel.readings || []).map((r) => ({ name: r.displayName, value: r.formatted })),
      ],
      sectionTitle: 'Building totals',
      actions: { explore: enterBuilding(sel.code), close: clearSelection() },
    };
    if (sel.active) {
      block.active = { label: sel.active.label, value: sel.active.formatted, color: sel.active.color || '' };
    }
    push(block);
  } else {
    // building scope shows the focused-building header; a room selection (building scope OR campus
    // room-paint room-select) shows the room-readings card. (rendering.md "Campus room-paint".)
    if (mode === 'building' && vm.focus) {
      push({ id: 'building-id', type: 'building-id', region: 'readings', required: false,
        code: vm.focus.code, name: vm.focus.name });
    }
    if (sel && sel.kind === 'room') {
      const { room, readings: rows, drift, key } = sel;
      push({
        id: 'room-readings', type: 'room-readings', region: 'readings', required: true,
        kick: `${key.split('::')[0]} · ${room.floor || ''}`,
        title: `${room.room_name || 'Room'} · ${room.room_id}`,
        drift: {
          status: drift ? (drift.status || '—') : '—',
          zoneSource: (drift && drift.zoneSource) || '',
        },
        rows: (rows || []).map((r) => ({ name: r.displayName, value: r.formatted })),
        actions: { close: clearSelection() },
      });
    }
  }

  // ---- HOVER (cursor) ------------------------------------------------------
  const h = vm.hover;
  if (h && h.lines && h.lines.length) {
    push({
      id: 'hover', type: 'hover', region: 'hover', required: false,
      lines: h.lines.map((ln, i) => ({ label: ln.label, value: String(ln.value), emphasis: i === 0, lineKind: ln.lineKind || '' })),
    });
  }

  return { blocks };
}
