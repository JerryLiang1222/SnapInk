/**
 * SnapFull - Content Script
 *
 * Scroll strategy (three tiers, tried in order):
 *
 *  1. WINDOW scroll  — standard pages; probe window.scrollY after scrollTo(0,999999)
 *  2. ELEMENT scroll — SPAs where the scrollable surface is a child element
 *                      (overflow-y: auto/scroll covering ≥80% of viewport)
 *  3. SINGLE frame   — truly fixed-height pages; just capture what's visible
 *
 * In all cases captureVisibleTab captures the full browser viewport,
 * so the scroll method doesn't matter for the background/stitching logic.
 */

(function () {
  if (window.__snapFullInjected) return;
  window.__snapFullInjected = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'START_CAPTURE') {
      runCapture().catch(err => {
        console.error('[SnapFull]', err);
        chrome.runtime.sendMessage({ type: 'CAPTURE_ERROR', error: err.message });
      });
      sendResponse({ ok: true });
    }
    return false;
  });

  // ─────────────────────────────────────────────────────────────────────────
  async function runCapture() {
    const body     = document.body;
    const scrollEl = document.scrollingElement || document.documentElement;

    /* ── 1. Save state ─────────────────────────────────────────────────── */
    const origBodyOverflow = body ? body.style.overflow    : '';
    const origBodyOverflowY = body ? body.style.overflowY : '';
    const origHtmlOverflow = document.documentElement.style.overflow;
    const origScrollX      = window.scrollX;
    const origScrollY      = window.scrollY;

    /* ── 2. Unlock body scrolling before measuring ──────────────────────── */
    if (body) {
      body.style.overflow  = 'visible';
      body.style.overflowY = 'visible';
    }

    const windowWidth  = window.innerWidth;
    const windowHeight = window.innerHeight;

    /* ── 3. Detect scroll mode ──────────────────────────────────────────── */
    //
    //  First probe window scroll.  If the page doesn't scroll via window
    //  (typical for SPAs with overflow:hidden on html/body), fall back to
    //  finding the largest scrollable child element.
    //

    // --- Tier 1: window scroll probe ---
    window.scrollTo(0, 999_999);
    await sleep(120);
    const windowMaxScrollY = window.scrollY;
    window.scrollTo(0, 0);
    await sleep(50);

    let scrollMode   = 'window';   // 'window' | 'element' | 'single'
    let scrollTarget = null;        // the element (tier 2 only)
    let fullHeight;
    let fullWidth;

    if (windowMaxScrollY > 10) {
      // Tier 1: normal page — window scrolls
      scrollMode = 'window';
      fullHeight = windowMaxScrollY + windowHeight;

      const domWidths = [
        scrollEl.scrollWidth, scrollEl.offsetWidth, scrollEl.clientWidth,
        body ? body.scrollWidth : 0, body ? body.offsetWidth : 0, windowWidth,
      ];
      fullWidth = Math.max(...domWidths.filter(Boolean));

    } else {
      // Tier 2: look for a scrollable child container
      scrollTarget = findScrollContainer(windowWidth, windowHeight);

      if (scrollTarget) {
        scrollMode = 'element';

        // Probe the container's true scroll range
        scrollTarget.scrollTo({ top: 999_999, behavior: 'instant' });
        await sleep(120);
        const elMaxScrollY = scrollTarget.scrollTop;
        scrollTarget.scrollTo({ top: 0, behavior: 'instant' });
        await sleep(50);

        if (elMaxScrollY > 10) {
          // full canvas height = max scroll + full viewport height
          // (because we draw the entire viewport image at each scroll position)
          fullHeight = elMaxScrollY + windowHeight;
          fullWidth  = windowWidth;
        } else {
          scrollMode = 'single';
          fullHeight = windowHeight;
          fullWidth  = windowWidth;
        }
      } else {
        // Tier 3: no scrollable surface found — single capture
        scrollMode = 'single';
        fullHeight = windowHeight;
        fullWidth  = windowWidth;
      }
    }

    // Width guard:
    //  - Window-scroll pages: always use windowWidth.  body.scrollWidth can be
    //    larger than the viewport due to position:absolute overflows, negative
    //    margins etc., which would make the canvas incorrectly wide.
    //  - Element-scroll (SPA) pages: use windowWidth too; the scroll container
    //    itself is inside the viewport.
    fullWidth = windowWidth;

    /* ── 3.5. Hide fixed/sticky elements (window-scroll mode only) ─────── */
    //
    //  position:fixed and position:sticky elements (nav bars, sticky sidebars)
    //  appear at the same visual position in every captured viewport strip, so
    //  they repeat at every strip boundary in the stitched image.
    //
    //  Fix: walk the full DOM *including Shadow Roots* (Reddit, YouTube etc.
    //  use custom elements / Shadow DOM), hide everything fixed/sticky with
    //  visibility:hidden (preserves layout), capture the strips, then restore
    //  and take one overlay capture that paints them back at the page top.
    //
    const fixedEls = [];
    let   fixedHideStyle = null;   // injected <style> for robust hiding

    if (scrollMode === 'window') {
      //
      //  Walk the full DOM (including open Shadow Roots) and tag every
      //  fixed/sticky element with a data attribute.  A single CSS rule then
      //  hides each tagged element AND ALL ITS DESCENDANTS with !important,
      //  so child elements with explicit visibility:visible cannot override.
      //  (Setting element.style.visibility = 'hidden' directly can be overridden
      //   by a child with visibility:visible; CSS !important cannot.)
      //
      (function walkDOM(root) {
        for (const el of root.querySelectorAll('*')) {
          const s = window.getComputedStyle(el);
          if (
            (s.position === 'fixed' || s.position === 'sticky') &&
            s.display    !== 'none'   &&
            s.visibility !== 'hidden' &&
            (el.offsetWidth || el.offsetHeight)
          ) {
            fixedEls.push(el);
            el.dataset.snapfullHide = '1';
          }
          if (el.shadowRoot) walkDOM(el.shadowRoot);
        }
      })(document);

      if (fixedEls.length > 0) {
        fixedHideStyle = document.createElement('style');
        fixedHideStyle.textContent =
          '[data-snapfull-hide],[data-snapfull-hide] *' +
          '{visibility:hidden!important;pointer-events:none!important}';
        (document.head || document.documentElement).appendChild(fixedHideStyle);
        await sleep(200); // let browser repaint before first strip
      }
    }

    /* ── 4. Build arrangements (BOTTOM → TOP) ───────────────────────────── */
    //
    //  200 px scroll-pad overlap: each strip overlaps the one below by 200 px.
    //  Sticky/fixed elements painted at the top of each viewport get naturally
    //  overdrawn by real content from the strip above (drawn later = wins).
    //
    const SCROLL_PAD = 200;
    const yDelta = windowHeight - (windowHeight > SCROLL_PAD ? SCROLL_PAD : 0);
    const xDelta = windowWidth;

    const arrangements = [];
    if (scrollMode === 'single') {
      // Just capture what's visible right now
      arrangements.push([0, 0]);
    } else {
      let yPos = fullHeight - windowHeight;   // start at bottom
      while (yPos > -yDelta) {
        let xPos = 0;
        while (xPos < fullWidth) {
          arrangements.push([xPos, yPos]);
          xPos += xDelta;
        }
        yPos -= yDelta;
      }
    }

    /* ── 5. Pre-compute container bounds (SPA mode only) ───────────────── */
    //
    //  For element-scroll (SPA) pages, the background needs to know the
    //  scroll-container's position within the viewport so it can:
    //    • draw only the CONTENT AREA at each scroll offset  (no sidebar repeat)
    //    • draw the full viewport ONCE (y=0 capture) as the "outer frame"
    //
    //  We read the rect ONCE before the loop (position doesn't change).
    //
    let containerBounds = null;
    if (scrollMode === 'element' && scrollTarget) {
      const r = scrollTarget.getBoundingClientRect();
      containerBounds = {
        left:   Math.round(r.left),
        top:    Math.round(r.top),
        width:  Math.round(r.width),
        height: Math.round(r.height),
      };
    }

    /* ── 6. Hide ALL scrollbars globally ───────────────────────────────── */
    //
    // GoFullPage's key trick: inject CSS to remove every scrollbar on the page
    // before capturing.  Unlike `overflow:hidden`, this does NOT disable
    // programmatic .scrollTo() — it only removes the visible scrollbar UI.
    //
    // Without this, every viewport strip contains the scrollbar gutter, and
    // the stitched image shows it repeating at every scroll-strip boundary.
    //
    const scrollbarStyle = document.createElement('style');
    scrollbarStyle.textContent =
      // Chromium / Safari
      '*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}' +
      // Firefox + IE/Edge legacy
      '*{scrollbar-width:none!important;-ms-overflow-style:none!important}';
    (document.head || document.documentElement).appendChild(scrollbarStyle);

    // Also hide the document-level scrollbar (GoFullPage's original trick)
    document.documentElement.style.overflow = 'hidden';

    /* ── 7. Capture loop ────────────────────────────────────────────────── */
    let success = true;
    const total = arrangements.length;
    let done    = 0;

    for (const [x, y] of arrangements) {
      // Scroll to the target position (clamped to [0, max] by the browser/element)
      const targetY = Math.max(0, y);
      scrollTo(scrollMode, scrollTarget, x, targetY);
      await sleep(150);   // wait for scroll + repaint

      // Read back the ACTUAL position after browser clamping
      const { actualX, actualY } = getScrollPos(scrollMode, scrollTarget);

      let response;
      try {
        response = await sendMsg({
          type:           'CAPTURE_REQUEST',
          x:              actualX,
          y:              actualY,
          windowWidth,
          totalWidth:     fullWidth,
          totalHeight:    fullHeight,
          containerBounds,          // null for window-scroll, rect for element-scroll
          progress:       ++done / total,
        });
      } catch (err) {
        console.error('[SnapFull] CAPTURE_REQUEST failed:', err.message);
        success = false;
        break;
      }

      if (!response?.ok) {
        console.error('[SnapFull] CAPTURE_REQUEST returned error:', response?.error);
        success = false;
        break;
      }
    }

    /* ── 7. Restore fixed/sticky elements + overlay capture ────────────── */
    //
    //  Restore visibility first, then scroll to 0 and take ONE more capture
    //  (isFixedOverlay).  Background will draw this on top of all strips at
    //  canvas (0,0), painting nav/sidebar chrome correctly at the page top.
    //
    // Remove the CSS hide rule first, then clean up data attributes
    if (fixedHideStyle) fixedHideStyle.remove();
    fixedEls.forEach(el => { delete el.dataset.snapfullHide; });

    if (fixedEls.length > 0 && success) {
      window.scrollTo(0, 0);
      await sleep(150);
      try {
        await sendMsg({
          type:        'CAPTURE_REQUEST',
          x:            0,
          y:            0,
          windowWidth,
          totalWidth:   fullWidth,
          totalHeight:  fullHeight,
          containerBounds: null,
          progress:     1,
          isFixedOverlay: true,   // ← tells background to draw at canvas origin
        });
      } catch (e) {
        console.warn('[SnapFull] overlay capture failed:', e.message);
      }
    }

    /* ── 8. Restore page state ──────────────────────────────────────────── */
    scrollbarStyle.remove();
    document.documentElement.style.overflow = origHtmlOverflow;
    if (body) {
      body.style.overflow  = origBodyOverflow;
      body.style.overflowY = origBodyOverflowY;
    }
    window.scrollTo(origScrollX, origScrollY);
    if (scrollTarget) {
      scrollTarget.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }

    /* ── 9. Notify background ───────────────────────────────────────────── */
    chrome.runtime.sendMessage(
      success
        ? { type: 'CAPTURE_DONE' }
        : { type: 'CAPTURE_ERROR', error: 'A capture step failed' }
    );
  }

  // ─── Scroll helpers ───────────────────────────────────────────────────────
  function scrollTo(mode, el, x, y) {
    if (mode === 'element' && el) {
      el.scrollTo({ left: x, top: y, behavior: 'instant' });
    } else {
      window.scrollTo(x, y);
    }
  }

  function getScrollPos(mode, el) {
    if (mode === 'element' && el) {
      return { actualX: el.scrollLeft, actualY: el.scrollTop };
    }
    return { actualX: window.scrollX, actualY: window.scrollY };
  }

  // ─── Find the primary scroll container for SPAs ───────────────────────────
  //
  //  Heuristic: the largest element that:
  //    • has overflow-y: auto | scroll | overlay
  //    • has scrollable content (scrollHeight > clientHeight + a threshold)
  //    • covers at least 80% of the viewport width and 60% of its height
  //    • is currently visible (not display:none, not zero-size)
  //
  function findScrollContainer(vw, vh) {
    const MIN_WIDTH_RATIO  = 0.80;
    const MIN_HEIGHT_RATIO = 0.60;
    const SCROLL_THRESHOLD = 50;   // px — must scroll more than this to qualify

    let bestEl     = null;
    let bestHeight = vh + SCROLL_THRESHOLD;

    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      // Skip trivial elements
      if (el === document.body || el === document.documentElement) continue;
      if (el.scrollHeight <= el.clientHeight + SCROLL_THRESHOLD) continue;

      const style   = window.getComputedStyle(el);
      const oy      = style.overflowY;
      if (!['auto', 'scroll', 'overlay'].includes(oy)) continue;

      // Must be visible
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (el.clientWidth === 0 || el.clientHeight === 0) continue;

      // Must cover a meaningful portion of the viewport
      const rect = el.getBoundingClientRect();
      if (rect.width  < vw * MIN_WIDTH_RATIO)  continue;
      if (rect.height < vh * MIN_HEIGHT_RATIO) continue;

      // Pick the one with the tallest scrollable content
      if (el.scrollHeight > bestHeight) {
        bestHeight = el.scrollHeight;
        bestEl     = el;
      }
    }

    return bestEl;
  }

  // ─── Messaging ────────────────────────────────────────────────────────────
  function sendMsg(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, response => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

})();
