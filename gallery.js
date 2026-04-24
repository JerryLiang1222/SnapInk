/**
 * SnapFull – Gallery Page
 *
 * Features:
 *  1. Thumbnail grid with PNG/PDF download + delete per card
 *  2. Multi-select + batch delete
 *  3. Group by site (optional toggle, default off)
 *  4. Lightbox preview with zoom (wheel, +/-, drag to pan)
 */

// ── DOM refs ──────────────────────────────────────────────────────────────────
const stateLoading  = document.getElementById('stateLoading');
const stateEmpty    = document.getElementById('stateEmpty');
const gridContainer = document.getElementById('gridContainer');
const grid          = document.getElementById('grid');
const countBadge    = document.getElementById('countBadge');
const btnClearAll   = document.getElementById('btnClearAll');
const btnGroup      = document.getElementById('btnGroup');
const btnSelect     = document.getElementById('btnSelect');

const batchBar      = document.getElementById('batchBar');
const btnSelectAll  = document.getElementById('btnSelectAll');
const batchCount    = document.getElementById('batchCount');
const btnBatchDel   = document.getElementById('btnBatchDelete');
const btnExitSelect = document.getElementById('btnExitSelect');

const lightbox      = document.getElementById('lightbox');
const lbBackdrop    = document.getElementById('lightboxBackdrop');
const lightboxUrl   = document.getElementById('lightboxUrl');
const lightboxDate  = document.getElementById('lightboxDate');
const lightboxSize  = document.getElementById('lightboxSize');
const lbStage       = document.getElementById('lbStage');
const lightboxImg   = document.getElementById('lightboxImg');
const lbBtnPng      = document.getElementById('lbBtnPng');
const lbBtnPdf      = document.getElementById('lbBtnPdf');
const lbBtnClose    = document.getElementById('lbBtnClose');
const btnZoomIn     = document.getElementById('btnZoomIn');
const btnZoomOut    = document.getElementById('btnZoomOut');
const zoomLabel     = document.getElementById('zoomLabel');
const toastEl       = document.getElementById('toast');

// ── App state ─────────────────────────────────────────────────────────────────
let captures    = [];          // metadata array, sorted newest-first
let selectMode  = false;
let selectedIds = new Set();
let isGrouped   = false;
let lbActiveId  = null;
let toastTimer  = null;

// ── Zoom / pan state ──────────────────────────────────────────────────────────
let zoom    = 1;
let panX    = 0;
let panY    = 0;
let fitZoom = 1;
let imgNatW = 0;
let imgNatH = 0;
let isDragging  = false;
let dragAnchor  = { x: 0, y: 0 };

const ZOOM_MIN  = 0.05;
const ZOOM_MAX  = 8;
const ZOOM_STEP = 0.2;        // multiplicative per button press

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────
window.addEventListener('load', loadCaptures);

async function loadCaptures() {
  showState('loading');
  try {
    const res = await sendMsg({ type: 'GET_ALL_CAPTURES' });
    if (!res?.ok) throw new Error(res?.error ?? 'Unknown error');
    captures = res.captures ?? [];
    renderGrid();
  } catch (e) {
    console.error('[SnapFull Gallery]', e);
    showState('empty');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Grid rendering
// ─────────────────────────────────────────────────────────────────────────────
function renderGrid() {
  grid.innerHTML = '';
  if (captures.length === 0) { showState('empty'); return; }

  showState('grid');
  countBadge.textContent = captures.length;
  countBadge.hidden  = false;
  btnClearAll.hidden = false;
  btnGroup.hidden    = false;
  btnSelect.hidden   = false;

  if (isGrouped) renderGrouped();
  else           renderFlat();
}

function renderFlat() {
  grid.style.display = '';
  for (const cap of captures) grid.appendChild(buildCard(cap));
}

function renderGrouped() {
  grid.style.display = 'block';

  // Group by domain, preserving newest-first within each group
  const groups = new Map();
  for (const cap of captures) {
    const d = safeDomain(cap.sourceTabUrl);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(cap);
  }

  // Sort groups by their most-recent capture
  const sorted = [...groups.entries()].sort(
    ([, a], [, b]) => b[0].capturedAt - a[0].capturedAt
  );

  for (const [domain, caps] of sorted) {
    const section = document.createElement('div');
    section.className = 'group-section';
    section.dataset.domain = domain;

    const header = document.createElement('div');
    header.className = 'group-header';
    header.innerHTML = `
      <svg class="group-chevron" viewBox="0 0 24 24" fill="none">
        <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="group-favicon">${domain[0]}</span>
      <span class="group-title" title="${domain}">${domain}</span>
      <span class="group-count">${caps.length}</span>`;
    header.addEventListener('click', () => section.classList.toggle('collapsed'));

    const groupGrid = document.createElement('div');
    groupGrid.className = 'group-grid';
    for (const cap of caps) groupGrid.appendChild(buildCard(cap));

    section.append(header, groupGrid);
    grid.appendChild(section);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Card builder
// ─────────────────────────────────────────────────────────────────────────────
function buildCard(cap) {
  const domain = safeDomain(cap.sourceTabUrl);
  const card   = document.createElement('div');
  card.className    = 'card';
  card.dataset.id   = cap.id;

  card.innerHTML = `
    <div class="card-check">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M5 12l4 4 10-10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <div class="card-thumb-wrap">
      <img class="card-thumb loading" alt="${domain}" />
    </div>
    <div class="card-body">
      <div class="card-domain" title="${cap.sourceTabUrl}">${domain}</div>
      <div class="card-date">${formatDate(cap.capturedAt)}</div>
      <div class="card-dims">${cap.pageWidth} × ${cap.pageHeight} px</div>
    </div>
    <div class="card-actions">
      <button class="btn btn-secondary card-btn-png" title="Download PNG">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 3v13M7 11l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M3 20h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>PNG
      </button>
      <button class="btn btn-primary card-btn-pdf" title="Download PDF">
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
          <path d="M14 3v5h5M9 13h6M9 17h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>PDF
      </button>
      <button class="btn card-btn-del" title="Delete">
        <svg viewBox="0 0 24 24" fill="none">
          <polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>`;

  // Lazy-load thumbnail
  const img  = card.querySelector('.card-thumb');
  img.src    = cap.thumbnail;
  img.onload = () => img.classList.remove('loading');

  // Click handlers — open lightbox OR toggle selection
  const openOrSelect = () => {
    if (selectMode) toggleCardSelect(cap.id, card);
    else            openLightbox(cap.id);
  };
  card.querySelector('.card-thumb-wrap').addEventListener('click', openOrSelect);
  card.querySelector('.card-body').addEventListener('click', openOrSelect);

  card.querySelector('.card-btn-png').addEventListener('click', e => { e.stopPropagation(); doDownloadPng(cap.id, domain); });
  card.querySelector('.card-btn-pdf').addEventListener('click', e => { e.stopPropagation(); doDownloadPdf(cap.id, cap, domain); });
  card.querySelector('.card-btn-del').addEventListener('click', e => { e.stopPropagation(); doDeleteOne(cap.id, card); });

  return card;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-select
// ─────────────────────────────────────────────────────────────────────────────
function enterSelectMode() {
  selectMode = true;
  btnSelect.classList.add('active');
  batchBar.hidden = false;
  gridContainer.classList.add('has-batch');
  document.querySelectorAll('.card').forEach(c => c.classList.add('selectable'));
  updateBatchBar();
}

function exitSelectMode() {
  selectMode = false;
  selectedIds.clear();
  btnSelect.classList.remove('active');
  batchBar.hidden = true;
  gridContainer.classList.remove('has-batch');
  document.querySelectorAll('.card').forEach(c => c.classList.remove('selectable', 'selected'));
  updateBatchBar();
}

function toggleCardSelect(id, cardEl) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    cardEl.classList.remove('selected');
  } else {
    selectedIds.add(id);
    cardEl.classList.add('selected');
  }
  updateBatchBar();
}

function updateBatchBar() {
  const n = selectedIds.size;
  batchCount.textContent = n === 0 ? '0 selected' : `${n} selected`;
  btnBatchDel.disabled   = n === 0;
  btnBatchDel.innerHTML  = `<svg viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19 6l-1 14H6L5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Delete${n > 0 ? ' (' + n + ')' : ''}`;

  const allSelected = captures.length > 0 && selectedIds.size === captures.length;
  btnSelectAll.textContent = allSelected ? 'Deselect All' : 'Select All';
}

btnSelect.addEventListener('click', () => {
  selectMode ? exitSelectMode() : enterSelectMode();
});
btnExitSelect.addEventListener('click', exitSelectMode);

btnSelectAll.addEventListener('click', () => {
  const allSelected = selectedIds.size === captures.length;
  document.querySelectorAll('.card.selectable').forEach(card => {
    const id = Number(card.dataset.id);
    if (allSelected) {
      selectedIds.delete(id);
      card.classList.remove('selected');
    } else {
      selectedIds.add(id);
      card.classList.add('selected');
    }
  });
  updateBatchBar();
});

btnBatchDel.addEventListener('click', async () => {
  const ids = [...selectedIds];
  if (ids.length === 0) return;
  if (!confirm(`Delete ${ids.length} screenshot${ids.length > 1 ? 's' : ''}?`)) return;

  const res = await Promise.all(ids.map(id => sendMsg({ type: 'DELETE_CAPTURE', id })));
  const failed = res.filter(r => !r?.ok).length;

  // Remove from captures list and DOM
  ids.forEach(id => {
    captures = captures.filter(c => c.id !== id);
    const card = document.querySelector(`.card[data-id="${id}"]`);
    card?.remove();
  });
  // Remove empty group sections
  document.querySelectorAll('.group-section').forEach(s => {
    if (s.querySelectorAll('.card').length === 0) s.remove();
  });

  exitSelectMode();
  refreshToolbarState();
  if (failed) showToast(`${failed} deletion(s) failed`);
  else        showToast(`Deleted ${ids.length} screenshot${ids.length > 1 ? 's' : ''} ✓`);
  if (captures.length === 0) showState('empty');
});

// ─────────────────────────────────────────────────────────────────────────────
// Grouping
// ─────────────────────────────────────────────────────────────────────────────
btnGroup.addEventListener('click', () => {
  isGrouped = !isGrouped;
  btnGroup.classList.toggle('active', isGrouped);
  // Re-render if we have data
  if (captures.length > 0) {
    grid.innerHTML = '';
    if (isGrouped) renderGrouped();
    else           renderFlat();
    // Re-apply select mode visuals if active
    if (selectMode) document.querySelectorAll('.card').forEach(c => {
      c.classList.add('selectable');
      if (selectedIds.has(Number(c.dataset.id))) c.classList.add('selected');
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Lightbox
// ─────────────────────────────────────────────────────────────────────────────
async function openLightbox(id) {
  lbActiveId = id;
  lightbox.hidden  = false;
  lbBtnPng.disabled = true;
  lbBtnPdf.disabled = true;
  lbStage.classList.add('loading');
  lightboxImg.style.width  = '';
  lightboxImg.style.height = '';
  lightboxImg.src = '';
  zoomLabel.textContent = '…';

  const meta = captures.find(c => c.id === id);
  if (meta) {
    lightboxUrl.textContent  = meta.sourceTabUrl ?? '';
    lightboxDate.textContent = formatDate(meta.capturedAt);
    lightboxSize.textContent = `${meta.pageWidth} × ${meta.pageHeight} px`;
  }

  try {
    const res = await sendMsg({ type: 'GET_CAPTURE', id });
    if (!res?.ok || !res.capture) throw new Error(res?.error ?? 'No data');

    const cap = res.capture;
    lbStage.classList.remove('loading');

    lightboxImg.onload = () => {
      imgNatW = lightboxImg.naturalWidth;
      imgNatH = lightboxImg.naturalHeight;
      lightboxImg.style.width  = imgNatW + 'px';
      lightboxImg.style.height = imgNatH + 'px';
      fitToStage();
      lbBtnPng.disabled = false;
      lbBtnPdf.disabled = false;
    };
    lightboxImg.src = cap.dataUrl;
  } catch (e) {
    lbStage.classList.remove('loading');
    showToast('Failed to load image');
    closeLightbox();
  }
}

function closeLightbox() {
  lightbox.hidden = true;
  lightboxImg.src = '';
  lbActiveId = null;
  isDragging = false;
}

lbBtnClose.addEventListener('click', closeLightbox);
lbBackdrop.addEventListener('click', closeLightbox);

// ─────────────────────────────────────────────────────────────────────────────
// Zoom & Pan
// ─────────────────────────────────────────────────────────────────────────────
function applyTransform() {
  lightboxImg.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  zoomLabel.textContent = Math.round(zoom * 100) + '%';
  const pannable = zoom > fitZoom + 0.01;
  lbStage.classList.toggle('pannable', pannable && !isDragging);
  lbStage.classList.toggle('panning',  isDragging);
}

function fitToStage() {
  const sw = lbStage.clientWidth;
  const sh = lbStage.clientHeight;
  fitZoom = Math.min(sw / imgNatW, sh / imgNatH);
  zoom = fitZoom;
  panX = (sw - imgNatW * zoom) / 2;
  // Tall screenshots: start at top; wide: center vertically
  panY = imgNatH * zoom > sh ? 0 : (sh - imgNatH * zoom) / 2;
  applyTransform();
}

function clampPan() {
  const sw = lbStage.clientWidth;
  const sh = lbStage.clientHeight;
  const iw = imgNatW * zoom;
  const ih = imgNatH * zoom;
  const mx = 60; // minimum overlap in px
  panX = Math.min(sw - mx, Math.max(mx - iw, panX));
  panY = Math.min(sh - mx, Math.max(mx - ih, panY));
}

function zoomToPoint(newZoom, cx, cy) {
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, newZoom));
  const ratio   = clamped / zoom;
  panX = cx - ratio * (cx - panX);
  panY = cy - ratio * (cy - panY);
  zoom = clamped;
  clampPan();
  applyTransform();
}

// Zoom buttons
btnZoomIn.addEventListener('click',  () => zoomToCenter(zoom * (1 + ZOOM_STEP)));
btnZoomOut.addEventListener('click', () => zoomToCenter(zoom / (1 + ZOOM_STEP)));
function zoomToCenter(nz) {
  zoomToPoint(nz, lbStage.clientWidth / 2, lbStage.clientHeight / 2);
}

// Zoom label click: toggle fit ↔ 100%
zoomLabel.addEventListener('click', () => {
  const atFit = Math.abs(zoom - fitZoom) < 0.02;
  const at100 = Math.abs(zoom - 1)       < 0.02;
  // If at fit but not already at 100% → jump to 100%; otherwise → fit
  (atFit && !at100) ? zoomToCenter(1) : fitToStage();
});

// Mouse wheel zoom
lbStage.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = lbStage.getBoundingClientRect();
  const cx   = e.clientX - rect.left;
  const cy   = e.clientY - rect.top;
  if (e.ctrlKey || e.metaKey) {
    // Ctrl/Cmd + scroll → zoom to cursor
    const factor = e.deltaY < 0 ? (1 + ZOOM_STEP) : 1 / (1 + ZOOM_STEP);
    zoomToPoint(zoom * factor, cx, cy);
  } else {
    // Normal scroll → pan
    panX -= e.deltaX;
    panY -= e.deltaY;
    clampPan();
    applyTransform();
  }
}, { passive: false });

// Double-click: fit ↔ 2× at cursor
lbStage.addEventListener('dblclick', e => {
  if (Math.abs(zoom - fitZoom) > 0.02) {
    fitToStage();
  } else {
    const rect = lbStage.getBoundingClientRect();
    zoomToPoint(Math.min(2, ZOOM_MAX), e.clientX - rect.left, e.clientY - rect.top);
  }
});

// Drag to pan
lbStage.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  isDragging = true;
  dragAnchor = { x: e.clientX - panX, y: e.clientY - panY };
  lbStage.classList.add('panning');
  lbStage.classList.remove('pannable');
  e.preventDefault();
});

window.addEventListener('mousemove', e => {
  if (!isDragging) return;
  panX = e.clientX - dragAnchor.x;
  panY = e.clientY - dragAnchor.y;
  clampPan();
  applyTransform();
});

window.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  lbStage.classList.remove('panning');
  lbStage.classList.toggle('pannable', zoom > fitZoom + 0.01);
});

// Keyboard shortcuts (when lightbox is open)
document.addEventListener('keydown', e => {
  if (lightbox.hidden) return;
  if (e.key === 'Escape') { closeLightbox(); return; }
  if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomToCenter(zoom * (1 + ZOOM_STEP)); }
  if (e.key === '-')                  { e.preventDefault(); zoomToCenter(zoom / (1 + ZOOM_STEP)); }
  if (e.key === '0')                  { e.preventDefault(); fitToStage(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Lightbox download handlers
// ─────────────────────────────────────────────────────────────────────────────
lbBtnPng.addEventListener('click', () => {
  if (!lbActiveId) return;
  const meta = captures.find(c => c.id === lbActiveId);
  doDownloadPng(lbActiveId, safeDomain(meta?.sourceTabUrl));
});
lbBtnPdf.addEventListener('click', () => {
  if (!lbActiveId) return;
  const meta = captures.find(c => c.id === lbActiveId);
  doDownloadPdf(lbActiveId, meta, safeDomain(meta?.sourceTabUrl));
});

// ─────────────────────────────────────────────────────────────────────────────
// Download / Delete helpers
// ─────────────────────────────────────────────────────────────────────────────
async function doDownloadPng(id, domain) {
  try {
    const res = await sendMsg({ type: 'GET_CAPTURE', id });
    if (!res?.ok || !res.capture?.dataUrl) throw new Error('No data');
    const a = document.createElement('a');
    a.href = res.capture.dataUrl;
    a.download = buildFilename(domain, 'png', res.capture.capturedAt);
    a.click();
    showToast('PNG downloaded ✓');
  } catch { showToast('Download failed'); }
}

async function doDownloadPdf(id, capMeta, domain) {
  try {
    const res = await sendMsg({ type: 'GET_CAPTURE', id });
    if (!res?.ok || !res.capture?.dataUrl) throw new Error('No data');
    const cap   = res.capture;
    const { jsPDF } = window.jspdf;
    const PDF_W = 210;
    const pdfH  = (cap.pageHeight / cap.pageWidth) * PDF_W;
    const pdf   = new jsPDF({ orientation: pdfH > PDF_W ? 'portrait' : 'landscape', unit: 'mm', format: [PDF_W, pdfH] });
    pdf.addImage(cap.dataUrl, 'PNG', 0, 0, PDF_W, pdfH, '', 'FAST');
    pdf.save(buildFilename(domain, 'pdf', cap.capturedAt));
    showToast('PDF downloaded ✓');
  } catch { showToast('PDF generation failed'); }
}

async function doDeleteOne(id, cardEl) {
  if (!confirm('Delete this screenshot?')) return;
  try {
    const res = await sendMsg({ type: 'DELETE_CAPTURE', id });
    if (!res?.ok) throw new Error(res?.error);
    captures = captures.filter(c => c.id !== id);
    cardEl.remove();
    // Remove empty group section
    const section = document.querySelector(`.group-section:not(:has(.card))`);
    section?.remove();
    refreshToolbarState();
    if (lbActiveId === id) closeLightbox();
    showToast('Deleted ✓');
    if (captures.length === 0) showState('empty');
  } catch { showToast('Delete failed'); }
}

btnClearAll.addEventListener('click', async () => {
  if (!confirm(`Delete all ${captures.length} screenshots? This cannot be undone.`)) return;
  try {
    const res = await sendMsg({ type: 'CLEAR_ALL_CAPTURES' });
    if (!res?.ok) throw new Error(res?.error);
    captures = [];
    grid.innerHTML = '';
    showState('empty');
    countBadge.hidden  = true;
    btnClearAll.hidden = true;
    btnGroup.hidden    = true;
    btnSelect.hidden   = true;
    exitSelectMode();
    closeLightbox();
    showToast('All screenshots cleared');
  } catch { showToast('Clear failed'); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function refreshToolbarState() {
  countBadge.textContent = captures.length;
  if (captures.length === 0) {
    countBadge.hidden = true; btnClearAll.hidden = true;
    btnGroup.hidden = true;   btnSelect.hidden = true;
  }
}

function showState(state) {
  stateLoading.hidden  = state !== 'loading';
  stateEmpty.hidden    = state !== 'empty';
  gridContainer.hidden = state !== 'grid';
}

function safeDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') || 'unknown'; }
  catch { return 'unknown'; }
}

function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function buildFilename(domain, ext, ts) {
  const d = ts ? new Date(ts).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `snapfull-${domain}-${d}.${ext}`;
}

function sendMsg(payload) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(payload, res => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      });
    } catch (e) { reject(e); }
  });
}

let _toastTimer = null;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}
