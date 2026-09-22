# Datum tests

These cover the two things in Datum that quietly ruin a job if they break: the save
format, and snapping.

**The save format.** A saved PDF has to show its markups in Adobe or Chrome **and**
reopen in Datum with every markup live, editable, and sitting on a clean background
rather than doubled up on top of a baked-in copy of itself.

**Snapping to the drawing.** A measurement that lands a pixel off the wall is wrong,
and wrong quietly. The snap tests assert exact coordinates against fixtures whose
geometry is known to the decimal.

They drive the real `BDM-PDF-Markup-Tool.html` in a real Chromium.

## Running them

You need Node 18+ and Chromium.

```bash
cd tests
npm install
npm test
```

Takes a few minutes. The last line says whether everything passed.

To also check that a set bigger than the old ceiling still saves:

```bash
npm test -- --large 150
```

That builds and saves a 150MB drawing set, so give it longer and a machine with
a few GB free.

If Chromium is somewhere unusual, point at it:

```bash
CHROMIUM_PATH=/path/to/chrome npm test
```

## What gets checked

**Round trip** — draw markups on every page, save, read the file back.

- The clean original comes back **byte-for-byte identical**.
- Every markup survives.
- The saved file opens as an ordinary PDF and the markups really are painted into the
  page, which is what an outside viewer shows.
- The saved file is smaller than the pre-v3.34 hex route would have made it, and the
  run prints both sizes so the gap is visible.
- The degraded path (too big to carry a clean copy) keeps markups editable and bakes
  nothing, so reopening can never show them twice.

**Reopen and backwards compatibility** — save, then reopen through the same code path
the user goes through.

- Reopening renders the clean original, not the baked copy.
- Saving again changes the file by a handful of bytes, not by a whole overlay. Nothing
  double-stacks and nothing grows round over round.
- Files written by older builds still open: both the compressed and uncompressed
  hex formats, with their clean source intact.

**Snap to drawing geometry** — the fixtures are hand-written PDF content streams, so
the tests assert against coordinates known exactly.

- A crossing snaps to the exact intersection, a line end to the exact endpoint, a span
  to its exact midpoint, mid-span to the exact perpendicular foot.
- The same point at 0.5x, 1x, 2x and 4x zoom gives the **same** answer. This is the
  whole point of reading geometry instead of pixels.
- Text is not snappable, and neither is an invisible clip path.
- Scaled, nested and form-XObject transforms all place geometry where it is drawn
  rather than where its local coordinates say, on a flat page and a rotated one.
- On a sheet of 150,000 segments: indexed in about two seconds, and a snap query costs
  0.12 ms against a 16 ms frame.

## How it works, and the traps

The app loads pdf.js and pdf-lib from a CDN, which a test machine may not reach. The
harness copies a build of the app that points those two `<script>` tags at local files
at the **same pinned versions** and changes nothing else. If those URLs ever change in
the app, the harness throws rather than silently testing something else.

The tests call the app's own functions (`addAnnotation`, `_buildSavedPdf`,
`readBDMDataFromPdfBytes`, `loadPdf`) instead of simulating clicks. Faster, and far
less brittle when the toolbar moves.

One trap worth knowing: the app keeps its state in top-level `let` bindings, and those
are **not** properties of `window`. `page.waitForFunction(() => window.currentPdfBytes)`
waits forever. Use the bare identifier with a `typeof` guard.

The test drawings are generated, not committed: A1 sheets of linework, plus a block of
deliberately incompressible bytes standing in for embedded raster imagery. Incompressible
is the worst case for the embedded clean source, so the size figures the run prints are
a floor rather than a flattering best case. They are cached in `tests/.work/` after the
first run.
