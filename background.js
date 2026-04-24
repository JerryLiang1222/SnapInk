/**
 * SnapFull - Background Service Worker (Manifest V3)
 *
 * Flow:
 *  Popup / shortcut → startCapture(tabId)
 *    → inject content.js → send START_CAPTURE
 *    → content scrolls bottom-to-top, sends CAPTURE_REQUEST per strip
 *    → background: rate-limit → captureVisibleTab → draw on OffscreenCanvas → ok
 *    → content sends CAPTURE_DONE
 *    → background: canvas → dataUrl → store → open preview tab
 *    → save thumbnail + full image to IndexedDB history
 */

// ── Session state (one capture run) ──────────────────────────────────────────
let session      = null;
let captureResult = null;

// ── IndexedDB ─────────────────────────────────────────────────────────────────
const DB_NAME    = 'snapfull_history';
const DB_VERSION = 1;
const STORE      = 'captures';

function openHistoryDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess  = e => resolve(e.target.result);
    req.onerror    = e => reject(e.target.error);
  });
}

async function saveToHistory(data) {
  // Generate a small JPEG thumbnail (max 300 px wide) for the gallery grid
  const THUMB_MAX_W = 300;
  const scale = Math.min(THUMB_MAX_W / data.pageWidth, 1);
  const tw    = Math.max(1, Math.round(data.pageWidth  * scale));
  const th    = Math.max(1, Math.round(data.pageHeight * scale));

  let thumbnail = '';
  try {
    const blob   = dataUrlToBlob(data.dataUrl);
    const bitmap = await createImageBitmap(blob);
    const tc     = new OffscreenCanvas(tw, th);
    tc.getContext('2d').drawImage(bitmap, 0, 0, tw, th);
    bitmap.close();
    const tblob  = await tc.convertToBlob({ type: 'image/jpeg', quality: 0.72 });
    thumbnail    = await blobToDataUrl(tblob);
  } catch (e) {
    console.warn('[SnapFull] thumbnail generation failed:', e.message);
    thumbnail = data.dataUrl;
  }

  const record = {
    dataUrl:      data.dataUrl,
    thumbnail,
    pageWidth:    data.pageWidth,
    pageHeight:   data.pageHeight,
    sourceTabUrl: data.sourceTabUrl,
    capturedAt:   data.capturedAt,
  };

  const db  = await openHistoryDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function getAllCapturesMeta() {
  // Returns metadata only (no full dataUrl) — keeps message payload small
  const db  = await openHistoryDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const list = req.result.map(
        ({ id, thumbnail, pageWidth, pageHeight, sourceTabUrl, capturedAt }) =>
          ({ id, thumbnail, pageWidth, pageHeight, sourceTabUrl, capturedAt })
      );
      resolve(list.sort((a, b) => b.capturedAt - a.capturedAt));
    };
    req.onerror = () => reject(req.error);
  });
}

async function getOneCapture(id) {
  const db  = await openHistoryDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function deleteOneCapture(id) {
  const db  = await openHistoryDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function clearAllCaptures() {
  const db  = await openHistoryDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite');
    const req = tx.objectStore(STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function getCaptureCount() {
  const db  = await openHistoryDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── Message router ────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'START_CAPTURE':
      startCapture(msg.tabId)
        .then(()  => sendResponse({ ok: true }))
        .catch(e  => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'CAPTURE_REQUEST':
      handleCaptureRequest(msg, sendResponse)
        .catch(e => {
          console.error('[SnapFull] handleCaptureRequest threw:', e);
          try { sendResponse({ ok: false, error: e.message }); } catch (_) {}
        });
      return true;

    case 'CAPTURE_DONE':
      finishCapture().catch(console.error);
      sendResponse({ ok: true });
      return false;

    case 'CAPTURE_ERROR':
      console.error('[SnapFull] Content error:', msg.error);
      session = null;
      sendResponse({ ok: true });
      return false;

    case 'GET_CAPTURE_RESULT':
      sendResponse(captureResult ?? null);
      return false;

    // ── History API ───────────────────────────────────────────────────────────
    case 'GET_ALL_CAPTURES':
      getAllCapturesMeta()
        .then(captures => sendResponse({ ok: true, captures }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'GET_CAPTURE':
      getOneCapture(msg.id)
        .then(capture => sendResponse({ ok: true, capture }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'DELETE_CAPTURE':
      deleteOneCapture(msg.id)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'CLEAR_ALL_CAPTURES':
      clearAllCaptures()
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'GET_CAPTURE_COUNT':
      getCaptureCount()
        .then(count => sendResponse({ ok: true, count }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
  }
});

// ── Keyboard shortcut ─────────────────────────────────────────────────────────
chrome.commands.onCommand.addListener(async command => {
  if (command !== 'capture-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) startCapture(tab.id).catch(console.error);
});

// ── startCapture ──────────────────────────────────────────────────────────────
async function startCapture(tabId) {
  if (!tabId) throw new Error('No active tab');

  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? '';
  if (/^(chrome(-extension)?|about|data):/.test(url)) {
    throw new Error('Cannot capture this page type');
  }

  session = {
    canvas:          null,
    ctx:             null,
    lastCaptureTime: 0,
    sourceTabUrl:    url,
    windowId:        tab.windowId,
    outerFrameDrawn: false,
  };
  captureResult = null;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (e) {
    console.warn('[SnapFull] executeScript:', e.message);
  }

  await sendToContent(tabId, { type: 'START_CAPTURE' });
}

// ── handleCaptureRequest: one viewport strip ──────────────────────────────────
async function handleCaptureRequest(data, sendResponse) {
  const { x, y, windowWidth, totalWidth, totalHeight } = data;

  if (!session) {
    sendResponse({ ok: false, error: 'No active capture session' });
    return;
  }

  const INTERVAL = 600;
  const elapsed  = Date.now() - session.lastCaptureTime;
  if (elapsed < INTERVAL) await sleep(INTERVAL - elapsed);

  let dataUrl;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(
        session.windowId,
        { format: 'png' }
      );
      session.lastCaptureTime = Date.now();
      break;
    } catch (err) {
      if (attempt === 2) {
        sendResponse({ ok: false, error: `captureVisibleTab: ${err.message}` });
        return;
      }
      await sleep(INTERVAL * (attempt + 2));
    }
  }

  const blob   = dataUrlToBlob(dataUrl);
  const bitmap = await createImageBitmap(blob);

  // ── Fixed overlay: draw once at canvas origin, then exit ─────────────────
  //
  //  content.js sends this after restoring position:fixed/sticky elements and
  //  scrolling to y=0.  Drawing it on top of all strips correctly paints nav
  //  bars, sticky sidebars etc. at the top of the final image (and only there).
  //
  if (data.isFixedOverlay) {
    if (session?.canvas) session.ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    sendResponse({ ok: true });
    return;
  }

  const scale   = bitmap.width / windowWidth;
  const drawX   = Math.round(x          * scale);
  const drawY   = Math.round(y          * scale);
  const scaledW = Math.round(totalWidth  * scale);
  const scaledH = Math.round(totalHeight * scale);

  if (!session.canvas) {
    session.canvas = new OffscreenCanvas(scaledW, scaledH);
    session.ctx    = session.canvas.getContext('2d');
    session.ctx.fillStyle = '#ffffff';
    session.ctx.fillRect(0, 0, scaledW, scaledH);
  }

  const cb = data.containerBounds;

  if (cb) {
    const cl = Math.round(cb.left   * scale);
    const ct = Math.round(cb.top    * scale);
    const cw = Math.round(cb.width  * scale);
    const ch = Math.round(cb.height * scale);

    if (cw > 0 && ch > 0) {
      session.ctx.drawImage(
        bitmap,
        cl, ct, cw, ch,
        cl, ct + drawY, cw, ch
      );
    }

    if (y === 0 && !session.outerFrameDrawn) {
      session.ctx.drawImage(bitmap, 0, 0);
      session.outerFrameDrawn = true;
    }
  } else {
    session.ctx.drawImage(bitmap, drawX, drawY);
  }

  bitmap.close();
  sendResponse({ ok: true });
}

// ── finishCapture: stitch → store → open preview → save to history ────────────
async function finishCapture() {
  if (!session?.canvas) {
    console.warn('[SnapFull] finishCapture called with no canvas');
    return;
  }

  try {
    const blob    = await session.canvas.convertToBlob({ type: 'image/png' });
    const dataUrl = await blobToDataUrl(blob);

    captureResult = {
      dataUrl,
      pageWidth:    session.canvas.width,
      pageHeight:   session.canvas.height,
      sourceTabUrl: session.sourceTabUrl,
      capturedAt:   Date.now(),
    };

    // Open preview tab immediately
    chrome.tabs.create({ url: chrome.runtime.getURL('preview.html') });

    // Persist to history asynchronously — don't let DB errors block preview
    saveToHistory(captureResult).catch(e =>
      console.warn('[SnapFull] saveToHistory failed:', e.message)
    );

  } catch (err) {
    console.error('[SnapFull] finishCapture error:', err);
  } finally {
    session = null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sendToContent(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime   = header.match(/:(.*?);/)[1];
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// FileReader unavailable in MV3 service workers — use ArrayBuffer + btoa
async function blobToDataUrl(blob) {
  const buf       = await blob.arrayBuffer();
  const bytes     = new Uint8Array(buf);
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
