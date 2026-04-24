/**
 * SnapFull - Popup Script
 * Handles the capture button click and progress feedback.
 */

const btnCapture   = document.getElementById('btnCapture');
const statusEl     = document.getElementById('status');
const progressFill = document.getElementById('progressFill');
const statusText   = document.getElementById('statusText');
const btnHistory   = document.getElementById('btnHistory');
const historyBadge = document.getElementById('historyBadge');

// ── Detect platform and update shortcut hint ──────────────────────────────────
chrome.runtime.getPlatformInfo(info => {
  const kbdMod = document.getElementById('kbdMod');
  if (info.os === 'mac') {
    kbdMod.textContent = '⌘ Cmd';   // manifest Ctrl → ⌘ Command on Mac
  }
  // Windows / Linux / ChromeOS all use Alt — default text is already correct
});

// ── On load: fetch and show history count ─────────────────────────────────────
chrome.runtime.sendMessage({ type: 'GET_CAPTURE_COUNT' }, res => {
  if (chrome.runtime.lastError) return;
  const count = res?.count ?? 0;
  if (count > 0) {
    historyBadge.textContent = count;
    historyBadge.hidden = false;
  }
});

// ── Open history gallery ──────────────────────────────────────────────────────
btnHistory.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('gallery.html') });
  window.close();
});

btnCapture.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Block special Chrome pages
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    showError('Cannot capture Chrome system pages.');
    return;
  }

  startCapture(tab.id);
});

async function startCapture(tabId) {
  // Update UI to "capturing" state
  btnCapture.disabled = true;
  statusEl.hidden = false;
  setProgress(10, 'Preparing page…');

  try {
    // Animate progress while waiting
    let prog = 10;
    const ticker = setInterval(() => {
      prog = Math.min(prog + 8, 85);
      setProgress(prog, prog < 40 ? 'Scrolling & capturing…' : 'Stitching image…');
    }, 400);

    const response = await chrome.runtime.sendMessage({
      type: 'START_CAPTURE',
      tabId,
    });

    clearInterval(ticker);

    if (response?.ok) {
      setProgress(100, 'Done! Opening preview…');
      setTimeout(() => window.close(), 800);
    } else {
      showError(response?.error ?? 'Capture failed.');
    }
  } catch (err) {
    showError(err.message);
  }
}

function setProgress(pct, text) {
  progressFill.style.width = pct + '%';
  statusText.textContent = text;
}

function showError(msg) {
  btnCapture.disabled = false;
  setProgress(0, '');
  statusEl.hidden = true;
  statusText.textContent = '⚠ ' + msg;
  statusEl.hidden = false;
  progressFill.style.width = '0%';
}
