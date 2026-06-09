// Rendering — material styler (the canonical viewer styler). Reproduces the minimal-black look and
// carries the CINEMATIC GOLD treatment (sandbox/CINEMATIC_GOLD_MIGRATION.md): constant material PHYSICS
// (metalness / roughness / envMapIntensity / patina aoMap) + config-driven scope opacities + mode-aware
// depth-write + cinematic campus-envelope edges. scene.js imports this applyStyle.
//
// THE ONE CONSTRAINT (rendering.md "Cinematic render style", memory cinematic-gold-render-style):
// COLOR is DATA. Fill colors come from the engine — styleMap[key].color (rooms) + envelopeStyle[code].color
// (envelopes), encoded from data/render_config.json's gradient/palette. The gold treatment is
// everything EXCEPT color, held constant from global.cinematic.material and stamped on top of the data
// color → layer recoloring keeps working (only `color` varies per layer).
//
// Scope opacities (rendering.md): campus = translucent massing (envelope 0.56 / rooms 0.2 through the
// shell, the checkpoint "both" look); building scope keeps room legibility (0.96) + selection + ghost.

import * as THREE from 'three';
import { patinaTexture } from './patina.js';

const WHITE = '#ffffff';
const LIME = '#c8f24a';        // selection edge (minimal 0xc8f24a)
const LIME_EMISSIVE = '#4a5a14'; // selection fill glow (minimal 0x4a5a14, intensity 1)
// Building-scope tuning imported from sandbox/main_viewer_render_state.json (building mode, 2026-06-07):
// the unselected "other" building shells now carry a faint green fill (was wireframe-only) and the focused
// building's rooms/edges adopt the sandbox opacities.
const OTHER_FILL = '#808080';     // building scope: unselected building shell fill (mid grey; was sandbox green #85d544)
const OTHER_FILL_OPACITY = 0.08;  // sandbox otherFillOpacity (was 0 = wireframe-only)
// building scope: unselected building shell edge — matches the CONTEXT edge EXACTLY (same color +
// opacity + thickness) so the shells are indistinguishable from the context buildings. The color is
// computed from classes.context the same way geometry.applyClassEdge derives the context edge color.
const OTHER_EDGE_OPACITY = 0.6;   // = the context edge opacity (_contextEdgeMat creation default)
const B_ROOM_OPACITY = 0.9;       // building scope: focused-building room fill (sandbox bRoomOpacity, was 0.96)
const B_ROOM_EDGE_OPACITY = 0.5;  // building scope: focused-building room edge (sandbox roomEdgeOpacity, was 0.18)
const GHOST_COLOR = '#3a3d42'; // ghost mode: unselected focused-building rooms drop to dark grey (rendering.md)
const SPOTLIGHT_DIM = 0.3;     // EXPERIMENT (reversible): non-matching campus rooms recede to this opacity
// Building scope: the FOCUSED building's FLOOR slabs render as a light-grey slab @ 20% + a white edge
// around its colored rooms (user request 2026-06-07; rendering.md "focused-building WIREFRAME").
// The envelope is NOT outlined in building scope (its rooms show; envelope off).
const FOCUS_FLOOR_EDGE_OPACITY = 0.45;
const FOCUS_FLOOR_FILL = '#cccccc';     // light grey floor slab (building scope, focused building)
const FOCUS_FLOOR_FILL_OPACITY = 0.15;
const ROOM_FALLBACK = '#9a9a9a';
const EDGE_PX = 1.0;           // screen-space edge width (building scope; campus uses worldUnits)
const EDGE_WORLD_SCALE = 1.5;  // cinematic campus edges: linewidth = thickness × this (world units)
// Legacy depth-write threshold (used only where a branch doesn't pass an explicit mode-aware decision).
const DEPTH_OPACITY = 0.9;

// Derive the context edge color from render-config classes.context — fill color lerped toward white by
// edge.brightness — EXACTLY as geometry.applyClassEdge styles the shared _contextEdgeMat. Reused for the
// unselected building shells so they match the context buildings. Scratch Colors avoid per-call allocs.
const _ctxEdgeScratch = new THREE.Color();
const _whiteCol = new THREE.Color('#ffffff');
function contextEdgeColor(global) {
  const cls = (global.classes && global.classes.context) || {};
  const fill = (cls.fill && cls.fill.color != null) ? cls.fill.color : '#222225';
  const brightness = (cls.edge && cls.edge.brightness != null) ? cls.edge.brightness : 0.2;
  _ctxEdgeScratch.set(fill);
  if (brightness) _ctxEdgeScratch.lerp(_whiteCol, brightness);
  return _ctxEdgeScratch;
}

// global.cinematic.material for the CURRENT applyStyle pass (set at the top of applyStyle so setFill can
// stamp the constant PBR params without threading them through every call). null → no cinematic config.
let _cmat = null;

// Screen-space edge (building scope / fallback): pure-white-or-lime faint lines, constant pixel width.
// Like the cinematic edge it renders OVER the fills (renderOrder 10 + depthWrite false) so the fill needs
// NO polygonOffset to keep its coincident edge crisp — matching the sandbox (which uses no fill offset).
function setEdge(edge, color, opacity, visible, thickness) {
  if (!edge) return;
  edge.visible = visible;
  edge.renderOrder = 10;
  if (!visible) return;
  const mat = edge.material;
  mat.color.set(color);
  mat.opacity = opacity;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.worldUnits = false;          // reset (the same per-mesh mat may have been worldUnits at campus)
  if ('linewidth' in mat) mat.linewidth = thickness != null ? thickness : EDGE_PX;
  mat.alphaToCoverage = true;
  mat.needsUpdate = true;          // worldUnits flips a shader define → recompile
}

// Cinematic edge (campus envelope): WORLD-unit thickness (perspective — near fatter, far thinner),
// antialiased (MSAA composer + alphaToCoverage), and drawn OVER the translucent fills — transparent
// always + renderOrder 10 + depthWrite off (so edges paint on top) + depthTest on (opaque geometry
// still occludes them; no full x-ray). (rendering.md "Cinematic render style" / migration §11.4-11.6.)
function setEdgeWorld(edge, color, thickness, opacity, visible, worldScale) {
  if (!edge) return;
  edge.visible = visible;
  edge.renderOrder = 10;
  if (!visible) return;
  const mat = edge.material;
  mat.color.set(color);
  mat.opacity = opacity;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.worldUnits = true;
  if ('linewidth' in mat) mat.linewidth = (thickness || 0) * (worldScale || EDGE_WORLD_SCALE);
  mat.alphaToCoverage = true;
  mat.needsUpdate = true;          // worldUnits flips a shader define → recompile
}

// `depthWrite` (optional): explicit mode-aware decision (rendering.md). When omitted, falls back to the
// legacy opacity threshold. Rooms write depth (occlude own back edges); a campus envelope co-visible
// with its rooms does NOT (x-ray shell). `_cmat` stamps the constant gold PBR on top of the data color.
function setFill(m, color, opacity, selected, depthWrite) {
  m.color.set(color);
  m.opacity = opacity;
  m.transparent = opacity < 1;
  m.depthWrite = depthWrite != null ? depthWrite : (opacity >= DEPTH_OPACITY);
  // NO polygonOffset — the sandbox gold materials use none, and polygonOffset misbehaves under
  // logarithmicDepthBuffer (per-frame depth noise → flicker on coincident faces). Edges render OVER the
  // fills via renderOrder 10 + depthWrite false (setEdge/setEdgeWorld) instead of being kept crisp by a
  // fill offset. logDepth is OFF in scene_v2 (matches the sandbox) → coincident faces resolve cleanly.
  m.polygonOffset = false;
  if (m.emissive) {
    m.emissive.set(selected ? LIME_EMISSIVE : '#000000');
    m.emissiveIntensity = selected ? 1 : 0;
  }
  // Cinematic gold treatment: constant material PHYSICS, color-independent (rendering.md). aoMap ONLY for
  // patina (darken-only — never a roughnessMap, which would create bright hot spots). Needs uv2 (geometry.js
  // backfills it); meshes without UVs simply show no patina. Guarded so non-Standard materials are skipped.
  if (_cmat && 'metalness' in m) {
    m.metalness = _cmat.metalness;
    m.roughness = _cmat.roughness;
    m.envMapIntensity = _cmat.envMapIntensity;
    if (_cmat.patina > 0) { m.aoMap = patinaTexture(); m.aoMapIntensity = _cmat.patina * 2; }
    else { m.aoMap = null; m.aoMapIntensity = 0; }
  }
  m.needsUpdate = true;
}

// Same signature as viewer/rendering/materials.js applyStyle (scene_v2 calls it identically), plus a
// trailing `ghost` ({on,opacity}) — building-scope 2D-plan companion (rendering.md "Ghost mode").
export function applyStyle(entry, styleMap, global, selectionKey, mode, envelopeStyle, focusedCode, ghost, campusRender, spotlight) {
  const isCampus = mode === 'campus';
  // EXPERIMENT (reversible): campus categorical-room spotlight. When a category is picked from the
  // infographic, `spotlight.keys` holds the matching room keys; every other room dims to SPOTLIGHT_DIM
  // opacity (keeps its color, just recedes) so the chosen category pops. Inert unless campus room-paint.
  const spotKeys = (spotlight && spotlight.keys) || null;
  // Campus room-paint (rendering.md "Campus room-paint"): paint every room by its own value + drop
  // envelopes to faint context shells. Default 'envelope' keeps the existing aggregate look.
  const campusRooms = isCampus && campusRender === 'rooms';
  const envStyle = envelopeStyle || {};
  const missing = global.missingData || { color: '#4a4e52', opacity: 0.55 };
  _cmat = (global.cinematic && global.cinematic.material) || null;
  const cedges = (global.cinematic && global.cinematic.edges) || null;
  // Context edge thickness (classes.context.edge.thickness, screen-space px) — the unselected building
  // shells reuse it so their wireframe is the SAME thickness as the context buildings' wireframe.
  const ctxEdge = (global.classes && global.classes.context && global.classes.context.edge) || {};
  const ctxEdgeThick = ctxEdge.thickness != null ? ctxEdge.thickness : EDGE_PX;
  // Context edge COLOR — fill color lerped toward white by edge.brightness (same derivation as
  // geometry.applyClassEdge). The unselected building shells reuse it so they're indistinguishable
  // from the context buildings (same color + opacity + thickness).
  const ctxEdgeColor = contextEdgeColor(global);
  const envOp = _cmat ? _cmat.envelopeOpacity : 1.0;
  const roomOp = _cmat ? _cmat.roomOpacity : 0.99;
  // Focused-building floor wireframe (building scope): edge thickness from the per-class edge config.
  const floorCls = (global.classes && global.classes.floor) || {};
  const floorEdgeThick = (floorCls.edge && floorCls.edge.thickness != null) ? floorCls.edge.thickness : 0.8;

  entry.group.traverse((child) => {
    if (!child.isMesh) return;
    const kind = child.userData.kind;
    if (typeof kind === 'string' && kind.endsWith('-edge')) return; // the edge overlays themselves
    // 2D-plan source geometry carried in the building model (Rooms_SRF surfaces / CAD linework): never
    // styled or shown by the layer styler. It stays hidden (geometry.js); the ghost-mode CAD reveal is
    // driven separately by scene.js. Guard BEFORE the room branch, which would else show Rooms_SRF as a
    // missing-data room. (rendering.md "2D-plan layers in the building model".)
    if (kind === 'plan-srf' || kind === 'cad') return;
    if (kind === 'roof') { child.visible = false; return; }

    const m = child.material;
    const edge = child.userData.edge;
    const code = child.userData.buildingCode;
    const isOther = !isCampus && focusedCode && code !== focusedCode;

    // FLOOR slabs — campus keeps the clean cinematic massing (no floor). In BUILDING scope the FOCUSED
    // building shows its floor slabs as EDGES ONLY (fill opacity 0) for architectural context; other
    // buildings' floors stay off. (rendering.md "focused-building WIREFRAME".)
    if (kind === 'floor') {
      if (isCampus || code !== focusedCode) { child.visible = false; setEdge(edge, WHITE, 0, false); return; }
      child.visible = true;
      if (ghost && ghost.on) {
        // ghost mode: the floor reads EXACTLY like an unselected (ghosted) room — flat dark grey @ the
        // slider opacity + faint white edge, no depth-write (user request 2026-06-07).
        setFill(m, GHOST_COLOR, ghost.opacity != null ? ghost.opacity : 0.3, false, false);
        setEdge(edge, WHITE, 0.05, true);
      } else {
        setFill(m, FOCUS_FLOOR_FILL, FOCUS_FLOOR_FILL_OPACITY, false, false);
        setEdge(edge, WHITE, FOCUS_FLOOR_EDGE_OPACITY, true, floorEdgeThick);
      }
      return;
    }

    // ENVELOPE shell
    if (kind === 'envelope') {
      if (campusRooms) {
        // room-paint: the envelope drops to a faint context shell (the rooms inside carry the data color),
        // so cross-building distribution reads. Same styling as a building-scope unselected "other" shell.
        child.visible = true;
        setFill(m, OTHER_FILL, OTHER_FILL_OPACITY, false);
        setEdge(edge, ctxEdgeColor, OTHER_EDGE_OPACITY, true, ctxEdgeThick);
        return;
      }
      if (isCampus) {
        const fill = (envStyle[code] && envStyle[code].color) || ROOM_FALLBACK;
        const selected = !!selectionKey && code === selectionKey; // bare-code campus selection
        child.visible = true;
        // Campus = translucent "both" massing: envelope opacity from config, NO depth-write (x-ray shell
        // → interior rooms aren't depth-trimmed). rendering.md "Mode-aware depth-write".
        setFill(m, fill, envOp, selected, false);
        // Cinematic envelope edge (worldUnits, AA, over the fill); selection → clear screen-space lime.
        const e = cedges && cedges.envelope;
        if (selected) setEdge(edge, LIME, 0.95, true);
        else if (e && e.on) setEdgeWorld(edge, e.color, e.thickness, e.opacity, true, e.worldScale);
        else setEdge(edge, WHITE, 0.32, true);
        return;
      }
      if (code === focusedCode) { child.visible = false; setEdge(edge, WHITE, 0, false); return; }
      // building scope: unselected building → context shell (faint grey fill + a wireframe edge that
      // matches the context buildings EXACTLY — same color, opacity, and thickness).
      child.visible = true;
      setFill(m, OTHER_FILL, OTHER_FILL_OPACITY, false);
      setEdge(edge, ctxEdgeColor, OTHER_EDGE_OPACITY, true, ctxEdgeThick);
      return;
    }

    // ROOMS
    if (isOther) { child.visible = false; setEdge(edge, WHITE, 0, false); return; }
    const key = child.userData.key;
    const sm = key ? styleMap[key] : null;

    if (campusRooms) {
      // Campus room-paint: each room shows its OWN data color (styleMap, room-tier) at the encoded opacity
      // (missing rooms keep the missing-data class → distinct + receded). Single-click selects a room →
      // it highlights lime with a lime edge; unselected rooms keep edges off (clean at campus zoom).
      const roomSelected = !!key && key === selectionKey;
      // EXPERIMENT (reversible): spotlight — when a category is active, rooms NOT in the matching set lose
      // their data color, going flat grey @ SPOTLIGHT_DIM (like ghost mode). The matching set + any selected
      // room keep their color at full opacity.
      const dimmed = !!spotKeys && !roomSelected && !spotKeys.has(key);
      const fill = roomSelected ? LIME : (dimmed ? GHOST_COLOR : (sm ? sm.color : ROOM_FALLBACK));
      const opacity = roomSelected ? 0.96 : (dimmed ? SPOTLIGHT_DIM : (sm ? sm.opacity : B_ROOM_OPACITY));
      child.visible = true;
      setFill(m, fill, opacity, roomSelected, !dimmed);
      setEdge(edge, roomSelected ? LIME : WHITE, roomSelected ? 0.9 : 0, roomSelected);
      return;
    }

    if (isCampus) {
      // Rooms visible THROUGH the translucent envelope at roomOpacity (the checkpoint "both" look). Room
      // depth-write ON — EXACTLY the sandbox's `goldDepthWrite` rule (room → true always), so a 0.2 room
      // reads solid (occludes its own back faces) instead of an x-ray wireframe. The DOC flicker was NOT
      // from this: it was logDepth + fill polygonOffset adding per-frame depth noise on coincident walls
      // (now removed → logDepth off in scene_v2, no fill offset). Campus room edges stay OFF (checkpoint
      // thickness 0 ⇒ invisible; saves draw calls).
      const buildingSelected = !!selectionKey && !selectionKey.includes('::') && code === selectionKey;
      const fill = (envStyle[code] && envStyle[code].color) || (sm ? sm.color : ROOM_FALLBACK);
      child.visible = true;
      setFill(m, buildingSelected ? LIME : fill, roomOp, buildingSelected, true);
      setEdge(edge, WHITE, 0, false);
      return;
    }

    // building scope rooms (focused building) — opacity 0.96, edge #ffffff @0.18; selection/ghost as before.
    const selected = !!key && key === selectionKey;
    // Ghost mode: every UNSELECTED room drops to a flat dark grey @ the slider opacity (loses its layer
    // hue, intentional — user decision) and stays see-through (no depth write) so the selected room pops.
    const ghosted = !!ghost && ghost.on && !selected;
    // EXPERIMENT (reversible): spotlight — when a category is active, rooms NOT in the matching set lose
    // their data color, going flat grey @ SPOTLIGHT_DIM (same look as ghost). Reads like ghost for styling.
    const spotDimmed = !!spotKeys && !selected && !spotKeys.has(key);
    let fill; let opacity; let dw;
    if (selected) { fill = LIME; opacity = 0.96; dw = true; }
    else if (spotDimmed) { fill = GHOST_COLOR; opacity = SPOTLIGHT_DIM; dw = false; }
    else if (ghosted) { fill = GHOST_COLOR; opacity = ghost.opacity != null ? ghost.opacity : 0.3; dw = false; }
    else if (sm) { fill = sm.color; opacity = B_ROOM_OPACITY; dw = true; }
    else if (key) { fill = ROOM_FALLBACK; opacity = B_ROOM_OPACITY; dw = true; }
    else { fill = missing.color; opacity = missing.opacity != null ? missing.opacity : 0.55; dw = false; }
    child.visible = true;
    setFill(m, fill, opacity, selected, dw);
    // Ghost/spotlight: dimmed room edges are turned OFF so the dimmed rooms read as flat fills; the selected
    // room keeps its lime edge, non-dimmed rooms keep the white edge.
    const showRoomEdge = selected || !(ghosted || spotDimmed);
    setEdge(edge, selected ? LIME : WHITE, selected ? 0.9 : B_ROOM_EDGE_OPACITY, showRoomEdge);
  });
}
