// Rendering domain — shared procedural "patina" texture (cloudy roughness/AO noise).
// Lifted verbatim from sandbox/cinematic_gold_sandbox.html patinaTexture(). Imports three only.
//
// Used as an `aoMap` ONLY (never a roughnessMap): a WHITE base = no darkening, darker blobs = the
// cloudy noise → patina can only DARKEN the surface, never lower roughness (which would create the
// glossy hot reflections that read as "too bright"). aoMapIntensity scales the effect; the consuming
// mesh needs a `uv2` channel (meshes without UVs simply show no patina). RepeatWrapping ×(3,3).
//
// Shared by viewer_v2 cinematic materials (buildings, context, roads). The legacy viewer never imports
// it → backward-compatible. Lazily built once, cached.

import * as THREE from 'three';

let _tex = null;

export function patinaTexture() {
  if (_tex) return _tex;
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, N, N);
  for (let i = 0; i < 1400; i++) {
    const r = 6 + Math.pow(((i * 2654435761) >>> 0) / 4294967295, 2) * 70;
    const px = ((i * 40503) % N);
    const py = ((i * 12289) % N);
    const v = 40 + ((Math.sin(i * 1.3) * 0.5 + Math.sin(i * 0.7) * 0.5) + 1) * 0.5 * 90; // ~40–130 grey blobs (darken only)
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(${v | 0},${v | 0},${v | 0},0.14)`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(px, py, r, 0, 7);
    x.fill();
  }
  _tex = new THREE.CanvasTexture(c);
  _tex.wrapS = _tex.wrapT = THREE.RepeatWrapping;
  _tex.repeat.set(3, 3);
  return _tex;
}
