// Rendering domain — campus-scope floating "map pin" billboards (buildings, parking, train station).
//
// Each pin is a THREE.Sprite, which always faces the camera (billboards on all axes) → the label
// stays upright and readable from every orbit angle, for free, with no render-loop hook. The graphic
// is a canvas-drawn map pin: white text/lines on a near-black panel with a downward pointer whose node
// sits on the geometry. Non-interactive (no userData.key, not in the pickable `groups`), positioned in
// campus-world coords (buildings from the manifest bounds; parking/train from frozen pin artifacts).
//
// A standalone overlay module (imports three only), sibling to labels.js — shared by both the main
// viewer and viewer_v2, wired from each composition root; the host toggles the group's .visible for
// campus-only gating. See architecture/rendering.md "Map-pin billboards".

import * as THREE from 'three';

// Shared font stack. "Inter" is named in the page CSS but never loaded, so the canvas falls back to a
// system font — and Arial/Segoe UI ship only normal/bold, ignoring sub-400 weights. Naming actual thin
// FAMILIES ("Segoe UI Light"/"Semilight" on Windows) gets a genuinely thin face; the numeric weight
// then picks the lightest available within it. Fallbacks keep it sane elsewhere.
const FONT_FAMILY = '"Segoe UI Light","Segoe UI Semilight","Inter Light","Inter",Arial,sans-serif';
const fontOf = (px, weight = 100) => `${weight} ${px}px ${FONT_FAMILY}`;

// Draw one building map-pin graphic onto a canvas and return { canvas, aspect, centerY }.
// A rectangular label box (near-black fill, hairline border) joined by a thin vertical stem to a
// filled circular node at the bottom — the node's centre is the anchor that sits on the building.
// `centerY` is that anchor as a fraction up from the canvas bottom, so the sprite can pin the dot
// (not the box) to the world position.
//
// COMPACT TWO-PART layout (content = { title, value }):
//   row 1 — `title` (building ID / code), white, LARGER font
//   row 2 — `value` (active-layer building-tier value), lime accent, smaller font (omitted → code-only pin).
// The box auto-sizes to the widest row; the value line updates live as the active layer changes.
function drawPin(content, { ink, panel, line, accent }) {
  const title = content.title || '';
  const value = (content.value === null || content.value === undefined) ? '' : String(content.value);
  const hasValue = value !== '';

  const dpr = 2;                 // author crisp; texture is downsampled by mip/anisotropy at distance
  const titlePx = 30 * dpr;      // building ID (code) — LARGER than the value (user request)
  const valuePx = 22 * dpr;      // the active-layer value — smaller than the ID
  const padX = 16 * dpr;
  const padY = 11 * dpr;
  const rowGap = 4 * dpr;        // gap below the title before the value
  const radius = 3 * dpr;        // near-square corner
  const border = 0.75 * dpr;     // box edge (hairline)
  const stemH = 78 * dpr;        // vertical line from box down to the node
  const stemW = 0.75 * dpr;      // stem thickness (hairline)
  const nodeR = 6 * dpr;         // node (dot) radius
  const nodeRing = 0.75 * dpr;   // node ring thickness (hairline)
  const titleFont = fontOf(titlePx, 300);
  const valueFont = fontOf(valuePx, 400);

  // measure each row on a scratch context to size the box to the widest
  const scratch = document.createElement('canvas').getContext('2d');
  const measure = (txt, font) => { scratch.font = font; return Math.ceil(scratch.measureText(txt).width); };
  const titleW = measure(title, titleFont);
  const valueW = hasValue ? measure(value, valueFont) : 0;
  const textW = Math.max(titleW, valueW);

  let textH = titlePx;
  if (hasValue) textH += rowGap + valuePx;

  const boxW = textW + padX * 2;
  const boxH = textH + padY * 2;
  const margin = Math.max(border, nodeR + nodeRing) + 1 * dpr; // keep strokes inside the canvas
  const cw = boxW + margin * 2;
  const ch = margin + boxH + stemH + nodeR * 2 + margin;

  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext('2d');

  const x = margin;
  const y = margin;
  const cx = cw / 2;

  // --- stem (thin vertical line from box base to node centre), drawn first so the box overlaps it
  const nodeCy = y + boxH + stemH + nodeR;
  ctx.strokeStyle = line;
  ctx.lineWidth = stemW;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, y + boxH);
  ctx.lineTo(cx, nodeCy);
  ctx.stroke();

  // --- label box: rounded rectangle, near-black fill + hairline border
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + boxW - radius, y);
  ctx.arcTo(x + boxW, y, x + boxW, y + radius, radius);
  ctx.lineTo(x + boxW, y + boxH - radius);
  ctx.arcTo(x + boxW, y + boxH, x + boxW - radius, y + boxH, radius);
  ctx.lineTo(x + radius, y + boxH);
  ctx.arcTo(x, y + boxH, x, y + boxH - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.lineWidth = border;
  ctx.strokeStyle = line;
  ctx.lineJoin = 'miter';
  ctx.stroke();

  // --- node: near-black filled circle with a hairline ring
  ctx.beginPath();
  ctx.arc(cx, nodeCy, nodeR, 0, Math.PI * 2);
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.lineWidth = nodeRing;
  ctx.strokeStyle = line;
  ctx.stroke();

  // --- text rows (top-anchored, centered)
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let ty = y + padY;
  ctx.font = titleFont;
  ctx.fillStyle = ink;
  ctx.fillText(title, cx, ty);
  ty += titlePx;
  if (hasValue) {
    ty += rowGap;
    ctx.font = valueFont;
    ctx.fillStyle = accent;
    ctx.fillText(value, cx, ty);
  }

  // anchor = node centre, as a fraction up from the canvas bottom
  return { canvas: cv, aspect: cw / ch, centerY: (ch - nodeCy) / ch };
}

// Draw a circular badge pin → { canvas, aspect, centerY }. Same palette as drawPin: a (white) ring on
// a near-black disc, joined by a SHORT stem to a SMALL node — so these read as shorter, lower tags with
// a tinier pointer than the building pins. The center symbol is drawn by `drawGlyph(ctx, cx, cy, r,
// style)` so parking ("P") and train (icon) badges share all the disc/stem/node geometry.
function drawCircleBadge(style, drawGlyph) {
  const { panel, line } = style;
  const dpr = 2;
  const badgeR = 19 * dpr;       // disc radius
  const ring = 0.75 * dpr;       // ring thickness (hairline, matches building edges)
  const stemH = 26 * dpr;        // SHORT stem (building pins use 78) → badge sits lower
  const stemW = 0.75 * dpr;      // hairline stem
  const nodeR = 2.5 * dpr;       // MUCH smaller node than the building pins (building uses 6)
  const nodeRing = 0.75 * dpr;

  const margin = badgeR + ring + 1 * dpr; // disc is the widest element
  const cw = badgeR * 2 + margin * 2;
  const ch = margin + badgeR * 2 + stemH + nodeR * 2 + margin;

  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const ctx = cv.getContext('2d');

  const cx = cw / 2;
  const badgeCy = margin + badgeR;
  const nodeCy = margin + badgeR * 2 + stemH + nodeR;

  // stem first so the disc overlaps its top
  ctx.strokeStyle = line;
  ctx.lineWidth = stemW;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, badgeCy + badgeR);
  ctx.lineTo(cx, nodeCy);
  ctx.stroke();

  // disc: near-black fill + ring
  ctx.beginPath();
  ctx.arc(cx, badgeCy, badgeR, 0, Math.PI * 2);
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.lineWidth = ring;
  ctx.strokeStyle = line;
  ctx.stroke();

  // node: small near-black dot with a ring
  ctx.beginPath();
  ctx.arc(cx, nodeCy, nodeR, 0, Math.PI * 2);
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.lineWidth = nodeRing;
  ctx.strokeStyle = line;
  ctx.stroke();

  // center symbol (drawn within the disc, radius badgeR)
  drawGlyph(ctx, cx, badgeCy, badgeR, style);

  return { canvas: cv, aspect: cw / ch, centerY: (ch - nodeCy) / ch };
}

// Parking glyph: a centered "P".
function parkingGlyph(ctx, cx, cy, r, { ink }) {
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = fontOf(r * 1.26); // P cap ≈ the old 24px at r=19px
  ctx.fillText('P', cx, cy);
}

// Train glyph: a simple front-view train pictogram (stroked body using the dark disc as its fill, a
// filled window band, two headlights, two legs) — reads as a train/station at small on-screen sizes.
function trainGlyph(ctx, cx, cy, r, { ink }) {
  const w = r * 0.92;            // body width
  const h = r * 1.16;            // body height
  const lw = Math.max(1, r * 0.1);
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const yTop = cy - h * 0.52;
  const yBot = cy + h * 0.30;    // body bottom (room for legs below, within the disc)
  const rTop = r * 0.34, rBot = r * 0.14;

  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // body outline (rounded top, slightly rounded bottom); interior stays the dark disc
  ctx.beginPath();
  ctx.moveTo(x0, yTop + rTop);
  ctx.arcTo(x0, yTop, x0 + rTop, yTop, rTop);
  ctx.lineTo(x1 - rTop, yTop);
  ctx.arcTo(x1, yTop, x1, yTop + rTop, rTop);
  ctx.lineTo(x1, yBot - rBot);
  ctx.arcTo(x1, yBot, x1 - rBot, yBot, rBot);
  ctx.lineTo(x0 + rBot, yBot);
  ctx.arcTo(x0, yBot, x0, yBot - rBot, rBot);
  ctx.closePath();
  ctx.stroke();

  // window band (filled), upper portion
  const wy0 = yTop + h * 0.24;
  const wh = h * 0.26;
  ctx.fillRect(x0 + w * 0.16, wy0, w * 0.68, wh);

  // headlights (two dots), lower portion
  const ly = yBot - h * 0.20;
  const lr = r * 0.1;
  ctx.beginPath(); ctx.arc(cx - w * 0.22, ly, lr, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + w * 0.22, ly, lr, 0, Math.PI * 2); ctx.fill();

  // legs below the body
  const lgy1 = yBot + r * 0.26;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.26, yBot); ctx.lineTo(cx - w * 0.34, lgy1);
  ctx.moveTo(cx + w * 0.26, yBot); ctx.lineTo(cx + w * 0.34, lgy1);
  ctx.stroke();
}

const _camPos = new THREE.Vector3();

// Create a camera-facing pin sprite (no graphic yet), anchored at `pos` and resized each frame by the
// clamped/dampened scaling described below. The graphic is applied via setPinGraphic() so it can be
// swapped live (the building tag's value line updates on layer change). The per-frame hook reads the
// current aspect from sprite.userData.aspect, so a re-graphic with a different aspect Just Works.
function makePinSprite(pos, scale) {
  const mat = new THREE.SpriteMaterial({
    transparent: true,
    opacity: 0.8,       // whole pin at 80%
    depthTest: false,   // float on top — always readable, never occluded by buildings/context
    depthWrite: false,
    fog: false,
    sizeAttenuation: true, // world-sized; the per-frame hook below resizes it to the target apparent size
  });
  const sprite = new THREE.Sprite(mat);
  sprite.position.copy(pos);
  sprite.renderOrder = 1000;
  sprite.userData.aspect = 1;

  // Dynamic clamped/dampened scaling. Each frame, size the pin to a target fraction of the viewport
  // height: `screen` at distance `refDist`, scaled by (refDist/d)^damp — damp 0 = constant on-screen
  // size, damp 1 = full perspective shrink — then clamped to [minFrac, maxFrac] so it can't balloon
  // when zoomed in or vanish when zoomed out. sizeAttenuation stays true, so we set the WORLD height
  // that yields that on-screen fraction at the current camera distance. Self-contained (no loop hook):
  // onBeforeRender fires mid-render; updateMatrixWorld(true) re-bakes the new scale before the draw.
  const s = scale;
  sprite.onBeforeRender = (renderer, scene, cam) => {
    if (!cam.isPerspectiveCamera) return;
    const aspect = sprite.userData.aspect || 1;
    const d = cam.getWorldPosition(_camPos).distanceTo(sprite.position) || 1;
    const viewFactor = 2 * Math.tan((cam.fov * Math.PI / 180) / 2); // viewport world-height at dist 1
    let frac = s.screen * Math.pow(s.refDist / d, s.damp);
    frac = Math.min(s.maxFrac, Math.max(s.minFrac, frac));
    const h = frac * d * viewFactor;
    sprite.scale.set(h * aspect, h, 1);
    sprite.updateMatrixWorld(true);
  };
  return sprite;
}

// Apply (or replace) an already-drawn graphic on a pin sprite: swap the canvas texture, update the
// per-frame aspect, and re-anchor the node. Disposes the previous texture so live updates don't leak.
function setPinGraphic(sprite, drawn) {
  const { canvas, aspect, centerY } = drawn;
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  const old = sprite.material.map;
  sprite.material.map = tex;
  sprite.material.needsUpdate = true;
  if (old) old.dispose();
  sprite.userData.aspect = aspect;
  sprite.center.set(0.5, centerY); // anchor the NODE (dot) centre at the position
}

// Build a camera-facing sprite from an already-drawn pin graphic in one step (used by the static
// parking/train badges, which never change after creation).
function spriteFor(drawn, pos, scale) {
  const sprite = makePinSprite(pos, scale);
  setPinGraphic(sprite, drawn);
  // reasonable initial size (the first frame's onBeforeRender refines it before anything is shown)
  const h0 = scale.screen * scale.refDist * 2 * Math.tan(0.45);
  sprite.scale.set(h0 * drawn.aspect, h0, 1);
  return sprite;
}

// Build one billboard pin per manifest building, anchored just above each building's roof center
// (world bounds). The box shows the building ID (code) and (live) the active layer's building-tier VALUE.
// Returns the THREE.Group (host toggles .visible for campus-only gating), or null. The group carries
// an attached `group.update(buildingTags)` method — pass derive's `vm.buildingTags` map
// (`code → { label, value }`); it redraws each pin's value line, signature-deduped so it only repaints
// when a value or the active layer actually changes (not on hover/selection/camera ticks). Pins with
// no tag entry show the code only. (state.md / rendering.md "Map-pin billboards".)
//
// opts: { lift, ink, panel, line, accent, screen, refDist, damp, minFrac, maxFrac }
//   lift     — extra world units above the roof so the node floats just clear of the geometry
//   accent   — value-line color (default lime #c8f24a, the v2 data accent)
//   screen   — target pin height as a fraction of viewport height, at distance `refDist` (default 0.06)
//   refDist  — camera distance (world units) at which the pin hits `screen` size (default 2000)
//   damp     — 0 = constant on-screen size, 1 = full perspective shrink (default 0.6)
//   minFrac/ — clamp the apparent fraction so the pin never gets too small (zoomed out) …
//   maxFrac  — … or too big (zoomed in) (defaults 0.025 / 0.09)
export function addBuildingBillboards(scene, manifest, opts = {}) {
  if (!Array.isArray(manifest) || !manifest.length) return null;
  const style = {
    lift: opts.lift ?? 1.5,   // tiny gap so the node hovers just clear of the roof, not touching
    ink: opts.ink ?? '#ffffff',                 // white building-ID text
    panel: opts.panel ?? 'rgba(7,8,11,0.90)',   // near-black panel (matches the dark scene)
    line: opts.line ?? '#ffffff',               // white border + stem + node ring
    accent: opts.accent ?? '#c8f24a',           // lime value line (v2 data accent)
    scale: {
      screen:  opts.screen  ?? 0.06,
      refDist: opts.refDist ?? 2000,
      damp:    opts.damp    ?? 0.6,
      minFrac: opts.minFrac ?? 0.025,
      maxFrac: opts.maxFrac ?? 0.09,
    },
  };
  const group = new THREE.Group();
  group.name = '__building_billboards__';
  const byCode = new Map(); // building_code -> { sprite, title } (title = building code, static)
  for (const b of manifest) {
    const bn = b.bounds;
    if (!bn || !bn.min || !bn.max) continue; // need world bounds to place the pin
    const code = b.building_code || b.building_name || '?';
    const title = code; // tag title = building ID (code), NOT the full name (user request)
    const pos = new THREE.Vector3(
      (bn.min[0] + bn.max[0]) / 2,
      (bn.min[1] + bn.max[1]) / 2,
      bn.max[2] + style.lift,
    );
    const sprite = makePinSprite(pos, style.scale);
    setPinGraphic(sprite, drawPin({ title }, style)); // code-only until a layer value lands
    group.add(sprite);
    byCode.set(code, { sprite, title });
  }
  scene.add(group);

  // Live value updates, signature-deduped (cheap to call every vm change; repaints rarely).
  let lastSig = null;
  group.update = (buildingTags) => {
    const tags = buildingTags || {};
    let sig = '';
    for (const code of byCode.keys()) {
      const t = tags[code];
      sig += `${code}${t ? `${t.label || ''}${t.value || ''}` : ''}`;
    }
    if (sig === lastSig) return;
    lastSig = sig;
    for (const [code, e] of byCode) {
      const t = tags[code];
      setPinGraphic(e.sprite, drawPin({ title: e.title, label: t && t.label, value: t && t.value }, style));
    }
  };
  return group;
}

// Build circular-badge billboards from a frozen anchor artifact (a JSON array of {cx,cy,z}, campus-
// world coords, no placement; tools/extract_decor_pins.py). Same white-on-dark palette + 80% opacity
// as the building pins, but a circular badge (the `drawGlyph` symbol) with a smaller node + shorter
// stem. Async: returns the THREE.Group (host toggles .visible for campus-only gating), or null.
//
// opts: { lift, ink, panel, line, screen, refDist, damp, minFrac, maxFrac, name }. `defaults` supplies
// the per-kind scale baseline (parking vs train) that opts can still override.
async function addBadgeBillboards(scene, jsonUrl, drawGlyph, defaults, opts) {
  let pins;
  try {
    const res = await fetch(jsonUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pins = await res.json();
  } catch (e) {
    console.warn(`[${defaults.name}] load failed`, jsonUrl, e);
    return null;
  }
  if (!Array.isArray(pins) || !pins.length) return null;
  const style = {
    lift: opts.lift ?? 1.5,
    ink: opts.ink ?? '#ffffff',
    panel: opts.panel ?? 'rgba(7,8,11,0.90)',
    line: opts.line ?? '#ffffff',
    scale: {
      screen:  opts.screen  ?? defaults.screen,
      refDist: opts.refDist ?? 2000,
      damp:    opts.damp    ?? 0.6,
      minFrac: opts.minFrac ?? defaults.minFrac,
      maxFrac: opts.maxFrac ?? defaults.maxFrac,
    },
  };
  // one shared badge graphic (every pin shows the same symbol) → drawn once, reused across sprites
  const badge = drawCircleBadge(style, drawGlyph);
  const group = new THREE.Group();
  group.name = defaults.name;
  for (const p of pins) {
    if (p == null || p.cx == null) continue;
    const pos = new THREE.Vector3(p.cx, p.cy, (p.z ?? 0) + style.lift);
    group.add(spriteFor(badge, pos, style.scale));
  }
  scene.add(group);
  return group;
}

// Parking: one "P" badge per lot (data/decor/parking_pins.json). Smaller than the building pins.
export function addParkingBillboards(scene, jsonUrl, opts = {}) {
  return addBadgeBillboards(scene, jsonUrl, parkingGlyph,
    { name: '__parking_billboards__', screen: 0.0456, minFrac: 0.0216, maxFrac: 0.066 }, opts);
}

// Train station: one train-icon badge (data/decor/train_station_pins.json). Larger than the
// parking badge (parking 0.0456 → 0.08208 here, ~1.8×; clamps scaled to match).
export function addTrainBillboards(scene, jsonUrl, opts = {}) {
  return addBadgeBillboards(scene, jsonUrl, trainGlyph,
    { name: '__train_billboards__', screen: 0.08208, minFrac: 0.03888, maxFrac: 0.1188 }, opts);
}
