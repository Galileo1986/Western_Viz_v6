// Floating-panels skin — the first ALTERNATE skin, proving the swappable-skin seam (skins.md +
// architecture/ui_design.md). It REUSES the default skin's templates (a skin may reuse default
// markup and diverge only where it wants — skins.md) and ships its own CSS facet that dissolves the
// single left rail into independent, click-through FLOATING panels.
//
// Why reuse the default templates: it keeps the engine's block-completeness validator satisfied
// (every block type covered) and shows that "a redesign" can be a pure layout/structure change
// expressed in the skin's css. A later iteration can override individual templates here for genuine
// markup divergence (e.g. per-panel title bars / drag grips) without touching the engine.
//
// IMPORTANT — the skin css is injected by the engine as <style id="skin-css"> at RUNTIME, AFTER
// viewer/ui_layout.css. So it wins ties by source order. We PREPEND the default skin's css (the
// data-active / data-diverges state selectors + the display:contents wrappers the templates rely on)
// then append the floating layout — drop either and active chips / the readings card break.
//
// All cosmetics use the SAME CSS variables the finetune pass drives (--bg/--panel/--ink/--muted/
// --line/--accent), so the UI Design tool's theme + per-block knobs recolor this skin unchanged.

import { defaultSkin } from './default.js';

const FLOATING_CSS = `
/* ---- floating-panels layout (skin: floating) ------------------------------------------------ */
/* The rail stops being a solid panel: a transparent, full-viewport, CLICK-THROUGH flex container.
   Its blocks become individual floating cards; the gaps between them reveal the 3D stage behind and
   pass clicks through to it. (pointer-events:none on the container, auto on each card.) */
.panel.rail {
  top: 14px; left: 14px; right: 14px; bottom: 14px; width: auto; max-width: none;
  background: transparent; border: 0; border-radius: 0; padding: 0; backdrop-filter: none;
  overflow: visible; pointer-events: none;
  display: flex; flex-direction: column; align-items: flex-start; gap: 12px;
}
/* Each rail block = its own floating card (overrides .rail-section padding + border-bottom). */
.panel.rail > [data-block] {
  pointer-events: auto;
  width: 264px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: 11px 13px; backdrop-filter: blur(8px);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent),
              0 10px 30px rgba(0,0,0,0.5),
              0 0 22px color-mix(in srgb, var(--accent) 8%, transparent);
}
.panel.rail > [data-block]:last-child { border-bottom: 1px solid var(--line); }
/* keep prose from making a card run the full height */
.panel.rail > [data-block-type="prose"],
.panel.rail > [data-block-type="prose-titled"] { max-height: 32vh; overflow: auto; }

/* Insights (figures) pulled OUT of the left stack to the bottom-right corner (own floating panel).
   ID selector needed to beat #infographics{overflow:hidden} in the base css. */
.panel.rail > #infographics {
  position: absolute; right: 0; bottom: 0; left: auto; top: auto;
  width: 320px; max-height: 46vh; overflow: auto;
}

/* Readings (right) — floating card, top-right, height-capped so it never collides with the
   bottom-right insights panel. */
.panel.readings {
  top: 14px; right: 14px; left: auto; width: 308px; max-height: 52vh; overflow: auto;
  border-radius: 12px;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent),
              0 10px 30px rgba(0,0,0,0.5);
}
`;

export const floatingSkin = {
  templates: defaultSkin.templates,          // reuse default markup (skins.md)
  css: defaultSkin.css + '\n' + FLOATING_CSS, // state selectors + display:contents, THEN floating layout
};
