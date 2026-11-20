// The fixture area for the adversarial loop's scenarios (design 17.1 and 17.8: one fixture area
// with five seeded bugs and three clean controls). Synthetic and public: a small text module with
// an invariant registry, example tests that pass on every variant, and one branch per variant.
//
// Each seeded bug breaks exactly one registered invariant at a known place, and the example tests
// do not catch it: finding it is the adversarial pass's work. Each clean control changes the area
// without breaking anything, so the pass must raise nothing on it.

import {
  buildConsumer,
  commitAll,
  fixtureGit,
  itemFile,
  putFiles,
} from './orchestrator-fixtures.mjs';

const MODULE = {
  escape: `// A field of a comma-separated record: % and , written as %25 and %2C.
export function escapeField(s) {
  return s.replace(/%/g, '%25').replace(/,/g, '%2C');
}

export function unescapeField(s) {
  return s.replace(/%2C/g, ',').replace(/%25/g, '%');
}
`,
  squeeze: `// Runs of slashes in a path become one.
export function squeeze(path) {
  return path.replace(/\\/+/g, '/');
}
`,
  distinct: `// The distinct words of a list, sorted.
export function distinct(words) {
  return words.filter((w, i) => words.indexOf(w) === i).sort();
}
`,
  count: `// How many times word occurs in text, without overlaps, left to right.
export function countWord(text, word) {
  let n = 0;
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + word.length)) n++;
  return n;
}

// The slow version: the oracle.
export function countWordSlow(text, word) {
  return text.split(word).length - 1;
}
`,
  record: `// A record "k=v;k2=v2" as an object. Pieces with no "=" are skipped.
export function parseRecord(line) {
  const out = {};
  for (const piece of line.split(';')) {
    const at = piece.indexOf('=');
    if (at < 1) continue;
    out[piece.slice(0, at).trim()] = piece.slice(at + 1).trim();
  }
  return out;
}
`,
};

/** The variants: what each changes in src/text.js, and the invariant a seeded bug breaks. */
export const VARIANTS = Object.freeze({
  // Seeded bugs.
  'bug-escape': {
    breaks: 'field-round-trip',
    part: 'escape',
    text: MODULE.escape.replace(".replace(/%/g, '%25')", ''),
  },
  'bug-squeeze': {
    breaks: 'squeeze-idempotent',
    part: 'squeeze',
    text: MODULE.squeeze.replace('/\\/+/g', '/\\/\\//g'),
  },
  'bug-distinct': {
    breaks: 'distinct-order-independent',
    part: 'distinct',
    text: MODULE.distinct.replace('words.indexOf(w) === i', 'i === 0 || words[i - 1] !== w'),
  },
  'bug-count': {
    breaks: 'count-matches-slow',
    part: 'count',
    text: MODULE.count.replace(
      'i >= 0; i = text.indexOf(word, i + word.length)',
      'i >= 0 && i + word.length < text.length; i = text.indexOf(word, i + word.length)',
    ),
  },
  'bug-record': {
    breaks: 'record-total',
    part: 'record',
    text: MODULE.record.replace(
      "const at = piece.indexOf('=');\n    if (at < 1) continue;\n    out[piece.slice(0, at).trim()] = piece.slice(at + 1).trim();",
      "if (!piece) continue;\n    const [k, v] = piece.split('=');\n    out[k.trim()] = v.trim();",
    ),
  },
  // Clean controls: the same behavior written another way, or an unrelated addition.
  'clean-squeeze': {
    breaks: null,
    part: 'squeeze',
    text: `// Runs of slashes in a path become one.
export function squeeze(path) {
  let out = '';
  for (const c of path) if (!(c === '/' && out.endsWith('/'))) out += c;
  return out;
}
`,
  },
  'clean-distinct': {
    breaks: null,
    part: 'distinct',
    text: `// The distinct words of a list, sorted.
export function distinct(words) {
  return [...new Set(words)].sort();
}
`,
  },
  'clean-addition': {
    breaks: null,
    part: 'record',
    text: `${MODULE.record}
// The record's keys, sorted.
export function recordKeys(line) {
  return Object.keys(parseRecord(line)).sort();
}
`,
  },
  // A change outside the area: the pass is not due.
  outside: { breaks: null, part: null, text: null },
});

/** @param {Partial<Record<keyof typeof MODULE, string>>} parts */
const moduleText = (parts) =>
  /** @type {(keyof typeof MODULE)[]} */ (Object.keys(MODULE))
    .map((k) => parts[k] ?? MODULE[k])
    .join('\n');

const EXAMPLES = `import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as t from '../src/text.js';

test('a field with a comma round-trips', () => {
  assert.equal(t.unescapeField(t.escapeField('a,b')), 'a,b');
});
test('squeeze joins a double slash', () => assert.equal(t.squeeze('a//b'), 'a/b'));
test('distinct sorts', () => assert.deepEqual(t.distinct(['b', 'a']), ['a', 'b']));
test('countWord counts', () => assert.equal(t.countWord('a b a c', 'a'), 2));
test('parseRecord reads pairs', () => assert.deepEqual(t.parseRecord('a=1;b=2'), { a: '1', b: '2' }));
`;

const WORDS = { type: 'enum', values: ['a', 'b', 'c', 'ab'] };

/** The fixture area's invariant registry. */
export const REGISTRY = Object.freeze({
  schema_version: 1,
  area: 'text',
  tests_dir: 'test/adversary',
  fix_parent: 'W-8',
  invariants: [
    {
      id: 'field-round-trip',
      statement: 'A field read back after escaping is the field.',
      checked: '2026-11-20',
      form: 'round-trip',
      module: 'src/text.js',
      target: 'escapeField',
      inverse: 'unescapeField',
      args: [{ type: 'string', chars: 'ab,%2C5', max_length: 8 }],
    },
    {
      id: 'squeeze-idempotent',
      statement: 'Squeezing a squeezed path changes nothing.',
      checked: '2026-11-20',
      form: 'idempotent',
      module: 'src/text.js',
      target: 'squeeze',
      args: [{ type: 'string', chars: 'a/', max_length: 8 }],
    },
    {
      id: 'distinct-order-independent',
      statement: 'The distinct words do not depend on the order of the list.',
      checked: '2026-11-20',
      form: 'order-independent',
      module: 'src/text.js',
      target: 'distinct',
      args: [{ type: 'array', items: WORDS, max_items: 6 }],
    },
    {
      id: 'count-matches-slow',
      statement: 'countWord agrees with the slow count for every text and word.',
      checked: '2026-11-20',
      form: 'differential',
      module: 'src/text.js',
      target: 'countWord',
      oracle: 'countWordSlow',
      args: [{ type: 'string', chars: 'ab ', max_length: 8 }, WORDS],
    },
    {
      id: 'record-total',
      statement: 'parseRecord reads any line without throwing.',
      checked: '2026-11-20',
      form: 'total',
      module: 'src/text.js',
      target: 'parseRecord',
      args: [{ type: 'string', chars: 'ab=; ', max_length: 10 }],
    },
  ],
});

/**
 * The fixture repository: main holds the clean area, and the branch for the variant changes it.
 * The branch is checked out.
 * @param {string} root @param {keyof typeof VARIANTS} variant
 * @returns {{ root: string, branch: string }}
 */
export function buildAdversaryRepo(root, variant) {
  const v = VARIANTS[variant];
  if (!v)
    throw new Error(`unknown variant ${variant} (known: ${Object.keys(VARIANTS).join(', ')})`);
  buildConsumer(root, {
    policy: { rights: { areas: [{ name: 'text', paths: ['src/**'] }] } },
    files: {
      'src/text.js': moduleText({}),
      'test/text.test.js': EXAMPLES,
      'kb/areas/text/invariants.json': `${JSON.stringify(REGISTRY, null, 2)}\n`,
      'work/projects/W-8-the-text-area.md': itemFile(
        { id: 'W-8', title: 'The text area', kind: 'project', state: 'planned' },
        '\n## Summary\n\nThe fixture area.\n',
      ),
    },
  });
  const branch = `hitld/W-20-${variant}`;
  // A fixed mark for where main started, so what the pass commits can be told from the fixture.
  fixtureGit(root, 'tag', 'main-at-start');
  fixtureGit(root, 'switch', '-q', '-c', branch);
  if (v.part && v.text) {
    putFiles(root, { 'src/text.js': moduleText({ [v.part]: v.text }) });
  } else {
    putFiles(root, { 'docs/notes.md': 'A note outside the area.\n' });
  }
  commitAll(root, variant);
  return { root, branch };
}
