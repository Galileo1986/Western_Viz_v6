// State domain — the store: single source of truth. SOP: architecture/state.md.
// Holds raw state + the loaded "world"; reduces actions; re-derives the view-model; notifies.
// Imports actions (constants) + derive (same domain). No DOM, no IO, no rendering.

import { A } from './actions.js';
import { derive } from './derive.js';

const INITIAL_RAW = {
  scope: { buildingCode: null },
  selectionKey: null,
  activeLayerId: null,
  hoverKey: null,
  viewTransform: null,
  ghost: { on: false, opacity: 0.3 }, // 2D-plan ghost mode (transient — not in HYDRATE/URL). state.md
  spotlight: null, // EXPERIMENT (reversible): campus categorical-room spotlight value (transient)
};

function reduceRaw(raw, action) {
  switch (action.type) {
    case A.ENTER_BUILDING:
      // focus a building (campus → building, or switch focus); reset selection + camera
      return { ...raw, scope: { buildingCode: action.code }, selectionKey: null, viewTransform: null, spotlight: null };
    case A.SCOPE_UP:
      // two-state: building → campus
      return { ...raw, scope: { buildingCode: null }, selectionKey: null, viewTransform: null, spotlight: null };
    case A.SELECT:
      return { ...raw, selectionKey: action.key };
    case A.CLEAR_SELECTION:
      return { ...raw, selectionKey: null };
    case A.HOVER:
      return (action.key || null) === raw.hoverKey ? raw : { ...raw, hoverKey: action.key || null };
    case A.SET_LAYER:
      // EXPERIMENT (reversible): switching layer clears the spotlight (the old category no longer applies).
      return { ...raw, activeLayerId: action.layerId, spotlight: null };
    case A.SET_VIEW:
      return { ...raw, viewTransform: action.transform };
    case A.SET_GHOST:
      return { ...raw, ghost: { ...raw.ghost, ...(action.patch || {}) } };
    case A.SET_SPOTLIGHT: // EXPERIMENT (reversible): campus categorical-room spotlight
      return { ...raw, spotlight: action.value || null };
    case A.HYDRATE: {
      const u = action.urlState || {};
      return {
        ...raw,
        scope: { buildingCode: u.buildingCode ?? raw.scope.buildingCode },
        selectionKey: u.selectionKey ?? raw.selectionKey,
        activeLayerId: u.activeLayerId ?? raw.activeLayerId,
        viewTransform: u.viewTransform ?? raw.viewTransform,
      };
    }
    default:
      return raw;
  }
}

function reduceWorld(world, action) {
  if (action.type !== A.DATA_LOADED) return world;
  const p = action.payload || {};
  const next = { ...world, buildings: world.buildings, content: world.content, infographics: world.infographics };
  if (p.manifest) next.manifest = p.manifest;
  if (p.registries) next.registries = p.registries;
  if (p.renderConfig !== undefined) next.renderConfig = p.renderConfig;
  if (p.cameraViews !== undefined) next.cameraViews = p.cameraViews; // saved starting cameras (camera_tool.md)
  if (p.building) {
    // single shared Map instance, mutated in place (single ownership of the cache)
    world.buildings.set(p.building.code, p.building.entry);
  }
  // content/infographics artifacts, keyed by scope ('campus'|code); null = loaded & absent (§2.6)
  if (p.content) world.content.set(p.content.scope, p.content.artifact);
  if (p.infographics) world.infographics.set(p.infographics.scope, p.infographics.artifact);
  return next;
}

export function createStore(initialRaw) {
  let raw = { ...INITIAL_RAW, ...(initialRaw || {}) };
  let world = {
    manifest: [], registries: { slots: [], layers: [] }, renderConfig: null, cameraViews: null,
    buildings: new Map(), content: new Map(), infographics: new Map(),
  };
  const subs = new Set();
  let snapshot = derive(raw, world);

  function notify(action) {
    snapshot = derive(raw, world);
    for (const fn of subs) fn(snapshot, action || null);
  }

  return {
    getState: () => snapshot,
    getRaw: () => raw,
    dispatch(action) {
      raw = reduceRaw(raw, action);
      world = reduceWorld(world, action);
      notify(action);
    },
    subscribe(fn) {
      subs.add(fn);
      fn(snapshot, null); // push current snapshot immediately (no originating action)
      return () => subs.delete(fn);
    },
  };
}
