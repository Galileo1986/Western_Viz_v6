// State domain — view-model derivation. SOP: architecture/state.md, 00_module_map.md §5.
// The SINGLE layer-resolution site (spec §7). Pure fn of (raw, world). Imports Data +
// Interpretation (2 domains) — within budget.

import { resolve, resolveWithTier, scopePathFor } from '../data/cascade.js';
import { deriveMode, roomKey, resolveSelectionReadings, selectionDrift } from '../data/slots.js';
import { buildScale, encode } from '../interpretation/encode.js';
import { buildLegend } from '../interpretation/legend.js';
import { format } from '../interpretation/format.js';
import { globalStyle } from '../interpretation/defaults.js';

// rooms visible at the current scope (across loaded buildings). Two-state: campus = every room of
// every loaded building; building = ALL rooms of the focused building (no floor/zone filtering —
// floor/zone are selection, not navigation). cascade.md / state.md.
function roomsInScope(mode, raw, world) {
  if (mode === 'campus') {
    const out = [];
    for (const [code, entry] of world.buildings) {
      for (const room of entry.data.rooms) out.push({ code, room });
    }
    return out;
  }
  const entry = world.buildings.get(raw.scope.buildingCode);
  if (!entry) return [];
  const code = raw.scope.buildingCode;
  return entry.data.rooms.map((room) => ({ code, room }));
}

// Scope-aware menu/legend labels (mockup wording). Falls back to the registry display_name.
const SCOPE_LABELS = {
  campus: {
    zone_sqft: 'Total sqft', fill_rate_40h: 'Avg fill rate',
    occupied_rate: 'Avg occupied rate', use_occupancy_gap: 'Use vs occupancy gap',
  },
  building: {
    fill_rate_40h: 'Fill rate', occupied_rate: 'Occupied rate',
    daily_user_sessions: 'Daily sessions', daily_unique_users: 'Unique users',
    people_minutes_per_sqft: 'People-min / sqft', capacity: 'Capacity', division: 'Division',
    primary_usage: 'Primary usage', zone_type: 'Zone type', reconciliation_status: 'Reconciliation status',
  },
};
function layerLabel(slotId, mode, displayName) {
  return (SCOPE_LABELS[mode] && SCOPE_LABELS[mode][slotId]) || displayName;
}
// Menu family fallback (registry `family` wins; this only covers a layer missing the field). Three
// categories — Categorical / Performance / Analytical (user decision 2026-06-07; spec.js FAMILY_ORDER).
function layerFamily(valueType) {
  return valueType === 'categorical' ? 'Categorical' : 'Performance';
}

// Content block (claude.md §2.6): pick the content SCOPE, then join each deterministic infographic
// figure to its pre-authored caption by figure_id. Pure SELECT + JOIN — no prose, no numbers made
// here. Content scope: building mode → focused building; campus + a building selected → THAT
// building (per-building curated section in campus view); else campus. (ui.md §"Content sections")
// preferred chart per layer slot (the figure surfaced beside its layer in the no-scroll rail, ui.md).
const PRIMARY_FIGURE_BY_SLOT = {
  campus: { campus_building: 'sqft_by_building', fill_rate_40h: 'fill_rate_by_building',
    occupied_rate: 'occupied_rate_by_building', zone_sqft: 'sqft_by_building',
    space_category: 'space_category_distribution', college: 'college_mix', division: 'college_mix',
    underutilization: 'underutilization_mix', use_occupancy_gap: 'underutilization_mix',
    lab_allocation: 'lab_allocation_mix', condition_fci: 'condition_fci_mix',
    condition_fcni: 'fcni_by_building', deferred_maintenance: 'deferred_maintenance_by_building',
    replacement_value: 'replacement_value_by_building',
    // per-layer dedicated figures (2026-06-07) — every campus menu layer maps to a related chart
    healthcare_space: 'healthcare_space_mix', zone_source: 'zone_source_mix',
    reconciliation_status: 'reconciliation_status_mix', ownership: 'ownership_mix', ada_flag: 'ada_mix',
    building_age: 'building_age_by_building', gsf: 'gsf_by_building', stories: 'stories_by_building' },
  building: { fill_rate_40h: 'fill_rate_by_zone', occupied_rate: 'fill_rate_by_zone',
    division: 'division_mix', zone_sqft: 'space_category_distribution',
    space_category: 'space_category_distribution', college: 'college_mix',
    underutilization: 'underutilization_mix', use_occupancy_gap: 'underutilization_mix',
    lab_allocation: 'lab_allocation_mix',
    // per-layer dedicated figures (2026-06-07) — every building menu layer maps to a related chart
    room_use: 'room_use_mix', room_type: 'room_type_mix', space_standard: 'space_standard_mix',
    cpec_code: 'cpec_mix', healthcare_space: 'healthcare_space_mix', zone_source: 'zone_source_mix',
    capacity: 'capacity_by_zone', daily_user_sessions: 'sessions_by_zone',
    daily_unique_users: 'unique_users_by_zone', people_minutes_per_sqft: 'people_minutes_by_zone',
    nominal_seats: 'seats_by_room', sqft_per_seat: 'sqft_per_seat_by_room' },
};
function pickPrimaryFigure(figures, mode, slotId) {
  // Relevance must be EXPLICIT (ui.md "Infographic density"): only surface a figure that the active
  // layer's slot is mapped to for this scope. NO "first non-stat figure" fallback — that arbitrarily
  // showed one unrelated chart (Square footage by space type) on every layer lacking its own figure.
  // Unmapped slot ⇒ null ⇒ no infographic / no Key-takeaway block renders (spec.js gates on this).
  const ids = new Set(figures.map((f) => f.figure_id));
  const pref = (PRIMARY_FIGURE_BY_SLOT[mode] || {})[slotId];
  return (pref && ids.has(pref)) ? pref : null;
}

function buildContent(world, mode, buildingCode, activeLayerId, activeSlot, activeFamily) {
  // Content (rail: layer prose + infographic + Key-takeaway) follows the MODE scope only — NOT the
  // campus building selection. Selecting a building at campus must not re-scope the rail to that
  // building: the campus layer's primary figure (e.g. campus_building → sqft_by_building) is a
  // cross-building figure absent from per-building infographics, so re-scoping nulled primaryFigureId
  // and dropped BOTH the chart and the Key-takeaway. The selected building's specifics live entirely
  // in the right-hand building-info card (built from vm.selection, not content). (Old per-selection
  // re-scope fed the At-a-glance/Overview right cards, removed 2026-06-06 — now vestigial.)
  const scope = mode === 'building' ? buildingCode : 'campus';
  const content = (world.content && world.content.get(scope)) || null;
  const info = (world.infographics && world.infographics.get(scope)) || null;

  const overview = (content && content.overview) || null;
  const layerBlurb = (content && activeLayerId && content.layer_blurbs
    && content.layer_blurbs[activeLayerId]) || null;

  // reasoned analysis (building scope) = family-level prose for the active layer's family (§2.6-B).
  // Per-family (Categorical/Performance/Analytical), not per-layer. Campus uses `overview` instead.
  const familyKey = activeFamily || 'Categorical';
  const fam = content && content.family_analysis ? content.family_analysis[familyKey] : null;
  const analysis = (mode === 'building' && fam && fam.prose) ? { prose: fam.prose, family: familyKey } : null;

  const captionByFigure = {};
  if (content && Array.isArray(content.infographics)) {
    for (const c of content.infographics) captionByFigure[c.figure_id] = c;
  }
  const figures = (info && Array.isArray(info.figures)) ? info.figures : [];
  const infographics = figures.map((f) => {
    const c = captionByFigure[f.figure_id] || {};
    return {
      figure_id: f.figure_id, type: f.type, title: f.title, unit: f.unit,
      series: f.series, domain: f.domain,
      caption: c.caption || null, insight: c.insight || null,
    };
  });
  const primaryFigureId = pickPrimaryFigure(figures, mode, activeSlot);
  return { scope, overview, analysis, layerBlurb, infographics, primaryFigureId };
}

// find a loaded room record by its styleMap/geometry key, across loaded buildings
function findRoomByKey(world, key) {
  if (!key) return null;
  for (const entry of world.buildings.values()) {
    if (entry.byKey.has(key)) return entry.byKey.get(key);
  }
  return null;
}

// Curated room-readings list for a kind:'room' selection (UImigration.md §9 / state.md step 5):
// room-native strings (Division, FICM — Room Name omitted, it's the card title) → numeric slots resolvable at room (registry-driven,
// so a new numeric slot still auto-appears) → computed Zone Type assignment tier. Each row is
// { displayName, value, formatted, diverges } to match the room-readings spec block. Pure.
const ZONE_TIERS = [['end', 'End zone'], ['section', 'Section zone'], ['floor', 'Floor zone'], ['building', 'Building zone']];
function zoneTypeRow(room) {
  const z = room.zone_ids || {};
  for (const [k, label] of ZONE_TIERS) {
    if (z[k]) return { displayName: 'Zone Type', value: z[k], formatted: `${label} · ${z[k]}`, diverges: false };
  }
  return { displayName: 'Zone Type', value: null, formatted: '—', diverges: false };
}
function strRow(displayName, v) {
  return { displayName, value: v ?? null, formatted: (v === null || v === undefined || v === '') ? '—' : String(v), diverges: false };
}
function buildRoomReadings(room, slots) {
  const native = [
    strRow('Division', room.division),
    strRow('FICM', room.ficm),
  ];
  const numericSlots = slots.filter((s) => s.value_type === 'numeric' && (s.scope_levels || []).includes('room'));
  const numeric = resolveSelectionReadings(room, numericSlots).map((r) => ({
    displayName: r.displayName, value: r.value, formatted: format(r.value, r.slot), diverges: r.diverges,
  }));
  return [...native, ...numeric, zoneTypeRow(room)];
}

// compact, pre-formatted hover summary keyed to the ACTIVE LAYER (state.md derivation step 7):
//   campus  → 2 lines: building name + the active layer's building-tier value ("key takeaway")
//   building→ 3 lines: room name, room number, the active layer's value (finest tier — matches the room color)
// Pure; the active-layer value resolves through the same cascade the styleMap uses, so chart/tooltip agree.
function buildHover(world, raw, mode, activeLayer) {
  const room = findRoomByKey(world, raw.hoverKey);
  if (!room) return null;
  const lines = [];
  const layerLine = () => {
    if (!activeLayer) return;
    const v = resolve(scopePathFor(mode), activeLayer.data_source, room);
    if (v === null || v === undefined) return;
    lines.push({
      label: layerLabel(activeLayer.data_source, mode, activeLayer.display_name),
      value: activeLayer.__slot ? format(v, activeLayer.__slot) : String(v),
    });
  };
  if (mode === 'campus') {
    const code = raw.hoverKey.split('::')[0];
    const b = (world.manifest || []).find((m) => m.building_code === code);
    lines.push({ label: 'Building', value: (b && b.building_name) || code });
    layerLine(); // active-layer building-tier key takeaway
  } else {
    lines.push({ label: 'Number', value: String(room.room_id), lineKind: 'number' });
    lines.push({ label: 'Room', value: room.room_name || 'Room' });
    layerLine(); // active-layer value (finest tier)
  }
  return { key: raw.hoverKey, kind: mode === 'campus' ? 'building' : 'room', lines };
}

function pickActiveLayer(layers, slots, mode, activeLayerId) {
  const applicable = layers.filter((l) => l.applicable_scopes.includes(mode));
  if (!applicable.length) return { activeLayer: null, applicable: [] };
  let chosen = applicable.find((l) => l.layer_id === activeLayerId) || applicable[0];
  const slotOf = (l) => slots.find((s) => s.slot_id === l.data_source) || null;
  const slot = slotOf(chosen);
  const activeLayer = { ...chosen, __value_type: slot ? slot.value_type : 'numeric', __slot: slot };
  // enrich each applicable layer with menu family + scope-aware label (ui.md groups by family)
  const enriched = applicable.map((l) => {
    const s = slotOf(l);
    const vt = s ? s.value_type : 'numeric';
    return {
      layer_id: l.layer_id,
      display_name: l.display_name,
      label: layerLabel(l.data_source, mode, l.display_name),
      family: l.family || layerFamily(vt), // registry family (Categorical/Performance/Analytical)
    };
  });
  return { activeLayer, applicable: enriched };
}

// Building-focus meta for the dropdown line ("N rooms · X sqft"). Building scope only.
function buildFocus(world, raw, mode) {
  if (mode !== 'building') return null;
  const entry = world.buildings.get(raw.scope.buildingCode);
  if (!entry) return null;
  const rooms = entry.data.rooms || [];
  const totalSqft = rooms.reduce((a, r) => a + (typeof r.room_area === 'number' ? r.room_area : 0), 0);
  // building-tier capacity (same building-tier resolve as the building-info card), bare number so the
  // meta line reads "… · 1,840 capacity" (the UI appends the word). Null when unavailable. (ui.md)
  const rep = rooms[0] || null;
  let capacityFormatted = null;
  if (rep) {
    const cv = resolve(scopePathFor('campus'), 'capacity', rep);
    if (typeof cv === 'number') capacityFormatted = Math.round(cv).toLocaleString('en-US');
  }
  return {
    code: raw.scope.buildingCode,
    name: entry.data.building_name || raw.scope.buildingCode,
    roomCount: rooms.length,
    totalSqft,
    totalSqftFormatted: `${Math.round(totalSqft).toLocaleString('en-US')} sqft`,
    capacityFormatted,
  };
}

// Distribution histograms for the two highlight rates over the focused building's rooms (building
// scope only; n=buildings too small to distribute at campus). Binning + prose are pure here — UI
// renders bars only (ui.md). 10 bins over [0,1] (rates are ratios).
const QUANT_SLOTS = ['fill_rate_40h', 'occupied_rate'];
function buildQuant(world, raw, mode, slots) {
  if (mode !== 'building') return { visible: false, metrics: [] };
  const entry = world.buildings.get(raw.scope.buildingCode);
  if (!entry) return { visible: false, metrics: [] };
  const path = scopePathFor('building');
  const NB = 10;
  const metrics = [];
  for (const sid of QUANT_SLOTS) {
    const slot = slots.find((s) => s.slot_id === sid);
    if (!slot) continue;
    const vals = entry.data.rooms.map((r) => resolve(path, sid, r)).filter((v) => typeof v === 'number');
    const bins = new Array(NB).fill(0);
    for (const v of vals) {
      const t = v <= 0 ? 0 : v >= 1 ? 0.999999 : v;
      bins[Math.min(NB - 1, Math.floor(t * NB))]++;
    }
    const sorted = [...vals].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = n ? vals.reduce((a, b) => a + b, 0) / n : 0;
    const median = n ? (sorted[(n - 1) >> 1] + sorted[n >> 1]) / 2 : 0;
    const aboveHalf = n ? vals.filter((v) => v >= 0.5).length / n : 0;
    const label = layerLabel(sid, 'building', slot.display_name);
    const prose = n
      ? `Median ${format(median, slot)} across ${n} rooms (mean ${format(mean, slot)}). `
        + `${Math.round(aboveHalf * 100)}% of rooms at or above 50%.`
      : `No room-level ${label.toLowerCase()} values for this building.`;
    metrics.push({ slotId: sid, label, bins, domain: [0, 1], n, prose });
  }
  return { visible: true, metrics };
}

// Building-info card for a CAMPUS single-click selection (selection.kind='building'). Identity +
// size + the building-tier numeric aggregates + the active-layer value (reuses the already-computed
// envelopeStyle color) + a reconciliation summary. Building-tier readings = numeric slots whose
// scope_levels include 'building', resolved at the building cascade tier on a representative room
// (every room of a building shares the building-tier value). Pure. (state.md derivation step 5.)
function buildBuildingSelection(world, code, mode, reg, envelopeStyle, activeLayer) {
  const entry = world.buildings.get(code);
  const m = (world.manifest || []).find((b) => b.building_code === code);
  if (!entry && !m) return null;
  const rooms = (entry && entry.data.rooms) || [];
  const name = (entry && entry.data.building_name) || (m && m.building_name) || code;
  const totalSqft = rooms.reduce((a, r) => a + (typeof r.room_area === 'number' ? r.room_area : 0), 0);
  const path = scopePathFor('campus'); // building tier
  const rep = rooms[0] || null;
  const slots = reg.slots || [];

  const readings = [];
  if (rep) {
    for (const slot of slots) {
      if (slot.value_type !== 'numeric') continue;          // categoricals aren't building aggregates
      if (!(slot.scope_levels || []).includes('building')) continue;
      if (slot.slot_id === 'zone_sqft') continue;           // duplicate of the header's inventory sqft (drift), omit
      const v = resolve(path, slot.slot_id, rep);
      if (v === null || v === undefined) continue;
      readings.push({ displayName: layerLabel(slot.slot_id, mode, slot.display_name), formatted: format(v, slot) });
    }
  }

  let active = null;
  if (activeLayer && rep) {
    const v = resolve(path, activeLayer.data_source, rep);
    const es = (envelopeStyle || {})[code] || null;
    active = {
      label: layerLabel(activeLayer.data_source, mode, activeLayer.display_name),
      formatted: activeLayer.__slot ? format(v, activeLayer.__slot) : (v == null ? '—' : String(v)),
      color: es ? es.color : null,
    };
  }

  return {
    kind: 'building',
    key: code,
    code,
    name,
    roomCount: rooms.length,
    totalSqftFormatted: `${Math.round(totalSqft).toLocaleString('en-US')} sqft`,
    active,
    readings,
  };
}

function campusView(manifest) {
  const withBounds = manifest.filter((m) => m.bounds);
  if (!withBounds.length) return null;
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const m of withBounds) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], m.bounds.min[i]);
      max[i] = Math.max(max[i], m.bounds.max[i]);
    }
  }
  const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const span = Math.max(max[0] - min[0], max[1] - min[1]) || 100;
  // Same viewing angle (offset ratio 0.8 : -1.1 : 0.9), pulled closer to the geometry by
  // scaling all three offsets uniformly (smaller factor = nearer; was 1.0).
  const z = 0.68;
  return { target: c, position: [c[0] + span * 0.8 * z, c[1] - span * 1.1 * z, c[2] + span * 0.9 * z] };
}

// Building-scope framing: target = the building's bounds center (so it sits centered in the
// viewport), camera pulled in close on the seed angle (offset ratio 1 : -1 : 0.75). Computed
// at runtime from the building's own world bounds so it's tunable here rather than baked into
// the manifest's default_view. Uses the horizontal span (max X,Y) so tall buildings aren't
// pushed too far back. zoom < 1 = nearer.
function buildingView(m) {
  if (!m || !m.bounds || !m.bounds.min || !m.bounds.max) return null;
  const { min, max } = m.bounds;
  const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const span = Math.max(max[0] - min[0], max[1] - min[1]) || 100;
  const zoom = 0.7;
  return { target: c, position: [c[0] + span * zoom, c[1] - span * zoom, c[2] + span * 0.75 * zoom] };
}

// A manually-captured starting camera for the active scope (camera_tool.md), or null to fall back to the
// computed framing. Validated shape (position+target arrays) so a malformed artifact can't break the render.
// Tagged `raw:true` → applied verbatim by Rendering (no FOV rescale; it was framed at the shipped FOV).
function savedView(cameraViews, mode, buildingCode) {
  if (!cameraViews) return null;
  const v = mode === 'campus'
    ? cameraViews.campus
    : (cameraViews.buildings && cameraViews.buildings[buildingCode]);
  if (!v || !Array.isArray(v.position) || !Array.isArray(v.target)) return null;
  return { target: v.target, position: v.position, raw: true };
}

export function derive(raw, world) {
  const reg = world.registries || { slots: [], layers: [] };
  const mode = deriveMode(raw);

  const buildings = (world.manifest || []).map((m) => ({
    code: m.building_code,
    name: m.building_name,
    bounds: m.bounds,
    geometry_url: m.geometry_url,
    placement: m.placement || null,
    hasGeometry: !!m.bounds,
  }));

  const { activeLayer, applicable } = pickActiveLayer(reg.layers, reg.slots, mode, raw.activeLayerId);

  // ---- styleMap + legend (single layer-resolution + encode site) ----
  let styleMap = {};
  let envelopeStyle = {}; // building-code -> pre-encoded color (campus: the building-tier aggregate)
  let buildingTags = {};  // campus only: building-code -> { label, value } for the map-pin billboards (rendering.md)
  let legend = { kind: 'missing', entries: [] };
  // campus_render mode of the active layer (rendering.md "Campus room-paint"); default envelope. Surfaced
  // on the vm so Rendering (materials/pick) can switch campus coloring + selection without a tier lookup.
  let campusRender = (activeLayer && activeLayer.campus_render) || 'envelope';
  // EXPERIMENT (reversible): campus categorical-room spotlight. When a category is picked from the
  // infographic AND the active layer paints rooms at campus, collect the room keys whose value matches.
  // Rendering dims the rest. `applicable` gates it to campus room-paint so a stale value is inert.
  let spotlight = null;
  if (activeLayer) {
    const scoped = roomsInScope(mode, raw, world);
    // campus + room-paint resolves per-room at the fine tier; else the scope's start tier.
    const scopePath = scopePathFor(mode, campusRender);
    const slotId = activeLayer.data_source;
    const resolved = scoped.map(({ room }) => resolveWithTier(scopePath, slotId, room));
    const values = resolved.map((r) => r.value);
    const scale = buildScale(activeLayer, values, world.renderConfig, mode);
    scoped.forEach(({ code, room }, i) => {
      styleMap[roomKey(code, room.room_id)] = encode(values[i], scale, world.renderConfig, mode);
    });
    // EXPERIMENT (reversible): build the spotlight key-set from the same per-room resolution. Applies to
    // campus categorical room-paint AND building scope (where every room is painted) for categorical layers.
    const spotlightApplicable = (mode === 'campus' && campusRender === 'rooms')
      || (mode === 'building' && activeLayer.family === 'Categorical');
    if (spotlightApplicable && raw.spotlight != null) {
      const keys = new Set();
      scoped.forEach(({ code, room }, i) => {
        if (values[i] != null && String(values[i]) === String(raw.spotlight)) keys.add(roomKey(code, room.room_id));
      });
      spotlight = { value: raw.spotlight, keys };
    }
    // Envelope color + map-pin tag = the BUILDING-tier value, resolved SEPARATELY (always the building
    // tier) so it stays a per-building aggregate even when styleMap is per-room (room-paint). In envelope
    // mode this equals the styleMap value; in room-paint mode the renderer ignores the envelope color
    // (faint context shell) but the tag still reads a meaningful aggregate. (state.md derivation step 3.)
    if (mode === 'campus') {
      const seen = new Set();
      const tagLabel = layerLabel(activeLayer.data_source, mode, activeLayer.display_name);
      const bPath = scopePathFor('campus'); // building tier (no campusRender → aggregate)
      // Categorical layers show the building CODE only on the pin — no value line (per-building category
      // text is noisy/redundant; color + legend convey it).
      const showTagValue = activeLayer.__value_type !== 'categorical';
      scoped.forEach(({ code, room }) => {
        if (seen.has(code)) return;
        seen.add(code);
        const bv = resolveWithTier(bPath, slotId, room).value;
        envelopeStyle[code] = encode(bv, scale, world.renderConfig, mode);
        buildingTags[code] = {
          label: tagLabel,
          value: showTagValue
            ? (activeLayer.__slot ? format(bv, activeLayer.__slot) : (bv == null ? '—' : String(bv)))
            : null,
        };
      });
    }
    legend = buildLegend(activeLayer, activeLayer.__slot, scale, world.renderConfig, mode);
    // cascade breakdown (building scope, numeric layer): which tier supplied each room's value
    if (mode === 'building' && activeLayer.__value_type === 'numeric') {
      const cascade = { zone: 0, section: 0, floor: 0, building: 0, na: 0, nEffective: 0 };
      for (const r of resolved) {
        if (r.value === null || r.value === undefined) { cascade.na++; continue; }
        cascade.nEffective++;
        if (r.tier && cascade[r.tier] !== undefined) cascade[r.tier]++;
      }
      legend = { ...legend, cascade };
    }
  }

  // ---- selection (polymorphic: room | building) ----
  // A "<code>::<room>" key = a room selection (readings); a bare "<code>" key at campus = a
  // building selection (building-info card). state.md derivation step 5.
  let selection = null;
  if (raw.selectionKey) {
    if (raw.selectionKey.includes('::')) {
      let room = null;
      for (const entry of world.buildings.values()) {
        if (entry.byKey.has(raw.selectionKey)) { room = entry.byKey.get(raw.selectionKey); break; }
      }
      if (room) {
        const readings = buildRoomReadings(room, reg.slots);
        selection = { kind: 'room', key: raw.selectionKey, room, readings, drift: selectionDrift(room) };
      }
    } else if (mode === 'campus') {
      selection = buildBuildingSelection(world, raw.selectionKey, mode, reg, envelopeStyle, activeLayer);
    }
  }

  // ---- hover (transient pointer summary) ----
  const hover = buildHover(world, raw, mode, activeLayer);

  // ---- view ----
  // Priority: a live orbit (raw.viewTransform) > a manually-SAVED starting view (world.cameraViews,
  // camera_tool.md) > the computed scope default. A saved view is tagged `raw:true` so Rendering applies it
  // verbatim (it was framed at the shipped FOV → no VIEW_DIST_SCALE; rendering.md "Camera FOV").
  let view = raw.viewTransform || null;
  if (!view) {
    const saved = savedView(world.cameraViews, mode, raw.scope.buildingCode);
    if (saved) view = saved;
    else if (mode === 'campus') view = campusView(world.manifest || []);
    else {
      const m = (world.manifest || []).find((b) => b.building_code === raw.scope.buildingCode);
      view = buildingView(m) || (m && m.default_view) || campusView(world.manifest || []);
    }
  }

  // ---- building-focus meta + distribution histograms (building scope only) ----
  const focus = buildFocus(world, raw, mode);
  const quant = buildQuant(world, raw, mode, reg.slots);

  // ---- content (narrative + infographics, left rail) ----
  const activeLayerVM = activeLayer
    ? {
        layer_id: activeLayer.layer_id,
        display_name: activeLayer.display_name,
        label: layerLabel(activeLayer.data_source, mode, activeLayer.display_name),
        value_type: activeLayer.__value_type,
        family: activeLayer.family, // spec.js routes the infographic style by family (ui.md)
      }
    : null;
  const content = buildContent(world, mode, raw.scope.buildingCode,
    activeLayerVM && activeLayerVM.layer_id, activeLayer && activeLayer.data_source,
    activeLayer && activeLayer.family);

  return {
    scope: { mode, buildingCode: raw.scope.buildingCode },
    buildings,
    focus,
    activeLayer: activeLayerVM,
    applicableLayers: applicable, // already enriched: { layer_id, display_name, label, family }
    styleMap,
    envelopeStyle,
    buildingTags,
    campusRender, // active layer's campus_render mode ('envelope'|'rooms') — Rendering reads (rendering.md)
    legend,
    selection,
    hover,
    quant,
    content,
    view,
    ghost: raw.ghost || { on: false, opacity: 0.3 }, // 2D-plan ghost mode (Rendering reads). state.md
    spotlight, // EXPERIMENT (reversible): { value, keys:Set } | null — campus categorical-room spotlight
    global: globalStyle(world.renderConfig, mode),
  };
}
