// Snap to the drawing's own geometry.
//
// The point of reading the PDF's line operators instead of its pixels is that
// the answer is EXACT and does not move when you zoom. So these tests assert
// against the fixture's known coordinates to sub-pixel tolerance, and re-run
// the same assertions at several zoom levels.
import { openApp, report } from './harness.mjs';
import { GEO, XF, W, H } from './snap-fixture.mjs';

const near = (got, want, tol) => got != null && Math.abs(got - want) <= tol;
const hit = (r, wantX, wantY, wantKind, tol) =>
  !!r && r.kind === wantKind && near(r.x, wantX, tol) && near(r.y, wantY, tol);

export async function snapGeometry(port, pdfFile) {
  const { browser, page, errors } = await openApp(port, pdfFile);
  try {
    const r = await page.evaluate(async ({ GEO, H }) => {
      const out = { probes: {} };
      const P = (x, y) => ({ x, y: H - y });   // PDF space -> page space

      // Wait for the index this page builds in the background.
      const t0 = performance.now();
      while (performance.now() - t0 < 20000) {
        const c = pdfDoc.__datumVecCache && pdfDoc.__datumVecCache.get(0);
        if (c && c.ready) break;
        await new Promise(res => setTimeout(res, 50));
      }
      const entry = pdfDoc.__datumVecCache && pdfDoc.__datumVecCache.get(0);
      out.indexed = !!(entry && entry.ready && !entry.empty);
      out.segments = entry ? (entry.count || 0) : 0;
      out.buildMs = Math.round(performance.now() - t0);

      // Offset a probe a few page units off the true point, so the snap has
      // to actually pull it in rather than already being there.
      const probe = (pt, dx, dy) => snapPageToVector({ x: pt.x + dx, y: pt.y + dy });

      // --- the four snap kinds, at their known coordinates ---
      const crossing = P(GEO.cross.x, GEO.cross.y);
      out.probes.intersection = probe(crossing, 2.5, -2);

      const wallEnd = P(GEO.hWall.x2, GEO.hWall.y);
      out.probes.endpoint = probe(wallEnd, -2, 2.5);

      const diagMid = P((GEO.diag.x1 + GEO.diag.x2) / 2, (GEO.diag.y1 + GEO.diag.y2) / 2);
      out.probes.midpoint = probe(diagMid, 2, 2);

      // A point on the horizontal wall, well away from its ends and the
      // crossing, so "on line" is the only thing available.
      const onWall = P(220, GEO.hWall.y);
      out.probes.online = probe(onWall, 0, 3);

      // Room corner — a rectangle path's corner is an endpoint
      const roomCorner = P(GEO.room.x, GEO.room.y + GEO.room.h);
      out.probes.roomCorner = probe(roomCorner, 3, 3);

      // --- text must not be snappable ---
      // Right in the middle of the "ROOM 01" glyphs. The room rectangle's own
      // edges are >20 units away, so anything returned here came from text.
      out.probes.overText = snapPageToVector(P(215, 437));

      // --- a clip-only path must not be snappable ---
      const clipCorner = P(GEO.clipOnly.x, GEO.clipOnly.y);
      out.probes.clipOnly = probe(clipCorner, 2, 2);

      // --- the same crossing, at several zooms, must give the same answer ---
      out.zoom = [];
      for (const s of [0.5, 1, 2, 4]) {
        currentScale = s;
        const v = probe(crossing, 1.5, -1.5);
        out.zoom.push({ scale: s, x: v ? v.x : null, y: v ? v.y : null, kind: v ? v.kind : null });
      }
      currentScale = 1;

      // --- and the full pipeline, the way a tool actually calls it ---
      snapEnabled = true; snapContentEnabled = true;
      const viaPipeline = snapPagePoint({ x: crossing.x + 2, y: crossing.y - 2 });
      out.pipeline = { x: viaPipeline.x, y: viaPipeline.y, type: lastSnapHit && lastSnapHit.type };

      // --- with drawing snap off, the drawing must be ignored entirely ---
      snapContentEnabled = false;
      const off = snapPageToVector(crossing);
      out.respectsToggle = off === null;
      snapContentEnabled = true;

      return out;
    }, { GEO, H });

    const TOL = 0.01;          // page units — this should be exact, not close
    const cx = GEO.cross.x, cy = H - GEO.cross.y;
    const zoomSame = r.zoom.every(z => hit(z, cx, cy, 'int', TOL));

    const failed = report('snap to drawing geometry — ' + pdfFile.split('/').pop(), [
      ['the page geometry gets indexed', r.indexed === true && r.segments > 0],
      ['a crossing snaps to the exact intersection',
        hit(r.probes.intersection, cx, cy, 'int', TOL)],
      ['a line end snaps to the exact endpoint',
        hit(r.probes.endpoint, GEO.hWall.x2, H - GEO.hWall.y, 'end', TOL)],
      ['a span snaps to its exact midpoint',
        hit(r.probes.midpoint, (GEO.diag.x1 + GEO.diag.x2) / 2, H - (GEO.diag.y1 + GEO.diag.y2) / 2, 'mid', TOL)],
      ['mid-span snaps onto the line itself',
        hit(r.probes.online, 220, H - GEO.hWall.y, 'line', TOL)],
      ['a room corner snaps to the exact corner',
        hit(r.probes.roomCorner, GEO.room.x, H - (GEO.room.y + GEO.room.h), 'end', TOL)],
      ['text is not snappable', r.probes.overText === null],
      ['an invisible clip path is not snappable', r.probes.clipOnly === null],
      ['the same point at every zoom gives the same answer', zoomSame],
      ['the drawing snap reaches the tools through snapPagePoint',
        near(r.pipeline.x, cx, TOL) && near(r.pipeline.y, cy, TOL) && r.pipeline.type === 'vint'],
      ['turning drawing snap off turns it off', r.respectsToggle === true],
      ['no page errors', errors.length === 0],
    ], {
      'segments indexed': r.segments,
      'index built in': r.buildMs + ' ms',
      'crossing at zoom 0.5 / 1 / 2 / 4': r.zoom.map(z =>
        z.x === null ? 'miss' : (z.x.toFixed(3) + ',' + z.y.toFixed(3))).join('  |  '),
    });
    if (errors.length) console.log('  errors:', errors.slice(0, 5));
    if (failed) console.log('  probes:', JSON.stringify(r.probes, null, 2));
    return failed;
  } finally { await browser.close(); }
}

// Transforms are where a geometry reader quietly goes wrong: the numbers in
// the content stream are almost never the numbers on the page. Each line in
// this fixture is drawn in local coordinates and placed somewhere else by a
// `cm`, a nested `cm`, or a form XObject's matrix, so these only pass if the
// transform stack is tracked properly.
export async function snapTransforms(port, pdfFile, rotated) {
  const { browser, page, errors } = await openApp(port, pdfFile);
  try {
    const r = await page.evaluate(async ({ XF, H, W, rotated }) => {
      const out = {};
      const t0 = performance.now();
      while (performance.now() - t0 < 20000) {
        const c = pdfDoc.__datumVecCache && pdfDoc.__datumVecCache.get(0);
        if (c && c.ready) break;
        await new Promise(res => setTimeout(res, 50));
      }
      const e = pdfDoc.__datumVecCache && pdfDoc.__datumVecCache.get(0);
      out.segments = e ? (e.count || 0) : 0;

      // PDF space -> page space, matching whatever the page's own viewport does
      // (rotation included), so the expectations stay honest on a rotated page.
      const pg = await pdfDoc.getPage(1);
      const vp = pg.getViewport({ scale: 1 });
      const P = (x, y) => {
        const m = vp.transform;
        return { x: m[0]*x + m[2]*y + m[4], y: m[1]*x + m[3]*y + m[5] };
      };
      out.rotation = vp.rotation;
      const probe = (pt, dx, dy) => snapPageToVector({ x: pt.x + dx, y: pt.y + dy });

      for (const [name, seg] of Object.entries({
        scaled: XF.scaled, nested: XF.nested, inForm: XF.inForm,
      })) {
        const a = P(seg.from.x, seg.from.y), b = P(seg.to.x, seg.to.y);
        out[name + 'From'] = probe(a, 2, 2);
        out[name + 'To'] = probe(b, -2, -2);
        out[name + 'Mid'] = probe({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 1.5, 1.5);
      }
      const ae = P(XF.arcTo.x, XF.arcTo.y);
      out.arcEnd = probe(ae, 2, -2);
      out.expected = {};
      for (const [name, seg] of Object.entries({
        scaled: XF.scaled, nested: XF.nested, inForm: XF.inForm,
      })) {
        const a = P(seg.from.x, seg.from.y), b = P(seg.to.x, seg.to.y);
        out.expected[name] = { a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      }
      out.expected.arcEnd = ae;
      return out;
    }, { XF, H, W, rotated });

    const TOL = 0.02;
    const at = (got, want, kind) => !!got && got.kind === kind &&
      Math.abs(got.x - want.x) <= TOL && Math.abs(got.y - want.y) <= TOL;

    const label = rotated ? 'transforms on a rotated page' : 'transforms and form XObjects';
    const failed = report('snap through ' + label, [
      ['a scaled+translated line lands where it is drawn',
        at(r.scaledFrom, r.expected.scaled.a, 'end') && at(r.scaledTo, r.expected.scaled.b, 'end')],
      ['its midpoint is the midpoint of the placed line',
        at(r.scaledMid, r.expected.scaled.mid, 'mid')],
      ['nested transforms compose in the right order',
        at(r.nestedFrom, r.expected.nested.a, 'end') && at(r.nestedTo, r.expected.nested.b, 'end')],
      ['geometry inside a form XObject is found and placed',
        at(r.inFormFrom, r.expected.inForm.a, 'end') && at(r.inFormTo, r.expected.inForm.b, 'end')],
      ['a curve keeps its exact end point',
        at(r.arcEnd, r.expected.arcEnd, 'end')],
      ['no page errors', errors.length === 0],
    ], { 'segments indexed': r.segments, 'page rotation': r.rotation + '°' });
    if (errors.length) console.log('  errors:', errors.slice(0, 5));
    if (failed) console.log('  got:', JSON.stringify({
      scaledFrom: r.scaledFrom, nestedFrom: r.nestedFrom, inForm: r.inFormFrom, arcEnd: r.arcEnd,
      expected: r.expected }, null, 2));
    return failed;
  } finally { await browser.close(); }
}

// The numbers that decide whether this is usable at all. A snap query runs on
// every mouse move, so it has to fit comfortably inside a frame on a sheet far
// denser than a real drawing.
export async function snapPerformance(port, pdfFile) {
  const { browser, page, errors } = await openApp(port, pdfFile);
  try {
    const r = await page.evaluate(async () => {
      const out = {};
      const t0 = performance.now();
      while (performance.now() - t0 < 60000) {
        const c = pdfDoc.__datumVecCache && pdfDoc.__datumVecCache.get(0);
        if (c && c.ready) break;
        await new Promise(res => setTimeout(res, 25));
      }
      const e = pdfDoc.__datumVecCache.get(0);
      out.segments = e.count || 0;
      out.indexMs = Math.round(performance.now() - t0);
      out.truncated = !!e.truncated;
      out.bytes = e.segs ? e.segs.byteLength + e.grid.items.byteLength + e.grid.offsets.byteLength : 0;

      // 400 queries scattered over the sheet, as a mouse drag would produce
      currentScale = 1;
      const N = 400;
      let hits = 0;
      const q0 = performance.now();
      for (let i = 0; i < N; i++) {
        const x = (i * 137.5) % 2384, y = (i * 91.7) % 1684;
        if (snapPageToVector({ x, y })) hits++;
      }
      out.queryMs = (performance.now() - q0) / N;
      out.hitRate = hits / N;
      return out;
    });

    const failed = report('snap performance on a dense sheet', [
      ['the whole sheet gets indexed', r.segments > 15000 && !r.truncated],
      ['indexing a page stays under 5 s', r.indexMs < 5000],
      ['a snap query stays well inside a frame (<4 ms)', r.queryMs < 4],
      ['no page errors', errors.length === 0],
    ], {
      'segments indexed': r.segments,
      'index built in': r.indexMs + ' ms',
      'index memory': (r.bytes / 1048576).toFixed(1) + ' MB',
      'per query': r.queryMs.toFixed(3) + ' ms',
      'queries that found something': Math.round(r.hitRate * 100) + '%',
    });
    if (errors.length) console.log('  errors:', errors.slice(0, 5));
    return failed;
  } finally { await browser.close(); }
}
