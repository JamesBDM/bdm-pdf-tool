// Run the Datum save-format tests.
//
//   npm test                 the standard run (a few minutes)
//   npm test -- --large 150  also save a 150MB set, to check the ceiling holds
//
import path from 'node:path';
import { buildAppUnderTest, serve, report, WORK, HERE } from './harness.mjs';
import { ensureFixtures, ensureLarge } from './fixtures.mjs';
import { buildSnapFixture, buildTransformFixture, buildDenseFixture } from './snap-fixture.mjs';
import { roundTrip, reopenAndCompatibility } from './save-format.test.mjs';
import { snapGeometry, snapTransforms, snapPerformance } from './snap.test.mjs';

const args = process.argv.slice(2);
const largeAt = args.includes('--large') ? Number(args[args.indexOf('--large') + 1] || 150) : 0;
const fixtures = path.join(WORK, 'fixtures');

console.log('Building a copy of the app with the CDN libraries served locally…');
buildAppUnderTest();

console.log('Building test drawings…');
const made = await ensureFixtures(fixtures);
const snapPdf = await buildSnapFixture(fixtures);
const xfPdf = await buildTransformFixture(fixtures);
const xfRotPdf = await buildTransformFixture(fixtures, 90);
const densePdf = await buildDenseFixture(fixtures);
console.log(made.length ? '  created ' + made.join(', ') : '  reusing cached drawings');

const server = await serve();
let failed = 0;
try {
  failed += await roundTrip(server.port, path.join(fixtures, 'heavy.pdf'));
  failed += await reopenAndCompatibility(server.port, path.join(fixtures, 'plain-8p.pdf'));
  failed += await snapGeometry(server.port, snapPdf);
  failed += await snapTransforms(server.port, xfPdf, false);
  failed += await snapTransforms(server.port, xfRotPdf, true);
  failed += await snapPerformance(server.port, densePdf);

  if (largeAt) {
    console.log('\nBuilding a ' + largeAt + 'MB set (this takes a minute)…');
    const big = await ensureLarge(fixtures, largeAt);
    failed += await roundTrip(server.port, big);
  }
} finally {
  await server.close();
}

console.log('\n' + (failed ? failed + ' CHECK(S) FAILED' : 'All checks passed.'));
process.exit(failed ? 1 : 0);
