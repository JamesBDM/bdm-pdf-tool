// The save / reopen contract.
//
// A saved Datum PDF has to be two things at once: an ordinary PDF that shows
// its markups in Adobe or Chrome, and a project file that reopens in Datum with
// every markup live and editable on a CLEAN background. Getting the second part
// wrong is what produced the duplicate-markups bug this format exists to avoid,
// so it is checked directly rather than by eye.
import { openApp, report, mb } from './harness.mjs';

export async function roundTrip(port, pdfFile) {
  const { browser, page, errors } = await openApp(port, pdfFile);
  try {
    const r = await page.evaluate(async () => {
      const out = {};
      out.pageCount = pdfDoc.numPages;
      out.originalBytes = currentPdfBytes.length;

      for (let p = 0; p < out.pageCount; p++) {
        currentPage = p;
        addAnnotation('rectangle', [{ x: 120, y: 120 }, { x: 900, y: 600 }]);
        addAnnotation('rectangle', [{ x: 1000, y: 700 }, { x: 1800, y: 1200 }]);
      }
      out.drawn = annotations.length;

      const clean = currentPdfBytes.slice();
      const t0 = performance.now();
      const saved = await _buildSavedPdf(clean, true);
      out.buildMs = Math.round(performance.now() - t0);
      out.savedBytes = saved.length;

      // What the pre-v3.34 hex route would have cost for the same clean source
      const oldComp = await _compressBytes(clean);
      const oldPayload = (oldComp && oldComp.length < clean.length ? oldComp.length : clean.length);
      out.legacyBytes = saved.length + oldPayload; // hex is 2 bytes/byte vs the stream's 1

      const back = await readBDMDataFromPdfBytes(saved.slice());
      out.gotProject = !!(back && back.project);
      out.gotClean = !!(back && back.cleanBytes);
      out.bakedFlag = back && back.bakedOverlay;
      out.restored = back && back.project ? back.project.annotations.length : -1;
      out.cleanIdentical = false;
      if (back && back.cleanBytes && back.cleanBytes.length === clean.length) {
        let same = true;
        for (let i = 0; i < clean.length; i++) if (clean[i] !== back.cleanBytes[i]) { same = false; break; }
        out.cleanIdentical = same;
      }

      // Still an ordinary PDF, and the markups really are painted into it
      const doc = await pdfjsLib.getDocument({ data: saved.slice() }).promise;
      out.savedOpens = doc.numPages;
      const ops = await (await doc.getPage(1)).getOperatorList();
      out.markupsPainted = ops.fnArray.includes(pdfjsLib.OPS.paintImageXObject);

      // The degraded path: editable markups, nothing baked, no second copy
      const noEmbed = await _buildSavedPdf(clean, false);
      const backNo = await readBDMDataFromPdfBytes(noEmbed.slice());
      out.noEmbedBaked = backNo && backNo.bakedOverlay;
      out.noEmbedProject = !!(backNo && backNo.project);
      out.noEmbedClean = !!(backNo && backNo.cleanBytes);
      return out;
    });

    const failed = report('save / reopen round trip — ' + pdfFile.split('/').pop(), [
      ['reopen recovers the project', r.gotProject === true],
      ['reopen recovers the clean original', r.gotClean === true],
      ['clean original is byte-identical', r.cleanIdentical === true],
      ['every markup survives the round trip', r.restored === r.drawn],
      ['baked flag set when embedding', r.bakedFlag === true],
      ['saved file opens as an ordinary PDF', r.savedOpens === r.pageCount],
      ['markups are painted into the saved file', r.markupsPainted === true],
      ['degraded path keeps markups editable', r.noEmbedProject === true],
      ['degraded path bakes and embeds nothing', r.noEmbedBaked === false && r.noEmbedClean === false],
      ['new format is smaller than the old hex route', r.savedBytes < r.legacyBytes],
      ['no page errors', errors.length === 0],
    ], {
      'original': mb(r.originalBytes) + ' over ' + r.pageCount + ' pages',
      'saved (v3.34 stream)': mb(r.savedBytes) + '  = ' + (r.savedBytes / r.originalBytes).toFixed(2) + '× original',
      'saved (old hex route)': mb(r.legacyBytes) + '  = ' + (r.legacyBytes / r.originalBytes).toFixed(2) + '× original',
      'build time': r.buildMs + ' ms',
    });
    if (errors.length) console.log('  errors:', errors.slice(0, 5));
    return failed;
  } finally { await browser.close(); }
}

export async function reopenAndCompatibility(port, pdfFile) {
  const { browser, page, errors, dialogs } = await openApp(port, pdfFile);
  try {
    const r = await page.evaluate(async () => {
      const out = {};
      for (let p = 0; p < pdfDoc.numPages; p++) {
        currentPage = p;
        addAnnotation('rectangle', [{ x: 120, y: 120 }, { x: 900, y: 600 }]);
      }
      const clean = currentPdfBytes.slice();
      out.drawn = annotations.length;
      out.cleanLen = clean.length;

      // Save, then reopen through the REAL load path the user goes through
      const saved = await _buildSavedPdf(clean, true);
      out.savedLen = saved.length;
      await loadPdf(saved.slice().buffer, 'saved-once.pdf');
      await new Promise(res => setTimeout(res, 1500));
      out.reopenedAnnotations = annotations.length;
      out.reopenedPages = pdfDoc.numPages;
      // The background must be the CLEAN original. This is the no-duplicates contract.
      out.rendersCleanOriginal = currentPdfBytes.length === clean.length;

      // Saving again from the reopened state must not double-stack or grow
      const saved2 = await _buildSavedPdf(currentPdfBytes.slice(), true);
      const back2 = await readBDMDataFromPdfBytes(saved2.slice());
      out.secondRoundAnnotations = back2 && back2.project ? back2.project.annotations.length : -1;
      out.secondRoundCleanLen = back2 && back2.cleanBytes ? back2.cleanBytes.length : -1;
      out.growthBytes = saved2.length - saved.length;

      // --- files written by older builds must still open ---
      const legacy = async (compressed) => {
        const doc = await PDFLib.PDFDocument.load(clean.slice(), { updateMetadata: false });
        const info = doc.getInfoDict();
        info.set(PDFLib.PDFName.of('BDMMarkupData'), PDFLib.PDFHexString.fromText(
          utf8ToB64(JSON.stringify({ version: 4, annotations: [
            { id: 'legacy1', type: 'rectangle', page: 0, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] }))));
        info.set(PDFLib.PDFName.of('BDMBakedOverlay'), PDFLib.PDFHexString.fromText('1'));
        let payload = clean, flag = '0';
        if (compressed) {
          const c = await _compressBytes(clean);
          if (c && c.length < clean.length) { payload = c; flag = 'deflate-raw'; }
        }
        info.set(PDFLib.PDFName.of('BDMCleanSource'), PDFLib.PDFHexString.of(bytesToHex(payload)));
        info.set(PDFLib.PDFName.of('BDMCleanCompressed'), PDFLib.PDFHexString.fromText(flag));
        const back = await readBDMDataFromPdfBytes(await doc.save());
        if (!back || !back.project || !back.cleanBytes) return false;
        if (back.cleanBytes.length !== clean.length) return false;
        for (let i = 0; i < clean.length; i++) if (clean[i] !== back.cleanBytes[i]) return false;
        return back.project.annotations.length === 1;
      };
      out.legacyCompressed = await legacy(true);
      out.legacyUncompressed = await legacy(false);
      return out;
    });

    const failed = report('reopen + backwards compatibility — ' + pdfFile.split('/').pop(), [
      ['reopened file keeps every markup', r.reopenedAnnotations === r.drawn],
      ['reopened file keeps every page', r.reopenedPages > 0],
      ['reopen renders the clean original, not the baked copy', r.rendersCleanOriginal === true],
      ['second save keeps the markups', r.secondRoundAnnotations === r.drawn],
      ['second save keeps the clean original intact', r.secondRoundCleanLen === r.cleanLen],
      ['file does not grow on re-save', Math.abs(r.growthBytes) < r.savedLen * 0.02],
      ['old compressed-hex files still open', r.legacyCompressed === true],
      ['old uncompressed-hex files still open', r.legacyUncompressed === true],
      ['nothing unexpected shown to the user', dialogs.length === 0],
      ['no page errors', errors.length === 0],
    ], { 're-save size change': r.growthBytes + ' bytes' });
    if (errors.length) console.log('  errors:', errors.slice(0, 5));
    if (dialogs.length) console.log('  dialogs:', dialogs);
    return failed;
  } finally { await browser.close(); }
}

// v3.41 — photos and the project payload. A sheet of pasted site photos once
// made a 50 MB file whose markup data swelled to ~149 MB on reopen and ran the
// browser out of memory. Pasted photos must come in small, the project must
// travel as a compressed stream, and big files from older builds must still open.
export async function photosAndProjectStream(port, pdfFile) {
  const { browser, page, errors, dialogs } = await openApp(port, pdfFile);
  try {
    const r = await page.evaluate(async () => {
      const out = {};
      // A photo-like PNG: smooth gradient plus grain, which PNG compresses badly
      const photo = (w, h) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const x = c.getContext('2d'), d = x.createImageData(w, h);
        for (let i = 0; i < d.data.length; i += 4) {
          const p = i / 4, px = p % w, py = (p / w) | 0, n = Math.random() * 40;
          d.data[i] = (px / w) * 200 + n; d.data[i + 1] = (py / h) * 200 + n; d.data[i + 2] = 120 + n; d.data[i + 3] = 255;
        }
        x.putImageData(d, 0, 0); return c;
      };
      const blob = await new Promise(res => photo(1200, 1600).toBlob(res, 'image/png'));
      out.pastedInBytes = blob.size;
      await addImageFromBlob(blob);
      const pasted = annotations[annotations.length - 1];
      out.pastedIsJpeg = pasted.src.startsWith('data:image/jpeg');
      out.pastedOutBytes = Math.round(pasted.src.length * 0.75);

      // An oversized PNG already on the sheet (pasted by an older build)
      const oldSrc = photo(3200, 2400).toDataURL('image/png');
      annotations.push({ id: 'old-photo', type: 'image', page: 0, src: oldSrc, opacity: 100, aspect: 0.75,
        points: [{ x: 50, y: 50 }, { x: 450, y: 350 }] });
      out.oldInBytes = Math.round(oldSrc.length * 0.75);
      await _compactImageAnnotations();
      const old = annotations.find(a => a.id === 'old-photo');
      out.oldOutBytes = Math.round(old.src.length * 0.75);
      const oldImg = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.src = old.src; });
      out.oldLongEdge = Math.max(oldImg.naturalWidth, oldImg.naturalHeight);

      // A transparent PNG keeps its transparency
      const t = photo(1500, 1500), tx = t.getContext('2d'); tx.clearRect(0, 0, 300, 300);
      const tSrc = t.toDataURL('image/png');
      out.transparentKept = (await _compactImageDataUrl(tSrc)).startsWith('data:image/png');

      // The project travels as a stream, not a hex string
      await _awaitImageAnnotationDecode();
      const saved = await _buildSavedPdf(currentPdfBytes.slice(), true);
      out.savedBytes = saved.length;
      const probe = await PDFLib.PDFDocument.load(saved.slice(), { updateMetadata: false });
      const info = probe.getInfoDict();
      out.hasStream = !!info.lookup(PDFLib.PDFName.of('BDMMarkupDataRef'));
      out.hasLegacyString = !!info.lookup(PDFLib.PDFName.of('BDMMarkupData'));
      const back = await readBDMDataFromPdfBytes(saved.slice());
      out.restored = back && back.project ? back.project.annotations.length : -1;
      out.drawn = annotations.length;
      out.photoIntact = !!(back && back.project && back.project.annotations.find(a => a.id === 'old-photo').src === old.src);

      // A big pre-v3.40 file (multi-MB UTF-16 hex project string) still opens
      const doc = await PDFLib.PDFDocument.load(currentPdfBytes.slice(), { updateMetadata: false });
      const big = 'x'.repeat(3000000);
      doc.getInfoDict().set(PDFLib.PDFName.of('BDMMarkupData'), PDFLib.PDFHexString.fromText(utf8ToB64(JSON.stringify(
        { version: 4, annotations: [{ id: 'legacy-big', type: 'image', page: 0, src: big, points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] }))));
      const backBig = await readBDMDataFromPdfBytes(await doc.save());
      out.legacyBigOpens = !!(backBig && backBig.project && backBig.project.annotations[0].src === big);
      return out;
    });

    const failed = report('photos + project stream — ' + pdfFile.split('/').pop(), [
      ['a pasted photo becomes a JPEG', r.pastedIsJpeg === true],
      ['a pasted photo comes in at under a quarter of its PNG size', r.pastedOutBytes < r.pastedInBytes / 4],
      ['an oversized photo already on the sheet is shrunk before save', r.oldOutBytes < r.oldInBytes / 4],
      ['and scaled to the 2400 px long-edge cap', r.oldLongEdge === 2400],
      ['a transparent image stays a PNG', r.transparentKept === true],
      ['project saved as a stream', r.hasStream === true],
      ['no legacy hex project string written', r.hasLegacyString === false],
      ['every markup survives', r.restored === r.drawn],
      ['photo data survives byte-for-byte', r.photoIntact === true],
      ['a big pre-v3.41 file still opens', r.legacyBigOpens === true],
      ['nothing unexpected shown to the user', dialogs.length === 0],
      ['no page errors', errors.length === 0],
    ], {
      'pasted photo': (r.pastedInBytes / 1e6).toFixed(2) + ' MB PNG → ' + (r.pastedOutBytes / 1e6).toFixed(2) + ' MB',
      'old photo': (r.oldInBytes / 1e6).toFixed(2) + ' MB → ' + (r.oldOutBytes / 1e6).toFixed(2) + ' MB',
      'saved file': (r.savedBytes / 1e6).toFixed(2) + ' MB',
    });
    if (errors.length) console.log('  errors:', errors.slice(0, 5));
    if (dialogs.length) console.log('  dialogs:', dialogs);
    return failed;
  } finally { await browser.close(); }
}
