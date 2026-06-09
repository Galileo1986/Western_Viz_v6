// V2 minimal-black SKIN — one template per spec.js block `type`, emitting the markup/classes of
// UI_ClaudeIterations/viz_tool_minimal.html. SOP posture: architecture/skins.md (a skin = { templates,
// css }; the engine + spec are reused unchanged). The component CSS lives in viewer_v2/index.html
// (ported from the minimal preview); this skin's `css` carries ONLY the data-attribute state selectors
// (the declarative engine sets data-* instead of toggling `.on`/`.diverges` classes).
//
// Grammar (viewer/ui/skin-engine.js): {{path}} · repeat="coll" · if="path" · action="name". No logic.
// Values arrive already resolved/formatted from spec.js → a skin can't fabricate or alter a number.
//
// The Layer block renders the minimal's family TABS + panels; tab switching (pure presentation, no
// state dispatch) is wired by viewer_v2/app/main_v2.js (ensureActiveTab + delegated .ftab clicks),
// the same "UI-only listener" exception the hover host uses.

export const templates = {
  // 1. building dropdown — a CUSTOM <details> listbox, NOT a native <select>. A native <select> opened over
  //    the cinematic WebGL canvas shows a white popup for ~1s before its dark content paints (Chromium native-
  //    popup quirk over heavy GPU pages); <details> is plain styleable DOM that opens instantly. Summary =
  //    the field button (shows the current building's label); each option dispatches enterBuilding via its
  //    per-item `action`. Picking one changes `value` → the engine re-instantiates this block → a fresh
  //    <details> defaults to CLOSED (auto-close). Outside-click close is wired in main_v2 (UI-only listener).
  select:
    '<section class="sec" id="building-select-wrap">'
    + '<h3>{{title}}</h3>'
    + '<details class="bsel" id="building-select">'
    + '<summary class="field bsel-summary">{{valueLabel}}</summary>'
    + '<div class="bsel-menu">'
    + '<button class="bsel-opt" repeat="options" data-active="{{active}}" action="select">{{label}}</button>'
    + '</div>'
    + '</details>'
    + '</section>',

  // 2. scope segmented control (no hint line — UImigration.md §5)
  segmented:
    '<section class="sec scope">'
    + '<h3>{{title}}</h3>'
    + '<div class="seg"><button repeat="options" data-active="{{active}}" action="select">{{label}}</button></div>'
    + '</section>',

  // 3. campus overview prose
  prose:
    '<section class="sec" id="overview">'
    + '<h3 if="title">{{title}}</h3>'
    + '<p class="prose" if="prose">{{prose}}</p>'
    + '</section>',

  // 4. layer chips → minimal family tabs + panels (active tab set by main_v2 from the active chip)
  'chip-groups':
    '<section class="sec" id="layer-sec">'
    + '<h3>{{title}}</h3>'
    + '<div class="fam-tabs">'
    + '<button class="ftab" repeat="groups" data-fam="{{family}}">{{family}}</button>'
    + '</div>'
    + '<div class="fam-panels">'
    + '<div class="fam-panel" repeat="groups" data-fam="{{family}}">'
    + '<div class="chips"><button class="chip" repeat="chips" data-active="{{active}}" action="select">{{label}}</button></div>'
    + '</div>'
    + '</div>'
    + '</section>',

  // 5a. numeric legend (gradient + ticks + optional cascade)
  'legend-numeric':
    '<section class="sec" id="legend">'
    + '<h3>Legend — {{label}}</h3>'
    + '<div class="grad" style="background:{{gradientCss}}"></div>'
    + '<div class="grad-x"><span>{{minLabel}}</span><span>{{maxLabel}}</span></div>'
    + '<div class="cascade" if="cascade">{{cascade.line}}</div>'
    + '</section>',

  // 5b. categorical legend (swatches)
  'legend-categorical':
    '<section class="sec" id="legend">'
    + '<h3>Legend — {{label}}</h3>'
    + '<div class="{{swatchClass}}"><div class="sw" repeat="entries"><i style="background:{{color}}"></i><span>{{label}}</span></div></div>'
    + '</section>',

  // 6. per-layer narrative prose — heading = layer name (no section title when empty)
  'prose-titled':
    '<section class="sec">'
    + '<h3 if="sectionTitle">{{sectionTitle}}</h3>'
    + '<div class="blurb-head" if="headline">{{headline}}</div>'
    + '<p class="prose">{{prose}}</p>'
    + '</section>',

  // 7. insights — title + figures (stat tiles or horizontal bars)
  figures:
    '<section class="sec" id="infographics">'
    + '<h3 if="sectionTitle">{{sectionTitle}}</h3>'
    + '<div class="fig" repeat="figures">'
    + '<div class="fig-title" if="title">{{title}}</div>'
    + '<div class="stat-grid" if="isStat"><div class="stat" repeat="cells"><div class="sv">{{value}}</div><div class="sl">{{label}}</div></div></div>'
    + '<div class="barsh" if="isBars"><div class="barh-row" repeat="bars"><span class="barh-lbl">{{label}}</span><span class="barh-track"><span class="barh-fill" style="width:{{pct}}%;background:{{color}}"></span></span><span class="barh-val">{{value}}</span></div></div>'
    // donut (categorical layer pie figures, UImigration.md §11) — all geometry pre-resolved in spec.js
    + '<svg class="donut" if="isPie" viewBox="0 0 {{W}} {{H}}" width="{{W}}" height="{{H}}">'
    + '<defs>'
    + '<filter id="{{shadowId}}" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="2" flood-color="#000" flood-opacity="0.4"></feDropShadow></filter>'
    + '<linearGradient repeat="slices" id="{{gradId}}" gradientUnits="userSpaceOnUse" x1="{{gx1}}" y1="{{gy1}}" x2="{{gx2}}" y2="{{gy2}}"><stop offset="0%" stop-color="{{c0}}"></stop><stop offset="100%" stop-color="{{c1}}"></stop></linearGradient>'
    + '</defs>'
    + '<g class="donut-ring" style="filter:url(#{{shadowId}})"><path repeat="slices" d="{{d}}" fill="{{fill}}"></path></g>'
    + '<g repeat="legend"><text x="241" y="{{ly}}" text-anchor="end">{{label}} {{pct}}%</text><rect x="245" y="{{ry}}" width="8" height="8" rx="2" fill="{{swatch}}"></rect></g>'
    + '</svg>'
    // per-family chart styles (user 2026-06-08) — VALUES ONLY; color/position decodes via the legend.
    // Categorical → treemap (area = value).
    + '<svg class="treemap" if="isTreemap" viewBox="0 0 {{W}} {{H}}" width="100%" preserveAspectRatio="xMidYMid meet">'
    // EXPERIMENT (reversible): cells carry the spotlight toggle (action="select" → rect.action) + active/dim state.
    + '<g class="tcell" repeat="rects" data-clickable="{{clickable}}" data-active="{{active}}" data-dim="{{dim}}" action="select"><rect x="{{x}}" y="{{y}}" width="{{w}}" height="{{h}}" rx="3" fill="{{fill}}"></rect>'
    + '<text if="showLabel" x="{{tx}}" y="{{ty}}" text-anchor="middle">{{value}}</text></g>'
    + '</svg>'
    // Performance → bullet bars (row label + domain-relative length + gradient hue).
    + '<div class="bulleth" if="isBullet" style="--lblw:{{labelCh}}ch">'
    + '<div class="bullet-row" repeat="bars"><span class="bullet-lbl" title="{{label}}">{{label}}</span><span class="bullet-track"><span class="bullet-fill" style="width:{{pct}}%;background:{{color}}"></span></span><span class="bullet-val">{{value}}</span></div>'
    + '<div class="bullet-dom" if="domainLabel">range {{domainLabel}}</div>'
    + '</div>'
    // Analytical → stepped columns (ordered bands / skyline; value above when few enough).
    + '<div class="colsh" if="isColumns">'
    + '<div class="colh" repeat="cols"><div class="colh-v" if="showVal">{{value}}</div><div class="colh-bar" style="height:{{h}}px;background:{{color}}"></div></div>'
    + '</div>'
    // Reconciliation → unit dot matrix (1 dot ≈ N rooms; colored by provenance legend).
    + '<div class="dotmx-wrap" if="isDots">'
    + '<div class="dotmx"><i repeat="dots" style="background:{{color}}"></i></div>'
    + '<div class="dotmx-cap">1 dot ≈ {{per}} · {{total}} total</div>'
    + '</div>'
    + '<div class="fig-more" if="moreCount">+{{moreCount}} more</div>'
    + '<div class="fig-cap" if="caption">{{caption}}</div>'
    // NOTE: inline figure insight intentionally omitted — the insight is the separate "Key takeaway" block (§7)
    + '</div>'
    + '</section>',

  // 7b. per-layer "Key takeaway" insight (UImigration.md §7) — lime eyebrow + one short sentence
  insight:
    '<section class="sec">'
    + '<div class="insight-eyebrow">{{eyebrow}}</div>'
    + '<div class="insight-big">{{text}}</div>'
    + '</section>',

  // 7c. "At a glance" overlay card (campus) — headline stat tiles, split out of the rail (§6.2)
  glance:
    '<section class="sec glance"><h3>{{title}}</h3>'
    + '<div class="stat-grid"><div class="stat" repeat="cells"><div class="sv">{{value}}</div><div class="sl">{{label}}</div></div></div>'
    + '</section>',

  // 7d. focused-building header card (building scope, overlay) — code + name (sandbox sel-* style)
  'building-id':
    '<div class="sel-head">'
    + '<div class="sel-kick">Building</div>'
    + '<div class="sel-code">{{code}}</div>'
    + '<div class="sel-name">{{name}}</div>'
    + '</div>',

  // 8. building-info card (campus single-click) — sandbox sel-* style; NO narrative (that's the Overview card)
  'building-card':
    '<div class="sel-head">'
    + '<button class="sel-x" action="close">✕</button>'
    + '<div class="sel-kick">Building</div>'
    + '<div class="sel-code">{{identity.code}}</div>'
    + '<div class="sel-name">{{identity.name}}</div>'
    + '<div class="sel-active" if="active"><div class="sa-l">{{active.label}}</div>'
    + '<div class="sa-v"><span class="sa-sw" if="active.color" style="background:{{active.color}}"></span>{{active.value}}</div></div>'
    + '<div class="sel-sectitle">{{sectionTitle}}</div>'
    + '<div class="sel-table"><div class="sel-row" repeat="rows"><span class="rk">{{name}}</span><span class="rv">{{value}}</span></div></div>'
    + '<button class="sel-explore" action="explore">Explore building →</button>'
    + '</div>',

  // 9. room readings (building selection) — sandbox sel-* style; status-keyed badge dot + zone source
  'room-readings':
    '<div class="sel-head">'
    + '<button class="sel-x" action="close">✕</button>'
    + '<div class="sel-kick">{{kick}}</div>'
    + '<div class="sel-code sm">{{title}}</div>'
    + '<div class="sel-badge" data-status="{{drift.status}}"><span class="dot"></span><span>{{drift.status}}</span>'
    + '<span class="src" if="drift.zoneSource">· {{drift.zoneSource}}</span></div>'
    + '<div class="sel-sectitle">Readings</div>'
    + '<div class="sel-table"><div class="sel-row" repeat="rows"><span class="rk">{{name}}</span><span class="rv">{{value}}</span></div></div>'
    + '</div>',

  // 10. hover tooltip
  hover:
    '<div class="hv-wrap"><div class="hr" repeat="lines" data-emph="{{emphasis}}" data-line="{{lineKind}}">'
    + '<span class="l">{{label}}</span><span class="v">{{value}}</span></div></div>',
};

// State-attribute selectors (the engine uses data-* instead of toggled classes). Everything else is
// in viewer_v2/index.html. Loaded last by the engine → wins by source order.
export const css = `
.seg button[data-active="true"] { background:var(--ink); color:#0a0a0a; font-weight:500; }
.chip[data-active="true"] { color:#0a0a0a; background:var(--hi); border-color:var(--hi); font-weight:500; }
/* status-keyed reconciliation dot on the room card badge (sandbox) */
.sel-badge[data-status="FULL_MATCH"] .dot,
.sel-badge[data-status="ZONE_OK_NO_SECTION"] .dot { background:#5fd38a; }
.sel-badge[data-status="NO_END_ZONE_HAS_SECTION"] .dot { background:#e6c84e; }
.sel-badge[data-status="NO_ZONE_ASSIGNED"] .dot { background:#ff5d5d; }
.hr[data-emph="true"] .v { color:var(--hi); font-weight:500; }
/* building-mode tooltip: room number larger + lime */
.hr[data-line="number"] .v { color:var(--hi); font-size:14px; font-weight:600; }
.hv-wrap { display: contents; }
`;

export const minimalSkin = { templates, css };
