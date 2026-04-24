/**
 * SnapFull - Popup Script
 * Handles capture, history, and Pro license management.
 */

const btnCapture   = document.getElementById('btnCapture');
const statusEl     = document.getElementById('status');
const progressFill = document.getElementById('progressFill');
const statusText   = document.getElementById('statusText');
const btnHistory   = document.getElementById('btnHistory');
const historyBadge = document.getElementById('historyBadge');

// ── Pro / License UI refs ─────────────────────────────────────────────────────
const psDefault    = document.getElementById('psDefault');
const psInput      = document.getElementById('psInput');
const psActivating = document.getElementById('psActivating');
const psActive     = document.getElementById('psActive');
const psError      = document.getElementById('psError');
const licenseInput = document.getElementById('licenseInput');
const proEmail     = document.getElementById('proEmail');
const btnGetPro    = document.getElementById('btnGetPro');
const btnEnterKey  = document.getElementById('btnEnterKey');
const btnKeyCancel = document.getElementById('btnKeyCancel');
const btnKeyConfirm= document.getElementById('btnKeyConfirm');
const btnRemoveKey         = document.getElementById('btnRemoveKey');
const btnRemoveCancel      = document.getElementById('btnRemoveCancel');
const btnRemoveConfirm     = document.getElementById('btnRemoveConfirm');
const psRemoveRow          = document.getElementById('psRemoveRow');
const psRemoveConfirmRow   = document.getElementById('psRemoveConfirmRow');

// ── Detect platform and update shortcut hint ──────────────────────────────────
chrome.runtime.getPlatformInfo(info => {
  const kbdMod = document.getElementById('kbdMod');
  if (info.os === 'mac') {
    kbdMod.textContent = '⌘ Cmd';   // manifest Ctrl → ⌘ Command on Mac
  }
  // Windows / Linux / ChromeOS all use Alt — default text is already correct
});

// ── On load: fetch history count + license status ─────────────────────────────
chrome.runtime.sendMessage({ type: 'GET_CAPTURE_COUNT' }, res => {
  if (chrome.runtime.lastError) return;
  const count = res?.count ?? 0;
  if (count > 0) {
    historyBadge.textContent = count;
    historyBadge.hidden = false;
  }
});

chrome.runtime.sendMessage({ type: 'GET_LICENSE_STATUS' }, res => {
  if (chrome.runtime.lastError) return;
  if (res?.isPro) {
    showProState(res.email ?? '');
  } else {
    showFreeState();
    if (res?.checkoutUrl) btnGetPro.dataset.url = res.checkoutUrl;
  }
});

// ── Pro state helpers ─────────────────────────────────────────────────────────
function showState(activeEl) {
  [psDefault, psInput, psActivating, psActive].forEach(el => {
    el.hidden = el !== activeEl;
  });
}
function showFreeState()       {
  showState(psDefault);
  document.querySelector('.divider').hidden = true;
  document.getElementById('proSection').hidden = true;
}
function showInputState()      { showState(psInput); licenseInput.value = ''; hideError(); btnKeyConfirm.disabled = true; }
function showActivatingState() { showState(psActivating); }
function showProState(email)   {
  showState(psActive);
  proEmail.textContent = email || '';
  showRemoveConfirm(false);   // always reset to initial state
  // Also show divider+section when Pro is active
  document.querySelector('.divider').hidden = false;
  document.getElementById('proSection').hidden = false;
}

function showError(msg) {
  psError.textContent = msg;
  psError.hidden = false;
}
function hideError() {
  psError.hidden = true;
  psError.textContent = '';
}

// ── Pro button handlers ───────────────────────────────────────────────────────
btnGetPro.addEventListener('click', () => {
  const url = btnGetPro.dataset.url;
  if (url && !url.includes('YOUR_PRODUCT_ID')) {
    chrome.tabs.create({ url });
    window.close();
  } else {
    // URL not configured yet — open GitHub as placeholder
    chrome.tabs.create({ url: 'https://github.com/JerryLiang1222/SnapFull' });
    window.close();
  }
});

btnEnterKey.addEventListener('click', showInputState);
btnKeyCancel.addEventListener('click', () => { showFreeState(); hideError(); });

licenseInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnKeyConfirm.click();
  if (e.key === 'Escape') btnKeyCancel.click();
});

licenseInput.addEventListener('input', () => {
  hideError();
  btnKeyConfirm.disabled = licenseInput.value.trim().length === 0;
});

btnKeyConfirm.addEventListener('click', async () => {
  const key = licenseInput.value.trim();
  if (!key) { showError('Please enter a license key.'); return; }

  showActivatingState();

  chrome.runtime.sendMessage({ type: 'ACTIVATE_LICENSE', key }, res => {
    if (chrome.runtime.lastError) {
      showInputState();
      showError('Extension error — please try again.');
      return;
    }
    if (res?.ok) {
      showProState(res.email ?? '');
    } else {
      showInputState();
      showError(res?.error ?? 'Activation failed — please check your key.');
    }
  });
});

// Two-step Remove License (no confirm() / alert())
function showRemoveConfirm(show) {
  psRemoveRow.hidden        = show;
  psRemoveConfirmRow.hidden = !show;
}

btnRemoveKey.addEventListener('click', () => showRemoveConfirm(true));
btnRemoveCancel.addEventListener('click', () => showRemoveConfirm(false));

btnRemoveConfirm.addEventListener('click', () => {
  showRemoveConfirm(false);
  chrome.runtime.sendMessage({ type: 'DEACTIVATE_LICENSE' }, res => {
    if (chrome.runtime.lastError || !res?.ok) {
      // Show an inline error without alert()
      showProState(proEmail.textContent);
      const errEl = document.createElement('p');
      errEl.className = 'ps-error';
      errEl.style.marginTop = '6px';
      errEl.textContent = 'Failed to remove license. Please try again.';
      psActive.appendChild(errEl);
      setTimeout(() => errEl.remove(), 3000);
      return;
    }
    showFreeState();
  });
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

function startCapture(tabId) {
  btnCapture.disabled = true;
  statusEl.hidden = false;
  setProgress(5, 'Preparing page…');

  // Open a long-lived port so background can push real-time progress updates
  const port = chrome.runtime.connect({ name: 'capture-progress' });
  let completed = false;

  port.onMessage.addListener(msg => {
    if (msg.type === 'PROGRESS') {
      setProgress(msg.pct, msg.text);
    } else if (msg.type === 'DONE') {
      completed = true;
      setProgress(100, 'Done! Opening preview…');
      setTimeout(() => window.close(), 800);
    } else if (msg.type === 'ERROR') {
      completed = true;
      showError(msg.error ?? 'Capture failed.');
    }
  });

  port.onDisconnect.addListener(() => {
    if (!completed) showError('Connection lost — please try again.');
  });

  // Kick off the capture
  port.postMessage({ type: 'START_CAPTURE', tabId });
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
