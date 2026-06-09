// Composition root — boots the viewer engine (real geometry + WUC context + reconciled data) with the
// minimal-black skin + data/render_config.json (the cinematic-gold look). Wires state, data loaders, UI
// engine, spec, persistence, scene rig, and the minimal shell. This is the ONLY multi-domain importer.
//
// Also wires the minimal chrome that is NOT part of the spec/view-model: the top-bar ARTIFACT logo
// (static), the LAYER/CAMERA viewport tags, and the Layer family-tab switching (pure presentation —
// no state dispatch). The startup splash (black page · logo · lime progress → Enter) is here too.

import { createStore } from '../state/store.js';
import { dataLoaded } from '../state/actions.js';
import { configure, loadRegistries, loadManifest, loadRenderConfig, loadAllBuildings, loadAllContent, loadCameraViews } from '../data/loaders.js';
import { initRenderer } from '../rendering/scene.js';
import { addGroundLabels } from '../rendering/labels.js';
import { addBuildingBillboards, addParkingBillboards, addTrainBillboards } from '../rendering/billboards.js';
import { initUI } from '../ui/ui.js';
import { initFloorPlan } from '../ui/floorplan.js';
import { initScreenshot } from '../ui/screenshot.js';
import { minimalSkin } from '../ui/skins/minimal.js';
import { initPersistence, hydrateFromURL } from '../persistence/url-state.js';

// asset base = everything before "viewer/" (data/ + geometry/ live at the repo root)
const assetBase = location.pathname.replace(/viewer\/.*$/, '') || '/';
function url(rel) { return assetBase.replace(/\/$/, '/') + String(rel).replace(/^\//, ''); }

// Startup-splash logo. Drop a file at viewer/logo.* and it shows on the splash; if it's missing/fails
// to load the splash falls back to the "WesternU" text wordmark (no asset required).
// Candidates are tried in order — first that loads wins. To use a different name, edit this list.
const LOGO_SRC = ['logo.png', 'logo.svg', 'logo.webp', 'logo.jpg'];

// module-level handle so the top-level boot().catch can surface a failure on the splash overlay
let splashRef = null;

// ---- chrome: viewport tags (CAMERA / LAYER; not spec-driven) --------------------------------
function txt(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

// ---- startup splash controller --------------------------------------------------------------
// Tracks weighted load milestones (geometry dominates) and drives the lime progress bar; when every
// registered task completes it morphs the bar into the "Enter" button. A safety timer force-readies
// after a max wait so a single stalled/missing asset can never trap the user behind the splash.
function createSplash() {
  const el = (id) => document.getElementById(id);
  const splash = el('splash');
  const fill = el('splash-fill'), statusEl = el('splash-status'), pctEl = el('splash-pct');
  const enterBtn = el('splash-enter'), img = el('splash-logo-img'), wordmark = el('splash-wordmark');
  if (!splash) return { register() {}, update() {}, tick() {}, markReady() {}, onEnter() {}, fail() {} };

  // logo: the FIRST candidate (LOGO_SRC[0]) is already set as the <img src> in static HTML so it loads
  // before this module does — we only handle the error→next-candidate→wordmark fallback here. Start at
  // index 1 (HTML already attempted [0]); also cover the case where the HTML image finished/failed
  // before these listeners attached (img.complete).
  let li = 1;
  const tryNext = () => {
    if (li >= LOGO_SRC.length) { img.style.display = 'none'; if (wordmark) wordmark.style.display = 'block'; return; }
    img.src = LOGO_SRC[li++];
  };
  if (img) {
    img.addEventListener('error', tryNext);
    img.addEventListener('load', () => { if (img.naturalWidth > 0) img.style.display = 'block'; });
    if (img.complete) { if (img.naturalWidth > 0) img.style.display = 'block'; else tryNext(); }
  }

  const tasks = new Map(); // key -> { total, done, weight, label }
  let started = false, finished = false, forceTimer = null;
  const register = (key, total, weight, label) => tasks.set(key, { total: Math.max(1, total), done: 0, weight, label });
  const update = (key, total) => { const t = tasks.get(key); if (t) { t.total = Math.max(1, total); t.done = Math.min(t.done, t.total); render(); } };
  const progress = () => {
    let num = 0, den = 0;
    for (const t of tasks.values()) { den += t.weight; num += t.weight * (t.done / t.total); }
    return den ? num / den : 0;
  };
  const allDone = () => { if (!tasks.size) return false; for (const t of tasks.values()) if (t.done < t.total) return false; return true; };
  function render(label) {
    if (!started) { started = true; fill.classList.remove('indeterminate'); }
    const p = Math.min(1, progress());
    fill.style.width = (p * 100).toFixed(1) + '%';
    pctEl.textContent = Math.round(p * 100) + '%';
    if (label) statusEl.textContent = label;
    if (allDone()) markReady();
  }
  function tick(key, n, label) {
    const t = tasks.get(key); if (!t) return;
    t.done = Math.min(t.total, t.done + (n || 1));
    render(label || t.label);
  }
  function markReady() {
    if (finished) return; finished = true;
    if (forceTimer) clearTimeout(forceTimer);
    fill.style.width = '100%'; pctEl.textContent = '100%'; statusEl.textContent = 'Ready';
    splash.classList.add('ready');
    enterBtn.disabled = false; enterBtn.focus();
  }
  function onEnter(cb) {
    const go = () => {
      if (!splash.classList.contains('ready')) return;
      splash.classList.add('hidden');
      setTimeout(() => { splash.style.display = 'none'; }, 600);
      if (cb) cb();
    };
    enterBtn.addEventListener('click', go);
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && splash.classList.contains('ready')) go(); });
  }
  function fail(msg) {
    if (finished) return;
    splash.classList.remove('ready');
    fill.classList.remove('indeterminate');
    statusEl.textContent = 'Load failed';
    if (!splash.querySelector('.splash-err')) {
      const d = document.createElement('div'); d.className = 'splash-err'; d.textContent = String(msg || 'Unknown error');
      splash.querySelector('.splash-inner').appendChild(d);
    }
  }
  // Never trap the user: force-ready after a max wait even if a task never reports.
  forceTimer = setTimeout(() => { if (!finished) { console.warn('splash: forcing ready after timeout'); markReady(); } }, 35000);

  return { register, update, tick, markReady, onEnter, fail };
}

// (The top-bar Buildings/Rooms/Reconciled/Scope KPI strip was removed 2026-06-07 — the top-right now
// holds the ARTIFACT logo. Scope is still shown via the rail's segmented control + the LAYER viewport tag.)

// ---- chrome: Layer family tabs (pure presentation; no dispatch) ------------------------------
function ensureActiveTab(rail) {
  const sec = rail.querySelector('#layer-sec');
  if (!sec) return;
  const tabs = [...sec.querySelectorAll('.ftab')];
  const panels = [...sec.querySelectorAll('.fam-panel')];
  if (!tabs.length) return;
  const current = sec.querySelector('.ftab.on'); // survives non-layer re-renders (block is memoized)
  let fam = current ? current.dataset.fam : null;
  if (!fam || !tabs.some((t) => t.dataset.fam === fam)) {
    const activeChip = sec.querySelector('.chip[data-active="true"]');
    const panel = activeChip ? activeChip.closest('.fam-panel') : null;
    fam = panel ? panel.dataset.fam : tabs[0].dataset.fam;
  }
  tabs.forEach((t) => t.classList.toggle('on', t.dataset.fam === fam));
  panels.forEach((p) => p.classList.toggle('on', p.dataset.fam === fam));
}

function wireTabs(rail) {
  rail.addEventListener('click', (e) => {
    const t = e.target.closest('.ftab');
    if (!t) return;
    const sec = t.closest('#layer-sec');
    sec.querySelectorAll('.ftab').forEach((x) => x.classList.toggle('on', x === t));
    sec.querySelectorAll('.fam-panel').forEach((p) => p.classList.toggle('on', p.dataset.fam === t.dataset.fam));
  });
  const obs = new MutationObserver(() => ensureActiveTab(rail));
  obs.observe(rail, { childList: true, subtree: true });
  ensureActiveTab(rail);
}

async function boot() {
  configure({ assetBase });
  const store = createStore();

  // Startup splash + load-progress tracking. Weights make geometry (the slow part) dominate the bar.
  // 'buildings'/'content' totals are provisional (a sensible default) until the manifest resolves, so
  // the bar doesn't lurch when their real counts land. 'overlays' = the 3 async map-pin/label groups.
  const splash = createSplash();
  splashRef = splash;
  splash.register('core', 1, 1, 'Loading catalogues…');
  splash.register('context', 1, 2, 'Loading campus context…');
  splash.register('buildings', 18, 6, 'Loading building models…');
  splash.register('content', 19, 2, 'Loading building data…');
  splash.register('overlays', 3, 1, 'Loading map overlays…');
  splash.onEnter(() => { /* the 3D engine is already live behind the splash — just reveal it */ });

  // static site-landscape decoration (campus-world coords; non-interactive; both scopes).
  // CINEMATIC GOLD palette + shadow hints (sandbox/cinematic_gold_state.json checkpoint): trees deeper
  // green & cast shadows; roads a neutral grey ramp & receive the building shadows (flat ground decals).
  // `shadow` hint ('cast'|'receive') is honored by scene_v2's decor .then (rendering.md "Cinematic").
  const decor = [
      { key: '__trees__', url: 'geometry/Tree_Site.3dm', color: '#32763f', opacity: 0.7, edges: false, shadow: 'cast' },
      { key: '__trees_offsite__', url: 'geometry/Tree_Off%20Site.3dm', color: '#32763f', opacity: 0.7, edges: false, shadow: 'cast' },
      // Masterplan roads (Enturage.3dm `Roads` group). byLayer allowlist colors each importance level
      // and drops the file's other layers (Parking/Train/Promenade/Green Space/Station/Text).
      // Colors from the cinematic checkpoint (grey road ramp, not the earlier teal). (rendering.md)
      {
        key: '__roads__', url: 'geometry/Enturage.3dm', edges: false, shadow: 'receive',
        // The file carries duplicate leaf names under two groups: a `Nurbs::` source-Brep branch and a
        // `Mesh::` render branch — import ONLY the mesh branch (else the Breps double up + z-fight).
        underLayer: 'Mesh',
        // `z` = tiny per-layer lift (world units) that separates the coplanar ground layers (all
        // authored at ~grade) so their overlapping flat faces stop z-fighting/flickering — invisible at
        // campus scale (~4000 wide). Train lines/station are 3D (have height) → no lift needed.
        byLayer: {
          // Roads — neutral grey ramp; importance read via darkness/opacity (major darkest → tertiary).
          major: { color: '#b0b0b0', opacity: 0.30, z: 1.2 },
          minor: { color: '#999999', opacity: 0.31, z: 0.9 },
          tertiary: { color: '#707070', opacity: 0.40, z: 0.6 },
          // Train Lines — warm yellow (rail corridor strip).
          'train lines': { color: '#fbdf2d', opacity: 0.5 },
          // Train Station — mint green, fully opaque (3D massing, no z lift needed; edge effectively off).
          'train station': { color: '#35e9a4', opacity: 1 },
          // Green Space — sage-green. NOTE: z lift dropped → sits at grade.
          'green space': { color: '#758952', opacity: 0.75, edge: { color: '#adadad', thickness: 0.2 } },
          // Promenade — warm stone. NOTE: z lift dropped → sits at grade.
          'promenade': { color: '#b3aa89', opacity: 0.77, edge: { color: '#ababab', thickness: 0.2 } },
          // Parking — warm brown + grey edge outline.
          'parking': { color: '#685540', opacity: 0.65, z: 0.2, edge: { color: '#878787', thickness: 0.6 } },
        },
      },
  ];
  splash.register('decor', decor.length, 1, 'Loading landscape…');

  const { controls, scene } = initRenderer({
    container: document.getElementById('stage'), store, assetBase,
    contextUrl: 'geometry/WUC_Context.3dm', // the REAL campus backdrop (buildings + context)
    decor,
    // load-progress hook → startup splash (context / each decor group / each building model).
    onGeometry: (kind, id) => {
      if (kind === 'context') splash.tick('context', 1, 'Campus context loaded');
      else if (kind === 'decor') splash.tick('decor', 1, 'Landscape loaded');
      else if (kind === 'building') splash.tick('buildings', 1, `Building model · ${id}`);
    },
  });
  // Street-name labels (Enturage.3dm R1/R2/R3 Text layers) — flat white text on the ground, drawn
  // from the frozen artifact tools/extract_decor_labels.py emits. Campus-only: hidden in building
  // scope (gated by the store subscription below once the async group resolves).
  let labelsGroup = null;
  // scale: the Rhino text was authored tiny vs the ~2640u campus; 29.4× makes it legible on-street (knob).
  addGroundLabels(scene, url('data/decor/enturage_labels.json'), { color: '#ffffff', scale: 29.4, opacity: 0.5 })
    .then((g) => { labelsGroup = g; if (g) g.visible = store.getState().scope.mode === 'campus'; })
    .catch((e) => console.warn('labels failed', e))
    .finally(() => splash.tick('overlays', 1, 'Map overlays'));

  // Per-building floating "map pin" billboards (face the camera as you orbit). Built from the
  // manifest bounds once it loads (below); campus-only, gated in the scope subscription like labels.
  let billboardsGroup = null;

  // Per-parking-lot "P" badge billboards (Enturage.3dm Parking layer → frozen pin artifact).
  // Campus-only, gated like the building pins/labels once the async group resolves.
  let parkingGroup = null;
  addParkingBillboards(scene, url('data/decor/parking_pins.json'))
    .then((g) => { parkingGroup = g; if (g) g.visible = store.getState().scope.mode === 'campus'; })
    .catch((e) => console.warn('parking pins failed', e))
    .finally(() => splash.tick('overlays', 1, 'Map overlays'));

  // Train-station "train" badge billboard (Enturage.3dm Train Station layer → frozen pin
  // artifact). One combined tag for the station; 50% bigger than the parking badge. Campus-only.
  let trainGroup = null;
  addTrainBillboards(scene, url('data/decor/train_station_pins.json'))
    .then((g) => { trainGroup = g; if (g) g.visible = store.getState().scope.mode === 'campus'; })
    .catch((e) => console.warn('train pins failed', e))
    .finally(() => splash.tick('overlays', 1, 'Map overlays'));

  initUI({ root: document.getElementById('ui'), store, skin: minimalSkin });

  // Building dropdown = a custom <details> listbox (skin_minimal), NOT a native <select> — so there is no
  // native popup that flashes white over the WebGL canvas. <details> doesn't close on an outside click by
  // itself, so close it here (UI-only listener, like the hover/tab handlers): any click that is NOT on its
  // summary closes the open menu (an option pick also re-renders the block to a fresh closed <details>).
  document.addEventListener('click', (e) => {
    const det = document.getElementById('building-select');
    if (!det || !det.open) return;
    if (e.target.closest && e.target.closest('#building-select > summary')) return; // summary toggles natively
    det.open = false;
  });
  // 2D floor-plan panel (building scope; bottom-right floating card over the 3D). A store-subscriber UI
  // peer to the renderer (imports no three.js / Rendering) — ui.md "2D floor-plan panel".
  initFloorPlan({ container: document.getElementById('planpanel'), store });
  initScreenshot({ store }); // lime top-bar button → compose an A4 report card → native save dialog
  initPersistence({ store });

  // viewport CAMERA tag — live azimuth/elevation from the orbit controls (deg, no THREE import)
  (function camTag() {
    requestAnimationFrame(camTag);
    if (!controls) return;
    const az = Math.round((controls.getAzimuthalAngle() * 180) / Math.PI);
    const el = Math.round(90 - (controls.getPolarAngle() * 180) / Math.PI);
    txt('cam-tag', `az ${((az % 360) + 360) % 360}° · el ${el}°`);
  })();

  // LAYER viewport tag (+ campus-only street-label gating). The top-bar SCOPE KPI was removed; scope is
  // shown by the rail's segmented control.
  store.subscribe((vm) => {
    const L = vm.activeLayer;
    txt('layer-tag', L ? `${L.label || L.display_name} · ${L.value_type === 'numeric' ? '5-stop gradient' : 'categorical'}` : '—');
    if (labelsGroup) labelsGroup.visible = vm.scope.mode === 'campus';
    if (billboardsGroup) {
      billboardsGroup.visible = vm.scope.mode === 'campus';
      // live building-name + active-layer-value tags (campus); signature-deduped inside .update
      if (billboardsGroup.update) billboardsGroup.update(vm.buildingTags);
    }
    if (parkingGroup) parkingGroup.visible = vm.scope.mode === 'campus';
    if (trainGroup) trainGroup.visible = vm.scope.mode === 'campus';
  });

  // family-tab switching on the (engine-created) rail host
  const rail = document.querySelector('[data-region="rail"]');
  if (rail) wireTabs(rail);

  const [registries, manifest, renderConfig, cameraViews] = await Promise.all([
    loadRegistries(),
    loadManifest(),
    loadRenderConfig(), // → data/render_config.json (cinematic-gold). null/absent ⇒ defaults.js fallback
    loadCameraViews(), // saved starting cameras per scope (camera_tool.md); null ⇒ computed framing
  ]);
  store.dispatch(dataLoaded({ registries, manifest, renderConfig, cameraViews }));
  hydrateFromURL(store);

  // core catalogues are in; correct the provisional building/content counts to the real manifest size.
  splash.tick('core', 1, 'Catalogues loaded');
  splash.update('buildings', manifest.length);          // one geometry model per building
  splash.update('content', manifest.length + 1);        // per-building content/infographics + campus

  // Floating map-pin billboards from the manifest bounds (lime text/edge on dark, matches UI).
  billboardsGroup = addBuildingBillboards(scene, manifest, {
    lift: 1.5,
    screen: 0.069, refDist: 2000, damp: 0.6, minFrac: 0.02875, maxFrac: 0.1035,
  });
  if (billboardsGroup) billboardsGroup.visible = store.getState().scope.mode === 'campus';

  loadAllBuildings(manifest, (code, entry) => {
    store.dispatch(dataLoaded({ building: { code, entry } }));
  });
  loadAllContent(manifest, (scope, { content, infographics }) => {
    store.dispatch(dataLoaded({ content: { scope, artifact: content },
                               infographics: { scope, artifact: infographics } }));
    splash.tick('content', 1, `Building data · ${scope}`);
  });
}

boot().catch((e) => {
  console.error('boot failed', e);
  // surface on the splash (it covers the UI) so the user isn't left staring at a frozen progress bar
  try { splashRef && splashRef.fail(e && e.message); } catch (_) { /* ignore */ }
  const ui = document.getElementById('ui');
  if (ui) ui.insertAdjacentHTML('beforeend', `<div class="boot-error">Boot failed: ${e.message}</div>`);
});
