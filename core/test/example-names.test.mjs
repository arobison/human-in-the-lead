// The repository's examples use placeholder names, so an owner who followed the guide and chose
// the names it once showed still passes `hitld work check` (design part 10.3, private names).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTree, STRICT } from '../lib/guard/classification.mjs';
import { compileTerms } from '../lib/guard/private-terms.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Names this repository's examples once used, built here so this file does not hold them.
 * @param {...string} parts
 */
const old = (...parts) => parts.join('-');

/** The private-term refusals the tree scan finds for a list. @param {string[]} names */
function scan(names) {
  const terms = compileTerms(names.map((term) => ({ term, kind: 'device' })));
  return checkTree(root, { ...STRICT, terms }).refused.filter((r) => r.rule === 'private-term');
}

test('the tree scan finds none of the device names the examples once used', () => {
  const found = scan([old('cloud', 'main'), old('cloud', 'test'), old('owners', 'laptop')]);
  assert.deepEqual(
    found.map((r) => `${r.path} line ${r.line}`),
    [],
  );
});

test('the scan does find a term that is in the tree', () => {
  // The guide's placeholder repository name is in the tree: the scan sees it, so the test above
  // would see an old name too.
  const found = scan(['sample-app-store']);
  assert.ok(found.length > 0);
  assert.ok(found.every((r) => r.kind === 'device'));
});
