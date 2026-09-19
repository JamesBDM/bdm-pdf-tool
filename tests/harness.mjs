// Shared plumbing: vendor the CDN libraries locally, build a copy of the real
// app that points at them, serve it, and hand back a Chromium page with the
// app loaded and a PDF open.
//
// Why a copy: the app loads pdf.js and pdf-lib from a CDN, which a test machine
// may not be able to reach. The copy swaps those two <script> tags for local
// files at the SAME pinned versions and changes nothing else, so what runs is
// the real BDM-PDF-Markup-Tool.html.
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

export const HERE = path.dirname(url.fileURLToPath(import.meta.url));
export const REPO = path.join(HERE, '..');
export const WORK = path.join(HERE, '.work');

const APP = 'BDM-PDF-Markup-Tool.html';
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.pdf': 'application/pdf',
                '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

export function buildAppUnderTest() {
  fs.mkdirSync(path.join(WORK, 'vendor'), { recursive: true });
  const copy = (from, to) => fs.copyFileSync(
    path.join(HERE, 'node_modules', from), path.join(WORK, 'vendor', to));
  copy('pdf-lib/dist/pdf-lib.min.js', 'pdf-lib.min.js');
  copy('pdfjs-dist/build/pdf.min.js', 'pdf.min.js');
  copy('pdfjs-dist/build/pdf.worker.min.js', 'pdf.worker.min.js');

  let html = fs.readFileSync(path.join(REPO, APP), 'utf8');
  const before = html;
  html = html.replace('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', 'vendor/pdf.min.js');
  html = html.replace('https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js', 'vendor/pdf-lib.min.js');
  if (html === before) throw new Error('Could not redirect the CDN script tags — did their URLs change in ' + APP + '?');
  html = html.replace(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/, '');
  html = html.replace('<script src="vendor/pdf-lib.min.js"></scr' + 'ipt>',
    '<script src="vendor/pdf-lib.min.js"></scr' + 'ipt>\n'
    + '<script>pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";</scr' + 'ipt>');
  fs.writeFileSync(path.join(WORK, 'app-under-test.html'), html);
}

export function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    for (const root of [WORK, REPO]) {
      const file = path.join(root, rel);
      if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        fs.createReadStream(file).pipe(res);
        return;
      }
    }
    res.writeHead(404).end('not found');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    close: () => new Promise(r => server.close(r)),
  })));
}

// Open the app with `pdfFile` loaded. Returns the page plus collected noise.
export async function openApp(port, pdfFile) {
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const page = await browser.newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text());
  });
  page.on('dialog', d => { dialogs.push(d.message().slice(0, 200)); d.accept(); });

  await page.goto('http://127.0.0.1:' + port + '/app-under-test.html');
  await page.waitForFunction(() => typeof saveProject === 'function');
  await page.setInputFiles('#pdf-input', pdfFile);
  // NOTE: the app's state lives in top-level `let` bindings, which are NOT
  // properties of window. Use bare identifiers with a typeof guard.
  await page.waitForFunction(
    () => typeof pdfDoc !== 'undefined' && pdfDoc
          && typeof currentPdfBytes !== 'undefined' && currentPdfBytes && currentPdfBytes.length > 0,
    null, { timeout: 120000 });

  return { browser, page, errors, dialogs };
}

export function report(title, checks, extras = {}) {
  console.log('\n=== ' + title + ' ===');
  for (const [k, v] of Object.entries(extras)) console.log('  ' + k + ': ' + v);
  let failed = 0;
  for (const [name, ok] of checks) { if (!ok) failed++; console.log((ok ? '  PASS  ' : '  FAIL  ') + name); }
  return failed;
}

export const mb = n => (n / 1048576).toFixed(2) + ' MB';
