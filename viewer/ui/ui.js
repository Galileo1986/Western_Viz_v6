// UI domain — THIN: subscribe → buildSpec(vm) → skin engine → DOM. SOP: architecture/ui.md + skins.md.
// Reads the VIEW-MODEL only; all interaction is bound by the engine from the spec's action descriptors
// (Layer 1). MUST NOT import Rendering. The ONE exception remains the #hover cursor-tracking listener,
// which only positions a view-model-driven element (ui.md).
//
// (The former hand-built rail/readings/hover render functions now live as: spec.js = WHAT information
// appears, skins/default.js = HOW it looks. Same DOM + behavior, split along the information seam.)

import { buildSpec } from './spec.js';
import { createSkinEngine } from './skin-engine.js';
import { getSkin, DEFAULT_SKIN_ID } from './skins/index.js';

// initUI({ root, store, skinId?, skin? }) → { setSkin(id), applySkin(skin) }.
// Skin resolution: an explicit `skin` OBJECT wins (the pushed data/ui_skin.json override, built via
// skins/index.js skinFromOverride); else `skinId` from the registry; else DEFAULT_SKIN_ID — so the
// shipped viewer's bare call is byte-for-byte the faithful default (backward compatible). The returned
// handle lets the dev-only UI Design tool swap/author skins LIVE; the viewer ignores it.
export function initUI({ root, store, skinId, skin }) {
  const engine = createSkinEngine({ root, store, skin: skin || getSkin(skinId || DEFAULT_SKIN_ID) });

  // UI-only navigation memory — the remembered building target for the Scope→Building button (not part
  // of the data view-model). Mirrors the old lastBuilding/defaultBuilding in ui.js.
  let lastBuilding = null;
  let defaultBuilding = null;

  // Coalesce renders to one per animation frame. The per-building data load fires a BURST of state
  // updates; rendering each one synchronously thrashes the rail ("scatter"). We keep the latest vm and
  // render once per frame. (Cheap nav-memory bookkeeping still runs on every update.)
  let pendingVM = null;
  let scheduled = false;
  function flush() {
    scheduled = false;
    const vm = pendingVM;
    if (!vm) return;
    const spec = buildSpec(vm, { buildingTarget: lastBuilding || defaultBuilding });
    engine.render(spec);
    // (validator report is { ok, missing }; the default skin always satisfies it. Custom skins are
    // validated + fall back at the lab/override boundary — see skins.md / the Lab Skin editor.)
  }

  store.subscribe((vm) => {
    if (vm.scope.mode === 'building' && vm.scope.buildingCode) lastBuilding = vm.scope.buildingCode;
    if (!defaultBuilding) {
      const firstGeo = vm.buildings.find((b) => b.hasGeometry) || vm.buildings[0];
      defaultBuilding = firstGeo ? firstGeo.code : null;
    }
    pendingVM = vm;
    if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
  });

  // hover positioning — the ONE allowed exception (ui.md): touches only the #hover element's position.
  // Move via `transform` (compositor-only) NOT left/top: left/top re-layout + re-blur the backdrop every
  // frame, which made the tooltip visibly lag the cursor. translate is GPU-composited → smooth.
  const hoverHost = engine.hosts.hover;
  hoverHost.style.willChange = 'transform';
  window.addEventListener('pointermove', (e) => {
    hoverHost.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
  });

  // Live skin swap (UI Design tool only). Switching the skin doesn't dispatch a state change, so we
  // re-render the latest view-model through the new templates/css ourselves.
  function setSkin(id) { return applySkin(getSkin(id)); }

  // Apply a skin OBJECT directly ({ templates, css }) — used by the UI Design tool's generative skin
  // authoring (the model emits a skin; we render it live and RETURN the engine's validator report
  // { ok, missing } so the author loop can self-correct an incomplete skin). Re-renders the latest
  // view-model. Reversible (just setSkin back to a registry id). The viewer never calls this.
  function applySkin(skin) {
    engine.setSkin(skin);
    if (!pendingVM) return { ok: true, missing: [] };
    return engine.render(buildSpec(pendingVM, { buildingTarget: lastBuilding || defaultBuilding }));
  }

  return { setSkin, applySkin };
}
