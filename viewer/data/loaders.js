// Data domain — loaders (the ONLY side-effecting part). SOP: architecture/data.md.
// One cache keyed by building code (spec §7: no duplicate caches). Idempotent. Imports
// indexRooms (same domain) only. No colors/DOM/three.js. main.js wires the asset base.

import { indexRooms } from './slots.js';

let ASSET_BASE = '/'; // repo root; set by main via configure()
export function configure(opts) {
  if (opts && opts.assetBase) ASSET_BASE = opts.assetBase;
}
function url(rel) {
  return ASSET_BASE.replace(/\/$/, '/') + String(rel).replace(/^\//, '');
}

async function getJSON(rel) {
  const res = await fetch(url(rel));
  if (!res.ok) throw new Error(`fetch ${rel} -> ${res.status}`);
  return res.json();
}

// ---- caches (single source per asset class) --------------------------------
const cache = {
  registries: null,
  manifest: null,
  renderConfig: undefined, // undefined = not attempted; null = attempted & absent
  skinOverride: undefined, // undefined = not attempted; null = attempted & absent → default skin
  cameraViews: undefined, // undefined = not attempted; null = attempted & absent → computed framing
  buildings: new Map(), // code -> { data, byKey }
  inflight: new Map(), // code -> Promise (dedupe concurrent loads)
  content: new Map(), // scope ('campus'|code) -> artifact | null (attempted & absent)
  infographics: new Map(), // scope -> artifact | null
  plans: new Map(), // building code -> 2D floor-plan artifact | null (attempted & absent)
};

export async function loadRegistries() {
  if (cache.registries) return cache.registries;
  const [slots, layers] = await Promise.all([
    getJSON('data/manifest/reading_slots.json'),
    getJSON('data/manifest/layer_registry.json'),
  ]);
  cache.registries = { slots, layers };
  return cache.registries;
}

export async function loadManifest() {
  if (cache.manifest) return cache.manifest;
  cache.manifest = await getJSON('data/manifest/building_manifest.json');
  return cache.manifest;
}

// Render-config is style-only and optional; Interpretation supplies defaults when absent.
export async function loadRenderConfig() {
  if (cache.renderConfig !== undefined) return cache.renderConfig;
  try {
    cache.renderConfig = await getJSON('data/render_config.json');
  } catch {
    cache.renderConfig = null;
  }
  return cache.renderConfig;
}

// UI skin override (architecture/ui_design.md) — style/structure-only, optional, "loaded last, empty =
// baseline" like ui_layout.css. Pushed by the UI Design tool's "Push to viewer". Absent/empty → null →
// the viewer uses its built-in default skin. no-store: a fresh push must not be served stale.
export async function loadSkinOverride() {
  if (cache.skinOverride !== undefined) return cache.skinOverride;
  try {
    const res = await fetch(url('data/ui_skin.json'), { cache: 'no-store' });
    if (!res.ok) { cache.skinOverride = null; return null; }
    const j = await res.json();
    cache.skinOverride = (j && (j.templates || j.css)) ? j : null;
  } catch {
    cache.skinOverride = null;
  }
  return cache.skinOverride;
}

// Saved starting cameras per scope (architecture/camera_tool.md) — optional, "loaded last, empty = baseline"
// like the skin override. Authored by the dev-only camera_tool; absent/empty ⇒ derive falls back to the
// computed campusView/buildingView framing. no-store: a fresh save must not be served stale.
export async function loadCameraViews() {
  if (cache.cameraViews !== undefined) return cache.cameraViews;
  try {
    const res = await fetch(url('data/camera_views.json'), { cache: 'no-store' });
    if (!res.ok) { cache.cameraViews = null; return null; }
    const j = await res.json();
    // treat a version-only / all-null artifact as absent (the fallback path stays clean)
    const hasAny = j && (j.campus || (j.buildings && Object.keys(j.buildings).length));
    cache.cameraViews = hasAny ? j : null;
  } catch {
    cache.cameraViews = null;
  }
  return cache.cameraViews;
}

// Idempotent per-building load; second call returns the cache. Builds the room index once.
export function loadBuilding(code) {
  const hit = cache.buildings.get(code);
  if (hit) return Promise.resolve(hit);
  const inflight = cache.inflight.get(code);
  if (inflight) return inflight;
  const p = getJSON(`data/buildings/${code}.json`)
    .then((data) => {
      const entry = { data, byKey: indexRooms(data) };
      cache.buildings.set(code, entry);
      cache.inflight.delete(code);
      return entry;
    })
    .catch((e) => {
      cache.inflight.delete(code);
      throw e;
    });
  cache.inflight.set(code, p);
  return p;
}

export function getCachedBuilding(code) {
  return cache.buildings.get(code) || null;
}

// Content + infographics (claude.md §2.6) — static, optional artifacts. Loaders ONLY fetch +
// cache; derive selects the scope + joins figure⋈caption (data.md). Absent file → cached as null
// (viewer renders fully without content). `scope` = 'campus' or a building code.
function optional(map, rel, scope) {
  if (map.has(scope)) return Promise.resolve(map.get(scope));
  return getJSON(rel)
    .then((art) => { map.set(scope, art); return art; })
    .catch(() => { map.set(scope, null); return null; });
}
// ---- Prose (hand-editable) → per-scope content artifact ----
// All on-screen PROSE lives in ONE editable file, data/content/prose.json (keyed by layer_id /
// figure_id / family / scope). The UI reads prose by key; numbers stay separate in data/infographics/.
// loadContent(scope) assembles the scope's content artifact (the shape derive.buildContent expects)
// from that single file — shared `layers`+`figures`, per-family `families` ({building} substituted),
// and `overview` (per scope, with `_template` fallback). No model; absent file → null (graceful).
// SOP: architecture/content_generation.md, claude.md §2.6.
let _prosePromise = null;
function loadProse() {
  if (!_prosePromise) _prosePromise = getJSON('data/content/prose.json').catch(() => null);
  return _prosePromise;
}
function _nameForScope(scope) {
  const m = (cache.manifest || []).find((b) => b.building_code === scope);
  return (m && m.building_name) || scope;
}
function _subst(s, name) { return typeof s === 'string' ? s.split('{building}').join(name) : s; }
function buildScopeContent(prose, scope) {
  if (!prose) return null;
  const figures = prose.figures || {};
  const infographics = Object.keys(figures).map((fid) => ({
    figure_id: fid, caption: figures[fid].caption || null,
    insight: figures[fid].insight || null, grounded_on: [],
  }));
  const ovBlock = (prose.overview || {});
  let overview = ovBlock[scope] || null;
  if (!overview && scope !== 'campus' && ovBlock._template) {
    const name = _nameForScope(scope);
    overview = { title: _subst(ovBlock._template.title, name), prose: _subst(ovBlock._template.prose, name), grounded_on: [] };
  }
  const family_analysis = {};
  if (scope !== 'campus' && prose.families) {
    const name = _nameForScope(scope);
    for (const fam of ['Categorical', 'Performance', 'Analytical', 'Reconciliation']) {
      if (prose.families[fam]) family_analysis[fam] = { prose: _subst(prose.families[fam], name), grounded_on: [] };
    }
  }
  return { version: '1', scope, overview: overview || null, family_analysis,
    layer_blurbs: prose.layers || {}, infographics };
}
export function loadContent(scope) {
  if (cache.content.has(scope)) return Promise.resolve(cache.content.get(scope));
  return loadProse().then((prose) => {
    const art = buildScopeContent(prose, scope);
    cache.content.set(scope, art);
    return art;
  });
}
export function loadInfographics(scope) {
  return optional(cache.infographics, `data/infographics/${scope}.json`, scope);
}

// 2D floor-plan artifact (architecture/ui.md, data_extraction.md) — static, optional, keyed by building
// code. Absent file → cached as null (the 2D-plan panel renders nothing → graceful absence, like content).
export function loadPlan(code) {
  return optional(cache.plans, `data/plan/${code}.json`, code);
}

// Load content + infographics for every scope (campus + each manifest building) in parallel;
// invoke onLoaded(scope, {content, infographics}) as each scope resolves (incremental dispatch).
export function loadAllContent(manifest, onLoaded) {
  const scopes = ['campus', ...manifest.map((m) => m.building_code)];
  return Promise.all(scopes.map((scope) =>
    Promise.all([loadContent(scope), loadInfographics(scope)])
      .then(([content, infographics]) => {
        if (onLoaded) onLoaded(scope, { content, infographics });
      })
  ));
}

// Campus load policy (spec §6.1): fetch every building in parallel; invoke onLoaded(code, entry)
// as each resolves so the caller can dispatch incrementally — render never blocks on the slowest.
export function loadAllBuildings(manifest, onLoaded) {
  return Promise.all(
    manifest.map((m) =>
      loadBuilding(m.building_code)
        .then((entry) => { if (onLoaded) onLoaded(m.building_code, entry); return entry; })
        .catch((e) => { console.warn('building load failed', m.building_code, e); return null; })
    )
  );
}
