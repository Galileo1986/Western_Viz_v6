// Rendering — scene orchestrator (the canonical viewer scene rig). Real .3dm + WUC context loading,
// render-config-driven globals, picking, camera, loop — with the CINEMATIC GOLD look: a real sun +
// soft VSM shadows + PMREM IBL + ACES, driven by data/render_config.json's `global.cinematic` block.
// SOP: architecture/rendering.md "Cinematic render style". Port report: sandbox/CINEMATIC_GOLD_MIGRATION.md.
//
// Returns { scene, camera, controls } so the chrome can read camera az/el for the CAMERA tag.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { loadBuildingGeometry, loadContextGeometry, loadDecorGeometry, applySharedStyle, updateEdgeResolution } from './geometry.js';
import { patinaTexture } from './patina.js';
import { applyStyle } from './materials.js'; // cinematic-gold styler + minimal selection/ghost
import { animateTo } from './camera.js';
import { select, clearSelection, enterBuilding, hover } from '../state/actions.js';

export function initRenderer({ container, store, assetBase = '/', contextUrl = null, decor = [], onGeometry = null }) {
  // Optional load-progress hook for the composition root's startup splash. Fires once per geometry
  // asset as it resolves (success OR failure, so the splash never stalls): ('context') | ('decor', key)
  // | ('building', code). Pure progress signal — Rendering imports no UI; the callback is supplied by
  // the composition root. Wrapped so a throwing splash can never break the render path.
  const reportGeo = (kind, id) => { try { if (onGeometry) onGeometry(kind, id); } catch (e) { /* ignore */ } };
  const scene = new THREE.Scene();
  // near/far are driven ADAPTIVELY each frame from the camera→target distance (see the loop) so the
  // LINEAR z-buffer stays precise across the campus — EXACTLY the sandbox setup. logarithmicDepthBuffer
  // is OFF to match the sandbox (the look study renders the lime massing glitch-free this way): logDepth
  // adds per-frame depth noise that, combined with fill polygonOffset, made coincident building walls
  // (e.g. DOC's adjacent rooms) flicker. With logDepth off + no fill offset, coincident faces resolve
  // deterministically. (rendering.md "Cinematic render style"; CINEMATIC_GOLD_MIGRATION.md §6/§11.)
  // FOV = 34° — EXACT sandbox parity (the minimal viewer shipped 50°). A flatter, architectural lens AND a
  // stability lever: to frame the same campus a wider 50° lens forces the camera ~1.5× CLOSER, shrinking the
  // adaptive near plane (dist*0.02) and widening the far/near ratio → less linear-depth precision → the
  // residual coincident-wall flicker. 34° keeps the camera back where depth is precise (rendering.md).
  const camera = new THREE.PerspectiveCamera(34, container.clientWidth / container.clientHeight, 0.5, 40000);
  camera.up.set(0, 0, 1); // Rhino/Z-up world
  camera.position.set(200, -200, 200);

  const renderer = new THREE.WebGLRenderer({
    antialias: true, logarithmicDepthBuffer: false, powerPreference: 'high-performance',
    preserveDrawingBuffer: true, // retain the last frame so the canvas is readable for UI screenshots
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // cap DPR — hiDPI rendered ~4× the pixels
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.48; // from cinematic.exposure (applyGlobals updates it live)
  // Soft, tunable VSM shadows. The campus + sun are STATIC → bake the shadow map on demand only
  // (needsUpdate after each load / sun move / flag change), so shadows are nearly free to keep on.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = false;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;

  // PMREM environment (IBL): without it metal renders dead-flat (the key cinematic lesson). Built lazily
  // in applyGlobals from cinematic.environment ("studio" | "sky" | "room"); rebuilt only when it changes.
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTex = null;
  let lastEnvSrc = null;
  function studioEquirect() {
    const c = document.createElement('canvas'); c.width = 2048; c.height = 1024; const x = c.getContext('2d');
    x.fillStyle = '#070708'; x.fillRect(0, 0, 2048, 1024);
    const hg = x.createLinearGradient(0, 360, 0, 700);
    hg.addColorStop(0, 'rgba(46,38,28,0)'); hg.addColorStop(0.5, 'rgba(120,96,60,0.45)'); hg.addColorStop(1, 'rgba(18,16,14,0)');
    x.fillStyle = hg; x.fillRect(0, 360, 2048, 340);
    const bars = [{ cx: 0.20, w: 0.045, i: 1.0 }, { cx: 0.45, w: 0.10, i: 0.45 }, { cx: 0.64, w: 0.05, i: 0.9 }, { cx: 0.85, w: 0.03, i: 1.0 }];
    for (const b of bars) {
      const cx = b.cx * 2048, w = b.w * 2048; const g = x.createLinearGradient(cx - w, 0, cx + w, 0);
      g.addColorStop(0, 'rgba(255,247,230,0)'); g.addColorStop(0.5, `rgba(255,247,230,${b.i})`); g.addColorStop(1, 'rgba(255,247,230,0)');
      x.fillStyle = g; x.fillRect(cx - w, 30, 2 * w, 840);
    }
    const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function skyEquirect() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#2a3340'); g.addColorStop(0.48, '#10141a'); g.addColorStop(0.52, '#1a1510'); g.addColorStop(1, '#050506');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
    const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function buildEnv(src) {
    if (envTex) envTex.dispose();
    if (src === 'room') { envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; }
    else { const tex = (src === 'sky') ? skyEquirect() : studioEquirect(); envTex = pmrem.fromEquirectangular(tex).texture; tex.dispose(); }
    scene.environment = envTex;
    lastEnvSrc = src;
  }

  // Composer: RenderPass → bloom → OutputPass. OutputPass owns ACES/sRGB on the composer path (r152+),
  // so the loop ALWAYS renders via the composer. Multisampled target (samples) restores AA for the thin
  // worldUnits edges (the off-screen chain bypasses canvas MSAA); swapped adaptively on orbit (below).
  const _db = renderer.getDrawingBufferSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(_db.x, _db.y, { samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(container.clientWidth, container.clientHeight), 0.07, 0.5, 0.85);
  bloomPass.enabled = true;
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.setSize(container.clientWidth, container.clientHeight);
  updateEdgeResolution(container.clientWidth, container.clientHeight); // LineMaterial needs viewport px
  // Adaptive MSAA: 4× at rest, 2× while orbiting (a lighter compromise than the old 0 — dropping MSAA
  // entirely stripped the thin worldUnits edges of coverage-based AA, so they visibly thickened +
  // brightened for the whole drag; 2× keeps enough coverage that the edges stay close to their rest look
  // while saving some framerate on this transparency-heavy scene). Recreates buffers on transition only.
  // (rendering.md "Edge antialiasing"; user 2026-06-07.)
  function setComposerMSAA(hi) {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(s.x, s.y, { samples: hi ? 4 : 2 });
    composer.renderTarget1.dispose(); composer.renderTarget2.dispose();
    composer.reset(rt);
  }
  controls.addEventListener('start', () => setComposerMSAA(false));
  controls.addEventListener('end', () => setComposerMSAA(true));

  // Lighting: a HemisphereLight fill ("ambient") + the SUN (the ONLY shadow caster). Values pushed live
  // from cinematic.{ambient,sun,shadow} in applyGlobals; sun placement + shadow frustum from placeSun().
  const hemi = new THREE.HemisphereLight(0x95acbd, 0x07070b, 0.48);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1da, 2.55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 1.5; // world units — kills acne on the large massing
  sun.shadow.radius = 4.5;
  sun.shadow.blurSamples = 25;
  scene.add(sun, sun.target);
  // NO synthetic ground plane — shadows are caught by the real WUC_Context geometry (receiveShadow below).

  const groups = new Map(); // code -> entry ({group, keyToMeshes})
  const loading = new Set();
  let current = store.getState();
  let lastViewKey = '';
  let contextGroup = null;

  function url(rel) { return assetBase.replace(/\/$/, '/') + String(rel).replace(/^\//, ''); }

  // ---- sun / shadow frustum + camera near/far sized from the campus bbox (recomputed as buildings load).
  // CRITICAL: bbox = BUILDINGS ONLY (NOT the context) — EXACTLY the sandbox (`computeBox` over `refs.byCode`).
  // The WUC_Context spans the whole masterplan (≫ the buildings); including it inflates `campusRadius`,
  // which inflates the camera `far` (loop below) → with logDepth OFF the linear z-buffer loses precision at
  // building distance → every building's surfaces z-FIGHT/flicker. Sizing to the buildings keeps `far`
  // tight → precise depth → no flicker, matching the sandbox.
  let campusBox = null;
  let campusRadius = 1000;
  function recomputeCampus() {
    const box = new THREE.Box3();
    for (const [, entry] of groups) box.expandByObject(entry.group);
    if (box.isEmpty()) return;
    campusBox = box;
    const size = box.getSize(new THREE.Vector3());
    campusRadius = Math.max(size.x, size.y) * 0.6;
    placeSun();
    applyFog(current.global); // fog near/far track campusRadius (sandbox parity) → refresh on bbox change
  }
  function placeSun() {
    if (!campusBox) return;
    const cin = (current.global && current.global.cinematic) || {};
    const s = cin.sun || {};
    const center = campusBox.getCenter(new THREE.Vector3());
    const az = ((s.azimuth != null ? s.azimuth : 171)) * Math.PI / 180;
    const el = ((s.elevation != null ? s.elevation : 28)) * Math.PI / 180;
    const dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el));
    const dist = campusRadius * 3.2;
    sun.position.copy(center).addScaledVector(dir, dist);
    sun.target.position.copy(center); sun.target.updateMatrixWorld();
    const sc = sun.shadow.camera;
    sc.left = -campusRadius * 1.3; sc.right = campusRadius * 1.3;
    sc.top = campusRadius * 1.3; sc.bottom = -campusRadius * 1.3;
    sc.near = dist * 0.2; sc.far = dist * 2.2;
    sc.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
  }

  // Shadow flags + uv2/patina on a freshly loaded group. Skip edge overlays (LineSegments2 are isMesh).
  function isEdge(o) { const k = o.userData && o.userData.kind; return typeof k === 'string' && k.endsWith('-edge'); }

  // Context patina (cloudy aoMap, darken-only). Applied from applyGlobals — NOT the load .then — because
  // the render config loads async and may arrive AFTER the context geometry; the change-guard makes it a
  // cheap no-op on every other apply. uv2 is backfilled at load (below) so the aoMap has a UV channel.
  let lastContextPatina = -1;
  function applyContextPatina(cin) {
    if (!contextGroup) return;
    const cpat = cin && cin.material ? (cin.material.contextPatina || 0) : 0;
    if (cpat === lastContextPatina) return;
    lastContextPatina = cpat;
    const pat = cpat > 0 ? patinaTexture() : null;
    contextGroup.traverse((o) => {
      if (!o.isMesh || isEdge(o) || !o.material || !('aoMap' in o.material)) return;
      o.material.aoMap = pat; o.material.aoMapIntensity = cpat * 2; o.material.needsUpdate = true;
    });
  }

  // campus context backdrop (the REAL WUC_Context.3dm). Dark matte, casts + receives shadow (the ground
  // catches the building shadows). uv2 backfilled for the patina aoMap (applied via applyGlobals).
  if (contextUrl) {
    loadContextGeometry(url(contextUrl))
      .then((entry) => {
        contextGroup = entry.group;
        contextGroup.visible = contextVisible(current);
        contextGroup.traverse((o) => {
          if (!o.isMesh || isEdge(o)) return;
          o.castShadow = true; o.receiveShadow = true;
          const g = o.geometry;
          if (g && g.attributes && g.attributes.uv && !g.attributes.uv2) g.setAttribute('uv2', g.attributes.uv);
        });
        scene.add(contextGroup);
        applyGlobals(current);
        recomputeCampus();
        reportGeo('context');
      })
      .catch((e) => { console.warn('context load failed', e); reportGeo('context'); });
  }

  // Static decoration backdrops (trees / roads / etc.) — non-interactive; shadow flags from the optional
  // composition-root `shadow` hint ('cast' = trees, 'receive' = roads). Not in the pickable `groups`.
  // CAMPUS-ONLY: the campus landscape (trees + the whole Enturage set — roads, parking, promenade, green,
  // train) is hidden in building scope and reappears at campus, matching the labels/billboards/pins gating
  // (the scope subscription below toggles them; we also set the right initial visibility on async load).
  const decorGroups = [];
  for (const d of decor) {
    loadDecorGeometry(d.key, url(d.url), d)
      .then((entry) => {
        if (d.shadow === 'cast' || d.shadow === 'receive') {
          entry.group.traverse((o) => {
            if (!o.isMesh || isEdge(o)) return;
            o.castShadow = d.shadow === 'cast';
            o.receiveShadow = d.shadow === 'receive';
          });
          renderer.shadowMap.needsUpdate = true;
        }
        entry.group.visible = current.scope.mode === 'campus';
        decorGroups.push(entry.group);
        scene.add(entry.group);
        reportGeo('decor', d.key);
      })
      .catch((e) => { console.warn('decor load failed', d.url, e); reportGeo('decor', d.key); });
  }

  // Fog near/far track the campus size — EXACT sandbox parity (near = campusRadius*3, far = campusRadius*12),
  // NOT fixed world units. Fixed units (the old 3000/16000) started the haze too close and muted mid-distance
  // building colors. Re-run whenever campusRadius changes (recomputeCampus). Config `fog.near/.far` are now
  // informational; `enabled` + `color` (tracks bg) still apply. (rendering.md "Fog near/far track campusRadius".)
  function applyFog(g) {
    g = g || {};
    if (g.fog && g.fog.enabled) {
      const fogColor = g.fog.color || g.background;
      const near = campusRadius * 3;
      const far = campusRadius * 12;
      if (!scene.fog) scene.fog = new THREE.Fog(fogColor, near, far);
      else { scene.fog.color.set(fogColor); scene.fog.near = near; scene.fog.far = far; }
    } else {
      scene.fog = null;
    }
  }

  function applyGlobals(vm) {
    const g = vm.global || {};
    if (g.background) scene.background = new THREE.Color(g.background);
    applyFog(g);
    if (g.bloom) {
      bloomPass.enabled = !!g.bloom.enabled;
      if (g.bloom.strength != null) bloomPass.strength = g.bloom.strength;
      if (g.bloom.radius != null) bloomPass.radius = g.bloom.radius;
      if (g.bloom.threshold != null) bloomPass.threshold = g.bloom.threshold;
    }
    // cinematic lighting / tone — pushed live so the look is config-driven (no hard-coded render params).
    const cin = g.cinematic;
    if (cin) {
      if (cin.exposure != null) renderer.toneMappingExposure = cin.exposure;
      if (cin.ambient != null) hemi.intensity = cin.ambient;
      const s = cin.sun || {};
      if (s.color) sun.color.set(s.color);
      if (s.intensity != null) sun.intensity = s.intensity;
      const sh = cin.shadow || {};
      sun.castShadow = sh.enabled !== false;
      if (sh.softness != null) sun.shadow.radius = sh.softness;
      if ((cin.environment || 'studio') !== lastEnvSrc) buildEnv(cin.environment || 'studio');
      applyContextPatina(cin);
      placeSun();
    }
    applySharedStyle(g, vm.scope && vm.scope.mode);
  }

  // The context group stays in the scene in BOTH scopes so its EDGE wireframe (the surrounding city
  // blocks) always reads. Only the FILL opacity (classes.context.fill.opacity, byScope) is scope-driven:
  // 1.0 at campus = solid matte blocks; 0 in building scope = invisible fill with the wireframe still
  // drawn — EXACT sandbox parity (main_viewer_render_sandbox keeps contextMats opacity→0 but ctxEdge on).
  // The edge overlays are CHILDREN of the fill meshes, so hiding the group/fill would also kill the edges
  // → the group must stay visible; the per-mesh fill opacity (applySharedStyle) is what hides the fill.
  function contextVisible() { return true; }

  function visibleCodes(vm) {
    return vm.buildings.filter((b) => b.hasGeometry).map((b) => b.code);
  }

  function ensureAndStyle(vm) {
    const want = new Set(visibleCodes(vm));
    for (const code of want) {
      if (groups.has(code) || loading.has(code)) continue;
      const b = vm.buildings.find((x) => x.code === code);
      if (!b) continue;
      loading.add(code);
      loadBuildingGeometry(code, url(b.geometry_url), b.placement)
        .then((entry) => {
          loading.delete(code);
          groups.set(code, entry);
          // Shadow casters + receivers: building envelope + room fills (geometry.js backfilled uv2 for
          // the patina aoMap). Ensure a MeshStandardMaterial so metal/IBL/patina actually apply.
          entry.group.traverse((o) => {
            if (!o.isMesh || isEdge(o)) return;
            const k = o.userData.kind;
            if (k === 'envelope' || k === 'room') {
              o.castShadow = true; o.receiveShadow = true;
              // Sandbox parity: replace the loader's cloned material with a FRESH MeshStandardMaterial
              // carrying only the data color (exactly like the sandbox goldMat) — drops any stray loader
              // properties (vertexColors / map / flatShading) that setFill doesn't reset. setFill then
              // stamps the constant gold treatment on top. (rendering.md "Material treatment".)
              const col = (o.material && o.material.color) ? o.material.color.clone() : new THREE.Color(0x888888);
              o.material = new THREE.MeshStandardMaterial({ color: col });
            }
          });
          scene.add(entry.group);
          recomputeCampus();
          styleAll(current);
          reportGeo('building', code);
        })
        .catch((e) => { loading.delete(code); console.warn('geometry load failed', code, e); reportGeo('building', code); });
    }
    for (const [code, entry] of groups) entry.group.visible = want.has(code);
    styleAll(vm);
  }

  function styleAll(vm) {
    const selKey = vm.selection ? vm.selection.key : null;
    const focusedCode = vm.scope.mode === 'building' ? vm.scope.buildingCode : null;
    for (const [, entry] of groups) {
      if (entry.group.visible) {
        applyStyle(entry, vm.styleMap, vm.global || {}, selKey, vm.scope.mode, vm.envelopeStyle, focusedCode, vm.ghost, vm.campusRender, vm.spotlight);
      }
    }
    applyGhostCad(vm);
    renderer.shadowMap.needsUpdate = true; // visibility / material change → re-bake the static shadow map
  }

  // Ghost-mode CAD reveal (rendering.md "2D-plan layers in the building model"). The CAD linework lives
  // hidden inside the building model (geometry.js groups it by level). It becomes visible in the 3D view
  // ONLY when: ghost mode is on (2D-plan companion) + building scope + a ROOM is selected → show that
  // room's level's CAD, hide every other level. Selecting a room on another floor switches the level;
  // ghost off / no room / campus → all CAD hidden. Keyed-cache so the per-line visibility loop only runs
  // when the shown (code, level) actually changes (not on every re-style).
  let lastCadKey = null;
  function applyGhostCad(vm) {
    const on = !!(vm.ghost && vm.ghost.on) && vm.scope.mode === 'building';
    const selKey = (vm.selection && vm.selection.kind === 'room') ? vm.selection.key : null;
    let targetCode = null, targetLevel = null;
    if (on && selKey) {
      targetCode = selKey.split('::')[0];
      const entry = groups.get(targetCode);
      if (entry && entry.keyToLevel) targetLevel = entry.keyToLevel.get(selKey) || null;
    }
    const cadKey = targetLevel ? `${targetCode}|${targetLevel}` : '';
    if (cadKey === lastCadKey) return;
    lastCadKey = cadKey;
    for (const [code, entry] of groups) {
      if (!entry.planCad) continue;
      for (const [lv, objs] of entry.planCad) {
        const vis = code === targetCode && lv === targetLevel;
        for (const o of objs) o.visible = vis;
      }
    }
  }

  // F8 — recenter the 3D camera on a newly selected room (building scope). The room's WORLD position
  // lives only in the loaded meshes (State is pure, has no geometry), so this is a Rendering concern:
  // retarget to the room's bbox center, preserving the current view direction + distance (no teleport).
  let lastSelKeyForCam = null;
  function maybeRecenterOnRoom(vm) {
    const sel = vm.selection;
    const key = (sel && sel.kind === 'room') ? sel.key : null;
    if (key === lastSelKeyForCam) return;
    lastSelKeyForCam = key;
    if (!key || vm.scope.mode !== 'building') return;
    const code = key.split('::')[0];
    const entry = groups.get(code);
    const meshes = entry && entry.keyToMeshes && entry.keyToMeshes.get(key);
    if (!meshes || !meshes.length) return;
    const box = new THREE.Box3();
    for (const mesh of meshes) box.expandByObject(mesh);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    camera.updateMatrixWorld();
    const ndc = center.clone().project(camera);
    const onScreen = ndc.z < 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
    if (onScreen) return;
    const offset = camera.position.clone().sub(controls.target);
    animateTo(camera, controls, { target: center.toArray(), position: center.clone().add(offset).toArray() });
  }

  // The shared derive.campusView/buildingView framing is tuned for the legacy 50° FOV; at the cinematic 34°
  // it would crop the campus. Scale each view's offset OUT by the exact FOV ratio so the apparent framing is
  // preserved AND the camera sits back where the linear depth buffer is precise (rendering.md "Camera FOV").
  const VIEW_DIST_SCALE = Math.tan((50 / 2) * Math.PI / 180) / Math.tan((34 / 2) * Math.PI / 180); // ≈1.525
  function scaledView(view) {
    if (!view || !view.target || !view.position) return view;
    // A manually-saved view (camera_tool.md) is already framed at this 34° FOV → apply verbatim, no rescale.
    if (view.raw) return view;
    const t = view.target; const p = view.position;
    return {
      ...view,
      position: [
        t[0] + (p[0] - t[0]) * VIEW_DIST_SCALE,
        t[1] + (p[1] - t[1]) * VIEW_DIST_SCALE,
        t[2] + (p[2] - t[2]) * VIEW_DIST_SCALE,
      ],
    };
  }

  function maybeAnimate(vm) {
    if (!vm.view) return;
    const key = JSON.stringify([vm.view.target, vm.view.position]);
    if (key !== lastViewKey) { lastViewKey = key; animateTo(camera, controls, scaledView(vm.view)); }
  }

  store.subscribe((vm, action) => {
    current = vm;
    // Hover changes only the tooltip — nothing in the 3D scene reads vm.hover. Skip the full re-style +
    // shadow re-bake so cursor motion stays smooth (state.md: heavy subscribers ignore HOVER). `current`
    // is kept current above for the post-load styleAll(current).
    if (action && action.type === 'HOVER') return;
    applyGlobals(vm);
    if (contextGroup) contextGroup.visible = contextVisible(vm);
    // Campus landscape decoration (trees + Enturage roads/parking/promenade/green/train) is campus-only —
    // hide it in building scope, restore at campus (consistent with the labels/billboards/pins gating).
    const decorVisible = vm.scope.mode === 'campus';
    for (const g of decorGroups) g.visible = decorVisible;
    ensureAndStyle(vm);
    maybeAnimate(vm);
    maybeRecenterOnRoom(vm);
  });

  // ---- picking (raycast) — identical to viewer/rendering/scene.js ----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downXY = null;
  let pendingMove = null;
  let lastHoverKey = null;

  function pickAt(clientX, clientY, pred = (o) => o.userData.key) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const meshes = [];
    for (const [, entry] of groups) {
      if (entry.group.visible) {
        entry.group.traverse((c) => {
          const k = c.userData.kind;
          if (c.isMesh && c.visible && !(typeof k === 'string' && k.endsWith('-edge'))) meshes.push(c);
        });
      }
    }
    return raycaster.intersectObjects(meshes, false).find((h) => pred(h.object)) || null;
  }

  renderer.domElement.addEventListener('pointerdown', (e) => { downXY = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downXY) return;
    const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]);
    downXY = null;
    if (moved > 5) return;
    if (current.scope.mode === 'campus') {
      if (current.campusRender === 'rooms') {
        // room-paint layer active → single-click selects the ROOM under the cursor (room-readings card).
        const hit = pickAt(e.clientX, e.clientY, (o) => o.userData.kind === 'room' && o.userData.key);
        if (hit) store.dispatch(select(hit.object.userData.key));
        else store.dispatch(clearSelection());
      } else {
        // envelope layer → single-click selects the BUILDING (building-info card; the two-step nav).
        const hit = pickAt(e.clientX, e.clientY,
          (o) => o.userData.buildingCode && (o.userData.kind === 'room' || o.userData.kind === 'envelope'));
        if (hit) store.dispatch(select(hit.object.userData.buildingCode));
        else store.dispatch(clearSelection());
      }
    } else {
      const hit = pickAt(e.clientX, e.clientY);
      if (hit) store.dispatch(select(hit.object.userData.key));
      else store.dispatch(clearSelection());
    }
  });
  renderer.domElement.addEventListener('dblclick', (e) => {
    if (current.scope.mode !== 'campus') return;
    const hit = pickAt(e.clientX, e.clientY,
      (o) => o.userData.buildingCode && (o.userData.kind === 'room' || o.userData.kind === 'envelope'));
    if (hit) store.dispatch(enterBuilding(hit.object.userData.buildingCode));
  });
  renderer.domElement.addEventListener('pointermove', (e) => { pendingMove = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerleave', () => {
    pendingMove = null;
    if (lastHoverKey !== null) { lastHoverKey = null; store.dispatch(hover(null)); }
  });

  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloomPass.setSize(w, h);
    updateEdgeResolution(w, h);
  });

  (function loop() {
    requestAnimationFrame(loop);
    controls.update();
    // Adaptive near/far (sandbox parity, logDepth is OFF): near shrinks as you zoom in so close geometry
    // is never clipped, and grows back out far away → the LINEAR z-buffer stays precise across the scene.
    const dist = camera.position.distanceTo(controls.target);
    const near = Math.max(0.4, dist * 0.02);
    const far = dist + campusRadius * 8 + 3000;
    if (Math.abs(camera.near - near) > near * 0.05 || Math.abs(camera.far - far) > far * 0.05) {
      camera.near = near; camera.far = far; camera.updateProjectionMatrix();
    }
    if (pendingMove && !downXY) {
      const hit = pickAt(pendingMove[0], pendingMove[1]);
      pendingMove = null;
      const key = hit ? hit.object.userData.key : null;
      if (key !== lastHoverKey) { lastHoverKey = key; store.dispatch(hover(key)); }
    }
    composer.render(); // OutputPass owns tonemapping → always render via the composer
  })();

  return { scene, camera, controls };
}
