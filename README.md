# SnapFull — Full Page Screenshot Extension

A Chrome extension that captures full-page screenshots and lets you export them as PNG or PDF, with a built-in screenshot history gallery.

## Features

- **Full-page capture** — scrolls bottom-to-top, stitches viewport strips into one seamless image
- **Smart scroll detection** — three-tier strategy: window scroll → SPA element scroll → single frame
- **Fixed/sticky element handling** — nav bars and sidebars are hidden during strip capture and composited back at the top via an overlay pass (Shadow DOM-aware, works on Reddit, YouTube, etc.)
- **Preview page** — instant preview after capture with fit ↔ original-size toggle and pan support
- **Screenshot gallery** — IndexedDB-backed history with thumbnail grid, per-item PNG/PDF download, delete, multi-select batch delete
- **Group by site** — optional collapsible grouping in the gallery
- **Lightbox** — full-resolution viewer with fit/100% zoom toggle and drag-to-pan
- **PNG & PDF export** — available from both preview page and gallery
- **Copy to clipboard** — one-click copy as PNG
- **Keyboard shortcut** — `Alt+Shift+P` (Windows/Linux) / `Cmd+Shift+P` (Mac)

## File Structure

```
manifest.json          Extension manifest (MV3)
background.js          Service worker: capture session, OffscreenCanvas stitching, IndexedDB history
content.js             Content script: scroll strategy, fixed-element hiding, strip coordination
popup.html/css/js      Extension popup (trigger capture, open gallery, shortcut hint)
preview.html/css/js    Post-capture preview page
gallery.html/css/js    Screenshot history & management page
icons/                 Extension icons (16/32/48/128 px)
libs/
  jspdf.umd.min.js     jsPDF for client-side PDF generation
```

## Installation (Developer Mode)

1. Clone or download this repository
2. Open Chrome → `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select this folder
5. The SnapFull icon appears in your toolbar

## Usage

- Click the **SnapFull icon** in the toolbar → **Capture**
- Or use the keyboard shortcut (`Alt+Shift+P` / `Cmd+Shift+P`)
- After capture, a preview tab opens automatically
- Click **History** in the preview toolbar or popup to open the gallery

## Technical Notes

- Capture is done with `chrome.tabs.captureVisibleTab` per strip; strips are composited on an `OffscreenCanvas` in the service worker
- Thumbnail generation uses a second `OffscreenCanvas` (JPEG 72%, max 300 px wide) to keep IndexedDB storage lean
- Fixed/sticky elements are tagged with `data-snapfull-hide` and hidden via a CSS rule with `!important` (covers descendants) before strip capture; restored afterward with one overlay capture drawn at canvas origin
- SPA pages (element-scroll mode) use `containerBounds` to draw only the scrollable content area at each offset, plus a single outer-frame draw at y=0

## Version

**v1.0** — initial release
