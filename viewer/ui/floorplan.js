// UI domain — 2D floor-plan panel. SOP: architecture/ui.md ("2D floor-plan panel").
//
// A building-scope SVG floor plan, two-way selection-synced with the 3D model. A store-subscriber peer
// to the 3D renderer (NOT a spec.js block / skin template): pan/zoom, floor switching, and SVG build are
// imperative and outside the declarative skin grammar. It reads the VIEW-MODEL only (styleMap/selection/
// scope/focus/global/ghost) and dispatches store actions. Import budget: Data (loadPlan) + State (actions)
// — 2 domains. It imports NO three.js and nothing from Rendering (Rendering ⊥ UI); it never reads mesh
// colors — room fills come from vm.styleMap (the value Interpretation already encoded for the active layer).
//
// Promoted from sandbox/plan_2d_sandbox.html: the prototype's cross-wired local `selectRoom` is gone —
// selection is store state, colors are read off the vm, highlight is this view reacting to the vm. The 3D
// view does the same independently, so the two stay consistent with no view-to-view wiring.

import { loadPlan } from '../data/loaders.js';
import { select, clearSelection, setGhost } from '../state/actions.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const SEL_FALLBACK = '#c8f24a';
const MISSING_FALLBACK = '#4a4e52';

function div(cls, text) {
  const d = document.createElement('div');
  if (cls) d.className = cls;
  if (text != null) d.textContent = text;
  return d;
}

export function initFloorPlan({ container, store }) {
  // ---- static chrome (built once) ----------------------------------------------------
  container.replaceChildren();
  const head = div('plan-head');
  head.title = 'Drag to move the panel';
  // minimize toggle — collapses the panel to just this header bar (a draggable floating title) so it
  // doesn't obstruct the 3D view while orbiting on small screens. Lives in the header's right group.
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'plan-collapse';
  collapseBtn.type = 'button';
  collapseBtn.setAttribute('aria-label', 'Minimize floor-plan panel');
  collapseBtn.title = 'Minimize to title bar';
  collapseBtn.textContent = '–';
  const headRight = div('plan-head-right');
  headRight.append(div('plan-hint', 'drag header to move · ↙ resize'), collapseBtn);
  head.append(div('plan-title', 'Floor plan'), headRight);
  const floorsBar = div('plan-floors');
  const svgwrap = div('plan-svgwrap');
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('class', 'plan-svg');
  svgwrap.appendChild(svg);

  const ghostWrap = div('plan-ghost');
  const ghostBtn = document.createElement('button');
  ghostBtn.className = 'plan-ghost-btn';
  ghostBtn.type = 'button';
  ghostBtn.title = 'Dim all unselected rooms in the 3D model so the selected one stands out';
  ghostBtn.innerHTML = '<span>Ghost mode</span><span class="st">off</span>';
  const ghostOpRow = div('plan-ghost-op');
  ghostOpRow.style.display = 'none';
  const ghostOp = document.createElement('input');
  ghostOp.type = 'range'; ghostOp.min = '0'; ghostOp.max = '100'; ghostOp.value = '30';
  const ghostVal = div('val', '30%');
  ghostOpRow.append(div('lbl', 'Opacity'), ghostOp, ghostVal);
  ghostWrap.append(ghostBtn);

  // level buttons (left, flexible) + ghost toggle (right) share ONE compact control row so the plan keeps
  // more height; the opacity slider — only shown when ghost is on — sits as its own thin row beneath it.
  const controls = div('plan-controls');
  controls.append(floorsBar, ghostWrap);
  container.append(head, controls, ghostOpRow, svgwrap);

  // ---- resize grip (top-left; panel is anchored bottom-right → grows toward top-left) ----
  // Drives the panel's width/height inline; the SVG area (flex:1) fills the rest. CSS max-width/height
  // cap it to the stage, and we clamp during the drag too. The inline size persists across re-renders
  // (the chrome is built once) so a resized plan stays resized when switching layers/buildings.
  const grip = div('plan-grip');
  grip.title = 'Drag to resize';
  container.appendChild(grip);
  let rz = null;
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    rz = { x: e.clientX, y: e.clientY, w: container.offsetWidth, h: container.offsetHeight };
    try { grip.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });
  grip.addEventListener('pointermove', (e) => {
    if (!rz) return;
    const parent = container.parentElement;
    const maxW = (parent ? parent.clientWidth : window.innerWidth) - 28;
    const maxH = (parent ? parent.clientHeight : window.innerHeight) - 28;
    const w = Math.max(300, Math.min(maxW, rz.w + (rz.x - e.clientX)));
    const h = Math.max(240, Math.min(maxH, rz.h + (rz.y - e.clientY)));
    container.style.width = w + 'px';
    container.style.height = h + 'px';
  });
  const endResize = (e) => { if (!rz) return; rz = null; try { grip.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ } };
  grip.addEventListener('pointerup', endResize);
  grip.addEventListener('pointercancel', endResize);

  // ---- move (drag the header) — keeps the panel bottom-right-anchored so the resize grip's anchor math
  // is untouched: moving just adjusts the right/bottom OFFSETS. Clamped to the stage. Inline offsets
  // persist across re-renders (chrome built once), so a moved panel stays put when switching layers. ----
  let mv = null;
  head.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const parent = container.parentElement;
    const pr = parent ? parent.getBoundingClientRect() : { right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
    const cr = container.getBoundingClientRect();
    mv = { x: e.clientX, y: e.clientY, right: pr.right - cr.right, bottom: pr.bottom - cr.bottom,
           maxRight: pr.width - cr.width, maxBottom: pr.height - cr.height };
    try { head.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    head.classList.add('dragging');
  });
  head.addEventListener('pointermove', (e) => {
    if (!mv) return;
    const right = Math.max(0, Math.min(mv.maxRight, mv.right - (e.clientX - mv.x)));
    const bottom = Math.max(0, Math.min(mv.maxBottom, mv.bottom - (e.clientY - mv.y)));
    container.style.right = right + 'px';
    container.style.bottom = bottom + 'px';
  });
  const endMove = (e) => { if (!mv) return; mv = null; try { head.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ } head.classList.remove('dragging'); };
  head.addEventListener('pointerup', endMove);
  head.addEventListener('pointercancel', endMove);

  // ---- minimize / restore — toggles a .collapsed class; CSS hides everything but the header and lets
  // the panel shrink to the title bar. State persists across re-renders (chrome built once) and across
  // building switches, so a minimized panel stays minimized until the user expands it. ----
  let collapsed = false;
  function setCollapsed(c) {
    collapsed = c;
    container.classList.toggle('collapsed', c);
    collapseBtn.textContent = c ? '+' : '–';
    collapseBtn.title = c ? 'Expand floor-plan panel' : 'Minimize to title bar';
    collapseBtn.setAttribute('aria-label', c ? 'Expand floor-plan panel' : 'Minimize floor-plan panel');
  }
  // swallow pointerdown so clicking the button never starts a header drag
  collapseBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(!collapsed); });
  // start collapsed so the plan never obstructs the 3D view on first entering a building — the user
  // expands it deliberately via the title-bar toggle.
  setCollapsed(true);

  // ghost controls → dispatch SET_GHOST (store owns the flag so Rendering can read it; transient)
  ghostBtn.addEventListener('click', () => {
    const g = store.getState().ghost || { on: false };
    store.dispatch(setGhost({ on: !g.on }));
  });
  ghostOp.addEventListener('input', () => {
    store.dispatch(setGhost({ opacity: ghostOp.valueAsNumber / 100 }));
  });

  // ---- panel-local plan state (allowed: this IS the panel component, not the store) ---
  const builts = new Map();    // code -> built plan refs (or null = absent artifact)
  let cur = null;              // currently mounted built plan, or null
  let curCode = null;          // currently mounted building code
  let loadingCode = null;      // code whose artifact is in-flight
  let latestVM = null;         // most recent view-model (for re-render after async load)
  let panning = null;
  let dragMoved = false;       // true once a pan exceeds the click threshold (suppress room click)
  let panelLastClickKey = null; // a room key the user clicked IN this plan → skip auto-recenter for it

  // ---- view transform (panel-local viewBox; per mounted plan) -------------------------
  function setView(v) {
    if (!cur) return;
    cur.view = { ...v };
    svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
  }
  function clientToWorld(ev) {
    const r = svg.getBoundingClientRect();
    const scale = Math.min(r.width / cur.view.w, r.height / cur.view.h);
    const offX = (r.width - cur.view.w * scale) / 2;
    const offY = (r.height - cur.view.h * scale) / 2;
    return { x: cur.view.x + (ev.clientX - r.left - offX) / scale,
             y: cur.view.y + (ev.clientY - r.top - offY) / scale };
  }
  function panToRoom(key) {
    const c = cur.keyToCenter.get(key);
    if (!c) return;
    setView({ x: c[0] - cur.view.w / 2, y: c[1] - cur.view.h / 2, w: cur.view.w, h: cur.view.h });
  }
  // is a room already fully inside the visible plan area? (preserveAspectRatio "meet" makes the visible
  // world rect larger than `view` on the long axis — account for that). Used to skip a needless pan.
  function roomFullyVisible(key) {
    const poly = cur.keyToPoly.get(key);
    if (!poly) return true;
    const bb = poly.getBBox();
    const r = svg.getBoundingClientRect();
    const scale = Math.min(r.width / cur.view.w, r.height / cur.view.h);
    if (!(scale > 0)) return true;
    const visW = r.width / scale, visH = r.height / scale;
    const visX = cur.view.x + cur.view.w / 2 - visW / 2;
    const visY = cur.view.y + cur.view.h / 2 - visH / 2;
    return bb.x >= visX && bb.y >= visY && bb.x + bb.width <= visX + visW && bb.y + bb.height <= visY + visH;
  }
  function showLevel(lv) {
    if (!cur) return;
    cur.level = lv;
    for (const [k, g] of cur.levelGroups) g.style.display = (k === lv) ? '' : 'none';
    for (const [k, b] of cur.levelRows) b.classList.toggle('on', k === lv);
  }

  // ---- pan / zoom listeners (static; read `cur`) --------------------------------------
  svg.addEventListener('wheel', (e) => {
    if (!cur) return;
    e.preventDefault();
    const w = clientToWorld(e);
    const f = e.deltaY < 0 ? 0.85 : 1.18;
    const nw = Math.min(cur.baseView.w * 1.2, cur.view.w * f);
    const nh = Math.min(cur.baseView.h * 1.2, cur.view.h * f);
    setView({ x: w.x - (w.x - cur.view.x) * (nw / cur.view.w),
              y: w.y - (w.y - cur.view.y) * (nh / cur.view.h), w: nw, h: nh });
  }, { passive: false });
  svg.addEventListener('pointerdown', (e) => {
    if (!cur) return;
    panning = { sx: e.clientX, sy: e.clientY, vx: cur.view.x, vy: cur.view.y };
    dragMoved = false;
    svg.classList.add('grabbing');
  });
  svg.addEventListener('pointermove', (e) => {
    if (!panning || !cur) return;
    const r = svg.getBoundingClientRect();
    const scale = Math.min(r.width / cur.view.w, r.height / cur.view.h);
    const dx = (e.clientX - panning.sx) / scale, dy = (e.clientY - panning.sy) / scale;
    if (Math.abs(e.clientX - panning.sx) + Math.abs(e.clientY - panning.sy) > 3) dragMoved = true;
    setView({ ...cur.view, x: panning.vx - dx, y: panning.vy - dy });
  });
  window.addEventListener('pointerup', () => { panning = null; svg.classList.remove('grabbing'); });
  svg.addEventListener('dblclick', () => { if (cur) setView(cur.baseView); });
  // background click (room clicks stopPropagation) → deselect, unless it ended a pan
  svg.addEventListener('click', () => { if (!dragMoved) store.dispatch(clearSelection()); });

  // ---- build the SVG for one plan artifact (detached; mounted on demand) --------------
  function buildPlan(plan) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const lv of plan.levels) {
      const b = plan.bbox[lv]; if (!b) continue;
      minX = Math.min(minX, b[0]); minY = Math.min(minY, b[1]);
      maxX = Math.max(maxX, b[2]); maxY = Math.max(maxY, b[3]);
    }
    if (!isFinite(minX)) return null;
    const pad = Math.max(maxX - minX, maxY - minY) * 0.04;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const flipY = (y) => (maxY + minY - y); // flip so north is up
    const baseView = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };

    const levelGroups = new Map(), levelRoomsG = new Map(), levelLabelsG = new Map();
    const keyToPoly = new Map(), keyToLabel = new Map(), keyToLevel = new Map(), keyToCenter = new Map();
    for (const lv of plan.levels) {
      const g = document.createElementNS(SVGNS, 'g'); g.style.display = 'none';
      const roomsG = document.createElementNS(SVGNS, 'g');
      const cadG = document.createElementNS(SVGNS, 'g');
      const labelsG = document.createElementNS(SVGNS, 'g');
      let d = '';
      for (const pl of (plan.cad[lv] || [])) {
        const pts = pl.pts;
        d += 'M' + pts[0][0] + ' ' + flipY(pts[0][1]);
        for (let i = 1; i < pts.length; i++) d += 'L' + pts[i][0] + ' ' + flipY(pts[i][1]);
      }
      if (d) { const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('class', 'cad'); p.setAttribute('d', d); cadG.appendChild(p); }
      g.append(roomsG, cadG, labelsG);
      levelGroups.set(lv, g); levelRoomsG.set(lv, roomsG); levelLabelsG.set(lv, labelsG);
    }
    for (const room of plan.rooms) {
      keyToLevel.set(room.key, room.level);
      if (room.c) keyToCenter.set(room.key, [room.c[0], flipY(room.c[1])]);
      const roomsG = levelRoomsG.get(room.level); if (!roomsG) continue;
      // boundary loop(s) → one <path> with even-odd fill (.room CSS) so a room with a courtyard/atrium
      // hole or disjoint pieces fills correctly. `loops` (v2 schema, outer-first); fall back to a single
      // `poly` for any legacy artifact.
      const rings = room.loops || (room.poly ? [room.poly] : []);
      const poly = document.createElementNS(SVGNS, 'path');
      poly.setAttribute('class', 'room');
      let dp = '';
      for (const ring of rings) {
        if (!ring || ring.length < 2) continue;
        dp += 'M' + ring[0][0] + ' ' + flipY(ring[0][1]);
        for (let i = 1; i < ring.length; i++) dp += 'L' + ring[i][0] + ' ' + flipY(ring[i][1]);
        dp += 'Z';
      }
      poly.setAttribute('d', dp);
      poly.dataset.key = room.key;
      poly.addEventListener('click', (e) => {
        e.stopPropagation();
        if (dragMoved) return;           // ignore the click that ended a pan
        panelLastClickKey = room.key;    // origin = this plan → don't auto-recenter on the resulting selection
        store.dispatch(select(room.key));
      });
      roomsG.appendChild(poly);
      keyToPoly.set(room.key, poly);
      if (room.c) {
        const t = document.createElementNS(SVGNS, 'text');
        t.setAttribute('class', 'rlabel');
        t.setAttribute('x', room.c[0]); t.setAttribute('y', flipY(room.c[1]));
        t.textContent = room.room_id;
        levelLabelsG.get(room.level).appendChild(t);
        keyToLabel.set(room.key, t);
      }
    }
    const levelRows = new Map(); const floorButtons = [];
    for (const lv of plan.levels) {
      const b = document.createElement('button');
      b.className = 'plan-floor-btn'; b.type = 'button'; b.textContent = lv;
      b.addEventListener('click', () => showLevel(lv));
      levelRows.set(lv, b); floorButtons.push(b);
    }
    return { levels: plan.levels, levelGroups, keyToPoly, keyToLabel, keyToLevel, keyToCenter,
             levelRows, floorButtons, baseView, view: { ...baseView }, level: null, selKey: null };
  }

  function mountBuilt(code) {
    const b = builts.get(code);
    curCode = code; cur = b;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    floorsBar.replaceChildren();
    if (!b) return;
    for (const g of b.levelGroups.values()) svg.appendChild(g);
    for (const btn of b.floorButtons) floorsBar.appendChild(btn);
    setView(b.view || b.baseView);
    showLevel(b.level || b.levels[0]);
  }

  // load (once) the artifact for `code`, build it, then re-render the latest vm
  function ensure(code) {
    if (loadingCode === code) return;
    loadingCode = code;
    loadPlan(code)
      .then((artifact) => {
        loadingCode = null;
        builts.set(code, artifact ? buildPlan(artifact) : null);
        if (latestVM) render(latestVM);
      })
      .catch((e) => { loadingCode = null; builts.set(code, null); console.warn('plan load failed', code, e); });
  }

  // ---- per-vm rendering --------------------------------------------------------------
  function syncGhost(ghost) {
    const g = ghost || { on: false, opacity: 0.3 };
    ghostBtn.classList.toggle('on', !!g.on);
    ghostBtn.querySelector('.st').textContent = g.on ? 'on' : 'off';
    ghostOpRow.style.display = g.on ? '' : 'none';
    const pct = Math.round((g.opacity != null ? g.opacity : 0.3) * 100);
    if (ghostOp.value !== String(pct)) ghostOp.value = String(pct);
    ghostVal.textContent = pct + '%';
  }

  function applyColors(vm) {
    const missing = (vm.global && vm.global.missingData && vm.global.missingData.color) || MISSING_FALLBACK;
    for (const [key, poly] of cur.keyToPoly) {
      if (key === cur.selKey) continue;                 // selected room keeps the selection color
      const sm = vm.styleMap[key];
      poly.style.setProperty('--rc', sm ? sm.color : missing);
    }
  }

  function applySelection(vm) {
    const selColor = (vm.global && vm.global.selection && vm.global.selection.color) || SEL_FALLBACK;
    const missing = (vm.global && vm.global.missingData && vm.global.missingData.color) || MISSING_FALLBACK;
    const selKey = (vm.selection && vm.selection.kind === 'room') ? vm.selection.key : null;

    if (cur.selKey && cur.selKey !== selKey) {           // restore the previously selected room
      const p = cur.keyToPoly.get(cur.selKey);
      if (p) { p.classList.remove('sel'); const sm = vm.styleMap[cur.selKey]; p.style.setProperty('--rc', sm ? sm.color : missing); }
      const l = cur.keyToLabel.get(cur.selKey); if (l) l.classList.remove('sel');
    }
    if (selKey) {
      const lv = cur.keyToLevel.get(selKey);
      if (lv && lv !== cur.level) showLevel(lv);          // jump the plan to the selected room's level
      const p = cur.keyToPoly.get(selKey);
      if (p) { p.classList.add('sel'); p.style.setProperty('--rc', selColor); }
      const l = cur.keyToLabel.get(selKey); if (l) l.classList.add('sel');
      // auto-recenter ONLY when the selection came from outside the plan (a 3D pick) and the room isn't
      // already fully visible — a click in the plan leaves the view where it is.
      if (selKey !== panelLastClickKey && cur.keyToPoly.has(selKey) && !roomFullyVisible(selKey)) panToRoom(selKey);
    }
    cur.selKey = selKey;
    panelLastClickKey = null; // consumed: only the immediate post-click render skips recenter
  }

  function render(vm) {
    latestVM = vm;
    syncGhost(vm.ghost);
    const show = vm.scope.mode === 'building' && vm.focus;
    if (!show) { container.style.display = 'none'; return; }

    const code = vm.focus.code;
    if (code !== curCode) {
      if (!builts.has(code)) { ensure(code); container.style.display = 'none'; return; } // loading/absent
      mountBuilt(code);
    }
    if (!cur) { container.style.display = 'none'; return; } // artifact absent for this building → no panel
    container.style.display = 'flex'; // base CSS is display:none — show explicitly (not '')
    svg.style.setProperty('--sel', (vm.global && vm.global.selection && vm.global.selection.color) || SEL_FALLBACK);
    applyColors(vm);
    applySelection(vm);
  }

  // Hover drives only the tooltip (no plan colors/selection read vm.hover) — skip HOVER to keep the
  // building-scope plan from re-coloring on every cursor move (state.md: heavy subscribers ignore HOVER).
  store.subscribe((vm, action) => { if (action && action.type === 'HOVER') return; render(vm); });
  return {};
}
