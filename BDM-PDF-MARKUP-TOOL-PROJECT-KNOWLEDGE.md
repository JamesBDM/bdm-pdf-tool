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

### v2.6.2 — signature stretching fix (3 Jul 2026)
- Placement used a fixed 140×50 box, squashing any signature that wasn't 2.8:1 — now sized from the image's real proportions (`aspect` stored on the annotation).
- Resizing locked to the image ratio in `applyResize` (corners anchor the untouched edge; edge handles stay centred). `_signatureRatio()` prefers the decoded image's natural size, falls back to stored aspect.
- "Fix proportions" button in the signature's Properties panel repairs signatures stretched before the fix.
- Deploy note: Pages build #23 failed transiently (GitHub-side); an empty retrigger commit fixed it. If a deploy doesn't appear after ~10 min, check github.com/JamesBDM/bdm-pdf-tool/actions for a failed "pages build and deployment" run and push any small commit to retry.

### v2.7 — m³ shape labels + shapes shared across items (6 Jul 2026)

**Volume shapes label in m³.** Area shapes linked to a Volume item now show their volume (area × depth) on the drawing instead of the raw m² — e.g. a 100m² slab outline at 200mm depth labels "20.00m³". Per-shape depth overrides (`ann.takeoffFactor`) win over the item default; falls back to m² when uncalibrated or no depth is set. Implemented as `takeoffVolumeLabel()` called from `drawAreaMeasure`, so the m³ value flows into `ann.label` and therefore the measurements panel, shape lists and XLSX "Measured value" automatically. The Properties "Measurement" row retitles Area→Volume when the label is m³. Vertical (m²) items unchanged.

**One shape, several items.** New multi-link model: `ann.takeoffItemId` stays the PRIMARY link (drives colour); `ann.takeoffExtraIds[]` holds additional items the same shape feeds (slab outline → Concrete m³ + Membrane m² + Edge formwork perimeter via assemblies, or directly to multiple flat items). Membership everywhere goes through `annLinkedToItem(a, itemId)` / `annTakeoffIds(a)`: quantities (`computeTakeoffQty`), ◎ highlight, item shape lists, detailed on-sheet summary, CSV/XLSX exports and deduction counts all include extra-linked shapes. `linkShapeToItem` fills the primary slot first, then extras; `unlinkShapeFromItem` removes ONE link and promotes the first extra to primary (shape recolours to the promoted item). Deleting an item unlinks per-item (other links survive); `_pruneExtraIds` drops stale/duplicate extras. Deduction flag is per-shape — it subtracts from ALL linked items (label says so). Persists free in saves/history/tabs since it's a plain annotation property.

**Adding existing shapes to an item.** Two entry points:
- Item editor → "＋ Add existing shapes" — arms pick mode (`takeoffPickItemId`): Select tool, every compatible shape clicked on the canvas links to the collecting item (as an extra when already owned), toast shows the running total. Esc / "✓ Done adding" exits; switching tools or items exits too. Incompatible clicks (e.g. a polyline onto an area item) toast the reason.
- Shape Properties → Takeoff — the existing "Item:" dropdown still sets the primary; new "Also add to:" dropdown adds extra links, listed as removable "also: <item>" rows. Height/depth override row now shows when ANY linked item is volume/vertical (not just the primary).

### v2.8 — Estimate Workbook: job-level estimating across documents (7 Jul 2026)

**Job-level takeoff.** `takeoffItems` / `takeoffZones` (+ active item/zone) are no longer swapped per document tab — one estimate spans every open PDF (architectural + structural, file per level). Removed from `captureActiveDocState`/`restoreDocState`/`newDocEntry`/split-pane swap; `loadPdf` only resets the job when it's the FIRST document, and `mergeTakeoffIntoJob()` merges a loaded file's saved takeoff by item id (empty job adopts wholesale, otherwise appends unknown items/zones — re-opening files saved together reunites the estimate). Every PDF save still embeds the full job (project JSON v4 shape unchanged).

**Cross-doc quantity engine.** `computeTakeoffQty` aggregates across all open documents via `_eachTakeoffDocState(fn)`, which temporarily swaps the calibration-relevant globals (annotations, pageCalibrations, viewports, defaultCalibration) per doc — same pattern as the split-pane render, guarded by `_docStateSwapped`/`_swapDocIdx` so it stays correct even when called during a split render (verified numerically: same-pixel shapes in a 1:100 doc and a 1:50 doc → 100m² + 25m²). shapeFilter now receives `(ann, docIdx)`; page-scope legend tables filter on their own doc. New helpers: `allTakeoffShapes(itemId)` → [{a, docIdx}], `_findShapeDoc(annId)`, `_docLabel`/`_docShortLabel`, `jumpToTakeoffShape(docIdx, annId)` (switches tab → page → selects). Panel shape lists show the source document; cross-doc rows are jump-only (edits happen in the shape's own doc to keep undo sane). `deleteTakeoffItem`, `setTakeoffItemColor`, zone deletion and dedication counts all operate across docs.

**Estimate Workbook dock.** `#workbook-dock` — an Excel-style grid docked full-width under the drawing (drag the top edge to resize; height + open state persisted in localStorage `bdm-workbook-h`/`bdm-workbook-open`; hidden in print). Toggles: topbar "Workbook" button, ⊞ Workbook in the takeoff panel. `item.trade` is now a PACKAGE PATH — "Concrete / Substructure / Footings" nests collapsible sub-tables with subtotals at every level (`buildTakeoffTree()`, auto-numbered codes 1 / 1.1 / 1.1.1). Rows: package headers (click to collapse, `wbCollapsed` keyed by path) → items (inline-editable name/colour/rate/markup, ✎ moves package, ◎ highlights shapes, ▸ expands) → assembly parts → individual measurements (doc · page · zone · deduct · value; click jumps to the exact shape; ± / ⤴ for active-doc shapes). Estimate total row at the bottom. Two-way: selecting a linked shape on the canvas expands + scrolls + flashes its workbook row(s) (`workbookSyncSelection`, hooked into `openPropertiesPanel`).

**Excel export upgrade.** `_xlsxFromSheets` now supports rich cells `{v, f, s}` (cached value + live formula + style index), per-sheet column widths, a styles part (bold, navy header band, grey subtotal bands with top border, 0.00 qty + $#,##0.00 money formats) and `fullCalcOnLoad`. New first sheet "Estimate" (`_buildEstimateSheet`) mirrors the workbook package tree with REAL formulas: item Amount `=Qty×Rate×(1+MU/100)`, assembly parts summed into their item, package subtotals `=SUM(...)` over children, grand total over top-level packages — change a rate in Excel and the estimate reflows. Shape Breakdown gained a Document column. Validated with zip/XML parse + openpyxl round-trip.

### v2.8.1 — version badge (7 Jul 2026)
- `const APP_VERSION` (top of the globals, above the TAKEOFF STATE section) renders as an accent-bordered badge next to the logo (`#app-version`, populated on DOMContentLoaded). **Bump it with every release** — it's how users tell the local build from the deployed one at jamesbdm.github.io. Stays visible in compact topbar mode.

### v2.8.2 — thumbnail multi-select delete + resizable takeoff tables (7 Jul 2026)
- **Thumbnail multi-select.** Ctrl/Cmd+click toggles pages in the thumbnail strip, Shift+click selects a range from the last anchor (falls back to the current page); plain click clears and navigates as before. Selected pages get a blue outline + ✓ badge; a selection bar appears above the strip ("N pages selected · Delete · ✕"). Bulk delete via the bar, the right-click menu (label becomes "Delete N Selected Pages" when the clicked page is in the selection), Esc clears. `deleteSelectedThumbPages()` removes pages highest-first in ONE pdf-lib pass, drops annotations on deleted pages, shifts the rest, remaps `pageCalibrations` AND `viewports` (single-page delete never handled viewports — bulk path does), clamps `currentPage`, then `rebuildPdf` + `resetHistoryAfterPageOp`. State: `thumbSelectedPages` (Set) / `thumbSelectAnchor`; pruned on every `generateThumbnails`.
- **Resizable takeoff summary/legend.** Legend-type annotations (takeoff legend / summary / detailed tables) now expose 4 corner handles when selected — dragging any corner scales the whole table around the OPPOSITE corner via `ann.legendScale` (0.4×–6×, persisted with the annotation so saves/prints/bakes match). `drawLegendAnn` multiplies every metric (pad/fonts/row height/gap/indent/swatch/line widths) by the scale, so the table re-lays-out crisply rather than stretching pixels. Also a "Size %" input + Reset in Properties → Takeoff Table.

### v2.8.3 — save prompt on close (7 Jul 2026)
- **Unsaved-changes tracking.** `docModified` global (per-doc via capture/restore, `d.docModified`): set by the first `saveToHistory()` after open/save (also re-renders tabs to show an accent ● + "unsaved changes" tooltip on the dirty tab), cleared in `loadPdf` (initial snapshot isn't an edit) and at the top of `writeSavedBytes` (both in-place saves and Downloads-copy fallbacks count as saved).
- **Close prompt.** `closeDoc(idx, force)` — closing a dirty sheet shows a Save & Close / Close Without Saving / Cancel modal. `saveThenCloseDoc` switches to the doc, runs `saveProject()`, and only closes if the flag actually cleared (failed/cancelled save keeps the sheet open). `beforeunload` warns when ANY open document is dirty.

### v2.8.4 — Select Text tool (7 Jul 2026)
- New EDIT-group tool `selecttext`: drag a box over the sheet; text items it touches highlight blue live and are copied to the clipboard on release (toast shows a preview). Uses pdf.js `getTextContent()` with the same PDF→canvas coordinate conversion as document search; items cached per doc/page in a WeakMap (`_pageTextItemsCache`), warmed when the tool is armed. `_composeSelectedText` groups fragments into reading order (lines by vertical midpoint, left→right, top→bottom, newline between lines). Clipboard via `navigator.clipboard.writeText` with a textarea/execCommand fallback. Clear messaging when a page has no text layer (scanned/plotted-as-image). Esc cancels the drag; tool stays armed for repeat grabs.

### v2.8.5 — workbook manual entries + headings (7 Jul 2026)
- **Manual entries.** `item.manual: true` with `manualQty` (typed number) and `unit` (free text — item/weeks/visits...). `computeTakeoffQty` returns the typed qty (and EXCLUDES manual lines from any shapeFilter call, so zone/page subtotals stay measurement-only); amount = qty × rate × (1 + MU%). Created from the workbook toolbar "+ Manual line", a ＋ button on any heading row, or the panel's new "Manual entry" type. Workbook rows edit qty + unit inline ('M' type tag, • instead of the measurements expander, no highlight button); panel editor gets Qty/Unit fields and hides shape-pick/assembly sections. `takeoffItemUnit(item)` replaces direct TAKEOFF_TYPE_UNITS lookups in panel/exports.
- **Headings & sub-headings.** New job-level `takeoffHeadings[]` (package paths that exist with no items yet) — seeded into `buildTakeoffTree`, persisted in saves (project JSON), merged on open, snapshotted in history. Workbook toolbar "+ Heading" (use / to nest); each heading row gains ＋ (manual line here), ＋§ (sub-heading), ✎ (rename segment — all items and sub-headings underneath follow), × (delete, only when empty).

### v2.8.6 — callout/text editing + right-click cancel (8 Jul 2026)
- **Callout text box is selectable.** `hitTest` callout case now checks the cached box rect (`ann._annBox`, cached at draw time, stripped from snapshots) before the leader lines — click the box to select/drag, not just the arrow.
- **Double-click edits.** Double-click any text/callout (selected or not — `getAnnotationAtPoint` at the double-click) selects it and opens the inline editor.
- **Wrap + resizable box.** `ann.boxW` fixes the box width and WRAPS the text (`_wrapTextLines`: keeps \n, word-wraps per line). Both callout and text get an extra bottom-right handle (appended in `getAnnotationHandlePoints`, handled in `applyResize`) to drag the width; Properties → Text Formatting gains "Box width" input + Auto button (blank/Auto = size to longest line). Text hit-test now uses the wrap-aware cached box.
- **Right-click cancels drawing.** `onCanvasRightClick` now cancels ANY in-progress draft (same as Esc — tool stays armed) instead of finishing polylines/callouts. Finishing is by DOUBLE-CLICK (unchanged; was already the primary path).

### v2.8.7 — text box fill (8 Jul 2026)
- Text annotations can have a fill behind them (Properties → Appearance → "Box Fill": on/off checkbox + colour + opacity slider). Stored as `ann.boxFill` — deliberately SEPARATE from shapes' `fillColor`, because text annotations already carried an unused `fillColor` from toolProperties and honouring it would have retro-filled every existing text orange. Fill uses `ann.fillOpacity` (default 100), drawn with 3px padding behind the (wrap-aware) lines in `drawTextAnn`. Callouts already had Box Fill.

### v2.8.8 — baked overlay lands off-sheet on centred-MediaBox pages (9 Jul 2026)
- **Bug (critical for sharing):** CAD-exported sheets (Revit et al.) can have a MediaBox that doesn't start at (0,0) — e.g. centred, spanning [-1192,-841 → 1192,841]. The save bake drew the overlay PNG at (0,0), which on such pages is the sheet CENTRE — the whole markup layer landed half a page off-sheet, so recipients saw NO markups in Adobe/Chrome while the BDM tool (which re-renders live JSON) looked perfect. Diagnosed from a real file: `BDMBakedOverlay=1`, overlay image present as the last content-stream op, but positioned outside the visible area.
- **Fix:** bake now anchors to `page.getMediaBox()` x/y (all four /Rotate branches). Repairing an already-sent file: inject `1 0 0 1 <mbx> <mby> cm` into the overlay's content stream (pikepdf) — see session notes; or just reopen + re-save with v2.8.8.

### v2.8.9 — Bluebeam-style free box sizing for text & callout (9 Jul 2026)
- v2.8.6's single bottom-right handle only drove width. Now text boxes and callout boxes carry `boxW` AND `boxH` with EIGHT handles (corners + edge midpoints, rectangle order via `_boxHandlePts`) — drag any handle to make the box any shape (square, tall, narrow); the opposite edge stays pinned (`_resizeBox` in `applyResize`, min 30×line-height). Text WRAPS to the box width; the box keeps the height you set (text overflows below if the box is too short — nothing is hidden). Text annotations' handles are now box-only (move = drag the body); callout keeps its leader handles + the 8 box handles, and resizing from the left/top moves `textPos` so the leader follows the box. Selected text/callouts show a dashed outline around the box. Properties row is now "Box W×H" with an Auto button (clears both).

### v2.8.10 — toolbar legibility (9 Jul 2026)
- Left toolbar widened 52 → 66px (`--toolbar-width`); tool buttons 40 → 52px wide. Group headings (MEASURE/SHAPES/MARKUP/EDIT) were clipping to "ASURE"/"HAPES" — now 10px, tighter letter-spacing, nowrap. Shortcut letters were 7px muted specks — now 9px bold on a dark chip (bottom-right of each button), accent-coloured when the tool is active.

### v2.8.11 — Save As opens in the current file's folder (9 Jul 2026)
- `saveProjectAs` now passes `startIn: currentFileHandle` to `showSaveFilePicker` — a FILE handle as startIn opens the picker in that file's containing directory, so Save As lands in the current job folder instead of wherever the browser last saved. Only applies when the document was opened with a real file handle (file picker / launch); drag-dropped files without a handle keep the browser default.

### v2.8.12 — Bluebeam-style print dialog (10 Jul 2026)
- **Custom page range + reverse order.** Pages dropdown gains "Custom Range…" with a text input (`parsePrintRange`: "1-3, 5, 8-10" → sorted 0-based indices; dedup, reversed ranges ok, null on garbage — invalid input alerts and keeps the dialog open) and a Reverse page order checkbox.
- **Paper size / orientation / auto-rotate.** `PRINT_PAPER_SIZES` (A4→A0, Letter, Legal, Tabloid; mm, portrait) drives an explicit `@page { size: Wmm Hmm }`; paper "Auto" keeps `size:auto` (or a bare `landscape`/`portrait` orientation hint). Orientation "Auto" follows the FIRST printed page's aspect (`resolvePaperMm`); per-page mismatches are handled by "Auto-rotate to fit paper" (default on) — `rotateCanvas90` rotates the rendered canvas and swaps the physical mm dims so Fit/Actual/Custom/Tile all stay correct.
- **Include markups toggle** (default on) — skips the annotation bake in preview AND print; preview cache now keys on page + markups flag.
- **Tile Large Pages** (Bluebeam poster mode). New Scale option: the page renders once, then `computeTiles` slices it into paper-sized tiles at the chosen Scale % (default 100) with a 10mm join overlap (`PRINT_TILE_OVERLAP_MM`); paper "Auto" falls back to A4 for tile maths. Each tile is emitted as `img.actual` at exact mm size (~144 dpi from the 2× render). Preview draws dashed red cut lines and reports "cols×rows = N sheets/page".
- **One settings object.** `collectPrintSettings()` is shared by `updatePrintPreview` and `executePrint`, so the preview always matches output (paper, rotation, greyscale, markups, tiles). Helpers unit-tested: range parsing, paper resolution, tile coverage reaching page edges (A1@100% on A4 = 5×3 sheets).

### v2.9 — Excel Quantity Link + Markup Report (10 Jul 2026, Bluebeam Core-tier parity)
- **Quantity Link (workbook toolbar → "Sync Excel").** Writes live takeoff quantities into the user's OWN estimate spreadsheet, Bluebeam Quantity Link style. Picks an .xlsx via `showOpenFilePicker` (handle kept per session; right-click the button to link a different file), reads it with a new `_readZip` (central-directory parser + native `DecompressionStream('deflate-raw')` — handles stored & deflate entries), then creates or REPLACES a "BDM Quantities" sheet (sync note row, header row, one row per item in package-tree order with Estimate-sheet codes) and a defined name per item (`QTY_Item_Name` → `'BDM Quantities'!$D$row`, deduped, cell-ref-safe). Users reference `=QTY_Screw_piles` anywhere in their own sheets; re-syncing updates the values wherever the rows move. Everything else in the host workbook — sheets, styles, formulas — passes through untouched (sheet XML uses inline strings and NO style indexes so it can't clash with the host styles part). Old `QTY_*` defined names are purged each sync; `fullCalcOnLoad` is set so referencing cells refresh on open. Repack via the existing `_buildZip` (stored entries — Excel accepts). Verified with openpyxl: host sheet + user formula intact, named ranges correct, re-sync replaces (no duplicate sheet) and updates values.
- **Markup Report (topbar → "Report").** Bluebeam-style PDF summary of every markup: options dialog (all/current page; all markups / measurements only / markups only; thumbnails on/off), grouped by page, each row = context thumbnail + № + colour swatch + type + content (measurement value, label, text, count group, deduction flag). Thumbnails: each page rendered ONCE (≤3600px, print intent) with all markups baked, then cropped per markup around `_annBounds` (points ∪ textPos ∪ `_annBox`) with 30pt padding and a 260px context minimum, JPEG'd at 0.8. Report built with pdf-lib (A4, BDM navy/gold header, page footers); `_winAnsiSafe` maps smart dashes/quotes/ellipsis to ASCII before Helvetica encoding. Downloads as `<file>-Markup-Report.pdf`. Note: uncalibrated measurement rows show "?" because the app's own labels are "?" until the page is calibrated.
- New globals/helpers: `quantityLinkHandle`, `_readZip`, `_qlBuildRows`, `_qlSheetXml`, `syncQuantityLink`, `ANNOTATION_TYPE_LABELS`, `_annTypeLabel`, `_annDescription`, `_annBounds`, `_winAnsiSafe`, `openMarkupReport`, `executeMarkupReport`.

### v2.9.1 — workbook estimating upgrades (11 Jul 2026)
- **Manual ↔ measured conversion, both directions.** New `convertTakeoffItem(id, newType)` — the type tag on every workbook row is now a dropdown (L/A/V/V³/C/M), and the panel editor gains a Type select. Measured → manual keeps the computed qty as the typed value (and the unit); shapes stay linked but stop driving the qty (the manual path in `computeTakeoffQty` already ignores them). Manual → measured deletes `item.manual`, sets the chosen `resultType` (prompting for height/depth on vertical/volume), and shapes drive the qty again.
- **"+ Measured line" in the workbook.** Toolbar button + per-heading `＋▱` — `wbAddMeasuredItem(pkgKey)` creates an area item in that package and calls `setActiveTakeoffItem` so the drawing tool arms immediately (change type afterwards via the tag dropdown).
- **Measure straight from a row.** Each measured item row gains a `✏` button (becomes `■` in the item colour while active) that arms/stops measuring via `setActiveTakeoffItem` — click an item, draw its qty.
- **Comments column.** New 9th workbook column; `item.comment` edited inline (persists automatically — items are saved whole in the project JSON). Flows into the Estimate sheet Excel export (column H) and the Quantity Link "BDM Quantities" sheet (column H). All row templates updated for the extra column (pkg/parts/measurements/total).
- **Sub-sub-headings** (3rd+ tier) confirmed already working — `＋§` on any heading row nests to any depth (`wbAddHeading` path join + recursive `buildTakeoffTree`); tooltip now says so.
- All verified headlessly: 3-tier tree builds, measured line arms the area tool, convert round-trip preserves qty/unit, comment lands in the workbook grid, Estimate export and Quantity Link rows.

### v3.0 — "Datum" rebrand (11 Jul 2026)
Full restyle to the Datum "Redline" identity per `Datum brand identity project.zip` (design handoff in `design_handoff_datum_brand/` — README + `datum-tokens.css` are the source of truth). Structure/behaviour unchanged (restyle-only, per handoff).
- **Tokens.** `:root` now carries the Datum primitives + semantic roles (`--bg/--surface/--surface-2/--line/--text/--muted/--accent-*/--secondary/--sheet`), with ALL legacy variable names (`--bg-primary`, `--border-color`, `--accent`…) aliased onto the roles — the whole 12k-line app restyles through the alias layer without touching component CSS. Light theme = `[data-theme="light"]` overrides on the role vars.
- **Fonts.** Google Fonts: Zilla Slab (display — modal titles, drop heading, panel title, wordmark), Archivo (UI default), Spline Sans Mono with `tabular-nums` (statusbar, wb-num/code, meas values, shortcut chips, cal pill).
- **Lockup.** Topbar logo = 18px inline datum-symbol SVG (redline triangle, `currentColor` baseline) + "Datum." Zilla Slab 600 with redline period; version badge in accent-text mono. Title → "Datum — PDF Markup & Measurement".
- **Overrides block** appended cascade-last: unified tool-rail labels (mono 8px, 0.14em, redline 5px square bullet, group tints/stripes removed), active tool = solid redline fill + `--accent-on` icon, radius 9px, `#toolbar svg { stroke-width: 1.7 }`, cream drafting-paper empty state (28px grid, dashed square, redline Browse button), statusbar 10px mono with calibration PILLS (calibrated = redline fill, not = outlined amber), panel active tab = text + redline underline, focus-visible ring, 120ms transitions.
- **Colour sweep.** All hardcoded `#D97757`/`rgba(217,119,87,…)` → redline equivalents.
- **Theme toggle.** Moon button in the topbar → `toggleDatumTheme()` sets `data-theme="light"` on `<html>`, persisted in localStorage `datum-theme`, restored on load. Dark is default.
- **PWA.** manifest.json → Datum name/short_name, navy `#0E1830` colours, new Datum icons (icon-192/512 + icon-maskable-512 copied to project, github-upload and the git repo); `theme-color` meta updated. Existing `file_handlers`/`launch_handler` plumbing preserved. NOTE: team members must reinstall (or Windows will keep the old name/icon until the PWA updates itself).
- **Deliverables.** Markup Report PDF header now Datum navy/redline, footer "Datum — Markup Report". Quantity Link sheet KEEPS the name "BDM Quantities" so existing linked workbooks' formulas don't break.
- Verified headlessly against the reference screens: dark loaded state, cream empty state, light theme.

### v3.1 — Bluebeam-style shell + layers/clipboard/sequence/overlay (11 Jul 2026)
Layout re-architecture for Bluebeam migrants (mockup approved before build). All existing handlers/workflows unchanged.
- **Menu bar.** New `#menubar` above the topbar: Datum lockup + File/Edit/View/Document/Tools/Window/Help dropdowns (`amToggle`/`amClose`, hover-switches like native menus, outside-click closes). Every item calls an EXISTING function; Window menu rebuilds from `openDocs` on open (`_buildWindowMenu` — note active doc's name comes from global `currentFilename`, inactive from `d.currentFilename`). Help → shortcuts modal (`showShortcutsHelp`). Old `#new-menu`/`#view-menu` dropdown blocks REMOVED from the topbar (their items now live in File/View menus); `toggleNewMenu`/`toggleViewMenu` remain as null-guarded dead code.
- **Quick access bar.** Topbar slimmed to: Open Save · Undo Redo · Snap SnapLines · Search Split Workbook · Print · (spring) Measures Report Markups · Panel Theme Compact. Removed buttons (New/SaveAs/Close/Combine/Compare/View/Snip/Compress/Flatten/Presets) all live in menus.
- **Movable tool rail.** `applyRailDock('left'|'top'|'right')` — right = flex `order:99` on #toolbar; top = element moved above `#main` with `.dock-top` horizontal styles; persisted in localStorage `datum-rail`; **default right** (Bluebeam muscle memory). `⠿` grip at rail top cycles positions (also View menu).
- **Markups List dock** (`#markups-dock`, statusbar "Markups" button / View menu). Live table of every markup: Subject/Page/Content/Value/Layer/Colour; column-click sorting, search, All/Measurements/Markups filter, row-click jumps + selects, CSV export. Kept live via `saveToHistory` + `updatePageIndicator` hooks (no-ops while closed).
- **Layers.** `ann.layer` (default "Markups", persisted with the ann), editable inline per row (datalist of known layers). "Layers ▾" dropdown toggles visibility → `hiddenLayers` Set (SESSION-only). Single gate in `drawAnnotation` = hidden layers vanish from screen AND every bake path (save/flatten/print/report) — WYSIWYG; also excluded from click-selection (`getAnnotationAtPoint`).
- **Markup clipboard.** Ctrl+C on a selected markup (skipped when page text is selected) → `markupClipboard` (deep clone, `_`-prefixed cache keys stripped); Ctrl+V pastes at +14pt offset per paste, onto the CURRENT page/document — cross-doc within the session. Falls back to the existing image-paste when the clipboard holds an image. Takeoff/zone links deliberately stripped on paste.
- **Sequence tool.** MARKUP group + Tools menu; first click prompts prefix + start, then every click places a bold white-filled text label ("Door 01"…), zero-padded under 10. Stays armed; clicking the tool button again (`armSequenceTool`) restarts the prompt.
- **Overlay compare.** Compare dialog gains a Mode select: existing cloud mode, or colour overlay — current doc ink → RED, revision → BLUE, agreement dark (per-pixel: R=255−dB, G=255−max, B=255−dA), composited PNG → single-page PDF opened as a new tab "Overlay - <name>".
- **Status bar.** Physical page size readout (`#sb-pagesize`, mm, via `updateSbPageSize` in `updatePageIndicator`). Ctrl+P now opens the print dialog.
- Headless-verified: menus, rail right-default + cycling, markups list rows/sort/CSV/layer hide (row dims, canvas skips), copy/paste clone, sequence "Door 01/02" via real canvas clicks, overlay tab creation, 420×297mm readout.

### v3.2 — standalone workbook files (dual-mode estimating) + no px readouts (11 Jul 2026)
- **Dual persistence, switched by whether a workbook file is open.** NO workbook → unchanged v2.8 behaviour: the full job estimate embeds in every saved PDF (self-contained, ideal for one-off measures). Workbook OPEN → the `.datumwb` file (JSON: `{app:'Datum', kind:'workbook', version:1, takeoffItems, takeoffZones, takeoffHeadings}`) is the SINGLE MASTER: saved PDFs write EMPTY takeoff arrays + `workbookManaged` flag (shapes still carry their item tags, so quantities re-link when the workbook is open), `loadPdf`'s first-document job reset is skipped, and an opened PDF's embedded estimate is IGNORED with a one-time confirm to import unknown items (de-dupe by item id). Kills the stale-embedded-copy problem for multi-drawing jobs.
- **File ops** (workbook dock toolbar chip + Open/New/Save/Close, and File menu): `newWorkbookFile` (doubles as "start workbook from current estimate" — lifts the session estimate into the new file), `openWorkbookFile` (replace-confirm when un-mastered items exist; wrong-file-kind rejected), `saveWorkbookFile` (explicit save; Excel-style "last save wins" for shared drives — one editor at a time), `closeWorkbookFile` (save-confirm, then estimate leaves the session and embedded mode resumes with a clean job). Dirty tracking via `saveToHistory` → chip ● + `beforeunload` warning. Chip states: `▣ file.datumwb` (master) / `▢ No workbook — estimate saves inside each PDF`.
- **Gotcha fixed in review:** `openWorkbookFile` calls `saveToHistory` (undo snapshot) BEFORE clearing the dirty flag, else a freshly opened workbook immediately shows unsaved changes.
- **Uncalibrated pages no longer show pixel values.** `getCalibratedLabel`/`getCalibratedArea` return "Not calibrated" instead of `123.4px` / `5000px²` — nobody mistakes px for real dimensions. (Testing note: the synthetic reportlab test sheet auto-calibrated from its "SCALE 1:100" title text — both pages had `pageCalibrations` entries — so the uncal branch must be tested with `pageCalibrations={}; defaultCalibration=null`.)
- Headless-verified full cycle: create-from-estimate → PDF payload empty → edit=dirty/save=clean → close clears session → reopen restores (rate edit intact) → chip correct; uncal labels return "Not calibrated".

### v3.2.1 — light-theme shortcut chips + rail icon size (11 Jul 2026)
- Shortcut letters on tool buttons were grey-on-grey in the light theme — added `[data-theme="light"] .tool-btn .shortcut` overrides (navy `#33415E` on `rgba(20,32,60,.10)` chip; active keeps `--accent-on` on a darker chip).
- Tool rail icons 18px → 15px to match the quick-access bar (Print/Save etc.).

### v3.2.2 — text/callout wrap fix for unbroken words (11 Jul 2026)
- `_wrapTextLines` only broke at SPACES, so a single word wider than the box (long codes, URLs, "ggg…" test strings) never wrapped — text overflowed the resized box. Now words wider than `maxW` hard-break at character level (`breakWord` helper); spaced text unchanged. Fixes both text boxes and callouts (both wrap via the same helper). Verified: no characters lost, all lines ≤ box width.

### v3.3 — branded alerts + per-item shape visibility (11 Jul 2026)
- **Branded alert box.** `datumAlert(message)` — Datum-styled overlay (own element + z-index 5000, deliberately NOT the showModal system so an alert fired while a dialog is open leaves that dialog intact); `window.alert = datumAlert`. Non-blocking is safe: every alert() call site in the app treats it as fire-and-forget. NOT branded (impossible for any web app): Chrome's own "Leave app?" beforeunload box, and native confirm()/prompt() — converting those needs an async refactor of ~30 call sites (future work).
- **Hide a trade's shapes while measuring another.** `hiddenTakeoffItemIds` Set + 👁/⊘ eye button per measured workbook row (`toggleTakeoffItemShapes`); an amber "⊘ Show all shapes" chip appears in the workbook toolbar while anything is hidden (`showAllTakeoffShapes`). `annVisible` now hides a shape when its LAYER is hidden OR when EVERY takeoff item it feeds is hidden (shared shapes stay visible if any linked item is visible) — flows through the same single `drawAnnotation` gate as layers, so hidden shapes vanish from screen, print, report and save-bake alike. Session-only, like layer visibility.
- **Escape gotcha:** template-literal button titles must not use `\'` via the Edit tool (`\\'` landed in the file and broke parsing) — use typographic ’ instead.
- Headless-verified: alert renders/branded/closes; hide A leaves B visible; Show-all chip appears/clears.

### v3.4 — construction symbol library (15 Jul 2026)
- **Bluebeam-style Tool Chest symbols.** New Symbols tool button in the tool rail (MARKUP group, under Highlight; also Tools menu → "Symbols — Construction Library"). Clicking it arms the symbol tool and opens the tool chest in the right panel (same pattern as Stamp): 96 pre-drawn construction symbols in 8 collapsible discipline categories — General/Drafting (north arrow, section/detail/elevation/level markers, grid bubble, rev triangle…), Architectural (door swings, windows, stairs…), Plumbing/Hydraulic (toilet, bath, vanity, floor waste, HWU…), Electrical (GPOs, switches, lights, DB, smoke detector…), Mechanical/HVAC, Fire Services, Furniture/Fixtures, Civil/Siteworks. Search box filters across all categories (auto-expands while searching); collapse state and the "Keep placing after each click" toggle persist in localStorage (`bdm-symbol-collapsed`, `bdm-symbol-keep`). (Originally shipped as a 4th right-panel tab; moved to the tool rail same-day at James's request — `openSymbolsPanel()` sets panelMode='properties' + `setTool('symbol')`, and `getToolPropertiesHTML('symbol')` returns the full library.)
- **Implementation.** Symbols are vector linework: SVG path data in a 0–100 box (`SYMBOL_LIBRARY`/`SYMBOL_DEFS`), drawn on canvas via cached `Path2D` + `DOMMatrix` scaling (`drawSymbolAnn`), rendered in the panel as inline SVG from the SAME path data (`symbolTileSVG`) — one source of truth, crisp at any zoom. New annotation type `'symbol'` (points = [tl,br] like image/signature) joins every two-point-shape list (`ROT_PROP_TYPES`, handle/resize/hit-test lists), so select/move/8-handle resize/rotate/undo/copy-paste/layers all work for free, and it flows through the single `drawAnnotation` gate → bakes into save, flatten, print, compress identically. Placement: click a tile (arms `pendingSymbolId` + `setTool('symbol')`), click page to place centred at the def's default width; Esc or Select stops. Placed black (`#111111`) by default, recolourable via Properties (thickness input = lineweight multiplier).
- Panel search re-renders only `#sym-cats` (keeps focus in the search box); tiles sit on a fixed light background (`#f2f0ea`) so black linework reads in both themes.
- Verified: full-file `node --check` + jsdom load of the real page (no script errors; panel builds 96 tiles / 8 category heads; Symbols tab present), plus a rendered contact sheet of all 96 symbols visually checked. Both root and `github-upload/` copies updated via identical Edit operations (mount was serving a truncated stale copy — again).

### v3.5 — open password-protected PDFs (27 Jul 2026)
- **Problem.** Locked PDFs failed to open with "Error loading PDF: No password given". Root cause: pdf.js can prompt for a password via its `onPassword` callback, but Datum never wired it up, so it fell over. Separately, pdf-lib (the save engine) refuses encrypted files outright — so even opening wasn't enough; markups couldn't save. Confirmed against a real client "Welcome Letter" (RC4-40, non-empty user/open password) and Edge prompting for a password.
- **Fix — decrypt once at ingest.** New dependency-free decryptor for the PDF Standard security handler, embedded as an inline `<script>` right after the pdf-lib CDN tag: `window.datumDecryptPdf(bytes, passwordProvider)`. Given the password it returns fully-decrypted bytes carrying no `/Encrypt`, so BOTH pdf.js (view/measure) and pdf-lib (save/page-ops) get a normal unlocked document. Handles RC4 40/128-bit, AES-128 (V4/AESV2) and AES-256 (V5/R6/AESV3); validates user OR owner password; honours EncryptMetadata=false. Contains its own MD5, RC4 and a pure-JS AES (block enc/dec) — WebCrypto used only for SHA-256/384/512 in the R6 key derivation (Algorithm 2.B). Rebuilds the file with a fresh classic xref, dropping the Encrypt object (nulled) and any xref-stream (left unreferenced).
- **Integration.** `loadPdf` calls `datumMaybeDecrypt(incomingBytes)` immediately after reading the file (before the BDM-data probe and pdf.js), so `currentPdfBytes` is always unlocked — downstream save/rotate/delete-page all work unchanged. `executeCompare` decrypts the comparison file too. New `datumPasswordPrompt(reason)` — branded promise-based password dialog (Enter submits, Esc/backdrop cancels, red "Incorrect password" on retry). Cancelling throws `{datumCancelled:true}`, caught quietly in `loadPdf` and `executeCompare` (no error alert). All five `pdfjsLib.getDocument` sites now go through `datumGetDocument`, which also attaches pdf.js's native `onPassword` as a belt-and-suspenders fallback for any exotic encryption the decryptor can't rewrite (opens for viewing even if save is then limited). Bumped `APP_VERSION` to v3.5.
- **Verified.** Standalone Node tests: MD5/AES vectors vs Node crypto; full decrypt of pikepdf-generated RC4-40, RC4-128, AES-128, AES-256, empty-user owner-only and no-metadata files → every output opens with NO password in PDFium (Chrome/Edge engine), correct page count, text + embedded JPEG intact, and **pdf-lib loads and re-saves the result** (the save path). Owner-password unlock confirmed. In-browser (Playwright, real Datum.html): all new functions defined, no page errors, embedded decryptor unlocks RC4-128 + AES-256 in-page (output `%PDF…`, no `/Encrypt`). NOTE: can't validate against the actual Welcome Letter — its open password is unknown (not empty, not simple-numeric); a password box only helps if the user knows the password.
- **Limitation.** Public-key (certificate) encryption and non-Standard handlers are not supported (throws `unsupported-encryption` → falls back to pdf.js onPassword for view-only). Very large AES files decrypt in pure JS (no WebCrypto bulk path) — fine for typical drawings, could be slow for hundreds of MB.

### v3.6 — existing PDF annotations now print (28 Jul 2026)
- **Problem.** A client-filled form (Brighten "Authority to Discharge", filled with Acrobat-style typewriter text) displayed correctly in Datum and in the print PREVIEW, but every printed copy came out blank in the fill-in boxes. Same for anything already annotated in the source file — form-field values, stamps, sticky notes, callouts added in Acrobat/Edge/Bluebeam.
- **Root cause.** Two render calls passed `annotationMode: 0` (pdf.js `AnnotationMode.DISABLE`): `executePrint` (~line 12196) and the markup-report thumbnail render (`executeMarkupReport`). The comment said "we draw our own annotation layer" — true for Datum's OWN markups (drawn from the `annotations` array onto the canvas), but mode 0 ALSO discards annotations already baked into the incoming PDF, which Datum never parses into that array (no `getAnnotations` call anywhere in the app). Screen render (`page.render` at ~3052) passes no `annotationMode`, and pdf.js defaults to ENABLE — hence display-vs-print divergence. The print preview (`updatePrintPreview`, ~12028) also uses the default, so the preview showed text the print then dropped.
- **Fix.** `annotationMode: 0` → `annotationMode: 1` in both places. **Use 1 (ENABLE), never 2 (ENABLE_FORMS)** — mode 2 deliberately returns an empty op list for widget/form annotations (`WidgetAnnotation.getOperatorList` short-circuits on `ANNOTATIONS_FORMS`) because it expects an HTML form layer to draw them, which Datum doesn't have; form-field values would then still print blank. Under `intent:'print'` pdf.js still honours each annotation's Print/Hidden flags, so no-print annotations correctly stay out — same as Acrobat. No double-draw risk: Datum's own markups never exist as PDF annotation objects on the page it renders.
- **Already correct, left alone:** `executeCompress` and `flattenAndDownload` omit `annotationMode` entirely (default ENABLE), so Save-flattened and compressed output already carried source annotations — `flattenAndDownload` is therefore the fix to hand a user whose filled form looks blank in other software.
- **Verified.** pdf.js 3.11.174 (the exact CDN version Datum loads), real file, `getOperatorList`: `intent:'print'` + mode 0 → 1289 ops; mode 1 → 1415 ops (the 14 FreeText annotations). Playwright against the real page with the CDN scripts routed to local copies: v3.6 badge renders, no page errors, print-intent canvas gains ~8.6k dark pixels with mode 1. Independent pikepdf flatten of the same file rendered in PDFium confirmed all 14 values land in the right boxes.
- **Gotcha for future flatten work:** this file's page content stream (Microsoft Print To PDF) leaves an unbalanced `0.75 0 0 -0.75 0 841.92 cm` CTM at the end of the stream. Appending an overlay without first wrapping the original content in `q`/`Q` renders it mirrored and mispositioned.

### v3.7 — text tool types straight onto the page (WYSIWYG inline editor) (30 Jul 2026)
- **Problem (James).** "When I use the text function it opens up a separate box, which doesn't sit where I'm writing the text, but then the text goes to where I actually wanted." The editor already WAS an inline contentEditable overlay positioned at the click — but it looked and behaved like a pop-up: opaque dark fill `rgba(34,35,56,.95)`, 2px accent border, 4x6px padding, `min-width:120px`, `min-height:24px`, `resize:both`. The border+padding are content-box, so the caret sat **+8px right / +6px down** from the click, while `drawTextAnn` renders with `textBaseline:'top'` **exactly at** `points[0]`. Hence: type here, text lands there.
- **Fix — make the editor render-identical to the canvas.** `.text-input-overlay` is now chrome-free: `background:transparent; border:0; padding:0; min-width:6px; white-space:pre`, and the only visual cue is `outline:1px dashed var(--accent); outline-offset:3px` — outlines paint OUTSIDE the box, so they cost zero layout offset. New helper `_styleTextOverlay(overlay, opts)` copies font family/size, **weight, slant and underline** (previously only the new-text path was missing these) and sets `line-height` to `(fontSize + lineGap) * currentScale` to match the canvas line step (`+2` for text, `+3` for callouts). Applied to all three entry points: `showTextInput`, `showCalloutTextInput`, `editTextAnnotationInline`.
- **Callouts keep their box.** A finished callout IS a white box with black text, so the editor keeps `.callout-edit` (white bg, black text, 6px padding, solid outline) and cancels the padding with an equal `-6px` offset on left/top, so the first character still lands on `textPos`. The opaque white also means no ghosting when editing an existing callout.
- **Ghosting gate.** With a transparent editor, editing an EXISTING text annotation would show the old canvas copy behind the live text. `drawAnnotation` gained `if (ann._editingInline) return;` right after the `annVisible` layer gate; the flag is set (plain text only, not callouts) before focus and `delete`d on blur — transient, so save/flatten/print never see it.
- **Verified (Playwright, real page, CDN routed to local pdf.js 3.11.174 / pdf-lib).** Old build measured first as the control: editor text origin `+8.00 / +6.00` from the click, typed glyphs `+7.5 / +6.0` from the committed render. New build: click→editor origin `0.00 / 0.00`; typed-vs-drawn `-0.50 / 0.00` (subpixel ink-bbox vs layout-box); continuous view at 200% zoom `-1 / -2`; double-click-to-edit sits exactly on the original glyphs with **0 ink pixels** left on the canvas underneath (gate works) and the flag clears after commit; callout typed glyph exactly on `textPos`. No page errors; both inline `<script>` blocks pass `node --check`.
- **Test-harness gotchas:** the sandbox's Playwright build needs `executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`; in continuous view at high zoom the first `.page-ann-canvas` boundingBox can have a NEGATIVE y (scrolled), so clamp synthetic click coords into the viewport or the click silently misses; and `range.getBoundingClientRect()` on an EMPTY contentEditable returns `0,0` — measure the empty case from `getComputedStyle` offsets instead.

### v3.8 — search results stay in the sidebar (4 Aug 2026)
- **Problem (James).** "When I use the search function, it only shows me one occurrence then the sidebar changes to Takeoff." Root cause: `openSearchDialog` injects the search UI straight into `#panel-content`, but `openPropertiesPanel()` — called by `goToPage`/`nextPage`/`previousPage` and many takeoff refreshes — rebuilds that same container from `panelMode`. Search's own `gotoSearchResult(0)` jumps to the first hit → `goToPage` → panel rebuilt as Takeoff (or Properties), wiping the search box and result list after the very first result.
- **Fix.** New flag `searchPanelOpen`. While true, `openPropertiesPanel()` returns early and leaves the panel alone — page jumps and takeoff refreshes can no longer steal it. Explicit exits only: selecting a markup (guard clears the flag and falls through to its Properties), clicking a panel tab (`setPanelMode` clears it), or the new ✕ button (`closeSearchPanel()` = clear highlights → flag off → `openPropertiesPanel()`). Ctrl+F while already open now just refocuses the input instead of re-rendering (which used to orphan the results list). Extras: result rows carry `data-sr` ids; `gotoSearchResult` updates the status line to "n of N", highlights the active row (`var(--bg-hover)`) and `scrollIntoView({block:'nearest'})`s it.
- **Verified (Playwright, real page, CDN routed to local pdf.js 3.11.174 / pdf-lib, control-first).** Control (v3.7): after `searchNext()` crossed to page 2 the panel title flipped to "Takeoff", search UI gone, re-Ctrl+F wiped the result list. Fixed build: 6/6 hits on a 3-page pdfkit doc, panel stays "Search" through Next×2 / result-row click / cross-page jumps, status ticks 1→2→3 of 6, active row highlighted, Ctrl+F re-open keeps all 6 rows, tab click and ✕ both hand the panel back to Takeoff with highlights cleared. Both inline `<script>` blocks pass `node --check`.
- **Harness gotcha:** the app's globals (`pdfDoc`, `searchHighlights`) are top-level `let` — they are NOT `window.` properties. `waitForFunction(() => window.pdfDoc …)` never fires; reference the bare binding inside a try/catch instead. `loadPdf` takes `(arrayBuffer, filename)`, not a `File`.

### Lesson learned (tooling)
- The OneDrive-synced project folder can serve a **stale/truncated copy to the sandbox shell** while the real file (via Read/Write tools) is fine — verify against the real file, and beware `sed -i` on the mount. A mid-edit OneDrive lock once truncated the file tail (EBUSY); if a file ever ends mid-line, the missing tail can be restored from v1 since the last ~400 lines are unchanged between versions.
- Since v3.5 the deploy source of truth is the git clone `C:\Git Hub\bdm-pdf-tool` (edited in the sandbox, pushed by James); the `github-upload/` folder inside OneDrive is deprecated.

### v3.9 — white measure labels, custom Legend/Table tool, calibration rework (6 Aug 2026)
Four things James asked for in one pass. All verified with Playwright against the real page (CDN routed to local pdf.js 3.11.174 / pdf-lib); both inline `<script>` blocks pass `node --check`.

**1. Measurement label text is now WHITE by default.**
- **Symptom.** The little pill on a measure/area/polyline/dimension markup drew its text in redline red (`#E5432E`) on the dark 80%-opacity background. On a green-tinted architectural fill (James's screenshot: `63.15m²` over an ENTRY LOBBY plan) the red-on-dark is hard to read.
- **Fix.** New constant `DEFAULT_LABEL_TEXT_COLOR = '#ffffff'`, used by `drawLabel()` (`ann.labelColor || DEFAULT_LABEL_TEXT_COLOR`) and by the Properties → Label swatch default so the picker starts on white too. Per-annotation override (Properties → Label → Text Color) is untouched, and existing saves have no `labelColor` so they pick the new default up automatically. Background stays `rgba(18,19,26,0.8)` — white on that pill reads on any drawing.

**2. New Legend / Table tool (`type: 'table'`).**
- A free-form table you drop on the sheet. Columns are either **Text** or **Colour box** (a filled swatch that can also carry text, whose ink flips black/white from the swatch luminance via `_contrastInk`). Optional title bar, optional heading row, grid lines, per-cell bold, per-column alignment and width.
- Tool rail button in MARKUP (grid icon) + Tools menu entry. Click the page → table is placed → the editor opens immediately. Double-click any table re-opens the editor. Properties panel gets Edit / Size % / Font size / Opacity / **Copy to all pages**.
- **Deliberately reuses the takeoff-legend plumbing** rather than duplicating it: the same `_legendW` / `_legendH` render cache and `legendScale`, so `getAnnotationHandlePoints`, `applyResize` (corner drag rescales, opposite corner pinned) and `hitTest` needed only `|| ann.type === 'table'`. Because it renders through `drawAnnotation`, it bakes into save / print / flatten / markup report for free — verified: flattened PDF shows the table incl. white "FW" text on a green swatch.
- Editor internals: `_tableDraft` working copy, `_readTableEditor()` scrapes the DOM via `data-col-*` / `data-cell-*` attributes, `_rerenderTableEditor()` re-renders the body after add/delete row/column, `applyTableEditor()` `Object.assign`s the draft onto the annotation (the draft holds data keys ONLY — no id/type/points). `autoFitTableCols()` measures text on an offscreen canvas at base font size.
- Round-trip verified: save project → reload → 2 tables restored with every cell (`RC LEGEND | Slab on ground | FW`); undo/redo of "Copy to all pages" correct.

**3. Calibration no longer snaps back to the arrow.**
- **Symptom (James).** "for the calibration tool when i finish a measure it switches to arrow key which i dont want." Cause: two hard-coded `setTool('select')` calls at the end of the calibrate branch of `addMeasurement`.
- **Fix.** New `afterCalibrationTool()` honours a persisted preference `calibrateAfterTool` — **Stay on Calibrate (default)** / Measure / Measure Area / Select. Staying just refreshes the panel (`openPropertiesPanel()`), never `setTool`. Preference lives in `localStorage['bdm-calibrate-prefs']` alongside `calibrateAskAfterDraw`.

**4. Custom scales + draw-then-type calibration.**
- **Custom scale.** `applyCustomScale()` + a `1: [ ]` input in the Calibrate panel takes anything positive (1:75, 1:35, 1:1.5). Preset row widened to 1:1 … 1:1000 incl. **1:75**, and the last 6 custom scales are remembered (`localStorage['bdm-custom-scales']`) as one-click chips. `applyScalePreset` now `parseFloat`s its argument so decimals work.
- **guessScale** snap list widened to `[1,2,2.5,5,10,15,20,25,30,40,50,60,75,100,125,150,200,250,300,400,500,600,750,1000,1250,1500,2000,2500,5000]` — 1:75 / 1:150 / 1:300 / 1:400 used to be rounded onto a neighbour. Non-snapping results under 10 keep one decimal.
- **Draw first, then type** (the reversal James asked for). `datumCalibrationPrompt(pixelDist, prefillMm)` is a branded promise dialog (modelled on `datumPasswordPrompt`): value + mm/m unit selector, a LIVE "Drawing scale will be 1:N" preview that updates as you type, and its own Apply-to-all-pages tick. `addMeasurement`'s calibrate branch now calls it whenever `calibrateAskAfterDraw` is on (default) or the reference-length box is empty/invalid, and the shared `applyMeasuredCalibration(pixelDist, mm, allPages)` does the actual work. Unticking "Draw first, then type the length" in the panel restores the old type-first flow (the panel then shows the Reference Length box again).
- **Sticky "Apply to ALL pages".** The checkbox is re-rendered every time the properties panel refreshes, so the truth now lives in `calAllPages` (`_calAllPagesState()` / `setCalAllPages()`); it no longer silently unticks itself after a calibration.

**Verified.** Calibrate dialog appears on the second click of the click-click line, preview tracks unit change (10 m → 1:94 on the test sheet), tool stays `calibrate` afterwards, `setCalibrateAfterTool('measure')` switches to `measure` instead, custom 1:75 applies and is remembered, measure label draws with no `labelColor` (→ white). Table: place → edit → apply → drag (dx/dy exact) → corner resize (`legendScale` 1 → 1.62) → double-click reopens with content intact.
- **Harness gotcha (new).** Re-fetch `#annotation-canvas`'s bounding box after anything that opens the properties panel — the canvas shifts left and a stale box makes every synthesised click miss. Also: measure/calibrate/line/arrow/dimension are **click-click**, not drag — a `mouse.down/move/up` never fires them.

### v3.9.1 — Sequence labels were red-on-red (6 Aug 2026)
- **Symptom (James).** Every label the Sequence (numbered labels) tool drops ("Door 01", "Door 02"…) came out as a solid red block — the text and the box behind it were the same colour, so the number was unreadable.
- **Cause.** `addSequenceLabel()` built its text annotation with `boxFill: true, fillColor: '#FFFFFF'`, but `drawTextAnn()` assigns `ann.boxFill` **straight to `ctx.fillStyle`** — it expects a colour string, and `fillColor` is only used by shape annotations. Canvas silently rejects an invalid `fillStyle`, so the assignment was a no-op and the box was painted with whatever `fillStyle` was already set — which two lines earlier was `ann.color` (redline red `#E5432E`). Hence red text on a red box. Nothing else in the app sets `boxFill` to a boolean (the Properties → Appearance picker always writes a hex string), so only the Sequence tool was affected.
- **Fix.** (1) `addSequenceLabel()` now sets `boxFill: '#FFFFFF'` (keeps `fillOpacity: 85`). (2) New helper `_textBoxFillColor(ann)` normalises a legacy non-string `boxFill` to `ann.fillColor || '#FFFFFF'`, used by both `drawTextAnn()` and the Properties → Box Fill row — so labels in already-saved files repair themselves on open instead of staying red blocks, and the colour picker no longer opens on a bogus value.
- **Verified (Playwright, real page).** Rendered the exact legacy annotation object through `drawTextAnn` onto a black test canvas and sampled a pixel inside the box, off the glyphs: v3.9 → `rgb(195,57,39)` (the red text colour), v3.9.1 → `rgb(217,217,217)` (white at 85%). Both inline `<script>` blocks pass `node --check`.

### v3.10 — stamps can be resized and made see-through (11 Aug 2026)
- **Request (James).** "Stamps, need ability to change size, and change transparency." Until now a stamp was a fixed 18px bold Arial box at a hard-coded `ctx.globalAlpha = 0.85` — no way to make it bigger for an A1 sheet or fainter so the drawing underneath still reads.
- **Data model.** Two new (optional) properties on a `type:'stamp'` annotation: **`stampScale`** (1 = the original size; clamped 0.2–12 by `stampScaleOf()`) and **`opacity`** (percent, the same property every other markup already uses). Everything scales together — font `18 * sc`, horizontal padding `20 * sc`, box height `28 * sc`, border `2 * sc` — so a 300% stamp looks like the 100% one, just bigger. Constants `DEFAULT_STAMP_OPACITY = 85`, `STAMP_BASE_FONT/PAD/H` sit next to `drawStampAnn`.
- **Backwards compatible.** Old saves have neither property: `stampScaleOf` returns 1 and `drawStampAnn` falls back to `DEFAULT_STAMP_OPACITY` (85), which is exactly the pre-v3.10 look. Note `drawAnnotation` already sets `ctx.globalAlpha = ann.opacity/100` before dispatching, and `drawStampAnn` re-assigns (not multiplies) the same value — the 85 default has to live in the draw function, not in `drawAnnotation`, or legacy stamps would jump to fully solid.
- **Measured box cached at draw time.** `drawStampAnn` now stores `ann._stampW` / `ann._stampH` (transients, stripped in `_annotationsForSnapshot`), and `stampBoxOf(ann)` returns them — falling back to the old character-count estimate before the first draw. `hitTest`'s `case 'stamp'` uses it, so clicking a big stamp works anywhere inside its real box (it used to use the hard-coded 11px-per-character / ±14px estimate and missed everything outside the 100% box).
- **Corner resize.** `getAnnotationHandlePoints` returns 4 corner handles for stamps (TL, TR, BL, BR — same order as legend/table), and `applyResize` rescales `stampScale` from the dragged corner's new width with the OPPOSITE corner pinned. The stamp is centred on `points[0]` (legends are anchored top-left), so the centre is recomputed as `anchor ∓ nw/2` rather than assigned directly — that's the one real difference from the legend/table branch it's modelled on. Cursor feedback added for the 4-corner types (`stamp`/`legend`/`table` → `nwse`/`nesw`/`nesw`/`nwse`).
- **UI.** Properties (stamp selected): **Size** slider 25–500% + an exact **Size %** number box (accepts up to 1200) that stays in step with the slider, a **Reset** button (`resetStampSize()`), a **Transparency** slider, and **Use as default for new stamps** (`useStampAsDefault()`). Stamp TOOL panel: the same Size / Transparency sliders, which set the defaults applied by `addStamp` to every new stamp. Defaults persist in `localStorage['bdm-stamp-prefs']` as `{scale, opacity}` (`loadStampPrefs` / `saveStampPrefs`, `stampDefaultScale` / `stampDefaultOpacity`).
- **Vocabulary note.** The stamp + signature sliders are labelled **Transparency** (0% = solid) because that's how James asked for it, while the stored value stays `ann.opacity` (100 = solid) like every other markup — the slider handlers convert with `opacity = 100 - transparency`. Don't "fix" one to match the other without changing both the label and the handler.
- **Signature stamps** got a Transparency slider too (`prop-sig-transparency`). No renderer change was needed — `drawAnnotation` already applied `ann.opacity`; it simply had no control exposed.
- **Panel refresh after a drag.** Mouse-up on a stamp resize now calls `openPropertiesPanel()` (previously only measurements did), otherwise the Size % box keeps showing the pre-drag figure.
- **Verified (Playwright, real page, CDN routed to local pdf.js 3.11.174 / pdf-lib).** Pure-render checks on an offscreen canvas: 200% doubles both dimensions exactly; border pixel darkens solid → 85% → 20% in order; hit-test hits a 300% stamp 4px inside its right edge and correctly misses at 100%; 4 handles land exactly on the drawn box; BR drag → `stampScale` 2.00 with TL pinned, TL drag → 0.50 with BR pinned; transients stripped from the snapshot. Panel checks: sliders/number box/labels populate from the annotation, drive `stampScale`/`opacity`, clamp at 1200%, Reset and Use-as-default work, tool-panel sliders persist to localStorage and `addStamp` picks them up. End-to-end on a real PDF: click-place → select → drag BR handle (scale 1 → 1.99, panel updates to 199%) → transparency slider → JSON round-trip preserves both. Both inline `<script>` blocks pass `node --check`.

### v3.11 — autosave & crash recovery, corner snap, Room Fill gap closing (11 Aug 2026)
James asked "what should I build next?" and picked autosave/crash-recovery plus snapping/dynamic-fill from a shortlist. Snap-to-content and Room Fill already existed (added quietly in the v3.x shell work), so those two became targeted UPGRADES rather than new tools. All verified with Playwright against the real page (CDN routed to local pdf.js 3.11.174 / pdf-lib); both inline `<script>` blocks pass `node --check`.

**1. Autosave & crash recovery (new).**
- Every 30s — and ~8s after the last edit (`autosaveSweepSoon()` hooked into `saveToHistory`) — each document with unsaved markups is backed up to IndexedDB (`datum-autosave` db): PDF bytes in a `bytes` store, project JSON (annotations via the shared `_asStripAnn` transient-stripper, calibrations, measurements, countGroups, viewports, currentPage) plus a job-level takeoff snapshot in a `meta` store. Bytes are only rewritten when the `currentPdfBytes` REFERENCE changes (page ops / open), so routine sweeps write only the small JSON. Also sweeps when the tab goes hidden (`visibilitychange`) — a backgrounded tab can be killed by the OS without warning.
- **Records are deleted the moment they stop representing possible loss:** on successful save (`writeSavedBytes` → sweep sees `docModified=false`), on deliberate close (`closeDoc` deletes before the splice — covers "Close Without Saving", which is an explicit user choice), and a belt-and-braces pass drops any record of this session whose doc no longer exists.
- **Liveness via localStorage heartbeats** (`datum-as-hb-<sessionId>`, 20s pulse, stale after 90s): IndexedDB is shared across windows, so the pop-out window's live documents must not look like crashed ones. `pagehide` clears the heartbeat → after a normal force-close the leftover records are offered IMMEDIATELY on next open; a hard crash never runs pagehide and the heartbeat simply goes stale.
- **Startup:** `autosaveStartupCheck()` (900ms after DOMContentLoaded) lists records from dead sessions and shows a branded `showModal` "Recover unsaved work?" with filename + backup time rows; Restore replays each record through `loadPdf(bytes)` then lays the project JSON over the top (mutating the live arrays IN PLACE — the `openDocs` entry holds references to the same globals, reassignment would desync them), merges takeoff via `mergeTakeoffIntoJob` (skipped when a workbook is master), `saveToHistory()` (re-arms ● + a fresh backup), `captureActiveDocState()`. Discard deletes the records. PDFs > 150MB are skipped with a one-time toast.
- Verified: dirty doc → record with correct project JSON + bytes; save → record gone; simulated crash (heartbeat killed, page closed) → prompt on next open → restore rebuilt 2 annotations + 1:100 calibration with `docModified=true` → stale record cleaned up.

**2. Content snap now prefers CORNERS, LINE ENDS and INTERSECTIONS.**
- **Problem:** `snapPageToContent` snapped to the NEAREST dark pixel, and when measuring along a wall the nearest ink is always the wall's flank — you could never land on the corner you were aiming for.
- **Fix:** the patch is binarised into an ink mask and every candidate within a corner-magnet radius (`rC = 1.8r + 2` — corners get more reach than plain edges) is classified by a 16-point sampling ring (radius 4px): 1 short dark arc = line end; 2 arcs = mean arm directions compared — `dot > -0.5` (bent < ~120°) = corner, opposite arms = straight line (skip); 3+ arcs = junction; all-dark ring = interior of thick ink (skip); no dark = isolated dot/tick (snap to it). Nearest corner-class pixel wins; otherwise nearest ink within the ORIGINAL radius edge-snaps as before. **The `-0.5` dot threshold is deliberate:** the pixel grid skews arc directions by up to ~22° on a line's flank, which fakes a ~135° bend — a `-0.75` threshold misclassified every straight edge as a corner (caught by the control test).
- `lastSnapHit.type === 'corner'` draws a square+circle indicator (existing types: square = markup endpoint, diamond = midpoint, circle = content edge).
- Verified: probe near an L-corner (closer to the flank than the corner) snaps to the corner with `corner:true`; probe on a straight run stays an edge snap.

**3. Room Fill (magic area) — gap closing, leak detection, big-page downsampling.**
- **Gap closing** (James can tune it: new Room Fill tool panel → "Gap closing" select, persisted in `localStorage['bdm-magicarea-gap']`, default Small): `MAGIC_GAP_PT = {off:0, small:1.5, medium:4, large:10}` page points. A two-pass city-block distance-to-ink transform `D` virtually thickens every line — pixels with `D <= gapW` count as wall during the flood fill, sealing hatch gaps, line joins and (on Large) door openings. Afterwards the filled region is grown BACK out through the collar (BFS, `gapW` steps, never through real ink) so the traced outline still runs to the true wall face and the AREA is unchanged — verified: an 8px wall gap, outline still within ±6px of the inner wall faces.
- **Leak detection replaces the pixel-count bail:** if the fill touches the sheet edge the room isn't enclosed → toast suggesting a bigger Gap closing setting. (The old `MAGIC_AREA_MAX_PIXELS` bail stays as a safety net only.)
- **Downsampling:** when the rendered canvas exceeds ~4M px (high zoom + retina), the fill works on an s× reduced grid — ink is "max-pooled" (any ink in an s×s block marks the block) so thin walls survive. Fixes the spurious "room is huge" abort at high zoom. Coordinates map back via `(p*s + s/2)/factor`.
- **Click forgiveness:** clicking on/near a line (or inside the gap-closing collar) now hunts for the nearest open pixel within `gapW+3` instead of refusing.
- Verified: gap-off fill correctly refuses (leak detected); gap-medium seals the gap and measures to the wall face; tool panel renders the Gap closing control.

**Deploy note:** files saved to BOTH `C:\Git Hub\bdm-pdf-tool` (deploy source of truth — James commits + pushes) and the OneDrive project folder, per the standing instruction.

---

### v3.12 — one arrowhead size across the whole app (12 Aug 2026)

**Reported by James:** "The arrow tool produces a different size arrow to the callout text with arrow tool. It'd be good if these were the same size."

**Cause:** three separate places each hard-coded their own arrowhead geometry, and they had drifted apart:

| Drawn by | Head length | Half-angle | Style |
|---|---|---|---|
| `drawArrowShape` (committed Arrow) | 15 | `Math.PI/6` (60° included) | filled triangle |
| Arrow drag preview (in `drawInProgress`) | 12 | `Math.PI/6` | stroked open "V" |
| `drawCalloutAnn` leader head | 10 | `Math.PI/7` (~51° included) | filled triangle |

So a callout head measured 8.7 × 9.0 page units against the arrow tool's 15 × 13.0 — about a third shorter and visibly narrower. An arrow and a callout pointing at the same detail read as two different tools.

**Fix:** two module-level constants declared immediately above `drawArrowShape`, and all three call sites now read from them:

```js
const ARROWHEAD_LEN  = 15;         // page units, tip back to the barbs
const ARROWHEAD_HALF = Math.PI/6;  // half the included angle
```

- `drawCalloutAnn` head: `hl = 10` → `ARROWHEAD_LEN`, `Math.PI/7` → `ARROWHEAD_HALF`.
- Arrow drag preview: `headlen = 12` → `ARROWHEAD_LEN`, and it now draws the same CLOSED, FILLED triangle the committed arrow gets (`closePath()` + `fillStyle = toolProperties.color` + `fill()`) instead of two stroked barbs — so what you drag is what you drop. The preview's `setLineDash([4,4])` doesn't affect a fill, so no dash reset was needed.
- **Deliberately NOT changed:** `drawDimensionAnn` keeps its own smaller `al = 8` head. Dimension arrows are conventionally smaller than annotation arrows and sit between extension lines; matching them to 15 would crowd short dimensions. If James ever wants them unified too, that's the third call site.

**Why constants rather than editing three numbers:** this exact drift is how the bug happened. Any future resize is now one edit in one place, and a new arrowhead-drawing site has an obvious thing to reference.

**Verified:** head geometry computed off-canvas for both tools at horizontal, reversed and diagonal leader angles — all return an identical 15.000 wide × 12.990 long triangle (old callout: 8.678 × 9.010). Both `<script>` blocks extracted and `node --check`ed clean. `APP_VERSION` bumped `v3.11` → `v3.12`.

**Deploy note:** saved to BOTH `C:\Git Hub\bdm-pdf-tool` (deploy source of truth — James commits + pushes) and the OneDrive project folder, per the standing instruction.

---

### v3.13 — text boxes shrink properly, resizable arrow heads, Text Color actually works (13 Aug 2026)

**Reported by James (three things in one message):**
1. "The text box can't reduce in size to a point, ie at size 8 text it won't go any thinner."
2. "I can't adjust size of the arrow head."
3. "When I add a text box it has text colour and appearance colour in properties but text colour doesn't work (you need to change appearance colour). Appearance colour should be the text box outline if you want to add one — maybe call it Outline not Appearance."

---

#### 1. Text / callout boxes wouldn't shrink

**Cause:** the resize floor was a flat literal, unrelated to the font. `applyResize` passed `minW = 30, minH = fs + 2` for text and `minW = 30 + pad*2, minH = fs + 3 + pad*2` for a callout, and the callout's `pad` was a hard-coded `6`. At 8pt text that's a 30-unit floor for text (~4 characters) and a 42-unit floor for a callout — the box hit a wall long before it looked tight. The typed Box W×H inputs enforced the same thing (`min="30"` / `min="10"`, and the bind rejected anything under 30/10 back to "auto").

**Fix — two new helpers next to the arrowhead constants:**

```js
function BOX_MIN(fontSize) { return Math.max(4, Math.round((fontSize || 14) * 0.6)); }
function calloutPad(ann)   { return Math.max(2, Math.round(((ann && ann.fontSize) || 12) * 0.5)); }
```

- `BOX_MIN` replaces the literal floors in BOTH branches of `applyResize` (text and callout) and in the `prop-boxw` / `prop-boxh` binds and `min=` attributes. 8pt → 5 units, 14pt → 8 units.
- `calloutPad` replaces every hard-coded `6` in the callout path: `drawCalloutAnn`, `applyResize`'s callout branch, `showCalloutTextInput` and `editTextAnnotationInline` (the last two also set `overlay.style.padding` explicitly so the WYSIWYG editor from v3.7 still lines up — `.callout-edit` CSS hard-codes `padding:6px`, which is now overridden per-annotation).
- **`fontSize: 12` still returns exactly 6**, so every callout ever drawn (default 12pt) is pixel-identical. Verified: a 12pt callout's `_annBox` is byte-for-byte the same as v3.12's; an 8pt one goes 75×23 → 71×19.
- Font size inputs (`prop-fontsize`, `tool-fontsize`) dropped `min="8"` → `min="4"` as well, covering the other reading of "won't go any thinner".

Measured floors: text 30 → 5 wide, 10 → 5 tall; callout 42 → 13 wide, 23 → 13 tall (at 8pt).

#### 2. Arrow head size is now per-annotation

v3.12 unified the head at `ARROWHEAD_LEN = 15` but left it a constant. v3.13 adds an **`ann.arrowScale` multiplier** on top, read through one accessor so all three call sites stay in step:

```js
function arrowHeadLen(ann) {
  const v = parseFloat(ann && ann.arrowScale);
  const sc = (isFinite(v) && v > 0) ? Math.max(0.2, Math.min(6, v)) : 1;
  return ARROWHEAD_LEN * sc;
}
```

- `drawArrowShape` and `drawCalloutAnn` call `arrowHeadLen(ann)`; the drag preview calls `arrowHeadLen({arrowScale: toolProperties.arrowScale})` so the preview matches what you'll drop.
- **`undefined` → scale 1**, so nothing drawn before v3.13 changes. Verified: arrow and callout at default both measure 49 × 15 px on canvas, identical to v3.12.
- UI: Properties → Appearance gains an "Arrow Head" slider (20–400%) + exact "Head %" box (20–600%) + Reset, on `arrow` AND `callout`. The Arrow and Callout **tool** panels gain an "Arrow Head %" default (`toolProperties.arrowScale`), baked onto the annotation at creation so changing the default later doesn't resize arrows already on the page.
- `drawDimensionAnn` still keeps its own smaller `al = 8` head — same deliberate exclusion as v3.12.

#### 3. Text Color did nothing; Appearance Colour was the real one

**Cause:** `drawTextAnn` set `ctx.fillStyle = ann.color`. The panel's "Text Color" swatch bound to `ann.textColor`, which `drawTextAnn` never read — only `drawCalloutAnn` did (`ann.textColor || color`). So on a plain text box the labelled control was dead and the generic Appearance → Colour was doing the job.

**Fix:**
- New `_textInkColor(ann)` = `ann.textColor || ann.color || '#E5432E'`, used by `drawTextAnn` for the glyphs, the underline stroke, and the colour restored after the box fill; `editTextAnnotationInline` uses it too so the inline editor matches. **`ann.color` stays as the fallback** — text written before v3.13 has no `textColor` and renders exactly as it always did (verified pixel-identical).
- New text annotations get `textColor: toolProperties.color` alongside `color`, so both agree from birth.
- **Appearance for `type:'text'` no longer shows a bare "Colour" row.** It shows **Outline:** — a checkbox + colour picker writing `ann.boxStroke`, which `drawTextAnn` strokes around the box at `ann.thickness` when set. Off unless set, so no existing text gains a border. The box rect is now computed ONCE and shared by the fill, the outline, `_annBox` (hit-test) and the resize handles, instead of being recalculated inside the fill branch.
- Callout's Appearance row is relabelled **"Leader/Border"** with a tooltip, since for a callout that colour genuinely is the leader + arrow head + border (its Text Color already worked).
- The Text **tool** panel's "Colour" is relabelled "Text Colour" for the same reason.

**Vocabulary trap for this file, now three deep:** `boxFill` = the text box's fill colour, `fillColor` = a shape's fill colour (v3.9.1), and now `boxStroke` = the text box's border colour while `color` is the legacy text-ink fallback. Don't cross them.

**Verified:** control-first Playwright, old build vs new, rendering annotations onto an offscreen canvas (the `drawTextAnn`-is-on-window shortcut) plus a real end-to-end run — blank PDF served over local http, CDN routed to local npm `pdfjs-dist@3.11.174` / `pdf-lib`, text placed, resized and recoloured through the actual Properties panel. Results: Text Color red → blue in the pixels (old build stayed red); legacy `color`-only text byte-identical; outline pixel present only with `boxStroke`; heads 15/30/7.5 at 100/200/50%; arrow and callout equal at 100%; text box floor 30 → 5; callout floor 42 → 13; 12pt callout box unchanged; `_annBox` still stripped from the save snapshot; zero page errors. Both `<script>` blocks `node --check` clean. `APP_VERSION` bumped `v3.12` → `v3.13`.

**Deploy note:** saved to BOTH `C:\Git Hub\bdm-pdf-tool` (deploy source of truth — James commits + pushes) and the OneDrive project folder, per the standing instruction.

---

### v3.14 — locked PDFs that use compressed object streams now open (17 Aug 2026)

**Symptom James hit:** an Acrobat-produced, permissions-locked supplier quote (`EEP_Quote_794_SIGNED_Acceptance_20260723.pdf`) died on open with the branded dialog **"Error loading PDF: Invalid Root reference."** No password prompt appeared — the file has an owner (permissions) password with a blank *user* password, so v3.5's decryptor unlocked it silently and then handed pdf.js a broken rebuild.

**Cause — the rebuild dropped every object stored inside an `/ObjStm`.** `rebuild()` scans the raw file for `N G obj` headers, re-emits each object, then writes a **classic `xref` table + trailer**. PDF 1.5+ writers (Acrobat above all) pack ordinary objects — page tree, Info, often most of the Catalog's children — into compressed **object streams**, reachable only through a cross-reference *stream*'s type-2 entries. Those objects have no `N G obj` header anywhere in the file, so `offsets[n]` stayed `undefined` and the classic xref marked them **free**. In James's file objects **20–29 came out free**, including `28 0 R` — the `/Pages` the Catalog points at. pdf.js resolves `/Root` → catalog with no reachable `/Pages` → `InvalidPDFException: Invalid Root reference.`

**Scope was much wider than one file.** Old build vs new across a purpose-built matrix: **every** encrypted PDF written with object streams failed — RC4-40, RC4-128, AES-128, AES-256, user-password and owner-password alike. Only the "flat" (no-ObjStm) variants worked, which is exactly how v3.5's original pikepdf test files were written — that's why it shipped green. Modern writers use object streams by default, so in practice most locked PDFs were affected.

**Fix (all inside the decryptor `<script>`):**
- New `expandObjStm(dictText, decryptedBytes)` — inflates the bundle, reads `/N` + `/First`, parses the `num offset num offset …` pair table and returns `[{num, body}]`. Bails to `null` (caller then leaves the bundle untouched, i.e. old behaviour) on any exotic filter, a `/Predictor`, a malformed pair table or out-of-range offsets.
- New `inflateFlate(data)` — `DecompressionStream` (`deflate`, falling back to `deflate-raw`) piped through `Response.arrayBuffer()`. **Keeps the file dependency-free** — no zlib, no library. Browser-verified in Chromium.
- `rebuild()`'s stream branch: an `/ObjStm` is replaced by `null` and its contents written out as ordinary top-level objects, each recorded in `offsets`. **Strings inside an object stream are covered by the stream's own decryption — do NOT run `decryptStringsInDict` over them again.**
- Cross-reference **streams** (`/Type/XRef`) are now emitted as `null` too, instead of being carried over verbatim. They're dead weight once a classic xref is written, and a stale one still carrying `/Encrypt` was making **pdf-lib** report the rebuilt file as *still encrypted* — a second, quieter symptom of the same bug (it broke Save, not just Open).
- New `extraMax` tracks unpacked object numbers so the trailer's `/Size` covers objects that only existed inside a bundle.

**Verified:** 11-case old-vs-new matrix (RC4-40 / RC4-128 / AES-128 / AES-256 × objstm / flat, plus a user-password file, plus an unencrypted ObjStm file that must pass through untouched, plus James's real quote). New build: all 11 open in `pdfjs-dist@3.11.174` **and** re-save through pdf-lib, with **extracted text byte-identical** to a pikepdf-decrypted reference. Old build: all 5 objstm-encrypted cases threw `Invalid Root reference.` Then a real Chromium end-to-end on the actual page (served over local http, CDN routed to local npm copies): `datumDecryptPdf` → 2 pages in both engines for RC4-40 / AES-256-objstm / RC4-128-flat, and the full `loadPdf()` path on James's quote renders 44,520 dark pixels on the page canvas with **zero `datumAlert`s and zero page errors**. `APP_VERSION` bumped `v3.13` → `v3.14`.

**General lesson for this codebase:** a rebuild that writes a classic `xref` must first flatten every `/ObjStm` — a classic table cannot address an object living inside a compressed bundle. And when building encryption test fixtures with pikepdf, always generate **both** `ObjectStreamMode.generate` and `.disable` variants; the flat-only corpus is what let this ship green in v3.5.

**Deploy note:** saved to BOTH `C:\Git Hub\bdm-pdf-tool` (deploy source of truth — James commits + pushes) and the OneDrive project folder, per the standing instruction.

### v3.15 — BOQ Report: every measurement printed with a snippet of where it sits on the plan (18 Aug 2026)

**What James asked for:** "a PDF print version where each of the measurements in the bill of quantity are shown with a corresponding snippet of the image … everything for one item shown under that total with the screenshot of each image and where it sits on the plans."

**Shape chosen (James picked from a shortlist):** one snippet per row, LARGE (≈2 per A4 page); every include-option is a checkbox in the dialog rather than baked in; entry point is the top menu — added BOTH a `Document ▸ BOQ Report… PDF` menu item and a `BOQ` topbar button next to `Report`.

**Implementation — almost entirely reuse, no new arithmetic.**
- **Quantities** come from the existing takeoff engine. The per-measurement figure is `computeTakeoffQty(item, (a2, di) => a2.id === sh.a.id && di === sh.docIdx)` — the same function that produces the item total, run with a single-shape `shapeFilter`. That means deduction signs, per-shape `takeoffFactor` overrides, per-page/viewport calibration and unit conversion are guaranteed to agree with the Takeoff panel; there is no second implementation to drift.
- **Snippets** reuse the Markup Report's render-page-once-then-crop trick (`intent:'print'`, `annotationMode: 1` — see v3.6; mode 0 would drop annotations baked into the source file).
- **Trade order** comes from `buildTakeoffTree()`, walked into flat `[{key, items}]` groups so trade headings, subtotals and the grand total all follow the panel's own hierarchy.

**New functions** (inserted immediately before the `COMBINE PDFs` section): `openBOQReport()` / `executeBOQReport()` / `_boqBuildSnippets()` / `_boqDocSnapshots()` / `_boqShortName()` / `_boqPrefs()` / `_saveBoqPrefs()`, plus constants `BOQ_PAPERS`, `BOQ_SNIPPET_H`, `BOQ_PREF_KEY`, `BOQ_PREF_DEFAULTS`. Prefs persist in `localStorage['bdm-boq-report-prefs']`.

**Options:** rates & amounts · trade subtotals + grand total · assembly sub-items · flag deductions · summary table at the front · plan snippets on/off · ring the measurement in its snippet · skip items with no measurements (manual entries always kept — they have no shapes by design) · current document only · snippet size (large/medium/small) · paper (A4 portrait / A4 landscape / A3 landscape).

**The cross-document trap — `_boqDocSnapshots()` exists for a reason.** The takeoff is JOB-level (v2.8): `allTakeoffShapes` / `computeTakeoffQty` walk every open document through `_eachTakeoffDocState`, which swaps the `annotations` / `pageCalibrations` / `defaultCalibration` / `viewports` globals and restores them in a `finally`. That helper calls its callback **synchronously**, so *any* `await` inside it (and rendering a page is all awaits) resumes AFTER the restore and would bake the wrong document's markups. Fix: capture every doc's state (plus its `pdfDoc`, which `openDocs[i]` already carries) up-front into a plain map, then swap the globals by hand around the **synchronous** `drawAnnotation` bake only. `openDocs[i].pdfDoc` is the per-tab pdf.js document — that is what makes snippets from other open drawings possible at all.

**Cropping rules learned from the first render:**
- Padding is `max(28pt, 35% of the shape's own width/height)` so a big area gets proportionally more context than a door tag.
- Minimum crop **300 × 200 page points** — the first cut used a pixel-based minimum and counts came out uselessly zoomed.
- **Minimum aspect 1.45.** Without it a tall wall run cropped as a thin ribbon and printed as a sliver down the left of an otherwise empty row; widening the crop to at least 1.45:1 makes every snippet fill the width of its row.
- Page render scale `min(3, 4800 / longest side)` — sharp enough to enlarge a small crop, capped so an A1 sheet can't blow the canvas (~16M px worst case, one page held at a time). Output JPEG capped at 1500 px on the long edge, quality 0.82.
- `need(46 + min(maxImgH,130))` before an item header so an item never strands its heading alone at the foot of a page.

**Also fixed here:** `_winAnsiSafe` now maps U+2212 MINUS SIGN to ASCII `-`. Deduction labels are written with a real minus, so every deduction caption was printing `?18.67m²`. This helper is shared with the Markup Report, so that one benefits too.

**Verified** with real Chromium end-to-end on the served page (CDN routed to local `pdfjs-dist@3.11.174` + `pdf-lib`, hand-built 2-page landscape test plan): a 4-item / 3-trade estimate spanning both sheets with length (vertical, with a per-shape height override), area (including a deduction), count and manual items → 5-page report, 276 KB, 7 snippets, zero page errors and zero alerts; extracted text confirms per-shape quantities, negative deduction rows marked DEDUCT, trade subtotals and a grand total that matches the panel. Second run with money / summary / snippets off and A3 landscape produced a clean quantities-only issue. Both inline `<script>` blocks pass `node --check`. `APP_VERSION` bumped `v3.14` → `v3.15`.

### v3.15.1 — BOQ snippets show only the measurement they belong to (18 Aug 2026)

**James, on the first v3.15 output:** "the images show all markups, not just the markup of the measure in question on each image." On a real architectural sheet with dozens of measurements stacked over each other, a snippet that bakes every markup is unreadable — you cannot tell which line the 1.24 m row is about.

**Cause:** v3.15 copied the Markup Report's approach — render the page once with ALL Datum markups baked in, then crop. That is right for a page-grouped report and wrong for an item-grouped one, where the whole point of the snippet is to isolate one shape.

**Fix:** the page canvas is now the CLEAN plan (source-PDF annotations only, `annotationMode: 1`), and Datum's markups are baked **per snippet, onto the crop canvas**, after the clean region is drawn in. New transform maps page points straight into crop pixels: `cx.setTransform(scale*s2, 0, 0, scale*s2, -x0*s2, -y0*s2)`. Still one `page.render` per sheet — only the (cheap) annotation draws repeat.

**New option `Each snippet shows`** (`opts.show`, persisted in the prefs blob, default `only`):
- `only` — just the measurement for that row (default);
- `faded` — that measurement solid, every other markup at 22%;
- `all` — v3.15's behaviour.

**Gotcha worth remembering:** you cannot fade markups by setting `tctx.globalAlpha` before calling `drawAnnotation` — `drawAnnotation` assigns its own `ctx.globalAlpha` from `ann.opacity` (default 1) and clobbers it. The faded mode therefore draws the other markups to a same-size offscreen canvas first, then composites that canvas at `globalAlpha 0.22`. Same trap would bite any future "ghost/onion-skin" feature.

**Refactor:** the globals swap is now `_boqWithDocState(snap, fn)` — one place that sets `annotations`/`pageCalibrations`/`defaultCalibration`/`viewports` + `isBakingAnnotations` and restores in a `finally`. It takes a SYNCHRONOUS callback only; putting an `await` inside it re-introduces the v3.15 cross-document bug.

**Verified** with a deliberately cluttered fixture — 30 unrelated markups (measures, texts, rectangles) laid directly over the reported shapes — generating the same report in all three modes: 214 KB / 377 KB / 486 KB for only / faded / all, and visual check confirms `only` draws the single green area over an otherwise clean plan while `all` reproduces James's screenshot. `APP_VERSION` → `v3.15.1`.

### v3.15.2 — choose which estimate items print in the BOQ Report (18 Aug 2026)

**James:** "in the BOQ report print screen, allow option to choose which items in the takeoff print (currently it prints all)."

**UI:** a new **Items to print** box at the top of the BOQ Report dialog — a scrolling checkbox tree grouped by trade, in the exact order the report prints. Each trade row toggles its own children and shows an *indeterminate* tick when only some are on; a live `n of N selected` counter sits in the section header next to **All** / **None** links. Colour swatch and unit are shown against each item so two similarly-named lines are distinguishable.

**Plumbing:** the tree-flattening walk that the report used was extracted into `_boqGroups()` and is now shared by the picker and the builder — the tick boxes and the printed sections are generated from the same list, so they cannot fall out of step. New helpers: `_boqItemPickerHTML(excluded)`, `_boqItemBoxes()`, `_boqToggleTrade(gi)`, `_boqSetAllItems(on)`, `_boqSyncPicker()`. `executeBOQReport` reads the ticked ids before closing the modal, refuses with a toast if none are ticked (modal stays open), and skips unticked items in the gather loop — so trade headings, subtotals, the summary table and the grand total all reflect only what actually prints.

**Persistence:** the UNTICKED ids are stored (`prefs.excluded`) rather than the ticked ones, so any item added to the estimate later defaults to ON. The counter in the header is what makes a remembered exclusion visible instead of mysterious.

**Verified** end-to-end: picker renders 4 items / 4 trades and reports `4 of 4 selected`; unticking a whole trade plus a manual item leaves `2 of 4` and the generated PDF contains only those two items, with both trade headings, subtotals and the grand total recomputed ($12,893.50 vs $27,293.50); reopening the dialog restores `2 of 4`; ticking nothing refuses to generate and leaves the modal open; a trade holding two items shows `indeterminate` on its head box when only one child is on. `APP_VERSION` → `v3.15.2`.

### v3.16 — workbook docks left, and crosshair guides (18 Aug 2026)

Two James requests in one message: "the workbook is currently fixed to the bottom of the page, add option to add to left so you can see full list of BOQ and drawings at the same time" and "add a option to add vertical and horizontal lines to a pointer so you can line up with drawings easier."

**1. Workbook dock: bottom (default) or left.**

The dock is the SAME element in both positions — only its parent, one class and which dimension it sizes change. `#workbook-home` is an empty hidden marker left in the bottom slot; `setWorkbookDock('left')` moves `#workbook-dock` to `main.firstElementChild`, `setWorkbookDock('bottom')` puts it back immediately after the marker. Position persists in `localStorage['bdm-workbook-dock']`, and the two axes keep SEPARATE saved sizes (`bdm-workbook-w` / `bdm-workbook-h`) so flipping back and forth doesn't destroy either.

`.dock-left` CSS: `width: 380px` (min 220, max 70vw), `height: auto !important`, `border-right` instead of `border-top`. The resizer becomes `position:absolute; right:0; top:0; bottom:0; width:5px; cursor:ew-resize` — the drag handle has to be the RIGHT edge on the left dock and the TOP edge on the bottom dock, and `wireWorkbookResizer` now captures which one at mousedown (`from.left`) rather than reading the class mid-drag. The workbook toolbar is one long row built for a full-width dock, so left mode adds `flex-wrap: wrap` and hides the `.separator` / `.topbar-spacer` elements (a `flex:1` spacer inside a wrapping row throws everything onto its own line).

Entry points: a `▯ Dock left` / `▭ Dock bottom` button in the workbook toolbar, and `View ▸ Workbook Position (bottom / left)` — the menu item also opens the workbook if it was closed, since otherwise it appears to do nothing.

Interaction with the tool rail: `applyRailDock` inserts the rail at `main.firstElementChild` when docked left, so with both on the left the order is rail, then workbook, then canvas. That is the wanted order and needed no special-casing.

**2. Crosshair guides (H).**

Two absolutely positioned 1px divs (`#xhair-v`, `#xhair-h`) over `#canvas-area`, moved by a `passive` document `mousemove` handler. DOM overlay, NOT canvas drawing: re-rendering a large sheet's annotation canvas on every mouse move is far too expensive, and this way the guides sit above both the main canvas and the split pane for free. Each line carries `box-shadow: 0 0 0 1px rgba(255,255,255,.5)` so it stays visible over black linework and over dark fills alike. Hidden when the pointer leaves the area, when no document is open, and in the print stylesheet.

**THE TRAP, and why the state class is on the guides:** `#canvas-area.className` is ASSIGNED outright in four places — `setTool` (line ~6639, `className = tool`) and the three space-pan handlers. Any state class parked on `#canvas-area` is silently wiped the moment the user picks a tool or taps Space. The first cut used `#canvas-area.xhair-on .xhair { display:block }` and the guides vanished on the next tool change. The `on` class now lives on the two guide divs themselves. **Anything else that ever wants a persistent class on `#canvas-area` has to solve this too — or those four assignments need converting to `classList` operations.**

Shortcut is **H** — every other letter in the tool-shortcut chain was taken (`x` is Delete Markups, `g` is Highlight). Guarded by `!mod && !e.altKey`, and `onKeyDown` already returns early for INPUT / TEXTAREA / SELECT / contentEditable, so typing "h" in the workbook doesn't toggle it (verified).

**Verified** with Chromium at 1500×950: bottom dock 1500×300 under a 1433×516 canvas → left dock 380×816 beside a 1053×816 canvas (both fully visible at once), resizer relocates to the right edge, drag widens to 560px, position AND width survive a reload, flipping back restores the bottom dock exactly. Crosshair: display none→block on toggle, follows the pointer, SURVIVES a tool change plus a space-pan cycle (the regression that the class-placement fix exists for), H toggles it, a synthetic `h` keydown inside an input leaves it alone, zero page errors. `APP_VERSION` → `v3.16`.

---

### v3.17 — tool rail repacked to two columns; Open/Save/Undo/Redo moved to the menu bar (18 Aug 2026)

James: "the set out of the tool bar is a bit uneven. plus i need to scroll a lot to access all tools, bluebeams tool layout is cleaner. also move the open/save/undo buttons to top bar, the middle bar is getting too full." Note the vocabulary: **"top bar" = `#menubar`** (the File/Edit/View strip), **"middle bar" = `#topbar`** (the icon quick bar). Don't read `#topbar` as the thing he calls the top bar.

**1. The unevenness was a 1px border.** `.tool-group` carried `border-left: 2px solid transparent` (left over from the abandoned per-group colour tints, which the later theme block had already reset to `transparent` / `background: none`). A border on the group narrows its content box, so every grouped button was centred 1px right of the ungrouped Select/Pan pair. Fixed by deleting the border and the dead tint rules outright, and by putting **every** button block — grouped or not — through the same grid, so there is exactly one set of column positions in the rail. Verified: 30 buttons resolve to exactly 2 distinct `left` values.

**2. Two columns, driven by CSS vars.** `#toolbar` now declares `--rail-btn-w: 34px; --rail-btn-h: 26px; --rail-cols: 2; --rail-gap: 2px`, and `.tool-group-body` / the new `.tool-row` are `display: grid; grid-template-columns: repeat(var(--rail-cols), var(--rail-btn-w))`. `--toolbar-width` 66px → 78px. Select/Pan and the bottom Thumbnails button were bare children of `#toolbar`; both are now wrapped in `.tool-row` so they inherit the same grid. Content height **~1150px → 579px** at 1440×900 — the whole kit fits with no scrolling down to a 700px-tall window.

Measuring the rail height is fiddly: `#toolbar` contains a `flex:1` spacer, so `scrollHeight` always equals `clientHeight` and reports "no scroll" even when it overflows. Measure the **bottom of the last real child relative to the rail's top** instead.

**3. Group headings are now a slim full-width row** — red square bullet, mono uppercase name in a `.tg-label-text` span, chevron pushed right with `margin-left: auto`, plus `.tool-group + .tool-group { border-top: 1px solid var(--line) }` as the separator that the deleted tinted blocks used to provide. Collapse/expand and its `bdm-toolgroup-*` persistence are untouched.

**4. Top dock still flattens to one row.** `#toolbar.dock-top` has to override `display: grid` back to `display: flex; flex-direction: row` on BOTH `.tool-group-body` and `.tool-row` — the old rule only said `flex-direction: row`, which does nothing to a grid. Left / top / right all verified.

**5. `Spc` is the one three-character shortcut chip** and it overflowed the narrower button; `.tool-btn[data-tool="pan"] .shortcut` gets `font-size: 6.5px`.

**6. Open / Save / Undo / Redo moved from `#topbar` to `#menubar`**, icons only, sitting just right of the Help menu behind a `.m-sep` hairline (new `#menubar .mb-btn` / `.m-sep` styles). `id="btn-undo"` / `id="btn-redo"` moved with them — nothing in JS references those ids, so nothing else needed touching. The worded entries in `File ▸ Open/Save` and `Edit ▸ Undo/Redo` are unchanged, so the actions are still discoverable by name. `#topbar` now starts at Snap.

**Verified** in Chromium at 1440×900/800/768/700, dark and light: 30 rail buttons on exactly 2 column positions, no rail scrolling, `setTool('rectangle')` still sets `.active` and `#canvas-area.className`, group collapse writes `bdm-toolgroup-shapes=1` and re-expands, `cycleRailDock` walks top → right → left cleanly, the 4 menu-bar buttons carry the right `onclick`s and the menu bar does not overflow, zero page errors. Both inline `<script>` blocks pass `node --check`. `APP_VERSION` → `v3.17`.

---

### v3.18 — colour themes, revision carry-over, auto-count, sheet index & hyperlinks (18 Aug 2026)

James picked four items off the "what next" shortlist (revision carry-over, auto-count, sheet index/hyperlinks — the Tool Chest / price library item was dropped for now) and added: "some colour themes for mark ups (maybe 4-5 standards) so you end up with presentable mark up drawing rather then hodge podge colours … keep manual selection too." Decisions he made up front: themes ASK before recolouring existing markups; revisions replace the page IN PLACE; auto-count ships BOTH text-tag and image matching. All four features live in one new block inserted just before the AUTOSAVE section (`MARKUP COLOUR THEMES` → `REVISION CARRY-OVER` → `AUTO-COUNT` → `SHEET INDEX + HYPERLINKS`), plus small hooks listed at the end. `APP_VERSION` → `v3.18`, file ~17,560 lines.

**1. Markup colour themes** (`Tools ▸ Markup Colour Theme…`, and a "Theme … change…" line under the colour swatches in every themed tool panel).
- A theme is a palette keyed by CATEGORY, not tool: `THEME_CATS` = clouds / shapes (rect, ellipse, line, polygon, polyshape) / arrows & callouts / text / highlighter / pen / lengths & dimensions (measure, polyline, dimension) / areas & room fill. Five presets in `MARKUP_THEMES`: Classic Review (Bluebeam look), BDM Brand (navy `#0E1830`, red `#E5432E`, gold), Muted Presentation, High Contrast, Mono Print; plus Manual (off) and Custom (editing any preset's colour forks it into Custom — the preset itself is never mutated). Persisted in `localStorage['bdm-markup-theme']` = `{active, custom:{colors}}`.
- **The hook is one line in `setTool()`**: `applyThemeToTool(tool)` sets `toolProperties.color` (and `fillColor` when a fill is on) from the palette. Manual choice is preserved via `_themeToolOverride[tool]` — the `tool-color` change listener calls `noteThemeManualColor()`, so a hand-picked colour survives select→tool round trips for that tool until "reset to theme" is clicked. Theme "off" is byte-for-byte the classic single sticky colour (verified).
- `applyThemeToExisting('page'|'all')` recolours markups already on the drawing — but **skips anything with `annTakeoffIds(a).length`** (estimate item colours carry meaning) and never touches counts (group colours), stamps, symbols, ticks. Sets `textColor` on text/callouts (v3.13's `_textInkColor` reads it), `boxStroke` if present, `fillColor` on areas and on filled shapes. Because James asked to be asked, choosing a theme card sets `_themeAskDirty` and the dialog shows a highlighted "Recolour the markups already on the drawing to match? [This page (n)] [All pages (n)] [Leave them]" strip — the counts come from `_themedAnnCount()`.

**2. Revision carry-over** (`Document ▸ Replace Page with Revision…`, thumbnail right-click `Replace with Revision…`, hidden `#rev-input`).
- `executeRevisionReplace()`: pdf-lib `copyPages` from the revision → `insertPage(tgt)` → `removePage(tgt+1)` → `rebuildPdf(base)` + `resetHistoryAfterPageOp()`. Modes: one page (pick which page of the revision, defaults to the same number) or every page page-for-page (only offered when page counts match). Annotations keep their ids, so takeoff links, measurements[] entries and the workbook don't notice. Sheet size mismatch → `_revScaleAnn` scales points/textPos/boxW/boxH/labelOffset (dx,dy) and `pageCalibrations[p].pixelsPerMm` by the same factor.
- **Flagging = the useful bit.** `_revDiff(oldPage,newPage,threshold)` renders both at the same page-space scale (capped 2400px), 16px blocks, mean RGB delta > threshold ⇒ changed block (same maths as Compare Drawings; regions via the existing `clusterBlocks`). A markup is flagged (`ann.needsReview = {rev, at}`) when a changed block's centre lies within `8 + 12` page units of one of ITS SEGMENTS from `_revAnnSegments()` — perimeter for closed shapes, the polyline for lines/measures/pens, an estimated box for text/callout/count/stamp/tick/table. **Not the bounding box** — a long diagonal measure would otherwise be flagged by any change anywhere inside its box. Optional "also cloud the changed areas" drops clouds on a `Revision` layer.
- Review UI: amber dashed halo + "!" badge drawn by `drawReviewBadges()` from `redrawAnnotations()` — **screen only, deliberately NOT inside `drawAnnotation`**, because Markup Report / BOQ Report render through `drawAnnotation` without setting `isBakingAnnotations`, so a badge there would print. Sidebar "Revision Review" list (`openReviewPanel`/`renderReviewPanel`, Go / ✓ Keep / Delete / Keep all) owns `#panel-content` via `reviewPanelOpen`, guarded in `openPropertiesPanel()` exactly like v3.8's `searchPanelOpen`; `_reviewKeepPanel` is set for ~600ms while the list itself jumps to a markup so the resulting selection doesn't bounce the panel back to Properties.
- Verified: fixture floor plan with an internal wall moved 70pt; measure over the OLD wall flagged, measure and count far away NOT flagged, page count unchanged, new bytes, extracted text says "REV A", 3 revision clouds, summary modal, review panel rows, Keep clears the flag. **Test trap that cost 20 minutes:** reading `wall.needsReview` AFTER calling `reviewKeep()` in the same evaluate — the flag was correct, the assertion was late.

**3. Auto-count** (bottom of the Count tool panel: `autoCountPanelHTML()`; `Tools ▸ Auto-count…` just arms Count and focuses the tag box).
- Text: `autoCountByText()` stitches pdf.js text items into baseline runs (`_acRunsForPage`, also reused by the sheet index) because tags come out as separate glyph groups, then whole-word matches the tag (upper-cased; "Whole tag only" excludes D01A / D010). Scope this page / whole document. Markers go into a group named after the tag unless the Group box says otherwise (**leave the Group box blank** — v1 pre-filled it with the active group, which silently dumped "D01" counts into "Default"), get `takeoffTagAnnotation()` like a hand-placed count, and `_acExistingNear()` skips a marker already within 6pt in that group so re-running never double-counts. One `saveToHistory()` per run.
- Symbol: tool `visualsearch` (drag a box round ONE symbol → `onVisualSearchRegion` → `runVisualSearch`, then the tool returns to Count and the panel shows the results box). `_vsPageInk` rasterises a page to a binary ink map (`VS_INK_LUM` 150) at scale S chosen so the sheet ≤ 3400px and the symbol ≥ ~28px, cached per page (`_vsInkCache`, 6 pages). `_vsMatchTemplate`: OR-pooled coarse pass (template ~22px) with an integral-image ink-count pre-filter (skip windows with < 0.5× or > 1.9× the template's ink), Dice on the survivors, then full-res refine ±f px, then NMS at 0.6× template size; templates for 90/180/270 rotations when "Also match rotated" is on, followed by a cross-rotation NMS. **Score = (Dice + recall)/2, default threshold 75%** — plain Dice let a bare circle score 79% against a circle-with-cross GPO symbol; weighting recall (share of the template's own ink present) drops it to 72% while identical symbols stay 99–100%. Candidates ≥55% are kept so the threshold slider re-filters live without re-searching; boxes + % labels are drawn by `drawVisualSearchOverlay()`; "Add N as counts" → `_acAddMarkers` at the box centres.
- Verified: 6/6 GPO symbols found (4 upright, 2 rotated 90°) at ≥75%, both decoy circles at 72%, 5 D01 tags on p1 (decoys excluded), rerun adds 0, whole-document finds the 6th on p2.

**4. Sheet index + hyperlinks** (`Sheets` topbar button, `View ▸ Sheets Panel`, `Document ▸ Sheet Index & Hyperlinks…`).
- Per-document state `sheetLabels` (pageIdx → `{num,title,auto}`), `sheetLinks` (`[{page,x,y,w,h,target,text}]`), `sheetRegion` / `sheetTitleRegion` (fractions of the page) — added to `captureActiveDocState`/`restoreDocState`, reset in `loadPdf`/`closeDoc`, saved in the project JSON and restored on open.
- `buildSheetIndex()`: per page, `_sheetGuess()` scores runs that look like a sheet number (`SHEET_NUM_RE`: letter prefix or dotted form — bare "1000" is a dimension, "A3" is paper) and sit in the title-block zone (right strip / bottom band); bigger text and nearer the bottom-right corner win, "REV…" is penalised. Title = the largest wordy run in the zone that isn't a form label (`SHEET_LABEL_WORDS`) or contains @/www/ABN/long digit strings. When the heuristic misses, "Draw number box" / "Draw title box" (tool `sheetregion`, `pickSheetRegion`, `onSheetRegionDrawn`) reads the same fractional region on every page. Manual renames (`renameSheet`, double-click a row) are marked `auto:false` and survive a rebuild unless `{full:true}`.
- Links: `_sheetBuildLinks` tokenises every run with `SHEET_TOKEN_RE`, normalises separators (`A101` ≡ `A-101`), requires non-alphanumeric neighbours (so "1/A-501" links but "PA-101X" doesn't) and skips self-references. Clicking a hotspot with the SELECT tool (hook in `onCanvasMouseDown` step 2d — markups still win if one is under the cursor) → `followSheetLink` pushes `_sheetNavStack`, **Alt+←** = `sheetNavBack()`; hover shows a pointer via `updateSelectHoverCursor`; `drawSheetLinkOverlay` paints faint blue boxes (toggle in the panel). Thumbnails show `n · A-101`. `resetHistoryAfterPageOp()` now calls `_sheetIndexAfterPageOp()` — a debounced silent full rebuild, since page indices moved.
- **Saved PDFs carry real `/Link` annotations** (`_writeSheetLinksToPdf`, called in `saveProject` just before `outDoc.save()`, `Dest [pageRef /Fit]`, unrotated pages only, mediabox-offset aware, opt-out checkbox persisted in `bdm-sheet-links-save`). Because the output doc is rebuilt from the clean source every save, links don't accumulate. Verified: 5 links in the saved file via pdf-lib, reopening restores 3 labels + 5 links.

**Hooks outside the block** (grep `v3.18`): menus + `#rev-input` + thumb ctx item + topbar Sheets button; `.visualsearch/.sheetregion` crosshair CSS; `toolNames`; `setTool` theme hook; `attachToolListeners` override note; count panel `|| 'visualsearch'` + `autoCountPanelHTML()`; generic panel `themePanelNoteHTML()`; startSnap exclusion list; select 2d link click; `drawInProgress` rect lists + `SHIFT_BOX_TOOLS`; mouseup `case 'visualsearch'`/`'sheetregion'`; `redrawAnnotations` overlays; `openPropertiesPanel`/`setPanelMode` guards; hover cursor; `onKeyDown` Alt+←; doc state capture/restore/reset; project JSON save/load; `saveProject` link annots; `resetHistoryAfterPageOp`; thumbnail label; DOMContentLoaded `loadMarkupThemePrefs()`; shortcuts help.

**Verified** with a 28-check Playwright run against a purpose-built 3-sheet fixture (title blocks, cross-references, 6 GPO symbols incl. rotated + 2 decoy circles, 5 D01 tags + D010/D01A decoys, and a 1-page "Rev A" with a wall moved 70pt): all 28 pass, zero page errors, both inline `<script>` blocks `node --check` clean. Harness notes: `showModal` runs synchronously so `openRevisionDialog()` RESETS `_revFile/_revBytes/_revDoc` — set them after opening; a test markup sitting on top of a hyperlink correctly wins the click (move the fixture, not the code).

### v3.19 — hide / highlight buttons on workbook headings and individual measurements (18 Aug 2026)

James: "currently the hide button and the highlight button only apply to item descriptions, add same function to headings and individual shapes." The 👁/⊘ and ◎/◉ pair now sits on three row kinds in the Estimate Workbook: heading rows (`wb-pkg`, after ＋▱), item rows (unchanged, v3.3/v2.8) and measurement rows (`wb-meas`, after ± / ⤴ — also on rows for shapes in OTHER open documents; the row/button jumps there). Code lives next to the v3.3 hide block (grep `v3.19`), `APP_VERSION` → `v3.19`.

- **Heading hide reuses the item mechanism** — `toggleTakeoffPkgShapes(idx)` adds/removes EVERY measured (non-manual) item under the package, recursively, to `hiddenTakeoffItemIds`; `pkgShapesHidden(key)` = all of them hidden. So `annVisible()`, the "⊘ Show all shapes" chip and the Markups List "(hidden)" tag work with no new plumbing. Membership is by trade path — `_itemPkgKey(item)` / `_itemInPkg(item, key)` mirror `buildTakeoffTree`'s key rules (trim segments, join " / ", empty → General, case-insensitive), so a heading key from `_wbPkgKeys` matches "Stairs" and "Stairs / Sub". Empty heading → toast, no-op.
- **Per-shape hide** is a second set, `hiddenTakeoffShapeIds` (annotation ids — `generateId()` is unique across docs). `annVisible()` checks it right after layers; `showAllTakeoffShapes()` and the chip cover both sets; hidden rows render at opacity .5. Reset alongside `hiddenTakeoffItemIds` on close/new/workbook load.
- **Highlight is now three exclusive states**: `highlightTakeoffItemId` (existing), `highlightTakeoffPkgKey`, `highlightTakeoffShapeId`; `clearTakeoffHighlights()` zeroes all three and every toggle calls it first, so switching between a heading, an item and a shape never leaves two glows on. `redrawAnnotations` asks `annHighlighted(ann, hiPkgSet)` — the heading's item-id Set is built ONCE per redraw and passed in (don't rebuild per shape). Heading highlight jumps to a local shape or switches doc like the item version; shape highlight goes through `jumpToTakeoffShape` (also selects it). Manual items are never part of a heading's set.
- Verified headless (Playwright, detached `getWorkbookHTML()` + toggles on a 3-heading / 4-shape / 1-manual fixture): 3+3 heading buttons, 4+4 shape buttons; Stairs hide → i1+i2 hidden (sub-heading included, manual and Floor untouched), sub-heading reads hidden, unhide clears; shape hide isolates a2 only; Show all clears both sets; heading glow → a1,a3 not a4; item glow clears heading; shape glow clears item; zero page errors; both script blocks `node --check` clean.

### v3.20 — touch & Apple Pencil support (iPad) (18 Aug 2026)

James: "can i use this app on my ipad?" — it loaded in Safari but nothing could be drawn. Cause: **every canvas listener in the app was a mouse event** (`mousedown`/`mousemove`/`mouseup`, 33 sites, zero `pointer*` and zero `touch*` listeners), so on a touch screen a finger drag was claimed by the browser for scrolling and never reached a tool. He chose **both finger AND Pencil draw** (not Pencil-only) and **bigger targets on touch devices only**. `APP_VERSION` → `v3.20`.

- **One dispatcher, handlers untouched.** New `attachCanvasInputHandlers(canvas, beforeDown)` replaces the THREE places canvas input was wired (the DOMContentLoaded block, the `renderPage` re-attach after `container.innerHTML` rebuilds the canvas, and `attachPageAnnotationListeners` for continuous view). It listens on pointer events and forwards to the **unchanged** `onCanvasMouseDown/Move/Up` — PointerEvent carries `clientX/clientY/button/shiftKey/target`, which is everything those functions read. **A mouse returns on the first line of each dispatcher straight into the v3.19 path**, so no touch bookkeeping can affect desktop behaviour. The continuous-view page-switch logic became the `beforeDown` hook, so it now runs for finger and Pencil too.
- **`touch-action: none` is the load-bearing line.** Set in JS on each canvas when `DATUM_TOUCH`. Without it the browser claims a one-finger drag and sends `pointercancel` instead of `pointermove` — i.e. nothing draws, which is exactly the v3.19 symptom. Set in JS rather than CSS so a mouse-only machine keeps native behaviour on the canvas.
- **Two fingers = pan + pinch.** `_beginGesture` / `_updateGesture` / `_endGesture`. Pan writes `wrapper.scrollLeft/Top` directly; pinch calls the SAME `scheduleZoom(target, {mx,my})` Ctrl+wheel uses, so it inherits v3.x's CSS-stretch-now / re-render-when-idle smoothing for free. Zoom target is computed from the ORIGINAL finger separation (`s0 * d/d0`), never accumulated per frame, so a long pinch cannot drift.
- **The gesture-mid-drag trap.** The first finger has already run `onCanvasMouseDown` by the time the second lands, so a pinch could leave a markup moved AND uncommitted (`onCanvasMouseUp` is what calls `saveToHistory`, and a gesture never reaches it — Undo could not get it back). Fix: `_snapshotDragTarget()` stringifies `points/anchor/knees/textPos/labelOffset/rotation` of whatever `dragAnnotation || resizeAnnotation || labelDragAnnotation || rotateAnnotation` is after mousedown; `abortPointerInteraction()` rolls it back and clears every drag/resize/rotate/pan global before `cancelInProgressDrawing()`. `_holdOffUntilAllUp` then ignores the leftover finger when one lifts, so ending a pinch doesn't start a stray stroke.
- **Palm rejection** without a Pencil-only mode: while a `pen` pointer is down every `touch` pointer is dropped, and any contact wider/taller than `PALM_MAX_PX` (45) is dropped outright. A Pencil arriving mid-finger-stroke aborts the finger's stroke and takes over.
- **Double-tap is synthesised** (`DBLTAP_MS` 320 / `DBLTAP_SLOP` 28) because desktop gets `dblclick` for free and that is what finishes a polyline/area and opens a text markup to edit. iOS may ALSO fire a native `dblclick`, so `onCanvasDoubleClickGuarded` swallows one within 500ms of a synthesised one.
- **`_pointerLostGlobal` on window** — only the captured drawing pointer is guaranteed to deliver `pointerup` to the canvas; a second finger lifting elsewhere would otherwise be counted as down forever. Guarded by `_ptrs.has(id)` so it's a no-op on the normal path.
- **Touch UI is behind `(pointer: coarse)`, not `any-pointer`** — a Windows laptop with a touchscreen reports coarse on `any-pointer` but keeps a mouse as primary, and James's desktop must not grow 44px buttons. `body.touch-ui` sets `--rail-btn-w:44px / --rail-btn-h:38px` and **`--rail-cols: 3`**: at two columns the finger-sized rail runs ~790px tall and falls off the bottom of an iPad in landscape (measured 791 vs 635 available); three columns brings it to 629. Shortcut chips are hidden (no keyboard). `HANDLE_TOL_PX` 8→15 and `TAP_TOL_PX` 10→16 on coarse pointers only — **snap tolerances were deliberately left alone**, they affect measured geometry.
- **Also:** viewport meta gained `maximum-scale=1, user-scalable=no, viewport-fit=cover` (stops iOS page-zooming when a panel input is focused — the alternative, forcing 16px on every input, wrecks the dense panels); `apple-mobile-web-app-*` meta + `apple-touch-icon` so Share ▸ Add to Home Screen opens Datum full-screen with its icon. PDF Save already fell back to a download when `showSaveFilePicker` is missing, so Safari was fine there; the **workbook** genuinely needs a writable file handle (Chrome/Edge only) and its alert now says so in plain language.
- Verified control-first, 18 checks, Playwright + CDP `Input.dispatchTouchEvent` (real multi-touch) and `Input.dispatchMouseEvent` with `pointerType:'pen'`: on **v3.19** one-finger draw 0→0, pinch 1.000→1.000, two-finger pan 0,0→0,0, no touch layout; on **v3.20** finger rectangle, finger freehand, pinch 1.000→2.600, pan scrolls, gesture-mid-drag rollback byte-identical points, double-tap finishes a polyline, Pencil draws, palm ignored while the Pencil is down — and the five desktop control checks (mouse draw, mouse drag, Ctrl+wheel zoom, no `touch-ui` class, zero page errors) pass identically on both builds. Rail fits: desktop 760/766, iPad 629/635. Both script blocks `node --check` clean.
- **Test harness note:** Playwright's `page.touchscreen` only taps. For multi-touch use `context.newCDPSession(page)` → `Input.dispatchTouchEvent` with a `touchPoints` array; for the Pencil use `Input.dispatchMouseEvent` with `pointerType: 'pen'`. Gotcha that cost a red test: most drawing tools call `returnToNavTool()` on completion, so `currentTool` is `select` again by the next stage — re-`setTool()` before every stroke.

---

## v3.21 (19 Aug 2026) — three things that only bit on the iPad

James, after a real session on the iPad: *"tools such as polygon and poly shape you couldn't complete shape. The pen tool swaps back to point each time you finish, needs to stay on pen so you can keep drawing. Also on iPad the thickness boxes don't have arrows to change size, you have to click in and use keyboard to adjust."*

### 1. Multi-point shapes could not be closed — new **Finish-shape bar**

A polyline measure, polyline shape, polygon, area or callout is closed on a computer with a **double-click, Enter, or right-click**. An iPad has none of the three. v3.20 synthesised a double-tap for exactly this reason, but `DBLTAP_MS` was **320 ms** — tighter than a deliberate double tap on glass — so the second tap usually arrived late and just added another vertex. The shape could be started but never finished.

- `DBLTAP_MS` **320 → 460**. Double-tap still works and is still guarded against iOS's own native `dblclick` by `onCanvasDoubleClickGuarded` (500 ms window, unchanged).
- The real fix is an **explicit affordance**, not a better gesture. New floating bar `#shape-finish-bar`, `position: fixed`, bottom-centre, shown **whenever a multi-point shape is open on a `DATUM_TOUCH` device**: `n points` · **Undo point** · **Finish** · **Cancel**.
- New functions next to the touch dispatcher: `_shapeInProgressKind()` (returns `'poly'` / `'callout'` / `null`), `_ensureShapeBar()`, `updateShapeFinishBar()`, and the three globals the buttons call — `touchFinishShape()`, `touchUndoShapePoint()`, `touchCancelShape()`. Constant `SHAPE_BAR_TOOLS = ['polyline','polyshape','area','polygon']`.
- **Finish is disabled until the shape is legal** — 3 points for `area`/`polygon`, 2 for `polyline`/`polyshape` — mirroring `finishPolyShape`'s own guards, so the button can never silently discard the work.
- **Callout is covered too** (it also needs a double-click on a computer): Finish drops the text box 40 px past the last leader point and calls `showCalloutTextInput` with the same arguments the double-click path uses.
- **Hook point: the last line of `redrawAnnotations()`.** That is the one function every vertex push already calls, so the bar tracks the live preview exactly. It is therefore called at mousemove rate — `updateShapeFinishBar()` builds a `kind:n:enabled` signature string and **only touches the DOM when that changes**. Keep it that way.
- Gated on `DATUM_TOUCH` (any touch-capable device), **not** `DATUM_TOUCH_UI` (coarse primary pointer). A touchscreen Windows laptop keeps its desktop layout but still gets the bar, which is harmless and useful. On a pure-mouse machine the element is never even created.

### 2. Pen now stays armed between strokes

`onCanvasMouseUp` ended with `if (didDraw) returnToNavTool();` — every completed stroke snapped the tool back to Select, so freehand annotating meant re-picking the Pen after every line. Now:

```js
if (didDraw && !(currentTool === 'pen' && penKeepArmed)) returnToNavTool();
```

`penKeepArmed` is a new top-level `let` beside `polylinePoints`, **default ON**, persisted at `localStorage['bdm-pen-keep']` — the same pattern as `symbolKeepPlacing` / the Tick and Sequence tools, which have always stayed armed. Esc or V exits. The Pen tool panel gained a **"Keep pen armed after each stroke"** checkbox (`#tool-pen-keep`, bound in `attachToolListeners`); unticking it restores the pre-v3.21 behaviour exactly. This is a **desktop change as well as a touch one** — deliberately, because the complaint is not iPad-specific.

### 3. Number boxes get − / + steppers on touch

iOS Safari renders **no spinner arrows** inside `<input type="number">`, so on an iPad every Thickness / Size / Head % / percentage box could only be changed by tapping into it and using the on-screen keyboard. There are 41 such inputs across the app.

- `_decorateNumberInputs(root)` wraps each undecorated `input[type=number]` in a `.num-stepper` flex div with a `−` and a `+` `.num-step-btn` (36 × 34 px). `_stepNumberInput(input, dir)` steps by the box's **own `step` attribute**, rounds back onto the step grid to `step`'s decimal places (so 0.5-steps never accumulate binary dust), clamps to `min`/`max`, then dispatches **both `input` and `change`** — which is why every existing `bind()` in `attachToolListeners` / `attachAnnotationListeners` picks the value up with no per-input wiring.
- Panels are rebuilt with `innerHTML` constantly, so a **rAF-debounced `MutationObserver` on `document.body`** re-decorates whatever was just drawn. The `:not([data-stepped])` selector makes the observer's reaction to its own insertions a no-op after one extra frame.
- **`DATUM_TOUCH_UI` only** (coarse primary pointer) — a mouse-driven machine, touchscreen laptops included, is byte-for-byte unchanged. Verified by control run.
- Inputs keep their `id`, so `document.getElementById('tool-thickness')` and friends still resolve; only the parent changes. Nothing in the app walks `nextElementSibling` off an input (checked).

### Verification

27/27 Playwright checks over a served build (CDN routed to local `pdfjs-dist@3.11.174` + `pdf-lib`), touch context with `matchMedia('(pointer: coarse)')` forced true, plus a **desktop control context** in the same run:

*Touch* — `touch-ui` applied; `DBLTAP_MS === 460`; bar appears at 3 points reading "3 points"; Undo point → 2; Finish creates the polyline and hides the bar; area Finish disabled at 2 / enabled at 3 and creates the area; Cancel clears the draft, adds nothing, hides the bar; **double-tap still finishes a polyshape**; Pen stays `pen` after a stroke and the stroke exists; Thickness box is wrapped with exactly 2 stepper buttons; `+` moves `toolProperties.thickness` 1 → 1.5 (binding fires); `−` moves it back and past; clamps at min 0.5; zero page errors.

*Desktop control* — no `touch-ui`; `DATUM_TOUCH === false`; **no steppers added**; mouse dblclick still finishes a polyline; `#shape-finish-bar` never created; Pen stays armed (intended cross-platform change) and **unticking the checkbox restores `select` on stroke end**; zero page errors.

Both inline `<script>` blocks `node --check` clean.

---

## v3.23 (22 Aug 2026) — type a size, the markup follows

James: *"Make the measurement editable so that you can manually adjust the size of a measure line, for example, and it will auto adjust the measure line on the drawing"* — and, separately, *"the round corners on boxed function isnt working"*.

(The knowledge doc has no v3.22 entry; the app was already at v3.22 when this work started.)

### 1. The measured value in Properties is now an input

`Properties ▸ Measurement` showed the length/area as a coloured read-out. It is now a text box: type the size the markup **should** be, press Enter, and the geometry is rescaled so the measurement lands exactly on it. Covers `measure`, `dimension`, `polyline` and `area`.

- **Anchors, chosen so nothing jumps.** A measure/dimension line stretches **from its start point** (the end drawn first stays put) along its existing bearing — the angle is untouched. A polyline scales as a whole about its **first vertex**. An area polygon scales about its **centroid** by `√(target/current)`, so it keeps its shape and its position on the sheet.
- **Everything downstream is derived, so nothing else needed touching.** The draw routines recompute `ann.label` from the points on every frame, so the tail of `setMeasurementSize` is the same one a handle-drag resize already runs: `saveToHistory → redrawAnnotations → rebuildMeasurements → openPropertiesPanel → refreshMeasurementsPanel → refreshTakeoffPanel`. Label, Measurements tally, take-off quantity and workbook all follow. One undo step per edit.
- **Units.** `parseMeasurementInput` takes `135`, `135mm`, `1.35m`, `1,350`, `12m²`, `12 sqm`, `4500000mm2`, and strips a leading deduction `−`. A **bare number is read in whatever unit the label is currently showing** — typing `135` over `135mm` means millimetres, over `1.35m` means metres. Unknown units (`12ft`) and zero are rejected with a toast and no change.
- **Viewports.** `_measCalPoint` mirrors the point each draw routine passes to `getCalibratedLabel`, so a markup inside a 1:20 detail region is solved at the viewport's scale. Because resizing **moves** that point, the solve loops up to 4 times — a markup that grows into or out of a viewport re-solves at the scale it ends up in. Converges on the first pass everywhere else.
- **Read-only cases, deliberately.** An uncalibrated page (`Not calibrated`) has nothing to solve against — the row stays a read-out and the toast says to calibrate first. A polyline drawn with the SHAPE tool (`isShape`) is decoration, never a measurement. Perimeter stays read-only: with the area already typed, a second constraint would fight it. An **m³ volume** read-out is area × depth, so the volume row stays read-only and the shape's **Area** gets the editable row underneath it.
- New functions beside `updateMeasLabel`: `measIsResizable`, `_measCalPoint`, `_measPixelSize`, `parseMeasurementInput`, `_scalePointsAbout`, `setMeasurementSize`.

### 2. "Corners: Round" on a box did nothing — because it was never the box control

Two different controls both said **Corners**. The one James used was the **stroke-join** picker (`ctx.lineJoin`), which shapes where two strokes meet — half a line width, i.e. **invisible at 1 px**. The control that actually rounds a box is **Corner Radius**, which was sitting at 0 two rows above it.

- On box shapes (`rectangle`, `text`, `callout`, all `PANEL_TYPES`) the radius now has a plain **Corners: Square / Rounded** picker in front of it. Rounded sets `ann.radius` to `DEFAULT_CORNER_RADIUS` (8, new constant) when there's no radius yet; the Corner Radius number is still there to fine-tune it. The two are kept in step in both directions, so they can never disagree.
- The stroke-join picker is **renamed "Line Joins"**, tooltipped as such, and **no longer shown on rectangles** (on a closed box it is meaningless; `Line Ends` stays, because it does matter once `Border Sides` cuts the outline into open segments). Open-path types — line, arrow, polyline, polygon, pen, cloud — keep it unchanged.

### Verification

33 logic checks in a Node VM against the functions lifted straight out of the file (parser, both anchors, angle preservation, deduction minus, viewport re-solve, uncalibrated / garbage / zero-length / SHAPE guards), plus an end-to-end pass in the browser on a blank A4 at 1:100: typing `2500` into the panel input moved the line 3.83 → 70.87 page units (2500 mm at 1:100 = 70.866) with the start point fixed, label `135mm → 2.50m`, `measurements[]` in step, panel input refreshed, one undo step that restores the original length; area `9.96m² → 48.00m²` with the centroid and aspect ratio unmoved; and the Corners picker square → rounded → typed 20 → square, with no `Line Joins` row present on a rectangle. Both inline `<script>` blocks parse clean.

### Deploying (from v3.23 on) — the project folder IS the working copy

Until now the live site was updated by dragging files into the GitHub web UI, which is why the repo's history is 68 commits all called "update" and why `_to_delete/` still holds two empty `index.lock` files from a bad upload.

- The **project folder is now a clone** of `github.com/JamesBDM/bdm-pdf-tool` (cloned with `--no-checkout`, `.git` moved in, `git reset` — so the full history is intact and the working tree was never overwritten). Edit in place, run **`.\deploy.ps1`** (or double-click `Deploy to GitHub.cmd`), done.
- **`.gitignore` is deny-by-default** — `*` first, then an explicit allow-list. This folder sits in OneDrive next to client PDFs, user guides in .docx, brand assets and the packaged agent skill, and the repo is **public**; a conventional ignore list would leak the first time someone dropped a new file in. Anything added to the folder stays private until it's named in the allow-list.
- **`deploy.ps1` refuses to push an app that doesn't parse.** It runs `check-syntax.js` (local only, not published), which `vm.Script`s both inline `<script>` blocks — the single-file design means one stray bracket is a white screen for every user. It also reads `APP_VERSION` out of the HTML for the commit message and **warns when the app changed but the badge didn't**.
- Keep the script **ASCII-only**. Windows PowerShell 5.1 reads a `.ps1` as ANSI unless it has a BOM, so the em dashes in the first draft came back as mojibake and broke the parser 40 lines later.
- The old `github-upload/` staging folder and the repo's `_to_delete/` junk were both removed once this landed - there is now exactly one copy of the app to edit.

---

## v3.24 (22 Aug 2026) — the Label actually appears, and the panel stops wasting the fold

James, on a selected polyline: *"It shows a tab down the bottom which says label. I've put in a label, but it doesn't show on the actual line that I've selected. Also, the line joints are put round, but they're still not rounded. I don't understand what the line ends and line joints is, so either they don't belong there or those functions need to be added, and those we need a description of what they actually do. The arrange section and rotation section of the properties area is taking up too much room, these can be reduced."*

### 1. `Properties ▸ General ▸ Label` now draws on the drawing

The field writes `ann.measLabel`, which only ever fed the **Measurements list and the report** — nothing on the canvas read it. Typing a label and watching the page not change was indistinguishable from a broken input.

- New `labelPillText(ann, measured)` composes the pill: the typed name on top, the measured value under it, a newline between. `drawLabel` now takes multi-line text and sizes one background around every line, so a named measurement is **one pill, two lines**, not two overlapping pills.
- Two families, both driven off the same property:
  - `MEASURE_LABEL_TYPES` (`measure`, `polyline`, `area`, `dimension`) fold the name into the pill they already draw.
  - `NAME_LABEL_TYPES` (`rectangle`, `ellipse`, `line`, `arrow`, `polygon`, `cloud`, `pen`, `image`, `symbol`, `highlight`) had no pill at all; `drawShapeNameLabel` gives them one pinned above the shape's top edge, called once at the end of `drawAnnotation` so screen, bake, flatten, print and report all get it.
  - Types that already carry their own words (`text`, `callout`, `stamp`, the presentation panels) are deliberately excluded — their content **is** the text.
- Both families record `_labelRect`, so the name drags with the same code the measurement pill already used; the drag hit-test list is now `LABELLED_TYPES` instead of a hard-coded four.
- **A polyline SHAPE no longer sets `hideLabel: true` at creation.** It was set so the (empty) measurement pill stayed off; with the name now sharing that pill it meant a typed label could never appear. `ann.label` is empty on a shape, so the pill still draws nothing until there is a name to draw.
- The `Label` section is shown for every `LABELLED_TYPES` member, leads with a line saying where the text comes from, and the checkbox reads **"Hide label on the drawing"** instead of the opaque "Hide label (text only)".

### 2. Line Joins was working — it just cannot be seen at 1 px

Measured on a canvas: at `thickness: 10` switching miter → round changes **52 pixels**, miter → bevel **59**. At `thickness: 1` it changes **0**. The setting was correct and the feedback was nil, so it read as broken. (v3.23 had already put this in a tooltip; a tooltip you have to hover to find is not an answer.)

- Both controls now carry their explanation **in the panel**, under the dropdown: what Flat / Round / Square do to a loose end, what Sharp / Round / Bevel do to a bend.
- Below Line Joins, an amber note appears while `thickness < 3`: *"At 1px thick the join is under a pixel wide, so it looks like nothing changed — set Thickness to 3 or more to see it."* It follows the Thickness box live (`input` listener on `#prop-thickness`) rather than only being right at the moment the panel opened.
- Neither control was removed. Both do real work at a usable line weight, and `Line Ends` matters on any open path.
- Small correctness fix in `drawPolylineMeasure`: the path started `moveTo(points[0])` then `forEach(lineTo)`, so the first segment was zero-length. It now starts the loop at index 1.

### 3. Arrange + Rotation: 274 px → 126 px

Measured on a selected polyline at a 287 px panel width. Two sections of once-pressed buttons wrapped in helper prose were pushing the properties people actually edit below the fold.

- They are now **one section, "Arrange & Rotate"**, three tight rows: `Front · Up · Down · Back` / `Group · Ungroup · ↺90° · ↻90°` / the angle row (`Angle °` + input for `ROT_PROP_TYPES`, `Turn by °` + input + `Apply` for the rest).
- New `.mini-btn` / `.mini-lbl` / `.compact-btn-row` styles — 4 px padding, 10.5 px type, real button chrome (the old `.modal-btn` had no background outside a modal, so the row read as loose text).
- Every line of helper prose became a `title=`. The group state ("In a group of 4 — they move and delete together") is now on the Group button's tooltip.
- **Don't let the row wrap.** The first attempt put all six order/group buttons on one `flex-wrap` row; `Ungroup` fell to a second line and `flex: 1 1 auto` stretched it to the full 263 px. Four buttons per row, no wrap.

### Verification

In-browser against the served build: `labelPillText` composes `"Wall type A\n615mm"`; a named polyline measure draws a **23 px** two-line pill against **13 px** for the value alone, and `hitTestLabel` is true inside it and false outside; a named rectangle and a named polyline SHAPE both draw (650 changed pixels vs. the unnamed control) and `hideLabel` suppresses them completely (0 changed pixels). The join numbers above are from the same harness. Panel heights measured live: `Arrange 134 + Rotation 140` on v3.23 against `Arrange & Rotate 126` on v3.24, with no row wrapping at 287 px. Both inline `<script>` blocks parse clean.

### A trap when scripting edits to this file from Bash on Windows

`\n` inside a JS template literal in a quoted heredoc arrived at Node as `\n` and was written to the HTML as a **real newline**, splitting `.split('\n')` across two lines and breaking the whole script block. `check-syntax.js` caught it. Build the two-character escape explicitly (`const NL = '\u005cn'`) rather than trying to escape a backslash through the shell.

## v3.25 (23 Aug 2026) — hold Shift to resize a pasted image at its original proportions

James: *"when I drop a photo or screenshot / snip into a PDF, I want to hold Shift to re-size at the same dimensions as the original."*

### 1. Shift locks the aspect ratio on an image markup

The proportion-keeping maths already existed inside `applyResize`'s two-point branch — written for signatures, which are always proportional. It now runs for `type:'image'` as well, gated on a new predicate:

```js
function aspectLockedResize(ann) {
  if (ann.type === 'signature') return true;      // always
  if (ann.type !== 'image') return false;
  return ann.lockAspect ? !isShiftHeld : isShiftHeld;   // Shift INVERTS the tick
}
```

- `isShiftHeld` needed no new plumbing — `onCanvasMouseMove` already refreshes it from `e.shiftKey` on every move, so pressing or releasing Shift **mid-drag** switches modes live.
- `_signatureRatio` is renamed `_annImageRatio` (same body) because it now serves both types; `fixSelectedSignatureAspect` and the new `fixSelectedImageAspect` are both thin wrappers over `_fixSelectedPictureAspect(type, noun)`.
- Every image annotation now records `aspect: h / w` at placement (both in `addImageFromBlob` and in `captureSnipRegion`), so the lock has a ratio to work from even before the image element finishes decoding.
- **Corners are no longer always width-driven.** The old signature code took the horizontal drag and derived the height from it, so dragging a corner mostly *downwards* barely grew the box. Corners now use whichever axis the user dragged further (`h > w * r` → height drives width, pinning the untouched side edge). Mid-edge handles are unchanged: top/bottom-centre grows about the horizontal centre, left/right-centre about the vertical centre.

### 2. `Properties ▸ Image` — for the iPad, which has no Shift key

New panel section on `type:'image'`: a **Lock proportions** tick (`ann.lockAspect`, bound through the ordinary `bind()` helper, default off), a **Fix proportions** button that snaps an already-stretched image back to the shape it came in at (keeping its width), and one line of help. With the tick on, Shift reverses the behaviour and lets the image be stretched — the same convention Illustrator and PowerPoint use.

Both placement toasts now say so: *"Image pasted — drag corners to resize (hold Shift to keep its proportions)"*.

### 3. Bug found on the way: signatures had stopped resizing proportionally at all

`BOX2_TYPES` — the list that decides which markups get 8 resize handles, a dashed bounding box, resize cursors and the two-point resize branch — did **not** contain `'signature'`. So a selected signature got only its two raw points as handles and resized through the generic move-a-vertex path at the bottom of `applyResize`. Consequences, all silent:

- the proportion-keeping branch documented in the changelog **never executed** — every signature resize was a free stretch;
- there were 2 handles, not 8, and handle index 1 (drawn where the *top-centre* handle belongs on an 8-handle box) moved the **bottom-right corner**.

Fix is one word: `'signature'` added to `BOX2_TYPES`. Verified by the control run below — v3.24 stretched a 2:1 signature to 0.35, v3.25 holds it at 0.50.

**Lesson for this codebase:** when a type list like `BOX2_TYPES` is extracted from what used to be an inline `includes([...])`, every branch that keys off the type silently changes behaviour for anything left out of the list. Grep the list's usages, not just the branch you are editing.

### Verification

Playwright, control-first — the same script run against v3.24 and v3.25 over local http (CDN routed to local `pdfjs-dist@3.11.174` / `pdf-lib`), a 200 × 100 image (ratio 0.5) placed at 200 × 100 page points and its bottom-right handle dragged:

| case | v3.24 | v3.25 |
|---|---|---|
| free drag | 400 × 140 (0.35) | 400 × 140 (0.35) — unchanged |
| Shift drag | 400 × 140 (0.35) | 400 × **200** (0.50) |
| `lockAspect`, no Shift | 400 × 140 | 400 × 200 (0.50) |
| `lockAspect` + Shift | 400 × 140 | 400 × 140 — stretches, as intended |
| Shift, dragged mostly downwards | 220 × 400 (1.82) | **800** × 400 (0.50) |
| signature, no Shift | 400 × 140 (0.35) | 400 × 200 (0.50) |

Plus: the panel renders `#prop-image-lockaspect`, ticking it sets `ann.lockAspect`, the image reports 8 handle points, `fixSelectedImageAspect()` returns a stretched 200 × 300 box to ratio 0.50, and `_annotationsForSnapshot` keeps `aspect` / `lockAspect` while still dropping `_`-prefixed transients. Zero page errors; both inline `<script>` blocks `node --check` clean.
