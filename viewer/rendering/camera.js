// Rendering domain — camera tween (no teleport, spec §6.2). Imports three only.

import * as THREE from 'three';

let _raf = null;

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

// Animate camera position + controls target to `view` over duration ms.
export function animateTo(camera, controls, view, duration = 700) {
  if (!view || !view.target || !view.position) return;
  if (_raf) cancelAnimationFrame(_raf);
  const startPos = camera.position.clone();
  const startTgt = controls.target.clone();
  const endPos = new THREE.Vector3().fromArray(view.position);
  const endTgt = new THREE.Vector3().fromArray(view.target);
  let t0 = null;

  function step(ts) {
    if (t0 === null) t0 = ts;
    const k = Math.min(1, (ts - t0) / duration);
    const e = easeInOut(k);
    camera.position.lerpVectors(startPos, endPos, e);
    controls.target.lerpVectors(startTgt, endTgt, e);
    controls.update();
    if (k < 1) _raf = requestAnimationFrame(step);
    else _raf = null;
  }
  _raf = requestAnimationFrame(step);
}
