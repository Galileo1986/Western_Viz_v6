// Default skin — the FAITHFUL reproduction of today's UI. SOP: architecture/skins.md.
//
// One HTML template per block `type` (spec.js) + a small CSS patch. Loaded as a static JS module (not
// fetched) so a path error can never blank the UI. The templates reproduce the exact markup/classes of
// the old viewer/ui/ui.js; STATE that the old code expressed as toggled classes (`.active`,
// `.diverges`) is expressed here as `data-*` attributes (so a custom skin owns class names freely), and
// the CSS patch maps those data-attrs to the identical look. All other styling comes from the
// component CSS already in viewer/index.html (untouched), which these templates' classes still match.
//
// Grammar (skin-engine.js): {{path}} · repeat="coll" · if="path" · action="name". Each template's root
// element is the block root; the engine stamps data-block on it.

export const templates = {
  // 1. building dropdown (building scope) — wrap carries .scope-active (block only emitted in building)
  select:
    '<div class="rail-section scope-active" id="building-select-wrap">'
    + '<select class="rail-select" id="building-select" value="{{value}}" action="change">'
    + '<option repeat="options" value="{{value}}">{{label}}</option>'
    + '</select>'
    + '<div class="focus-meta">{{meta}}</div>'
    + '</div>',

  // 2. scope segmented control
  segmented:
    '<div class="rail-section scope-wrap">'
    + '<div class="rail-title">{{title}}</div>'
    + '<div class="seg"><button repeat="options" class="seg-btn" data-active="{{active}}" action="select">{{label}}</button></div>'
    + '<div class="scope-hint">{{hint}}</div>'
    + '</div>',

  // 3. campus overview prose
  prose:
    '<div class="rail-section" id="overview">'
    + '<h4 class="content-title" if="title">{{title}}</h4>'
    + '<p class="content-prose" if="prose">{{prose}}</p>'
    + '</div>',

  // 4. layer chips, grouped by family
  'chip-groups':
    '<div class="rail-section">'
    + '<div class="rail-title">{{title}}</div>'
    + '<div id="groups">'
    + '<div class="chip-group" repeat="groups">'
    + '<span class="chip-fam">{{family}}</span>'
    + '<div class="chips"><button class="layer-chip" repeat="chips" data-active="{{active}}" action="select">{{label}}</button></div>'
    + '</div>'
    + '</div>'
    + '</div>',

  // 5a. numeric legend (gradient + ticks + optional cascade)
  'legend-numeric':
    '<div class="rail-section" id="legend">'
    + '<h4>{{label}}</h4>'
    + '<div class="grad-bar" style="background:{{gradientCss}}"></div>'
    + '<div class="grad-ticks"><span>{{minLabel}}</span><span>{{maxLabel}}</span></div>'
    + '<div class="cascade-line" if="cascade">{{cascade.line}}</div>'
    + '<div class="cascade-line muted" if="cascade">{{cascade.nLine}}</div>'
    + '</div>',

  // 5b. categorical legend (swatches)
  'legend-categorical':
    '<div class="rail-section" id="legend">'
    + '<h4>{{label}}</h4>'
    + '<div class="swatch-row" repeat="entries"><span class="swatch" style="background:{{color}}"></span><span class="swatch-label">{{label}}</span></div>'
    + '</div>',

  // 6. reasoned analysis / about-this-layer
  'prose-titled':
    '<div class="rail-section">'
    + '<div class="rail-title">{{sectionTitle}}</div>'
    + '<div class="blurb-head" if="headline">{{headline}}</div>'
    + '<p class="content-prose">{{prose}}</p>'
    + '</div>',

  // 7. insights — one bordered rail-section with the title + figures (stat tiles or bars)
  figures:
    '<div class="rail-section" id="infographics">'
    + '<div class="rail-title">{{sectionTitle}}</div>'
    + '<div class="fig" repeat="figures">'
    + '<div class="fig-title">{{title}}</div>'
    + '<div class="stat-grid" if="isStat"><div class="stat-cell" repeat="cells"><div class="stat-val">{{value}}</div><div class="stat-lbl">{{label}}</div></div></div>'
    + '<div class="bars" if="isBars"><div class="bar-row" repeat="bars"><span class="bar-lbl">{{label}}</span><span class="bar-track"><span class="bar-fill" style="width:{{pct}}%"></span></span><span class="bar-val">{{value}}</span></div></div>'
    + '<div class="fig-more" if="moreCount">+{{moreCount}} more</div>'
    + '<div class="fig-cap" if="caption">{{caption}}</div>'
    + '<div class="fig-insight" if="insight">{{insight}}</div>'
    + '</div>'
    + '</div>',

  // 8. building-info card (campus single-click). Wrapper is display:contents → children flow as direct
  // children of .readings (faithful to the old direct-append).
  'building-card':
    '<div class="rd-card">'
    + '<div class="rd-head"><h4>{{identity.code}} · <span class="rd-bldg-name">{{identity.name}}</span></h4><button class="btn small" action="close">✕</button></div>'
    + '<p class="content-prose rd-narrative" if="narrative">{{narrative}}</p>'
    + '<div class="rd-active" if="active"><span class="swatch" if="active.color" style="background:{{active.color}}"></span><span class="rd-active-label">{{active.label}}</span><span class="rd-active-val">{{active.value}}</span></div>'
    + '<div class="rail-title">{{sectionTitle}}</div>'
    + '<div class="rd-table"><div class="rd-row" repeat="rows"><span class="rd-name">{{name}}</span><span class="rd-val">{{value}}</span></div></div>'
    + '<button class="btn explore-btn" action="explore">Explore building →</button>'
    + '</div>',

  // 9. room readings (building selection) — drift flag + per-row divergence
  'room-readings':
    '<div class="rd-card">'
    + '<div class="rd-head"><h4>{{title}}</h4><button class="btn small" action="close">✕</button></div>'
    + '<div class="rd-sub">{{sub}}</div>'
    + '<div class="drift" data-diverges="{{drift.diverges}}"><span class="drift-status">{{drift.status}}</span><span class="drift-src" if="drift.zoneSource">zone source: {{drift.zoneSource}}</span></div>'
    + '<div class="rd-table"><div class="rd-row" repeat="rows" data-diverges="{{diverges}}"><span class="rd-name">{{name}}</span><span class="rd-val">{{value}}</span><span class="rd-flag" if="diverges">⚑</span></div></div>'
    + '</div>',

  // 10. hover tooltip
  hover:
    '<div class="hv-wrap"><div class="hv-row" repeat="lines"><span class="hv-label">{{label}}</span><span class="hv-val">{{value}}</span></div></div>',
};

// CSS patch — ONLY the state-attribute selectors (because templates use data-* instead of toggled
// classes) + the display:contents wrappers. Everything else is inherited from viewer/index.html's
// component CSS (untouched). Loaded last by the engine → wins by source order.
export const css = `
.seg-btn[data-active="true"] { background:var(--accent); color:#1a1300; font-weight:600; }
.layer-chip[data-active="true"] { background:var(--accent); color:#1a1300; border-color:var(--accent); font-weight:600; }
.drift[data-diverges="false"] { background:rgba(89,161,79,0.12); }
.drift[data-diverges="true"] { background:rgba(225,87,89,0.15); border-color:#e15759; }
.rd-row[data-diverges="true"] .rd-val { color:#ffb3b3; }
.rd-card, .hv-wrap { display: contents; }
`;

export const defaultSkin = { templates, css };
