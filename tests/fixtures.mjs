// Build the test drawings. Two shapes of file, because they stress different things.
//
//   plain  — A1 sheets of vector linework. Small, fast, used for the reopen and
//            backwards-compatibility run where page count matters more than weight.
//   heavy  — the same sheets plus a block of incompressible bytes each, standing in
//            for the embedded raster imagery that makes real architectural sets big.
//            Incompressible is deliberate: it is the worst case for the embedded
//            clean source, so the size numbers the tests print are a floor, not a
//            best case.
import { PDFDocument, StandardFonts, rgb, PDFRawStream } from 'pdf-lib';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const A1_LANDSCAPE = [2384, 1684];

async function build(pages, ballastMbPerPage) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage(A1_LANDSCAPE);
    page.drawText('SHEET A-' + String(p + 1).padStart(3, '0'), { x: 60, y: 1600, size: 42, font });
    for (let i = 0; i < 200; i++) {
      page.drawRectangle({
        x: 60 + (i % 20) * 115, y: 80 + Math.floor(i / 20) * 70,
        width: 100, height: 55, borderWidth: 0.7, borderColor: rgb(0.2, 0.2, 0.3),
      });
    }
    if (ballastMbPerPage > 0) {
      const blob = crypto.randomBytes(ballastMbPerPage * 1024 * 1024);
      doc.context.register(PDFRawStream.of(
        doc.context.obj({ Type: 'DatumTestBallast', Length: blob.length }), new Uint8Array(blob)));
    }
  }
  return await doc.save();
}

export async function ensureFixtures(dir, { heavyMb = 12 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const made = [];
  const want = [
    { name: 'plain-8p.pdf', pages: 8, ballast: 0 },
    { name: 'heavy.pdf', pages: 6, ballast: Math.max(1, Math.round(heavyMb / 6)) },
  ];
  for (const w of want) {
    const file = path.join(dir, w.name);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, await build(w.pages, w.ballast));
      made.push(w.name);
    }
  }
  return made;
}

// Optional: a set past the old 60MB ceiling, for the capacity check.
export async function ensureLarge(dir, totalMb) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'large-' + totalMb + 'mb.pdf');
  if (!fs.existsSync(file)) fs.writeFileSync(file, await build(4, Math.round(totalMb / 4)));
  return file;
}
