# BDM PDF Markup Tool — Project Knowledge & Lessons Learned

> **v2 (June 2026):** `BDM-PDF-Markup-Tool-v2.html` (7,768 lines) — bug-fix + Cubit-style takeoff release. v1 kept unchanged. See "v2 Changelog" at the end of this document.

**Project:** BDM PDF Markup & Measurement Tool  
**Owner:** James @ Bentley Development Management  
**Purpose:** Replace Bluebeam for internal QS/PM team (3-4 people, all Windows)  
**Focus:** Markups and measurements for QS takeoffs  
**File:** `BDM-PDF-Markup-Tool.html` (~4645 lines, single self-contained HTML file)

---

## Architecture

### Single-File Design
- Everything lives in ONE HTML file: CSS `<style>`, HTML markup, and JavaScript `<script>`
- No build step, no server, no dependencies beyond two CDN scripts
- Runs locally in any browser — just double-click the file

### Dependencies (CDN)
- **pdf.js 3.11.174** — renders PDF pages to canvas (`pdfjsLib.getDocument`)
- **pdf-lib 1.17.1** — PDF manipulation: embed metadata, save modified PDFs, merge/split

### Core Rendering Model
- PDF pages rendered to a background canvas at `currentScale`
- Annotations drawn on a transparent overlay canvas (`annotation-canvas`)
- Canvas uses `ctx.setTransform(currentScale, 0, 0, currentScale, 0, 0)` so annotation coordinates are stored in **page space** (scale=1 pixel units)
- Coordinate conversion: `toPage(screenPt)` divides by `currentScale`, `toScreen(pagePt)` multiplies

### Data Model
- `annotations[]` — array of annotation objects, each with `id`, `type`, `page`, `points[]`, and type-specific properties
- `measurements[]` — parallel array tracking measurement annotations with labels/values
- `countGroups{}` — object keyed by group name, value is `{count, color}`
- `pageCalibrations{}` — keyed by page number, value is `{pixelsPerMm, scale}`
- `history[]` / `historyIndex` — undo/redo stack (full state snapshots)

---

## Key Design Decisions & Rationale

### Save Format (Bluebeam-Style Single PDF)
**Decision:** Save produces ONE .pdf where markups are visible in any PDF viewer AND editable when reopened in the BDM tool.

**How it works:**
1. **Bake overlay** — rasterize annotations onto each page as a flattened image layer (visible everywhere)
2. **Embed JSON** — store the live annotation data in the PDF's Info dictionary as `BDMProject` (PDFHexString.fromText for UTF-16BE encoding)
3. **Embed clean source** — store the ORIGINAL un-marked-up PDF bytes in Info dict as `BDMCleanSource` (PDFHexString.of for raw hex bytes)

**On reopen:**
1. Extract `BDMCleanSource` → load as the rendering PDF (no baked overlay visible)
2. Extract `BDMProject` JSON → restore annotations as live/editable objects
3. Result: editable markups on a clean background

### Info Dictionary for Persistence
**Why Info dict instead of PDF attachments:**
- pdf-lib 1.17's `attach()` API stores files in a Name Tree that's complex to walk back out
- We tried and failed to reliably extract attachments on reopen — the Name Tree traversal was fragile across different PDF structures
- Info dict custom entries are simple key-value pairs, trivially readable via `pdfDoc.context.trailerInfo.Info`
- For text data: `PDFHexString.fromText(jsonString)` — encodes as UTF-16BE hex
- For binary data: `PDFHexString.of(bytesToHex(uint8Array))` — raw hex, decode via `.asBytes()` or manual hex parse

### Size Guard
- `BDM_MAX_CLEAN_EMBED_BYTES = 25 * 1024 * 1024` (25MB)
- Above this, skip baking AND skip embedding clean source
- Tool stays editable via JSON-only mode, but markups won't be visible in external viewers
- Shows confirm dialog explaining the limitation

### Multi-Document Tabs
- `openDocs[]` array stores state per document (annotations, history, calibrations, etc.)
- `activeDocIndex` points to current
- On tab switch: save current state into `openDocs[activeDocIndex]`, swap globals to new doc's state
- Globals are swapped by reference — arrays like annotations are stored directly

### Click-Click Drawing (Line Tools)
**Decision:** Line, arrow, dimension, measure, and calibrate tools use **click-click** (not click-drag):
- First click sets start point + shows live preview
- Mouse move updates the preview line with snap applied
- Second click finalizes the shape

**Rationale:** Matches Bluebeam behavior; more precise for measurements; allows user to reposition during preview.

**Implementation:** `twoClickStart` global tracks whether first click has been placed. Both clicks go through `onCanvasMouseDown`. The `onCanvasMouseUp` handler skips finalization when `twoClickStart` is set.

### Calibration Formula
For architectural scale presets (1:50, 1:100, 1:200, 1:500):
```javascript
pixelsPerMm = (72 / 25.4) / scaleDenominator
```
- PDF uses 72 points per inch
- 1 inch = 25.4mm, so 72/25.4 ≈ 2.835 PDF points per paper-mm
- At 1:100, each paper-mm represents 100 real-mm
- So `pixelsPerMm(real) = 2.835 / 100 = 0.02835`

Annotations are in page-space pixels (= PDF points at scale 1), so this formula directly converts page-pixel distances to real-world mm.

---

## Bugs Encountered & Fixes

### Duplicate Markups on Reopen (Critical)
**Symptom:** Reopening a saved PDF showed two copies of every markup — a baked/flattened version behind the editable one.  
**Root cause:** The attachment-based clean source extraction failed silently. The tool loaded the BAKED PDF (with overlay already burned in) as the background, then rendered the live JSON annotations on top.  
**Fix:** Moved clean source storage from pdf-lib `attach()` to Info dictionary `BDMCleanSource` entry. Added `BDMBakedOverlay` flag so on load, if baked=true but clean recovery fails, show a warning.

### Stamp Select/Edit/Delete Broken
**Symptom:** Couldn't click on stamps to select them.  
**Root cause:** Hit-test used `Math.hypot(x-center, y-center) <= radius` (circle test), but stamps are rendered as rectangles with `measureText().width + 20` width and height 28.  
**Fix:** Changed stamp case in hit-test to proper rectangle bounds check:
```javascript
case 'stamp': {
  const t = ann.text || 'APPROVED';
  const w = (t.length * 11) + 20;  // approximate width
  const cx = ann.points[0].x, cy = ann.points[0].y;
  return x >= cx - w/2 - tol && x <= cx + w/2 + tol && y >= cy - 14 - tol && y <= cy + 14 + tol;
}
```
Also: stamps were excluded from the properties panel appearance section — added dedicated Stamp properties (text + color).

### Stamp Not Rendering Until Tool Switch
**Symptom:** Placing a stamp showed nothing until switching to another tool.  
**Root cause:** `addStamp()` pushed to `annotations[]` and called `saveToHistory()` but was missing `redrawAnnotations()`.  
**Fix:** Added `redrawAnnotations()` call after push.

### Snap Not Working on Final Placement
**Symptom:** Snap indicator showed during drawing preview but the final annotation didn't land on the snapped position.  
**Root cause:** `onCanvasMouseUp` used the raw `e.clientX/Y` mouse position to compute the endpoint, never passing it through `snapScreenPoint()`.  
**Fix:** Applied snap to `screenEnd` in mouseup before converting to page space.

### Scale Presets Not Calibrating
**Symptom:** Clicking a scale preset button (1:100 etc) only set the reference length input value — still required drawing a calibration line.  
**Root cause:** `applyScalePreset(scale)` only set `calibrationMM = scale` and updated the input field.  
**Fix:** Rewrote to directly set `pageCalibrations[currentPage] = { pixelsPerMm: (72/25.4)/scale, scale: '1:'+scale }`.

---

## Feature Implementation Notes

### Snap-to-Drawing
- `snapEnabled` global (default true), toggle via topbar button
- `snapPagePoint(pagePt)` collects candidate points from all annotations on current page:
  - All annotation endpoints (`.points[]`)
  - Rectangle/ellipse extra corners and midpoints
  - Line/arrow/measure/dimension midpoints
- Finds nearest candidate within `8 / currentScale` page units (= 8 screen pixels)
- Returns snapped point or original if nothing nearby
- `lastSnapHit` stores the snap target for visual indicator (green square for endpoints, diamond for midpoints)
- Applied in both mousedown (start point) and mousemove (end point preview)
- For click-click tools: applied at both first and second click

### Document Search
- Uses pdf.js `page.getTextContent()` to extract text items with positions
- Iterates all pages, finds substring matches (case-sensitive/whole-word options)
- Converts PDF coordinate system (origin bottom-left) to canvas coords (origin top-left):
  ```javascript
  yTop = viewportHeight - yBottom - fontHeight
  ```
- Results shown in sidebar panel (not modal) with clickable entries
- Highlights rendered in `redrawAnnotations()` as yellow rectangles on canvas
- Current match highlighted brighter; Prev/Next navigation cycles through matches
- Keyboard shortcut: Ctrl+F

### Multi-Count Groups
- `countGroups{}` stores `{groupName: {count: N, color: '#hex'}}`
- Legacy migration: if value is a number (old format), converts to `{count: N, color: '#D97757'}`
- UI: dropdown to select active group, + button for new group (auto-assigns unused color from palette), ✎ to rename
- Color picker recolors ALL markers in that group
- Count totals panel shows all groups with their totals

### Drag-Drop PDF Merge
- Canvas area: shows overlay with "Drop PDFs to merge" text
- Thumbnail strip: accepts drops with visual border highlight (`.drag-over` CSS class)
- Both call `mergeDroppedFiles(files)` which uses `executeMerge()` logic
- Initial PDF open: global drop handler opens first PDF if none loaded

### Undo/Redo
- Functions `undo()` and `redo()` exist — save/restore full state snapshots
- Keyboard: Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z)
- Topbar buttons with SVG icons added

### Recalibrate
- "Recalibrate" button appears in calibrate tool panel when page is already calibrated
- `clearCalibration()` deletes the entry from `pageCalibrations` and un-dismisses the calibration banner

---

## Code Structure (Key Line References)

These are approximate — they shift as code is edited:

| Section | ~Line | Description |
|---------|-------|-------------|
| CSS variables & reset | 10-40 | Theme colors, layout vars |
| Thumbnail strip styles | 88-100 | Left panel styling |
| Canvas area styles | 233-248 | Cursor classes per tool |
| HTML structure | 442-600 | Topbar, tabs, main, toolbar, panel |
| Globals | 685-710 | All state variables |
| DOMContentLoaded init | 749-843 | Event listeners, drag-drop setup |
| Multi-doc tab system | 845-1050 | openDocs, switchDoc, closeDoc |
| toPage / toScreen | 1141-1152 | Coordinate conversion |
| snapPagePoint / snapScreenPoint | 1157-1196 | Snap-to-drawing logic |
| redrawAnnotations | 1198-1250 | Main render loop + snap indicator + search highlights |
| drawAnnotation | 1260-1800 | Per-type rendering (rect, ellipse, line, stamp, count, etc.) |
| drawInProgress | 1739-1800 | Live preview while drawing |
| onCanvasMouseDown | 1805-1900 | Click handling, tool dispatch, click-click logic |
| onCanvasMouseMove | 1868-1923 | Pan, resize, drag, draw preview |
| onCanvasMouseUp | 1925-2010 | Finalize shapes (drag tools only) |
| onKeyDown | 2040-2070 | Keyboard shortcuts |
| addMeasurement | 2075-2100 | Creates measure/calibrate annotations |
| addCountMarker / count helpers | 2100-2195 | Count group management |
| addStamp | 2196-2205 | Stamp placement |
| Hit testing (isPointInAnnotation) | 2300-2360 | Per-type hit detection |
| Properties panel | 2500-2750 | Annotation & tool properties UI |
| setTool | 2384-2396 | Tool switching + state reset |
| Calibration functions | 2885-2935 | guessScale, applyScalePreset, clearCalibration |
| Search functions | 4020-4110 | openSearchDialog, runDocSearch, navigation |
| Merge/Split | 4110-4200 | openMergeDialog, executeMerge, splitPages |
| Save/Load (PDF) | 3600-3850 | saveProject, loadPdf, JSON embed/extract |

---

## Tech Debt & Known Limitations

1. **No snap to PDF native geometry** — snap only works on BDM annotations, not the underlying architectural drawing lines. Would require parsing PDF path operators (complex).

2. **Clean source size limit** — PDFs over 25MB can't embed the clean source in Info dict. Those files won't show markups in external viewers.

3. **Text measurement approximation** — stamp hit-test uses `t.length * 11` as width proxy since we don't have a canvas context at hit-test time. Could be off for very long/short text.

4. **Undo/redo stores full state** — no incremental diffing. Memory could grow on very large projects with many edits.

5. **Search performance** — iterates ALL pages synchronously on search. On 500+ page documents this could be slow. Could be optimized with a Web Worker.

6. **countGroups migration** — old saves stored `countGroups[name] = number`. New code handles this via `_getCountGroup()` which auto-upgrades, but only on access.

7. **showToast doesn't exist** — snap/calibration feedback calls `typeof showToast === 'function'` guard. No visual toast notification system implemented yet.

---

## Development Workflow

### Testing Changes
- Edit the HTML file directly
- Refresh browser to test (F5)
- Open browser DevTools console for errors
- Test with a multi-page PDF that has existing annotations

### Syntax Verification
```bash
node -e "
const fs = require('fs');
const h = fs.readFileSync('BDM-PDF-Markup-Tool.html','utf8');
const re = /<script(?![^>]*\\bsrc=)[^>]*>([\\s\\S]*?)<\\/script>/g;
let m, i = 0;
while ((m = re.exec(h))) {
  try { new Function(m[1]); console.log('script#'+i+' OK'); }
  catch(e) { console.log('script#'+i+' ERR: '+e.message); }
  i++;
}
"
```

### Key Patterns for Making Changes
- **Adding a new tool:** Add toolbar button HTML → add to cursor class CSS → handle in mousedown/mouseup/mousemove → add draw function → add hit-test case → add properties panel section
- **Adding a topbar button:** Insert in `<div id="topbar">` section, use `class="topbar-btn"` with inline SVG icon
- **Persisting new state:** Add to globals, include in `openDocs` state save/restore (lines ~838/858), include in JSON project save/load
- **Properties panel:** Add HTML generator in `getAnnotationPropertiesHTML()` or `getToolPropertiesHTML()`, wire listeners in `attachAnnotationListeners()` or `attachToolListeners()`

---

## User Preferences (James / BDM)

- Prefers Bluebeam-like UX patterns (click-click for lines, single-file save, etc.)
- QS/PM workflow: heavy use of measurements, calibration, counts, stamps
- Wants metric units (mm/m/m²) — already the default
- Team of 3-4 on Windows desktops
- No server infrastructure — everything must work as a local file
- Iterates quickly — gives bug reports + feature lists in one go, expects continuous implementation ("keep working")

---

## v2 Changelog (June 2026) — BDM-PDF-Markup-Tool-v2.html

### Critical bug fixes
- **Scale presets crashed silently** — `updatePanel()` was called but never defined; preset clicks set calibration but never refreshed the UI. Replaced with `openPropertiesPanel()` + `updateCalibrationIndicator()` + `rebuildMeasurements()`.
- **Calibration leaked between document tabs** — `pageCalibrations` was never reset in `loadPdf` and was shared by reference across tabs. Now reset per document.
- **Cut Content didn't redact in output files** — white cover only existed on the live canvas; saved/flattened/compressed/printed PDFs showed the "removed" content. The white fill now lives in `drawCutContentAnn` (with an `isBakingAnnotations` flag to drop the on-screen dashed border in outputs), so every export path covers correctly. Deleting/undoing a cutcontent re-renders the page so content reappears.
- **Manual calibration reported wrong scale (~33% off)** — `guessScale` used 96-DPI (3.78) instead of PDF points (72/25.4). Measurements were right; the label was wrong. Now also snaps to common architectural scales within 3%.
- **Undo could corrupt markups after page operations** — history only snapshotted annotations; Ctrl+Z after a page delete/insert/rotate restored stale page indices. Page ops now reset history (`resetHistoryAfterPageOp`); snapshots now include measurements + countGroups + takeoffItems.
- **Half-finished drawings leaked across pages/tabs** — first click of a click-click tool survived page nav/tab switch and committed at wrong coordinates. `cancelInProgressDrawing()` is now called from all page-nav paths, tab switch, and continuous-view page-cross clicks.
- **Rotating a page displaced its markups** — annotation coords are viewport-space; rotation now remaps every point (`remapAnnotationsForRotation`).
- **Baked overlay mis-rotated on pages with /Rotate ≠ 0** — save bake now draws the overlay with compensating rotation in pdf-lib.

### Other fixes
- `showToast` finally exists (snap/copy/calibration feedback now visible)
- Line/arrow hit-testing uses segment distance, not infinite-line (eraser no longer deletes lines you didn't click)
- Search result navigation no longer breaks continuous view (routes through `goToPage`)
- `measurements[].page` resyncs after page restructure (`rebuildMeasurements` updates `m.page`)
- Escape in text/callout/inline editors cancels instead of committing; Escape while drawing keeps the tool armed (Bluebeam-style), second Escape deselects
- Backspace deletes selection; Backspace mid-polyline removes the last vertex
- Properties-panel edits are undoable (debounced history)
- Right panel respects being closed (`panelUserCollapsed`); no more force-reopen on every page turn
- Middle-click pans from any tool; right-click no longer places stray points
- Eraser stays armed for bulk deletes; count numbering recounts on delete
- Calibrate-by-line prompts for the reference length if the input isn't visible (no more silent stale-value calibrations)
- "Apply to ALL pages" checkbox in calibrate panel (presets + drawn line) — big QS win on multi-sheet sets
- Zero-size highlight/cutcontent click-artifacts prevented (minD check)
- `closeDoc` clears the right thumbnail container; deleting an earlier page keeps the current sheet in view
- Select-mode hover cursors (resize arrows / move) now actually work; snap indicator shows before the first click
- History/saved JSON no longer bloated by `_labelRect`/`_perimRect` transients

### NEW: Cubit-style Takeoff (third panel tab)
- **Items** (e.g. "Slab", "Skirting", "Downlights") with result type Length (m) / Area (m²) / Count (no.), auto-assigned colour
- **Select item → tool arms automatically → draw shapes → quantity accumulates live** (tool stays armed between shapes while an item is active; Esc stops)
- **Deduct toggle** — shapes drawn while ON subtract (openings/voids), rendered dashed with a − label
- Quantities computed numerically from geometry + per-page calibration (never parsed from display strings); ⚠ shown if any source page is uncalibrated
- Per-item colour recolours all linked shapes; rename/delete (shapes stay, just unlinked); count items get their own count group
- **Export Takeoff CSV** (Item, Type, Unit, Quantity, Shapes, Deductions)
- State persists in saved PDFs (`takeoffItems` in the project JSON, version 4) and per tab

### Post-release fix (10 Jun 2026)
- **"Invalid PDF structure" on reopen of old saves** — files saved by the early build deployed on jamesbdm.github.io stored the clean source as a literal PDF string, which mangles binary (extraction yields a ~540-byte fragment). v2 now validates the extracted clean source (must start with %PDF and be >1KB) and falls back to the visible baked copy with a clear warning instead of refusing to open. Second net: if pdf.js still rejects the clean copy, retry with the original bytes. **Action: redeploy v2 to jamesbdm.github.io — the live site still runs the old build with the broken save format.**

### v2.1 additions (10 Jun 2026)
- **Takeoff level 2:** new result types — Vertical (length × height → m², for walls/render) and Volume (area × depth → m³, for slabs/excavation) with per-item height/depth; $ rate per item with live amounts, per-trade subtotals and an estimate total; trade groupings in the panel; ◎ button highlights (glows) all of an item's shapes on the drawing.
- **Excel export:** dependency-free .xlsx writer (`_buildZip`/`_xlsxFromSheets`, stored-zip + inline-string SpreadsheetML). Two sheets: Takeoff Summary (trade subtotals + estimate total) and Shape Breakdown (per-shape, with scale used). CSV export retained.
- **Compressed saves:** clean source is deflate-compressed (CompressionStream) before hex-embedding — flag `BDMCleanCompressed`; loader inflates when flagged, old uncompressed files unaffected. Embed cap raised 25MB → 60MB.
- **Viewports:** calibrate panel → "Draw Viewport" — drag a region, give it its own scale (e.g. 1:20 detail on a 1:100 sheet). All measurement labels and takeoff quantities are viewport-aware via `_calFor(page, point)` (anchor point: midpoint for lines, first vertex for polylines, centroid for areas). Teal dashed outline + scale tag; manage/delete in calibrate panel; persisted in saves/tabs/history.

### v2.2 — James's feedback round (10 Jun 2026)
- **Snap to drawing lines** — new "Snap Lines" topbar toggle (separate from markup snap, persisted in localStorage). Raster-based: samples the rendered PDF canvas around the cursor and snaps to the nearest dark ink pixel within ~8 screen px (`snapPageToContent`). Circle indicator = content snap; square/diamond = markup snap.
- Defaults: line thickness 2→1; measurement label font 11→8; takeoff new-item type defaults to Area (m²); polyline vertex dots now constant ~4 screen px (were zoom-scaled).
- Callout: default black text in solid white box + filled arrowhead at the anchor.
- Area measurements: perimeter label now opt-in per annotation (Properties → Label → "Show perimeter").
- Tick tool stays armed after each placement (like eraser).
- Custom stamps: "+ CUSTOM" tile in the stamp grid (prompt for text, stored in localStorage `bdm-custom-stamps`, × to remove).
- Thumbnails: dashed view-box on the current page's thumbnail showing the visible region; updates on scroll/zoom/page change (`updateThumbnailViewbox`).
- No more px labels once calibrated: `defaultCalibration` (most recent calibration) is the fallback for uncalibrated pages; per-page calibration and viewports still win.
- Takeoff: Markup % per item (amount = qty × rate × (1+markup%)), shown in panel amounts and both exports.

### v2.3 — measurement & takeoff upgrades (10 Jun 2026)
- **Room Fill (Dynamic-Fill style)** — new toolbar tool (F): click inside a room → flood-fills the rendered raster to the dark linework, Moore-traces the boundary, Douglas-Peucker simplifies, creates a normal editable area annotation (auto-tags to the active takeoff item). Bails politely if the room isn't enclosed (`MAGIC_AREA_MAX_PIXELS`). Functions: `magicAreaAt`, `_traceBoundary`, `_simplifyPath`.
- **Auto-calibration from title block** — on opening an uncalibrated PDF, scans each page's text for "SCALE 1:N" (or most frequent common "1:N"), calibrates those pages (`auto: true` flag), toasts a summary. `autoDetectScalesFromText`, runs 400ms after load.
- **Type-a-distance** — after the first click of measure/line/arrow/dimension (or mid-polyline/area), type a length in mm + Enter: places the point exactly that far along the cursor direction (Shift = nearest 45°). Floating hint shows the buffer; Backspace edits; Esc cancels. `typedDistanceBuffer`, `commitTypedDistance`.
- **Takeoff shape lists** — the active item's editor lists every measured shape (page + value): click to locate, ± flips deduction, ⤴ unlinks, × deletes. Any existing measurement can also be assigned to an item from its Properties panel ("Takeoff" section dropdown + deduction checkbox). `assignAnnotationToItem`, `compatibleTakeoffItems`.
- **On-sheet legend** — "Place Legend on Page" (takeoff panel) drops a live white table annotation (item colour / name / qty) that recomputes on every redraw and bakes into saves/prints/flattens. Draggable; new annotation type 'legend' (`drawLegendAnn`, hit-test via cached `_legendW/_legendH`).

### v2.4 — rotate, scrollbar fix, two-document viewing (2 Jul 2026)

**Bug fix: bottom scroll bar dead in the middle.** The save/snap toast (`showSaveToast`) is a `position:fixed` element centred at the bottom of the window that only fades to `opacity:0` — it never got `pointer-events:none`, so after the first toast an invisible box permanently swallowed clicks on the middle of the horizontal scrollbar. Fixed by adding `pointer-events:none` to the toast and to the typed-distance hint (same risk at `bottom:56px`).

**Rotate shapes.** Two families (see `ROT_PROP_TYPES` / `ROT_POINT_TYPES` constants):
- Box/anchored shapes (rectangle, ellipse, highlight, image, signature, stamp, text) carry `ann.rotation` (degrees CW) applied as a canvas transform around `annRotationCenter()` in `drawAnnotation` — so screen, bake, flatten, compress and print all render it identically, and it persists in saves/history for free (plain property). Points stay stored unrotated; `annLocalPoint()` maps probe points into the local frame for `hitTest`, `getResizeHandleAtPoint` and `applyResize`. Snap candidates are rotated to on-screen positions in `snapPagePoint`.
- Point-based shapes (line, arrow, measure, dimension, polygon, polyline, area, cloud, pen) get rotation baked permanently into their points around the centroid — measurements are unaffected (rotation-invariant).
- UX: round drag handle floating above the selected shape (Shift = 15° steps, magnet on 0/90/180/270), plus a Rotation section in Properties (↺/↻ 90° buttons; exact angle input for stored-rotation shapes, "rotate by" for point-based). `cutcontent` deliberately excluded — redactions stay axis-aligned. Rotating text about its anchor; stamps about their centre point.

**Split view (two documents side by side).** New `#canvas-split-row` wraps `#canvas-wrapper` plus a draggable divider and `#split-pane` (own header: document dropdown, page nav, zoom ±/Fit, ⇄ swap, ✕). The pane renders any open tab — or another page of the active document — via its own pdf.js render loop (`renderSplitPane`, cancel-safe via `_splitRenderSeq`). Annotations are drawn by temporarily swapping the doc-state globals (`drawSplitPaneAnnotations`) since `drawAnnotation`/`_calFor` read globals; synchronous swap-and-restore. **The pane is view-only** (pan/zoom/page-nav; no markup editing) — ⇄ swaps which document is in the editor. When the pane shows the doc being edited, `scheduleSplitRefresh()` (hooked at the end of `redrawAnnotations`) mirrors edits live, one overlay redraw per frame. `closeDoc`/`renderDocTabs` keep `splitDocIndex` and the dropdown in sync. `#drop-zone` became an absolute overlay so the empty state still fills the canvas area.

**Pop-out window.** `openPopoutWindow()` — `window.open(location.href, …)` gives a second fully independent editor (own tabs, own state) to drag onto the other monitor. Entry points: topbar "Split" button + View menu → "Split View (side by side)" / "New Window (second screen)".

### v2.5 — takeoff estimating upgrade (2 Jul 2026)

**Assemblies (composite items).** An item can carry `subItems: [{name, basis, factor, unit, rate}]` — one drawn shape feeds several bill lines. `computeTakeoffQty` now aggregates every geometry basis per item (length m, area m², perimeter m — absolute, so deduction openings still get edge treatment — and signed count); each part's qty = basis × factor (e.g. Slab area → Concrete m³ at ×0.1 depth, Edge formwork m from perimeter, Pump fixed). Assembly amount = Σ parts × (1 + markup%); the parent's flat rate is ignored. Editor lives in the active item's expander ("+ Make this an assembly"); parts appear indented in the panel, exports and the on-sheet summary. Verified numerically in node (48m² slab with 2m² opening → 4.8m³ / 36m perim / correct $ totals).

**Zones.** `takeoffZones` [{id,name}] per document + `activeTakeoffZoneId`; new shapes get `ann.zoneId` (persists with annotations). Zone picker row in the takeoff panel (+ Add zone…/rename/delete — deleting keeps shapes, drops the tag), per-shape reassignment in the shape's Properties → Takeoff, "By Zone" subtotal cards in the panel, Zone column in Shape Breakdown and a "By Zone" sheet in the XLSX. Persisted through doc tabs, saves, history and the split-pane global swap.

**Rate build-up.** `item.rateComponents: [{label, amount}]` — when present, `effectiveTakeoffRate()` (their sum) replaces the flat rate everywhere and the panel shows "$X (built up)" read-only. Editor in the item expander; XLSX gains a "Rate Build-ups" sheet.

**Takeoff on the drawings.** `placeTakeoffSummary()` places a legend-type annotation with `legendMode:'summary'`; `drawLegendAnn` rewritten with three styles switchable from the annotation's Properties → Takeoff Table: simple (items+qty, the old legend), summary (trade-grouped with rates/amounts/subtotals/estimate total), detailed (every measured shape with page, zone, deduct flag and its dimension). Scope: whole document or this-page-only; rates column toggleable. Still recomputes live on every redraw and bakes into saves/prints/flattens.

### v2.6 — toolbar layout (2 Jul 2026)

**Top bar wraps + compact mode.** `#topbar` now `flex-wrap: wrap` (auto second row on narrow windows) instead of `overflow-x: auto` which hid buttons behind a sideways scroll. New compact toggle (double-arrow button, far right): `#topbar.compact .topbar-btn { font-size: 0 }` collapses labels to icon-only without touching markup (tooltips still name everything). Persisted in localStorage `bdm-topbar-compact`.

**Left toolbar grouped.** Tools now sit in four collapsible groups — MEASURE (teal), SHAPES (orange), MARKUP (purple), EDIT (red) — each a `.tool-group[data-group=…]` with coloured left stripe + tinted background and a clickable label (chevron) to collapse. Select/Pan stay ungrouped on top. Collapsed state persisted per group (`bdm-toolgroup-<name>`), restored in `restoreToolbarLayout()` on DOMContentLoaded. `setTool`'s `.tool-btn` querySelectorAll still finds the nested buttons; button markup unchanged (24 preserved).

### v2.6.1 — polyline shape + heading legibility (2 Jul 2026)
- New **Polyline Shape** tool (Y) in the SHAPES group: same click-click flow as the polyline measure but commits `type:'polyline'` with `isShape:true, hideLabel:true` — no measurement label, skipped by `rebuildMeasurements` and `drawPolylineMeasure` label logic. Icon = zigzag with vertex dots.
- Tool group headings enlarged 7.5px → 9px with brighter per-group colours (teal/orange/purple/red 300-level tints) after feedback they were hard to read.

### Lesson learned (tooling)
- The OneDrive-synced project folder can serve a **stale/truncated copy to the sandbox shell** while the real file (via Read/Write tools) is fine — verify against the real file, and beware `sed -i` on the mount. A mid-edit OneDrive lock once truncated the file tail (EBUSY); if a file ever ends mid-line, the missing tail can be restored from v1 since the last ~400 lines are unchanged between versions.
