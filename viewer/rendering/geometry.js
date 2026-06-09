// Rendering domain — .3dm load via Rhino3dmLoader, key extraction, per-building cache.
// SOP: architecture/rendering.md, geometry_link.md. Imports three + addons only.

import * as THREE from 'three';
import { Rhino3dmLoader } from 'three/addons/loaders/3DMLoader.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { snapToGround } from './zsnap.js';

const RHINO_LIB = 'https://cdn.jsdelivr.net/npm/rhino3dm@8.17.0/';

// ---- edge line work (Line2/LineMaterial — literal pixel thickness; WebGL ignores linewidth) -----
// All edge LineMaterials are tracked so the renderer can push resolution (required by the shader)
// on resize, and the shared floor/context mats can take global.classes live (rendering.md).
const _lineMats = new Set();
const _res = new THREE.Vector2(window.innerWidth || 1, window.innerHeight || 1);
const _white = new THREE.Color(0xffffff);
const _scratch = new THREE.Color();
let _contextMat = null; // campus backdrop mesh material (styled live from global.classes.context.fill)
let _notLinkedMat = null; // context-layer "Project_notLinked" placeholder massing (deep red @ campus)
const NOTLINKED_RED = '#8b0000'; // deep red placeholder color for not-yet-modelled buildings (campus scope)
function makeLineMat({ color, ...rest } = {}) {
  // NOTE: LineMaterial.color is a uniform-backed THREE.Color — set it via .color.set AFTER
  // construction (passing `color` as a constructor param would replace the Color with the raw value).
  // alphaToCoverage: smooth (antialiased) lines wherever the framebuffer is multisampled — the default
  // antialiased canvas (legacy viewer) and viewer_v2's MSAA composer target. Improves line AA; no
  // behavior/contract change (backward-compatible).
  const m = new LineMaterial({ transparent: true, worldUnits: false, alphaToCoverage: true, ...rest });
  if (color != null) m.color.set(color);
  m.resolution.copy(_res);
  _lineMats.add(m);
  return m;
}
function edgeLine(geometry, material, kind) {
  const lsg = new LineSegmentsGeometry().fromEdgesGeometry(new THREE.EdgesGeometry(geometry));
  const line = new LineSegments2(lsg, material);
  if (kind) line.userData.kind = kind;
  return line;
}
// Shared edge mat: context backdrop only. Building-envelope, room, AND floor edges are PER-MESH
// (their fill colors vary per building → floor edge carries its building's color), recolored in
// materials.applyStyle. (rendering.md "Per-class fill + line work".)
const _contextEdgeMat = makeLineMat({ color: 0x3a4452, opacity: 0.6, linewidth: 1 });

// Push the current viewport resolution to every edge material (call on init + resize).
export function updateEdgeResolution(w, h) {
  _res.set(w, h);
  for (const m of _lineMats) m.resolution.copy(_res);
}
// Set a shared edge material from a per-class { fill:{color}, edge:{thickness,brightness} } config:
// edge color = fill color lerped toward white by brightness; linewidth = edge.thickness. (rendering.md.)
function applyClassEdge(mat, cls, defColor, defThick) {
  cls = cls || {};
  const fill = cls.fill || {};
  const edge = cls.edge || {};
  _scratch.set(fill.color != null ? fill.color : defColor);
  if (edge.brightness) _scratch.lerp(_white, edge.brightness);
  mat.color.copy(_scratch);
  mat.linewidth = edge.thickness != null ? edge.thickness : defThick;
  mat.needsUpdate = true;
}
// Apply render-config to the SHARED materials live (context edge + context backdrop mesh).
// Building-envelope, room, AND floor edges vary per mesh → handled in materials.applyStyle.
// (finetuning_tool.md §5.) `mode` (campus/building) only switches the Project_notLinked fill color.
export function applySharedStyle(global, mode) {
  const classes = (global && global.classes) || {};
  applyClassEdge(_contextEdgeMat, classes.context, '#3a4452', 0.6);
  const cx = (classes.context && classes.context.fill) || {};
  const ctxColor = cx.color != null ? cx.color : '#232b36';
  const op = cx.opacity != null ? cx.opacity : 1;
  // Building scope = MATTE context: a MeshStandardMaterial reflects the warm studio IBL as DIFFUSE
  // ambient even at metalness 0, reading as a warm/red "reflection" behind the focused building. Zero
  // envMapIntensity in building scope (sun + hemisphere only); campus keeps the cinematic reflective look.
  // Inert on the legacy viewer (no scene.environment there). (rendering.md "Matte context in building scope".)
  const ctxEnvMap = mode === 'building' ? 0 : 1;
  if (_contextMat) {
    _contextMat.color.set(ctxColor);
    _contextMat.opacity = op;
    _contextMat.transparent = op < 1;
    _contextMat.envMapIntensity = ctxEnvMap;
    _contextMat.needsUpdate = true;
  }
  // Placeholder massing: deep red at campus (reads as "not built yet"), context-colored in building
  // scope; opacity always follows the context (rendering.md "Placeholder geometry").
  if (_notLinkedMat) {
    _notLinkedMat.color.set(mode === 'campus' ? NOTLINKED_RED : ctxColor);
    _notLinkedMat.opacity = op;
    _notLinkedMat.transparent = op < 1;
    _notLinkedMat.envMapIntensity = ctxEnvMap;
    _notLinkedMat.needsUpdate = true;
  }
}

let _loader = null;
function loader() {
  if (!_loader) {
    _loader = new Rhino3dmLoader();
    _loader.setLibraryPath(RHINO_LIB);
  }
  return _loader;
}

// rhino3dm getUserStrings() returns an array of [key,value] pairs; some builds expose a map.
// Read defensively for either shape.
export function readUserString(mesh, key) {
  const attrs = mesh.userData && mesh.userData.attributes;
  const us = attrs && attrs.userStrings;
  if (!us) return null;
  if (Array.isArray(us)) {
    for (const pair of us) {
      if (Array.isArray(pair) && pair[0] === key) return pair[1];
    }
    return null;
  }
  return us[key] != null ? us[key] : null;
}

// Resolve a node's Rhino layer path → lowercased SEGMENTS, from the loader's `object.userData.layers`
// table + per-mesh `attributes.layerIndex` (same approach as loadContextGeometry/loadDecorGeometry).
// Returns a closure so the layers table + id index are built once per file. [] if unresolvable.
function layerSegResolver(object) {
  const layers = (object.userData && object.userData.layers) || [];
  const byId = new Map();
  for (const l of layers) { if (l && l.id != null) byId.set(String(l.id), l); }
  return (node) => {
    const attrs = node && node.userData && node.userData.attributes;
    const li = attrs ? attrs.layerIndex : -1;
    if (li == null || li < 0 || !layers[li]) return [];
    let l = layers[li];
    let path = l.fullPath != null ? l.fullPath : (l.name != null ? l.name : '');
    if (!/::|\//.test(String(path))) {
      const parts = []; let cur = l, guard = 0;
      while (cur && guard++ < 32) {
        const nm = cur.name != null ? cur.name : (cur.fullPath != null ? cur.fullPath : '');
        parts.unshift(String(nm).split(/::|\//).pop());
        const pid = cur.parentLayerId != null ? cur.parentLayerId : (cur.parentId != null ? cur.parentId : null);
        cur = pid != null ? byId.get(String(pid)) : null;
      }
      path = parts.join('::');
    }
    return String(path).split(/::|\//).map((s) => s.trim().toLowerCase()).filter(Boolean);
  };
}

// CAD / Rooms_SRF objects carry their level designator ("L1".."L4") as the Rhino object Name.
// The loader exposes it as `child.name` (and on `userData.attributes.name`). Returns null if absent.
function objectLevel(child) {
  let n = child.name;
  if (!n) { const a = child.userData && child.userData.attributes; n = a ? a.name : ''; }
  n = String(n || '').trim();
  return n || null;
}

const cache = new Map(); // code -> { group, keyToMeshes: Map<key, Mesh[]>, planCad: Map<level, Obj3D[]>, keyToLevel: Map<key, level> }

// Load one building's geometry. Idempotent per code. Resolves to { group, keyToMeshes }.
// `placement` = 16 row-major floats (world transform from the context instance) or null.
export function loadBuildingGeometry(code, geometryUrl, placement = null) {
  if (cache.has(code)) return Promise.resolve(cache.get(code));
  return new Promise((resolve, reject) => {
    loader().load(
      geometryUrl,
      (object) => {
        const keyToMeshes = new Map();
        const floorMeshes = [];
        const envelopeMeshes = [];
        // 2D-plan layers carried INSIDE the building model (rendering.md "2D-plan layers in the building
        // model"): the `CAD::*` linework + the `Rooms_SRF` planar room surfaces. They exist only for the
        // 2D floor-plan extractor (tools/extract_plan_2d.py) + the ghost-mode CAD reveal — NEVER part of
        // the normal 3D render. Hidden at load; CAD is toggled per level by scene.js in ghost mode.
        const planCad = new Map();    // level ("L1"..) -> [Object3D] CAD linework (hidden)
        const keyToLevel = new Map(); // "CODE::room" -> level, from Rooms_SRF (ghost-CAD level switch)
        const layerSegs = layerSegResolver(object);
        let cadMat = null;            // shared CAD line material (lazy)
        object.traverse((child) => {
          // CAD linework (the loader renders curves as THREE.Line, not Mesh) — classify by LAYER name
          // (Rooms_SRF carries the same Building_Code+room userstrings as the 3D rooms, so user-string
          // classification can't distinguish them; layer name can). Hide + bucket by level.
          const segs = layerSegs(child);
          if (segs.includes('cad')) {
            child.visible = false;
            child.userData.kind = 'cad';
            child.userData.key = null;
            if (child.isLine || child.isMesh) {
              const lv = objectLevel(child);
              if (lv) {
                if (!cadMat) cadMat = new THREE.LineBasicMaterial({ color: 0xcfd6dd, transparent: true, opacity: 0.65, depthWrite: false });
                if (child.isLine) { child.material = cadMat; child.renderOrder = 11; }
                if (!planCad.has(lv)) planCad.set(lv, []);
                planCad.get(lv).push(child);
              }
            }
            return;
          }
          if (!child.isMesh) return;
          // Rooms_SRF / Room_SRF: planar 2D-plan room surfaces (leaf name varies per file — plural or
          // singular). Hide; do NOT add to keyToMeshes (would duplicate the real Rooms_Attr room keys →
          // double meshes per key); record key→level for the ghost-CAD switch.
          if (segs.length && (segs[segs.length - 1] === 'rooms_srf' || segs[segs.length - 1] === 'room_srf')) {
            child.visible = false;
            child.userData.kind = 'plan-srf';
            child.userData.key = null;
            const bc2 = readUserString(child, 'Building_Code') || code;
            const rid2 = readUserString(child, 'INV_Room_Number');
            const lv = objectLevel(child);
            if (rid2 && lv) keyToLevel.set(`${bc2}::${rid2}`, lv);
            return;
          }
          const bc = readUserString(child, 'Building_Code') || code;
          const rid = readUserString(child, 'INV_Room_Number');
          const floor = readUserString(child, 'INV_Floor_Name');
          // mesh class by user strings (NOT layer name — names differ per file: Building/Bldg,
          // Room_Attr/Rooms_Attr). room = INV_Room_Number; roof = floor slab named "Roof" (NEVER
          // rendered); floor = other floor slab; envelope = building shell (Building_Code only).
          const isRoof = !rid && floor && /roof/i.test(floor);
          const kind = rid ? 'room' : (isRoof ? 'roof' : (floor ? 'floor' : (bc ? 'envelope' : 'context')));
          child.userData.kind = kind;
          child.userData.key = rid ? `${bc}::${rid}` : null;
          child.userData.floor = floor;
          child.userData.buildingCode = code;
          // own material per mesh so we can recolor without cross-mesh bleed
          if (!Array.isArray(child.material)) child.material = child.material.clone();
          // uv2 backfill (additive, backward-compatible): an aoMap reads UV channel 1, which Rhino
          // meshes don't carry. Mirror the primary uv onto uv2 so viewer_v2's cinematic patina aoMap
          // works; the legacy viewer ignores uv2. Meshes with no uv at all simply get no patina.
          const g = child.geometry;
          if (g && g.attributes && g.attributes.uv && !g.attributes.uv2) {
            g.setAttribute('uv2', g.attributes.uv);
          }
          const k = child.userData.key;
          if (k) {
            if (!keyToMeshes.has(k)) keyToMeshes.set(k, []);
            keyToMeshes.get(k).push(child);
          }
          if (kind === 'roof') child.visible = false;          // never rendered (any scope)
          else if (kind === 'floor') floorMeshes.push(child);
          else if (kind === 'envelope') envelopeMeshes.push(child);
        });
        // Edge overlays (children → inherit the mesh transform; hide when the mesh hides). Line2/
        // LineMaterial gives literal pixel thickness (WebGL ignores linewidth). Floor (Level) slabs +
        // context use SHARED mats (single fill → applySharedStyle); the building envelope + rooms get
        // PER-MESH edges (fills vary → recolored in materials.applyStyle via userData.edge).
        for (const fm of floorMeshes) {
          // PER-MESH floor edge (was the shared _floorEdgeMat): the edge carries the color of the
          // BUILDING this floor belongs to (campus aggregate / selection color), recolored on layer
          // and selection change in materials.applyStyle via userData.edge.
          const lm = makeLineMat({ opacity: 0.9, linewidth: 1 });
          const e = edgeLine(fm.geometry, lm, 'floor-edge');
          fm.userData.edge = e;
          fm.add(e);
          fm.material.transparent = true;
          fm.material.depthWrite = false;
        }
        for (const em of envelopeMeshes) {
          const lm = makeLineMat({ opacity: 0.9, linewidth: 1 });
          const e = edgeLine(em.geometry, lm, 'envelope-edge');
          em.userData.edge = e; // recolored from the envelope fill (building-aggregate) in applyStyle
          em.add(e);
        }
        // Room edges (building scope): each room mesh gets its OWN edge overlay + material so the
        // line can be colored = the room fill but BRIGHTER, and recolored on layer switch. Hidden
        // at campus (rooms recede there). materials.applyStyle toggles + recolors via userData.edge.
        for (const meshes of keyToMeshes.values()) {
          for (const rm of meshes) {
            const lm = makeLineMat({ opacity: 0.85, linewidth: 1 });
            const e = edgeLine(rm.geometry, lm, 'room-edge');
            e.visible = false; // building scope only
            rm.userData.edge = e;
            rm.add(e);
          }
        }
        // Placement: apply the context instance transform (sets world XY/Z + Z-rotation).
        // Fallback to the ground-floor Z-snap only when a building has no placement (rendering.md, claude.md §4).
        if (placement && placement.length === 16) {
          object.applyMatrix4(new THREE.Matrix4().set(...placement));
        } else {
          snapToGround(object);
        }
        const entry = { group: object, keyToMeshes, planCad, keyToLevel };
        cache.set(code, entry);
        resolve(entry);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

export function getCachedGeometry(code) {
  return cache.get(code) || null;
}

// Static decoration backdrop (e.g. site trees geometry/Tree_Site.3dm) — loaded like the campus
// context: NOT a building, no rooms, no styleMap keys, no manifest entry, NON-INTERACTIVE
// (meshes carry no userData.key → picking ignores them; the renderer does NOT add this to its
// pickable `groups` map). Authored in campus-world coordinates → NO placement / NO Z-snap; added
// as-is. One flat material (color + opacity); edges optional. See rendering.md "Decoration geometry".
//
// `byLayer` (optional): a map keyed by leaf Rhino layer name (lowercased) → { color, opacity, z? }. When
// present it is an ALLOWLIST + per-layer styler: only meshes whose leaf layer matches a key render
// (own material from that entry); every other mesh in the file is dropped (visible=false). Layer-name
// classification is the only place layer-name is used here — same leaf normalization as the context.
// Optional `z` lifts that layer's meshes (world units) to separate coplanar ground layers (anti-z-fight).
//
// `underLayer` (optional): require the matched layer to live UNDER this ancestor group (matched against the
// full layer path's segments, case-insensitive). Disambiguates files that carry duplicate leaf names under
// two parents (e.g. an Enturage `Nurbs::Roads::Major` source-Brep branch alongside the `Mesh::Roads::Major`
// render branch) — pass `underLayer: 'Mesh'` to import only the mesh branch.
export function loadDecorGeometry(cacheKey, geometryUrl, { color = '#4caf50', opacity = 1, edges = false, byLayer = null, underLayer = null } = {}) {
  if (cache.has(cacheKey)) return Promise.resolve(cache.get(cacheKey));
  return new Promise((resolve, reject) => {
    loader().load(
      geometryUrl,
      (object) => {
        const sharedMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(color), roughness: 1, metalness: 0, flatShading: true,
          opacity, transparent: opacity < 1, depthWrite: true,
          // Push the fill slightly back so a per-layer edge overlay renders in FRONT of its own
          // coplanar fill face instead of z-fighting/being occluded (else decor edges never show).
          polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
        });
        // per-layer materials (built lazily from byLayer, keyed by leaf-name-lowercased)
        const layers = (object.userData && object.userData.layers) || [];
        const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
        // id -> layer record (for full-path reconstruction when the loader doesn't expose fullPath)
        const byId = new Map();
        for (const l of layers) { if (l && l.id != null) byId.set(String(l.id), l); }
        const underLayerN = underLayer ? norm(underLayer) : null;
        // Full path SEGMENTS (lowercased) of a mesh's layer: prefer the loader/rhino `fullPath`, else a
        // `name` that already carries the `::` path, else reconstruct by walking parentLayerId. Last
        // segment = leaf. Returns [] if unresolvable.
        const segmentsOf = (node) => {
          const attrs = node && node.userData && node.userData.attributes;
          const li = attrs ? attrs.layerIndex : -1;
          if (li == null || li < 0 || !layers[li]) return [];
          let l = layers[li];
          let path = l.fullPath != null ? l.fullPath : (l.name != null ? l.name : '');
          if (!/::|\//.test(String(path))) {
            // reconstruct from parents
            const parts = []; let cur = l; let guard = 0;
            while (cur && guard++ < 32) {
              const nm = cur.name != null ? cur.name : (cur.fullPath != null ? cur.fullPath : '');
              parts.unshift(String(nm).split(/::|\//).pop());
              const pid = cur.parentLayerId != null ? cur.parentLayerId
                : (cur.parentId != null ? cur.parentId : null);
              cur = pid != null ? byId.get(String(pid)) : null;
            }
            path = parts.join('::');
          }
          return String(path).split(/::|\//).map(norm).filter(Boolean);
        };
        // One-time diagnostic: confirm the loader gives us resolvable layer paths (so underLayer works).
        if (byLayer) {
          const sample = layers.slice(0, 24).map((l, i) => `${i}:${l && (l.fullPath != null ? l.fullPath : l.name)}`);
          console.log(`[decor ${cacheKey}] layer paths:`, sample);
        }
        const layerMats = new Map();
        function matForLayer(name) {
          if (layerMats.has(name)) return layerMats.get(name);
          const spec = byLayer[name];
          const op = spec.opacity != null ? spec.opacity : 1;
          const m = new THREE.MeshStandardMaterial({
            color: new THREE.Color(spec.color), roughness: 1, metalness: 0, flatShading: true,
            opacity: op, transparent: op < 1, depthWrite: true,
            // polygonOffset so a per-layer edge overlay isn't z-fought by its own coplanar fill.
            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
          });
          layerMats.set(name, m);
          return m;
        }
        // per-layer edge materials (lazy, keyed by leaf name) — built from a byLayer entry's optional
        // edge:{color,thickness}. LITERAL edge color (decor edges are explicit, not the §2.3 fill→white
        // brightness derive); linewidth = literal px thickness. Tracked by makeLineMat for resize.
        const layerEdgeMats = new Map();
        function edgeMatForLayer(name, edgeSpec) {
          if (layerEdgeMats.has(name)) return layerEdgeMats.get(name);
          const m = makeLineMat({
            color: edgeSpec.color != null ? edgeSpec.color : '#ffffff',
            linewidth: edgeSpec.thickness != null ? edgeSpec.thickness : 1,
            opacity: 1,
          });
          layerEdgeMats.set(name, m);
          return m;
        }
        object.traverse((child) => {
          if (!child.isMesh) return;
          // Skip our own edge overlays: edge lines are LineSegments2 (isMesh===true) added as children
          // of decor meshes DURING this traverse, so the walk re-visits them. Without this guard they'd be
          // reclassified as decor meshes (no matching layer → visible=false), hiding every decor edge.
          if (child.userData.kind === 'decor-edge') return;
          child.userData.key = null;   // non-interactive (no selection / hover)
          child.userData.kind = 'decor';
          if (byLayer) {
            const segs = segmentsOf(child);
            const ln = segs.length ? segs[segs.length - 1] : '';
            const spec = byLayer[ln];
            if (!spec) { child.visible = false; return; } // allowlist: drop other leaf layers
            // ancestor scope: drop matches that aren't under the required group (e.g. Nurbs source branch).
            // Fail OPEN — if the path couldn't be resolved past the leaf (segs.length<=1), don't drop
            // (better to render possible duplicates than nothing); the diagnostic above flags that case.
            if (underLayerN && segs.length > 1 && !segs.slice(0, -1).includes(underLayerN)) {
              child.visible = false; return;
            }
            child.material = matForLayer(ln);
            // Optional tiny per-layer Z lift: separates coplanar ground decoration (parking/roads/
            // green space/promenade authored at ~grade) so their overlapping flat faces stop z-fighting.
            // Invisible at campus scale; logdepth can't fix coplanar surfaces — only real separation can.
            if (spec.z) child.position.z += spec.z;
            // Per-layer edge overlay (optional). Takes precedence over the file-wide `edges` flag;
            // falls back to it (shared context edge mat) when this leaf has no edge spec.
            if (spec.edge) child.add(edgeLine(child.geometry, edgeMatForLayer(ln, spec.edge), 'decor-edge'));
            else if (edges) child.add(edgeLine(child.geometry, _contextEdgeMat, 'decor-edge'));
          } else {
            child.material = sharedMat;
            if (edges) child.add(edgeLine(child.geometry, _contextEdgeMat, 'decor-edge'));
          }
        });
        const entry = { group: object, keyToMeshes: new Map() };
        cache.set(cacheKey, entry);
        resolve(entry);
      },
      undefined,
      (err) => reject(err)
    );
  });
}

// Campus context backdrop (geometry/WUC_Context.3dm). Neutral material, non-interactive
// (no userData.key), NO Z-snap (context defines the shared datum). See rendering.md.
export function loadContextGeometry(url) {
  const KEY = '__context__';
  if (cache.has(KEY)) return Promise.resolve(cache.get(KEY));
  return new Promise((resolve, reject) => {
    loader().load(
      url,
      (object) => {
        if (!_contextMat) {
          _contextMat = new THREE.MeshStandardMaterial({
            color: 0x232b36, roughness: 1, metalness: 0, flatShading: true,
          });
        }
        // Placeholder massing (context layer "Project_notLinked"): own material so it can be deep red
        // at campus while sharing the context opacity (applySharedStyle, rendering.md "Placeholder geometry").
        if (!_notLinkedMat) {
          _notLinkedMat = new THREE.MeshStandardMaterial({
            color: NOTLINKED_RED, roughness: 1, metalness: 0, flatShading: true,
          });
        }
        // Classify by Rhino LAYER name (only here — building meshes classify by user-string): the loader
        // exposes the layer table on the root + a layerIndex per mesh attributes (3DMLoader r160).
        // notLinked meshes may sit under an InstanceReference group, so check the mesh AND its ancestors.
        const layers = (object.userData && object.userData.layers) || [];
        // normalize a layer record to its leaf name, lowercased (handles "Parent::Child" full paths + case)
        const leaf = (s) => String(s == null ? '' : s).split(/::|\//).pop().trim().toLowerCase();
        const layerNameOf = (node) => {
          const attrs = node && node.userData && node.userData.attributes;
          const li = attrs ? attrs.layerIndex : -1;
          if (li == null || li < 0 || !layers[li]) return null;
          return layers[li].name != null ? layers[li].name : layers[li].fullPath;
        };
        const NL = 'project_notlinked';
        const isNotLinked = (mesh) => {
          for (let n = mesh; n && n !== object.parent; n = n.parent) {
            if (leaf(layerNameOf(n)) === NL) return true;
          }
          return false;
        };
        // ---- TEMP DIAGNOSTIC: report what the loader actually gave us (remove after verifying) ----
        const _counts = {};
        object.traverse((c) => {
          if (!c.isMesh) return;
          const ln = layerNameOf(c) || '(none)';
          _counts[ln] = (_counts[ln] || 0) + 1;
        });
        console.log('[context] layers table:', layers.map((l, i) => `${i}:${l && l.name}`));
        console.log('[context] mesh layer-name counts:', _counts);
        // context shows edges too, but THINNER than buildings — the shared _contextEdgeMat keeps a
        // fainter/darker line + a fraction of the tuned linewidth (applySharedStyle, rendering.md).
        const ctxMeshes = [];
        let _nl = 0;
        object.traverse((child) => {
          if (!child.isMesh) return;
          const notLinked = isNotLinked(child);
          if (notLinked) _nl++;
          child.material = notLinked ? _notLinkedMat : _contextMat;
          child.userData.key = null;
          child.userData.context = true;
          child.userData.notLinked = notLinked;
          ctxMeshes.push(child);
        });
        console.log(`[context] Project_notLinked meshes detected: ${_nl} of ${ctxMeshes.length}`);
        for (const cm of ctxMeshes) {
          cm.add(edgeLine(cm.geometry, _contextEdgeMat, 'context-edge'));
        }
        const entry = { group: object, keyToMeshes: new Map() };
        cache.set(KEY, entry);
        resolve(entry);
      },
      undefined,
      (err) => reject(err)
    );
  });
}
