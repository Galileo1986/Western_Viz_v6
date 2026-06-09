// UI engine — renders a Spec (spec.js) through a SKIN (templates + css). SOP: architecture/skins.md.
//
// Viewer-owned; NOT edited by skin iterations. It: (1) instantiates each block's template against the
// block's resolved data, (2) binds declared actions to dispatch, (3) memoizes per block (anti-flicker:
// a block whose data is unchanged keeps its DOM node), (4) runs the block-completeness validator —
// every `required` block must render, else the skin is rejected and the caller falls back to default.
//
// Template grammar (ONLY): {{path}} interpolation (text + attributes, escaped) · repeat="collPath" ·
// if="path" · action="name". No expressions, no logic, no <script>. The cosmetic layer only ever sees
// resolved values, so it cannot recompute or alter a number (skins.md hard guarantee #1).

// ---- data path + interpolation ------------------------------------------------------
function getPath(obj, path) {
  if (!path) return undefined;
  let cur = obj;
  for (const k of path.split('.')) { if (cur == null) return undefined; cur = cur[k]; }
  return cur;
}
function truthy(v) { return !(v == null || v === false || v === '' || v === 0 || (Array.isArray(v) && v.length === 0)); }
function interpolate(str, scope) {
  return str.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, p) => {
    const v = getPath(scope, p);
    return v == null ? '' : String(v);
  });
}

// ---- template → DOM node ------------------------------------------------------------
// Resolves if/repeat (structure) then {{}} (text + attrs) then action= (events). `scope` is the data
// context (block at top; the item inside a repeat). `block` is always the owning block (for actions +
// the dynamic select handler).
function processNode(node, scope, block, dispatch) {
  if (node.nodeType !== 1) return;

  const ifPath = node.getAttribute('if');
  if (ifPath != null) {
    node.removeAttribute('if');
    if (!truthy(getPath(scope, ifPath))) { node.remove(); return; }
  }

  const repPath = node.getAttribute('repeat');
  if (repPath != null) {
    node.removeAttribute('repeat');
    const list = getPath(scope, repPath) || [];
    const parent = node.parentNode;
    for (const item of list) {
      const clone = node.cloneNode(true);
      processNode(clone, item, block, dispatch); // scope = the item
      parent.insertBefore(clone, node);
    }
    node.remove();
    return;
  }

  // attributes: interpolate {{}}; bind action=
  for (const attr of [...node.attributes]) {
    if (attr.name === 'action') continue;
    if (attr.value.includes('{{')) attr.value = interpolate(attr.value, scope);
  }
  const actName = node.getAttribute('action');
  if (actName != null) {
    node.removeAttribute('action');
    bindAction(node, actName, scope, block, dispatch);
  }

  // children (snapshot — repeat mutates the live list)
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) {
      if (child.nodeValue.includes('{{')) child.nodeValue = interpolate(child.nodeValue, scope);
    } else if (child.nodeType === 1) {
      processNode(child, scope, block, dispatch);
    }
  }

  // form controls: reflect a bound `value` attribute onto the .value PROPERTY (after options exist),
  // so a <select value="{{value}}"> actually selects the matching option.
  if ((node.tagName === 'SELECT' || node.tagName === 'INPUT' || node.tagName === 'TEXTAREA')
      && node.hasAttribute('value')) {
    node.value = node.getAttribute('value');
  }
}

function bindAction(node, name, scope, block, dispatch) {
  // item action (inside repeat) is `scope.action`; block actions are `block.actions[name]`
  const src = (scope.actions && scope.actions[name]) != null ? scope.actions[name]
            : (scope.action != null ? scope.action
            : (block.actions && block.actions[name]));
  if (src == null) return;
  const evt = node.tagName === 'SELECT' ? 'change' : 'click';
  node.addEventListener(evt, () => {
    const a = typeof src === 'function' ? src(node.value) : src; // dynamic (select) vs static
    if (a) dispatch(a);
  });
}

function instantiate(tplHtml, block, dispatch) {
  const t = document.createElement('template');
  t.innerHTML = (tplHtml || '').trim();
  const root = t.content.firstElementChild;
  if (!root) return null;
  const node = root.cloneNode(true);
  processNode(node, block, block, dispatch);
  node.setAttribute('data-block', block.id);
  node.setAttribute('data-block-type', block.type); // semantic group → per-block-type styling targets
  return node;
}

// stable hash of a block's DATA (drops functions so the dynamic select handler doesn't bust the memo)
function blockHash(block) {
  return JSON.stringify(block, (k, v) => (typeof v === 'function' ? undefined : v));
}

const REGIONS = ['rail', 'readings', 'hover'];

// Keyed reconcile: make host's children exactly `want` (in order) while touching the DOM as little as
// possible — nodes already in their correct slot are left in place (no detach → no reflow/flicker).
function reconcile(host, want) {
  const keep = new Set(want);
  for (const n of [...host.children]) if (!keep.has(n)) host.removeChild(n);
  let i = 0;
  for (const node of want) {
    if (host.children[i] !== node) host.insertBefore(node, host.children[i] || null);
    i++;
  }
}

/**
 * createSkinEngine({ root, store, skin })
 *   skin = { templates: { <type>: htmlString }, css?: string }
 * Returns { render(spec), setSkin(skin), validate(spec) }. render() reconciles per-block (anti-flicker)
 * and returns a validator report { ok, missing[] }. The caller decides fallback on !ok.
 */
export function createSkinEngine({ root, store, skin }) {
  let templates = (skin && skin.templates) || {};
  let styleEl = null;
  applyCss(skin && skin.css);

  // region hosts — faithful classes so the skin css (copied from today's <style>) matches verbatim
  const hosts = {
    rail: hostEl('panel rail', 'rail'),
    readings: hostEl('panel readings', 'readings'),
    hover: hostEl('hover-box', 'hover'),
  };
  // each region's "visible" display value (NOT '' — .hover-box is display:none in base CSS, and the
  // rail is flex-column; '' would fall back to those base values and break show/hide).
  const SHOW = { rail: 'flex', readings: 'block', hover: 'block' };
  root.append(hosts.rail, hosts.readings, hosts.hover);

  const cache = new Map(); // blockId → { hash, node, region }

  function hostEl(cls, region) {
    const n = document.createElement('div');
    n.className = cls; n.setAttribute('data-region', region);
    return n;
  }
  function applyCss(css) {
    if (css == null) return;
    if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'skin-css'; document.head.appendChild(styleEl); }
    styleEl.textContent = css;
  }
  function setSkin(next) { templates = (next && next.templates) || {}; applyCss(next && next.css); cache.clear(); }

  const dispatch = (a) => store.dispatch(a);

  function render(spec) {
    const blocks = spec.blocks || [];
    const seen = new Set();
    const byRegion = { rail: [], readings: [], hover: [] };

    for (const block of blocks) {
      const region = REGIONS.includes(block.region) ? block.region : 'rail';
      seen.add(block.id);
      const hash = blockHash(block);
      const cached = cache.get(block.id);
      let node;
      if (cached && cached.hash === hash && cached.region === region) {
        node = cached.node; // unchanged → reuse (preserves DOM state, no flicker)
      } else {
        const tpl = templates[block.type];
        node = tpl ? instantiate(tpl, block, dispatch) : null;
        cache.set(block.id, { hash, node, region });
      }
      if (node) byRegion[region].push(node);
    }

    // drop cache entries for blocks no longer in the spec
    for (const id of [...cache.keys()]) if (!seen.has(id)) cache.delete(id);

    // reconcile each region host to its ordered node list; hide empty regions. MINIMAL DOM churn:
    // unchanged blocks (reused nodes already in place) are left untouched — only changed/new/removed
    // nodes move. (A full replaceChildren every render thrashes the rail during the load burst.)
    for (const region of REGIONS) {
      const host = hosts[region];
      const want = byRegion[region];
      reconcile(host, want);
      host.style.display = want.length ? SHOW[region] : 'none';
    }

    return validate(spec);
  }

  // every `required` block must have produced a data-block in the DOM
  function validate(spec) {
    const required = (spec.blocks || []).filter((b) => b.required).map((b) => b.id);
    const rendered = new Set([...root.querySelectorAll('[data-block]')].map((n) => n.getAttribute('data-block')));
    const missing = required.filter((id) => !rendered.has(id));
    return { ok: missing.length === 0, missing };
  }

  return { render, setSkin, validate, hosts };
}
