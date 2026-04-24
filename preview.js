/**
 * SnapFull - Preview Page Script
 * Loads the captured image, shows it, and handles PNG / PDF download.
 *
 * Zoom model: two levels only — "fit to window" and "original size (100%)".
 * Clicking the zoom pill, double-clicking the image, or pressing Space/0
 * toggles between the two levels.  Pan (scroll / drag) works at any zoom.
 */

const previewImg    = document.getElementById('previewImg');
const previewArea   = document.getElementById('previewArea');
const loadingEl     = document.getElementById('loading');
const errorStateEl  = document.getElementById('errorState');
const pageUrlEl     = document.getElementById('pageUrl');
const imgSizeEl     = document.getElementById('imgSize');
const btnPng        = document.getElementById('btnDownloadPng');
const btnPdf        = document.getElementById('btnDownloadPdf');
const btnCopy       = document.getElementById('btnCopyClip');
const btnGallery    = document.getElementById('btnOpenGallery');
const toastEl       = document.getElementById('toast');
const zoomLabel     = document.getElementById('zoomLabel');

let captureData = null;

// ─── Zoom / Pan state ─────────────────────────────────────────────────────────
let zoom    = 1;
let panX    = 0;
let panY    = 0;
let fitZoom = 1;
let imgNatW = 0;
let imgNatH = 0;
let isDragging  = false;
let dragAnchor  = { x: 0, y: 0 };

// ─── Transform helpers ────────────────────────────────────────────────────────
function applyTransform() {
  previewImg.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;

  const pct = Math.round(zoom * 100);
  const atFit = Math.abs(zoom - fitZoom) < 0.02;
  zoomLabel.textContent  = atFit ? 'fit' : pct + '%';
  zoomLabel.dataset.state = atFit ? 'fit' : '100';
  zoomLabel.title = atFit
    ? 'Click / double-click: show original size'
    : 'Click / double-click: fit to window';

  const pannable = zoom > fitZoom + 0.01;
  previewArea.classList.toggle('pannable', pannable && !isDragging);
  previewArea.classList.toggle('panning',  isDragging);
}

function clampPan() {
  const aw = previewArea.clientWidth,  ah = previewArea.clientHeight;
  const iw = imgNatW * zoom,           ih = imgNatH * zoom;
  const m  = 60;
  panX = Math.min(aw - m, Math.max(m - iw, panX));
  panY = Math.min(ah - m, Math.max(m - ih, panY));
}

// Fit image to preview area (default view)
function fitToArea() {
  const aw = previewArea.clientWidth, ah = previewArea.clientHeight;
  fitZoom = Math.min(aw / imgNatW, ah / imgNatH);
  zoom    = fitZoom;
  panX    = (aw - imgNatW * zoom) / 2;
  panY    = imgNatH * zoom > ah ? 0 : (ah - imgNatH * zoom) / 2;
  applyTransform();
}

// Show image at 100% (original pixels), centered / top-anchored
function zoomToOriginal() {
  const aw = previewArea.clientWidth, ah = previewArea.clientHeight;
  zoom = 1;
  panX = (aw - imgNatW) / 2;
  panY = imgNatH > ah ? 0 : (ah - imgNatH) / 2;
  clampPan();
  applyTransform();
}

// Toggle between the two zoom levels
function toggleZoom() {
  Math.abs(zoom - fitZoom) < 0.02 ? zoomToOriginal() : fitToArea();
}

// ─── Zoom pill ────────────────────────────────────────────────────────────────
zoomLabel.addEventListener('click', toggleZoom);

// ─── Scroll → pan only (no scroll-zoom) ──────────────────────────────────────
previewArea.addEventListener('wheel', e => {
  e.preventDefault();
  panX -= e.deltaX;
  panY -= e.deltaY;
  clampPan();
  applyTransform();
}, { passive: false });

// ─── Double-click → toggle zoom ───────────────────────────────────────────────
previewArea.addEventListener('dblclick', toggleZoom);

// ─── Drag to pan ─────────────────────────────────────────────────────────────
previewArea.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  isDragging = true;
  dragAnchor = { x: e.clientX - panX, y: e.clientY - panY };
  previewArea.classList.add('panning');
  previewArea.classList.remove('pannable');
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
  previewArea.classList.remove('panning');
  previewArea.classList.toggle('pannable', zoom > fitZoom + 0.01);
});

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (!captureData) return;
  // Space or 0 → toggle zoom
  if (e.key === ' ' || e.key === '0') { e.preventDefault(); toggleZoom(); }
});

// ─── Gallery shortcut ─────────────────────────────────────────────────────────
btnGallery.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  try {
    captureData = await chrome.runtime.sendMessage({ type: 'GET_CAPTURE_RESULT' });

    if (!captureData?.dataUrl) {
      showError();
      return;
    }

    previewImg.src = captureData.dataUrl;
    previewImg.onload = () => {
      loadingEl.hidden = true;
      previewArea.hidden = false;

      pageUrlEl.textContent = captureData.sourceTabUrl ?? '';
      pageUrlEl.title       = captureData.sourceTabUrl ?? '';

      imgNatW = previewImg.naturalWidth;
      imgNatH = previewImg.naturalHeight;
      imgSizeEl.textContent = `${imgNatW} × ${imgNatH} px`;

      previewImg.style.width  = imgNatW + 'px';
      previewImg.style.height = imgNatH + 'px';
      fitToArea();

      btnPng.disabled  = false;
      btnPdf.disabled  = false;
      btnCopy.disabled = false;
    };

    previewImg.onerror = () => showError();
  } catch (err) {
    console.error('[SnapFull] Failed to load capture:', err);
    showError();
  }
});

// ─── Download PNG ─────────────────────────────────────────────────────────────
btnPng.addEventListener('click', () => {
  if (!captureData?.dataUrl) return;
  const link = document.createElement('a');
  link.href     = captureData.dataUrl;
  link.download = buildFilename('png');
  link.click();
  showToast('PNG downloaded ✓');
});

// ─── Download PDF ─────────────────────────────────────────────────────────────
btnPdf.addEventListener('click', async () => {
  if (!captureData?.dataUrl) return;

  btnPdf.disabled = true;
  btnPdf.textContent = 'Generating…';

  try {
    const { jsPDF } = window.jspdf;
    const imgW = previewImg.naturalWidth;
    const imgH = previewImg.naturalHeight;
    const PDF_WIDTH = 210;
    const pdfHeight = (imgH / imgW) * PDF_WIDTH;

    const pdf = new jsPDF({
      orientation: pdfHeight > PDF_WIDTH ? 'portrait' : 'landscape',
      unit: 'mm',
      format: [PDF_WIDTH, pdfHeight],
    });

    pdf.addImage(captureData.dataUrl, 'PNG', 0, 0, PDF_WIDTH, pdfHeight, '', 'FAST');
    pdf.save(buildFilename('pdf'));
    showToast('PDF downloaded ✓');
  } catch (err) {
    console.error('[SnapFull] PDF generation failed:', err);
    showToast('PDF generation failed — please try again');
  } finally {
    btnPdf.disabled = false;
    btnPdf.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M14 3v5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M9 13h6M9 17h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
      PDF`;
  }
});

// ─── Copy to Clipboard ────────────────────────────────────────────────────────
btnCopy.addEventListener('click', async () => {
  if (!captureData?.dataUrl) return;

  try {
    const blob = dataUrlToBlob(captureData.dataUrl);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    showToast('Copied to clipboard ✓');
  } catch (err) {
    console.error('[SnapFull] Clipboard copy failed:', err);
    showToast('Copy failed — browser may not support this');
  }
});

// ─── Drag-to-Desktop ─────────────────────────────────────────────────────────
previewImg.addEventListener('dragstart', e => {
  e.dataTransfer.setData('text/uri-list', captureData?.dataUrl ?? '');
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function showError() {
  loadingEl.hidden = true;
  errorStateEl.hidden = false;
}

function buildFilename(ext) {
  const url = captureData?.sourceTabUrl ?? '';
  let name = 'screenshot';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host) name = host;
  } catch (_) {}
  const date = new Date().toISOString().slice(0, 10);
  return `snapfull-${name}-${date}.${ext}`;
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime   = header.match(/:(.*?);/)[1];
  const binary = atob(data);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
}
