// Rendering domain — Z=0 snap at LOAD time. SOP: architecture/rendering.md §"Z=0 snap"
// (CONFIRMED, claude.md §4). Align the building's GROUND-FLOOR reference to Z=0, NOT the
// global bbox min — so real basements (e.g. RWC -15.32) are preserved and campus alignment holds.
// For context-aligned files the delta ~ 0 (no-op). Single load-time correction; no render-time Z hacks.

import * as THREE from 'three';

const GROUND_FLOOR = '1 - First Floor';

// min Z over meshes tagged INV_Floor_Name == "1 - First Floor"; fallback = group bbox min.
function groundDatumZ(group) {
  let datum = Infinity;
  group.traverse((child) => {
    if (!child.isMesh) return;
    if (child.userData.floor === GROUND_FLOOR) {
      child.geometry.computeBoundingBox();
      const bb = child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld);
      datum = Math.min(datum, bb.min.z);
    }
  });
  if (datum === Infinity) {
    const bb = new THREE.Box3().setFromObject(group);
    datum = bb.min.z;
  }
  return datum;
}

export function snapToGround(group) {
  group.updateMatrixWorld(true);
  const datum = groundDatumZ(group);
  if (Number.isFinite(datum)) group.position.z += -datum; // translate whole group; basements preserved
  group.updateMatrixWorld(true);
  return -datum;
}
