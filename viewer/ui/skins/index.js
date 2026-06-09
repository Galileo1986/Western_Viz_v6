// Skin registry — the viewer-owned, ENUMERABLE set of UI skins. SOP: architecture/skins.md +
// architecture/ui_design.md (§The skin registry).
//
// A "skin" = { templates, css } (skins/default.js form). The registry is what makes "redesign by
// selection" bounded: the UI Design tool's skin picker and its chat `selectSkin` verb both choose
// from THESE ids — the model can only pick a skin that ships, never author markup. Adding a skin =
// one import + one REGISTRY entry, zero engine/tool changes (extension-cost test, claude.md §4).
//
// Each skin must cover every block `type` in spec.js or the engine's block-completeness validator
// rejects it and falls back to the default (skins.md guarantee #3). A skin may reuse the default
// templates and diverge only where it wants (see floating.js).

import { defaultSkin } from './default.js';
import { floatingSkin } from './floating.js';

export const DEFAULT_SKIN_ID = 'default';

// id → { label, skin }. Order = display order in the picker.
const REGISTRY = {
  default:  { label: 'Default (rail)',     skin: defaultSkin },
  floating: { label: 'Floating panels',    skin: floatingSkin },
};

// [{ id, label }] — the enumerated choice set (drives the panel picker + the chat `selectSkin` enum).
export function listSkins() {
  return Object.entries(REGISTRY).map(([id, { label }]) => ({ id, label }));
}

// id → skin module. Unknown id → the default (never returns undefined, so the engine always has a skin).
export function getSkin(id) {
  const entry = REGISTRY[id] || REGISTRY[DEFAULT_SKIN_ID];
  return entry.skin;
}

export function isSkinId(id) { return Object.prototype.hasOwnProperty.call(REGISTRY, id); }

// Build a usable skin from a pushed override artifact (data/ui_skin.json — SOP: ui_design.md
// §Generative skin authoring / persisting). The artifact carries { templates?, css? }; templates is
// MERGED onto the default so a partial override is still block-complete, and css falls back to the
// default's when omitted. Bad/empty artifact → the default skin (the viewer never ships broken UI).
export function skinFromOverride(json) {
  if (!json || (json.templates == null && json.css == null)) return getSkin(DEFAULT_SKIN_ID);
  return {
    templates: { ...defaultSkin.templates, ...(json.templates || {}) },
    css: json.css != null ? json.css : defaultSkin.css,
  };
}
