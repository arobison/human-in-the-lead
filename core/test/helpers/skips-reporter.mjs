// A node:test reporter that writes one JSON line per skipped test: its file, its name and the
// reason it gave (HITLD-185). `npm test` runs it when HITLD_TEST_SKIPS_FILE names a file to write
// to (core/test/run.mjs), and CI then checks the lines against core/test/expected-skips.json
// (scripts/test-skips.mjs).
//
//   node --test --test-reporter=./core/test/helpers/skips-reporter.mjs \
//     --test-reporter-destination=skips.jsonl ...

import { relative, sep } from 'node:path';

/**
 * @param {AsyncIterable<{ type: string, data: any }>} source
 * @returns {AsyncGenerator<string>}
 */
export default async function* skipsReporter(source) {
  for await (const event of source) {
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const { data } = event;
    if (data.skip === undefined || data.skip === false) continue;
    const file = data.file ? relative(process.cwd(), data.file).split(sep).join('/') : '';
    const reason = typeof data.skip === 'string' ? data.skip : '';
    yield `${JSON.stringify({ file, name: data.name, reason })}\n`;
  }
}
