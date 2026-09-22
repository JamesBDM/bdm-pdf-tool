// A drawing whose exact geometry we know, so the snap tests can assert real
// coordinates rather than "something near a line".
//
// The content stream is written out by hand rather than through pdf-lib's
// drawing helpers. The thing under test is how the app reads PDF path
// operators, so the fixture is literally those operators — nothing in between
// to reinterpret them, and the clip-only path (which no drawing helper will
// emit) is expressible.
//
// Coordinates below are PDF user space: origin bottom-left, y up. The app's
// page space is origin top-left, y down, so pageY = height - pdfY.
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';

export const W = 800, H = 600;

// Every coordinate the tests assert against.
export const GEO = {
  hWall: { x1: 100, y: 300, x2: 700 },          // horizontal wall
  vGrid: { x: 400, y1: 80, y2: 520 },           // vertical gridline
  cross: { x: 400, y: 300 },                    // where those two cross
  room: { x: 150, y: 380, w: 200, h: 140 },     // a closed room, as `re`
  diag: { x1: 500, y1: 100, x2: 660, y2: 220 }, // isolated diagonal
  clipOnly: { x: 60, y: 60, w: 120, h: 60 },    // clipped, never painted
  text: { x: 170, y: 430 },                     // glyphs, never geometry
};

const CONTENT = `
q 2 w 0 0 0 RG
${GEO.hWall.x1} ${GEO.hWall.y} m ${GEO.hWall.x2} ${GEO.hWall.y} l S
${GEO.vGrid.x} ${GEO.vGrid.y1} m ${GEO.vGrid.x} ${GEO.vGrid.y2} l S
Q
q 1.5 w 0 0 0.8 RG
${GEO.room.x} ${GEO.room.y} ${GEO.room.w} ${GEO.room.h} re S
Q
q 1.5 w 0.8 0 0 RG
${GEO.diag.x1} ${GEO.diag.y1} m ${GEO.diag.x2} ${GEO.diag.y2} l S
Q
q BT /F1 18 Tf ${GEO.text.x} ${GEO.text.y} Td (ROOM 01) Tj ET Q
q ${GEO.clipOnly.x} ${GEO.clipOnly.y} ${GEO.clipOnly.w} ${GEO.clipOnly.h} re W n Q
`.trim();

export async function buildSnapFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'snap-geometry.pdf');
  if (fs.existsSync(file)) return file;

  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);

  const font = doc.context.obj({
    Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica', Encoding: 'WinAnsiEncoding',
  });
  page.node.set(PDFName.of('Resources'), doc.context.obj({
    Font: { F1: doc.context.register(font) },
  }));

  const bytes = new TextEncoder().encode(CONTENT);
  const stream = PDFRawStream.of(doc.context.obj({ Length: bytes.length }), bytes);
  page.node.set(PDFName.of('Contents'), doc.context.register(stream));

  fs.writeFileSync(file, await doc.save());
  return file;
}

// PDF user space -> the app's page space.
export const toPageSpace = (x, y) => ({ x, y: H - y });

// ---------------------------------------------------------------------------
// A second fixture for the things that actually bend coordinates: nested `cm`
// transforms, a form XObject with its own matrix, and page rotation. Each line
// is drawn in local coordinates that are NOT its final position, so a test
// asserting the final position can only pass if the transform stack is right.
// ---------------------------------------------------------------------------

export const XF = {
  // drawn as 0,0 -> 100,0 inside `cm 2 0 0 2 100 50` => 100,50 -> 300,50
  scaled: { from: { x: 100, y: 50 }, to: { x: 300, y: 50 } },
  // drawn as 0,0 -> 0,80 inside two nested translates (40,20) then (10,10)
  nested: { from: { x: 50, y: 30 }, to: { x: 50, y: 110 } },
  // drawn as 0,0 -> 60,0 inside a form XObject placed with `cm 1 0 0 1 200 200`
  inForm: { from: { x: 200, y: 200 }, to: { x: 260, y: 200 } },
  // a quarter-circle arc, to exercise curve flattening; its true ENDS are exact
  arcFrom: { x: 400, y: 300 }, arcTo: { x: 460, y: 360 },
};

const XF_CONTENT = `
q 1 w 0 0 0 RG
q 2 0 0 2 100 50 cm 0 0 m 100 0 l S Q
q 1 0 0 1 40 20 cm q 1 0 0 1 10 10 cm 0 0 m 0 80 l S Q Q
q 1 0 0 1 200 200 cm /Fx Do Q
400 300 m 433 300 460 327 460 360 c S
Q
`.trim();

const XF_FORM = `0 0 m 60 0 l S`;

export async function buildTransformFixture(dir, rotate = 0) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'snap-transforms' + (rotate ? '-rot' + rotate : '') + '.pdf');
  if (fs.existsSync(file)) return file;

  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);

  const formBytes = new TextEncoder().encode(XF_FORM);
  const form = PDFRawStream.of(doc.context.obj({
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, W, H], Length: formBytes.length,
  }), formBytes);
  page.node.set(PDFName.of('Resources'), doc.context.obj({
    XObject: { Fx: doc.context.register(form) },
  }));

  const bytes = new TextEncoder().encode(XF_CONTENT);
  const stream = PDFRawStream.of(doc.context.obj({ Length: bytes.length }), bytes);
  page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  if (rotate) page.node.set(PDFName.of('Rotate'), doc.context.obj(rotate));

  fs.writeFileSync(file, await doc.save());
  return file;
}

// ---------------------------------------------------------------------------
// A dense sheet, for the numbers that decide whether this is usable: how long
// one page takes to index, and how long a single snap query costs. A query
// runs on every mouse move, so it has to be comfortably inside a frame.
// ---------------------------------------------------------------------------
export async function buildDenseFixture(dir, lines = 20000) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'snap-dense.pdf');
  if (fs.existsSync(file)) return file;

  const A1W = 2384, A1H = 1684;
  const parts = ['q 0.5 w 0 0 0 RG'];
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < lines; i++) {
    const x = rnd() * A1W, y = rnd() * A1H;
    const horiz = rnd() < 0.5;
    const len = 20 + rnd() * 160;
    parts.push(horiz
      ? `${x.toFixed(1)} ${y.toFixed(1)} m ${(x + len).toFixed(1)} ${y.toFixed(1)} l S`
      : `${x.toFixed(1)} ${y.toFixed(1)} m ${x.toFixed(1)} ${(y + len).toFixed(1)} l S`);
  }
  parts.push('Q');

  const doc = await PDFDocument.create();
  const page = doc.addPage([A1W, A1H]);
  const bytes = new TextEncoder().encode(parts.join('\n'));
  const stream = PDFRawStream.of(doc.context.obj({ Length: bytes.length }), bytes);
  page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  fs.writeFileSync(file, await doc.save());
  return file;
}
