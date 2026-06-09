// Persistence domain — URL deep-linking. SOP: architecture/persistence.md.
// Imports State actions (1 domain) only. Owns no business logic. Same URL -> same render.

import { hydrate } from '../state/actions.js';

// raw scope/selection/layer -> query string (pure)
export function serialize(raw) {
  const p = new URLSearchParams();
  if (raw.scope.buildingCode) p.set('b', raw.scope.buildingCode);
  if (raw.selectionKey) p.set('sel', raw.selectionKey);
  if (raw.activeLayerId) p.set('layer', raw.activeLayerId);
  if (raw.viewTransform) {
    const v = raw.viewTransform;
    p.set('cam', [...v.target, ...v.position].map((n) => Number(n).toFixed(2)).join(','));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// query string -> partial raw state (pure). Unknown/malformed fields are dropped, not fatal.
export function parse(queryString) {
  const p = new URLSearchParams(queryString || '');
  const out = {};
  if (p.get('b')) out.buildingCode = p.get('b');
  if (p.get('sel')) out.selectionKey = p.get('sel');
  if (p.get('layer')) out.activeLayerId = p.get('layer');
  const cam = p.get('cam');
  if (cam) {
    const n = cam.split(',').map(Number);
    if (n.length === 6 && n.every((x) => !Number.isNaN(x))) {
      out.viewTransform = { target: n.slice(0, 3), position: n.slice(3) };
    }
  }
  return out;
}

// Wire persistence to the store: hydrate from URL, then replaceState on change (debounced).
export function initPersistence({ store }) {
  let timer = null;
  store.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const qs = serialize(store.getRaw());
      history.replaceState(null, '', qs || location.pathname);
    }, 150);
  });
}

export function hydrateFromURL(store) {
  store.dispatch(hydrate(parse(location.search)));
}
