// State domain — action creators (PURE). SOP: architecture/state.md.
// The only way state changes. UI/Rendering build + dispatch these (spec §7: no logic in handlers).

// Two-state navigation: ENTER_BUILDING focuses a building (campus → building, or switches focus);
// SCOPE_UP returns to campus. Floor/zone are selection, not navigation (state.md, cascade.md).
export const A = {
  ENTER_BUILDING: 'ENTER_BUILDING',
  SCOPE_UP: 'SCOPE_UP',
  SELECT: 'SELECT',
  CLEAR_SELECTION: 'CLEAR_SELECTION',
  HOVER: 'HOVER',
  SET_LAYER: 'SET_LAYER',
  SET_VIEW: 'SET_VIEW',
  SET_GHOST: 'SET_GHOST',
  SET_SPOTLIGHT: 'SET_SPOTLIGHT', // EXPERIMENT (reversible): infographic-driven campus room spotlight
  DATA_LOADED: 'DATA_LOADED',
  HYDRATE: 'HYDRATE',
};

export const enterBuilding = (code) => ({ type: A.ENTER_BUILDING, code });
export const scopeUp = () => ({ type: A.SCOPE_UP });
export const select = (key) => ({ type: A.SELECT, key });
export const clearSelection = () => ({ type: A.CLEAR_SELECTION });
export const hover = (key) => ({ type: A.HOVER, key });
export const setLayer = (layerId) => ({ type: A.SET_LAYER, layerId });
export const setView = (transform) => ({ type: A.SET_VIEW, transform });
// 2D-plan ghost mode (patch-merges raw.ghost; transient — not persisted). state.md / ui.md.
export const setGhost = (patch) => ({ type: A.SET_GHOST, patch });
// EXPERIMENT (reversible): campus categorical-room spotlight. Clicking an infographic category sets the
// spotlight to that value; all non-matching rooms dim. `value=null` clears it. Transient (not persisted),
// auto-cleared on layer/scope change. To revert this feature, delete its marked blocks across
// actions/store/derive/spec/skin/materials/scene.
export const setSpotlight = (value) => ({ type: A.SET_SPOTLIGHT, value: value || null });
export const dataLoaded = (payload) => ({ type: A.DATA_LOADED, payload });
export const hydrate = (urlState) => ({ type: A.HYDRATE, urlState });
