// Rendering domain — flat-on-ground street-name labels (the Enturage.3dm `R1/R2/R3 Text` layers).
// A static text-decoration overlay, sibling to the mesh decor (trees/roads) but for ANNOTATIONS,
// which are not meshes: the strings + placements are pre-extracted to a frozen JSON artifact by
// tools/extract_decor_labels.py (data/decor/enturage_labels.json; deterministic — the viewer never
// reads Rhino text live). This module just draws that artifact. Non-interactive (no userData.key),
// campus-world coords (no placement); shared by the main viewer + viewer_v2, wired from each
// composition root and scope-gated by the host (campus only).
//
// Each label lies on the XY ground plane (normal +Z), rotated about Z by its authored angle so the
// text reads along its street. White text on a transparent canvas, sized to the authored box aspect.

import * as THREE from 'three';

function labelMesh({ text, cx, cy, z, len, ht, rot }, color, scale, opacity) {
  // The Rhino street text was authored tiny (~7u long, ~1u tall) relative to the ~2640u campus, so at
  // campus zoom it is sub-pixel. `scale` enlarges every label uniformly (preserving authored aspect +
  // the small tier size differences) to a legible on-street size. Tunable from the composition root.
  const w = len * scale;
  const h = ht * scale;
  // Canvas sized to the authored box aspect (len = reading direction, ht = cap height). The plane
  // geometry carries the real world dimensions, so the canvas only needs the right aspect ratio.
  const aspect = Math.max(len / Math.max(ht, 0.01), 0.2);
  const baseH = 128;
  const cw = Math.max(8, Math.round(baseH * aspect));
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = baseH;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(baseH * 0.72)}px Arial, sans-serif`;
  ctx.fillText(text, cw / 2, baseH / 2);

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const geo = new THREE.PlaneGeometry(w, h); // lies in XY (normal +Z) → flat on the Z-up ground
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.z = THREE.MathUtils.degToRad(rot || 0); // read along the street
  mesh.position.set(cx, cy, (z || 0) + 0.6); // nudge just above grade to avoid z-fighting the roads
  mesh.renderOrder = 999; // draw last so labels sit on top of the (transparent) ground decor
  return mesh;
}

// Load the frozen label artifact and add a non-interactive group to the scene.
// Returns the THREE.Group (host toggles .visible for scope gating); or null on failure.
export async function addGroundLabels(scene, jsonUrl, { color = '#ffffff', scale = 14, opacity = 1 } = {}) {
  let labels;
  try {
    const res = await fetch(jsonUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    labels = await res.json();
  } catch (e) {
    console.warn('[labels] load failed', jsonUrl, e);
    return null;
  }
  const group = new THREE.Group();
  group.name = '__enturage_street_labels__';
  for (const l of labels) group.add(labelMesh(l, color, scale, opacity));
  scene.add(group);
  return group;
}
