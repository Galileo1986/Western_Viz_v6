// Screenshot — compose an A4-portrait "report card" of the current view and let the user save it.
//
// NOT a flat page grab. The lime "Screenshot" button (index.html #shot-btn) builds a printable card:
//   ┌─────────────────────────────────────────────┐
//   │  WesternU · Campus Spatial Inventory   [logo]│   header (project title left, artifact logo right)
//   │  CAMPUS · CATEGORICAL                         │   eyebrow = mode · layer family
//   │  College                                      │   title   = active-layer name
//   │  ┌─────────────────────────────────────────┐ │
//   │  │        3D viewport (cropped raster)      │ │   the live viewport (3D + its floating overlays)
//   │  └─────────────────────────────────────────┘ │
//   │  [ legend ] [ prose ] [ figure ] [ insight ]  │   the left-rail sections, reflowed HORIZONTALLY
//   └─────────────────────────────────────────────┘
//
// Pipeline: (1) html2canvas the live #ui → crop to the #stage rect for a clean viewport image (the WebGL
// canvas captures because the renderer uses preserveDrawingBuffer:true — rendering/scene.js). (2) Build the
// card off-screen, CLONING the rail's .sec nodes so they re-render crisply with the page CSS. (3) html2canvas
// the card → native save dialog. Domain: UI-only (DOM + a CDN rasterizer + read-only store.getState());
// no Rendering/State mutation.
import html2canvas from 'html2canvas';

const STAGE_BG = '#0a0a0c'; // page/scene background — fills any transparent gaps in the capture
const CARD_BG = '#0a0a0c';  // A4 card background (dark — the rail text is light-on-dark, reused as-is)
const A4_W = 794;           // A4 portrait width  @96dpi (px)
const A4_H = 1123;          // A4 portrait height @96dpi (px) — min height so short content still fills a page
const SCALE = 2;            // render at 2× for a crisp print-grade PNG

function stamp() {
  // YYYYMMDD-HHMMSS for a sortable default filename (browser Date is fine here — UI code, not a tool).
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

async function saveBlob(blob, filename) {
  // Preferred: native save dialog — the user chooses where to put the file (Chromium/Edge on win32).
  if (typeof window.showSaveFilePicker === 'function') {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }],
      });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // user cancelled the dialog — not an error
      // any other failure (e.g. permissions) → fall through to the download fallback
    }
  }
  // Fallback: trigger a browser download (Firefox/Safari, or if the picker is unavailable).
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a);
  a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function awaitImage(img) {
  return new Promise((res) => {
    if (img.complete && img.naturalWidth) return res();
    img.onload = img.onerror = () => res();
  });
}

// (1) Capture the live UI and crop out just the 3D viewport area (canvas + its floating overlays:
// selection/plan cards, vp-tags — they sit over #stage but are DOM siblings, so a crop is cleanest).
async function captureViewport() {
  const ui = document.getElementById('ui');
  const stage = document.getElementById('stage');
  if (!ui || !stage) return null;
  const full = await html2canvas(ui, {
    backgroundColor: STAGE_BG,
    scale: SCALE,
    useCORS: true,
    logging: false,
    ignoreElements: (el) => el.id === 'splash' || el.id === 'shot-btn',
    // html2canvas ignores <details> open/closed state → it'd paint the building dropdown menu expanded.
    onclone: (doc) => {
      doc.querySelectorAll('details:not([open]) .bsel-menu')
        .forEach((el) => { el.style.display = 'none'; });
      // hide the floating readings cards over the 3D — that info is re-laid into the card body below,
      // so a clean viewport (just the model + its corner tags) avoids duplicating the room readings.
      doc.querySelectorAll('[data-region="readings"]').forEach((el) => { el.style.display = 'none'; });
    },
  });
  const uiR = ui.getBoundingClientRect();
  const stR = stage.getBoundingClientRect();
  const sx = (stR.left - uiR.left) * SCALE, sy = (stR.top - uiR.top) * SCALE;
  const sw = Math.round(stR.width * SCALE), sh = Math.round(stR.height * SCALE);
  const vp = document.createElement('canvas');
  vp.width = sw; vp.height = sh;
  const ctx = vp.getContext('2d');
  ctx.fillStyle = STAGE_BG; ctx.fillRect(0, 0, sw, sh);
  ctx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
  return vp.toDataURL('image/png');
}

// Derive the card title parts from the view-model + the live building-selector label.
function titleParts(vm) {
  const mode = vm && vm.scope && vm.scope.mode;
  const L = vm && vm.activeLayer;
  const family = (L && L.family) || '';
  const layerName = (L && (L.label || L.display_name)) || '—';
  let modeStr = 'Campus';
  if (mode === 'building') {
    const sumEl = document.querySelector('#building-select .bsel-summary');
    const label = (sumEl && sumEl.textContent.trim()) || (vm.scope.buildingCode || '');
    modeStr = label ? `Building · ${label}` : 'Building';
  }
  const eyebrow = [modeStr, family].filter(Boolean).join('  ·  ');
  return { eyebrow, title: layerName, modeStr, family, layerName };
}

// (2) Build the off-screen A4 card. Returns the root element (caller removes it after capture).
function buildCard(vm, viewportUrl) {
  const { eyebrow, title } = titleParts(vm);

  const card = document.createElement('div');
  card.id = 'shot-card';
  Object.assign(card.style, {
    position: 'fixed', top: '0', left: '-100000px', // off-screen; html2canvas renders by element bounds
    width: A4_W + 'px', minHeight: A4_H + 'px', padding: '34px',
    background: CARD_BG, color: 'var(--ink)', boxSizing: 'border-box',
    fontFamily: 'var(--sans)', display: 'flex', flexDirection: 'column', gap: '18px',
  });

  // header: project title (clone the live brand for exactness) left · artifact logo right
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: '16px', borderBottom: '1px solid var(--line)',
  });
  const brandSrc = document.querySelector('#top .brand');
  if (brandSrc) {
    const brand = brandSrc.cloneNode(true);
    brand.style.alignItems = 'baseline';
    header.appendChild(brand);
  } else {
    const b = document.createElement('div');
    b.innerHTML = '<b style="font:500 15px/1 var(--sans)">WesternU</b>';
    header.appendChild(b);
  }
  const logo = document.createElement('img');
  logo.src = './logo.png'; logo.alt = 'ARTIFACT';
  Object.assign(logo.style, { height: '30px', width: 'auto', filter: 'invert(1)', opacity: '0.9', display: 'block' });
  header.appendChild(logo);
  card.appendChild(header);

  // title block: lime eyebrow (mode · family) + large layer name + one-line layer description (subtle box)
  const railSrc = document.querySelector('[data-region="rail"]');
  const proseText = perLayerProse(railSrc);
  const tb = document.createElement('div');
  tb.innerHTML =
    `<div style="font:700 11px/1 var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--hi);margin-bottom:9px">${eyebrow}</div>`
    + `<div style="font:200 32px/1.05 var(--sans);letter-spacing:-.01em;color:var(--ink)">${title}</div>`
    + (proseText
      ? `<div style="display:inline-block;margin-top:12px;padding:8px 13px;border-radius:7px;`
        + `background:rgba(255,255,255,.035);font:12.5px/1.5 var(--sans);color:var(--muted)">${proseText}</div>`
      : '');
  card.appendChild(tb);

  // viewport image (the cropped 3D raster)
  if (viewportUrl) {
    const vwrap = document.createElement('div');
    Object.assign(vwrap.style, { border: '1px solid var(--line)', borderRadius: '10px', overflow: 'hidden', background: STAGE_BG });
    const vimg = document.createElement('img');
    vimg.src = viewportUrl;
    // cap the height (the viewport is the biggest height consumer) so the card always fits A4 portrait;
    // contain letterboxes a tall capture into the stage-colored wrapper rather than overflowing the page.
    Object.assign(vimg.style, { width: '100%', height: 'auto', maxHeight: '430px', objectFit: 'contain', display: 'block' });
    vwrap.appendChild(vimg);
    card.appendChild(vwrap);
  }

  // data row: LEGEND (left) beside the INFOGRAPHIC figure (right) — the two cloned rail sections.
  if (railSrc) {
    const legendSec = railSrc.querySelector('#legend');
    const figSec = railSrc.querySelector('#infographics');
    if (legendSec || figSec) {
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'flex-start', gap: '26px', marginTop: '4px' });
      if (legendSec) {
        const l = cloneSlot(legendSec, { flex: '0 0 38%', maxWidth: '38%' });
        // compact: swatches in 2 columns instead of one tall list
        l.querySelectorAll('.swatches').forEach((sw) => {
          Object.assign(sw.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 16px' });
        });
        row.appendChild(l);
      }
      if (figSec) {
        const f = cloneSlot(figSec, { flex: '1 1 auto', minWidth: '0' });
        row.appendChild(f);
      }
      card.appendChild(row);
    }

    // building scope + a room selected → the room readings, laid into the card body between the figure
    // and the key takeaway, with the readings table split into TWO columns (user 2026-06-08).
    if (vm && vm.scope && vm.scope.mode === 'building') {
      const readings = document.querySelector('[data-region="readings"]');
      const roomCard = readings && Array.from(readings.querySelectorAll('[data-block]'))
        .find((b) => b.querySelector('.sel-badge') && b.querySelector('.sel-table'));
      if (roomCard) {
        const rsec = roomCard.cloneNode(true);
        rsec.removeAttribute('data-block');
        rsec.querySelectorAll('.sel-x').forEach((x) => x.remove()); // drop the close button
        Object.assign(rsec.style, {
          background: 'transparent', border: '0', borderTop: '1px solid var(--line)',
          borderRadius: '0', boxShadow: 'none', backdropFilter: 'none',
          marginTop: '2px', paddingTop: '12px',
        });
        // COMPACT the room card so it doesn't push the card past A4 height: tighten the header, shrink
        // the room title, and split the readings into two columns with tight per-row padding.
        rsec.querySelectorAll('.sel-kick').forEach((k) => { k.style.cssText += ';margin-bottom:3px'; });
        rsec.querySelectorAll('.sel-code').forEach((c) => {
          Object.assign(c.style, { font: '300 17px/1 var(--sans)', margin: '0 0 5px' });
        });
        rsec.querySelectorAll('.sel-badge').forEach((b) => {
          Object.assign(b.style, { margin: '0 0 6px', padding: '4px 9px' });
        });
        rsec.querySelectorAll('.sel-sectitle').forEach((s) => { Object.assign(s.style, { margin: '2px 0 2px' }); });
        rsec.querySelectorAll('.sel-table').forEach((t) => {
          Object.assign(t.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '30px' });
        });
        rsec.querySelectorAll('.sel-row').forEach((r) => { Object.assign(r.style, { padding: '5px 0' }); });
        card.appendChild(rsec);
      }
    }

    // KEY TAKEAWAY — the insight section, centered at the bottom.
    const insightEl = railSrc.querySelector('.insight-eyebrow');
    const insightSec = insightEl ? insightEl.closest('.sec') : null;
    if (insightSec) {
      const k = cloneSlot(insightSec, {
        marginTop: 'auto', paddingTop: '18px', borderTop: '1px solid var(--line)', textAlign: 'center',
      });
      card.appendChild(k);
    }
  }

  document.body.appendChild(card);
  return card;
}

// Clone a rail .sec for the card: strip its rail padding/borders, apply slot overrides.
function cloneSlot(secSrc, overrides) {
  const sec = secSrc.cloneNode(true);
  Object.assign(sec.style, { padding: '0', border: '0', ...overrides });
  return sec;
}

// The per-layer one-line description = the prose-titled section's body (NOT the campus overview #overview).
function perLayerProse(railSrc) {
  if (!railSrc) return '';
  const head = railSrc.querySelector('.blurb-head');
  if (head) {
    const p = head.closest('.sec').querySelector('.prose');
    if (p && p.textContent.trim()) return p.textContent.trim();
  }
  const proseEls = Array.from(railSrc.querySelectorAll('.prose'));
  const notOverview = proseEls.find((p) => !p.closest('#overview') && p.textContent.trim());
  return notOverview ? notOverview.textContent.trim() : '';
}

export function initScreenshot({ store } = {}) {
  const btn = document.getElementById('shot-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    // Icon-only button — just disable it (the [disabled] style shows a progress cursor + dim);
    // don't touch its content, or we'd wipe the camera SVG.
    btn.disabled = true;
    let card = null;
    try {
      const vm = store ? store.getState() : null;
      const viewportUrl = await captureViewport();
      card = buildCard(vm, viewportUrl);
      // wait for the logo + viewport <img> to decode before rasterizing the card
      await Promise.all(Array.from(card.querySelectorAll('img')).map(awaitImage));

      const canvas = await html2canvas(card, {
        backgroundColor: CARD_BG,
        scale: SCALE,
        useCORS: true,
        logging: false,
      });
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (blob) {
        const { modeStr, layerName } = titleParts(vm);
        const name = `westernu-${slug(modeStr) || 'view'}-${slug(layerName)}-${stamp()}.png`;
        await saveBlob(blob, name);
      }
    } catch (err) {
      console.error('[screenshot] capture failed', err);
    } finally {
      if (card) card.remove();
      btn.disabled = false;
    }
  });
}
