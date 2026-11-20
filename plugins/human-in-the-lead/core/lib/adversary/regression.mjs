// A break becomes a regression test (design 6.3, step 3): a node:test file in the area's tests
// directory that checks the invariant on the counterexample, marked todo with its fix item, so the
// suite stays green while the fix is open and the test starts passing when the fix lands. The
// test stands alone: it imports only the area's own modules, and checks what the pass checked.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { testPrefix } from './attack.mjs';

/**
 * @typedef {import('./registry.mjs').Invariant} Invariant
 * @typedef {import('./registry.mjs').RegistryData} RegistryData
 * @typedef {{ args: unknown[], variant?: unknown[] }} Counterexample
 */

/** @param {Counterexample} c */
const digest = (c) =>
  createHash('sha256')
    .update(JSON.stringify({ args: c.args, variant: c.variant ?? null }))
    .digest('hex')
    .slice(0, 8);

/**
 * The regression test's path, repository-relative.
 * @param {RegistryData} data @param {Invariant} inv @param {Counterexample} c
 */
export function regressionPath(data, inv, c) {
  const ext = inv.module.endsWith('.mjs') ? 'mjs' : 'js';
  return posix.join(data.tests_dir, `${testPrefix(inv.id)}${digest(c)}.test.${ext}`);
}

/** An import specifier from the test's directory to a module. @param {string} from @param {string} to */
function specifier(from, to) {
  const rel = posix.relative(posix.dirname(from), to);
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** @param {unknown} v */
const js = (v) => JSON.stringify(v);

/**
 * An argument list as a typed tuple, so a type checker accepts spreading it into the target.
 * @param {unknown[]} list
 */
const tuple = (list) => `/** @type {[${list.map(() => 'any').join(', ')}]} */ (${js(list)})`;

/** Text for a comment line: no character that would end the line. @param {string} t */
const oneLine = (t) =>
  t.replace(/[\r\n\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** The line that carries the break as data, for filing its fix item later. */
const META = '// hitld-adversary:';

/** The todo mark of a test whose fix item is not filed yet. @param {string} statement */
export const pendingTodo = (statement) => `fix item pending: ${statement}`;

/** The todo mark once the fix item is filed. @param {string} id @param {string} statement */
export const filedTodo = (id, statement) => `${id}: ${statement}`;

/**
 * The break a regression test records, and its todo mark, or null when the file is not one.
 * @param {string} text
 * @returns {{ area: string, invariant: string, args: unknown[], variant?: unknown[], message: string, todo: string | null } | null}
 */
export function readRegression(text) {
  const line = text.split('\n').find((l) => l.startsWith(`${META} `));
  if (!line) return null;
  try {
    const meta = JSON.parse(line.slice(META.length + 1));
    const mark = todoMark(text);
    return { ...meta, todo: mark ? mark.value : null };
  } catch {
    return null;
  }
}

/**
 * The todo option in a test's source, in either quote style and across a line break, as a
 * formatter may leave it.
 * @param {string} text
 * @returns {{ at: number, length: number, quote: string, value: string } | null}
 */
function todoMark(text) {
  const m = /\btodo:\s*(?:(")((?:[^"\\\n]|\\.)*)"|(')((?:[^'\\\n]|\\.)*)')/.exec(text);
  if (!m) return null;
  const quote = m[1] ?? m[3];
  const body = m[2] ?? m[4];
  const value =
    quote === '"'
      ? JSON.parse(`"${body}"`)
      : JSON.parse(`"${body.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`);
  return { at: m.index, length: m[0].length, quote, value };
}

/** A string literal in a quote style. @param {string} s @param {string} quote */
function literal(s, quote) {
  const json = JSON.stringify(s);
  if (quote === '"') return json;
  return `'${json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'")}'`;
}

/**
 * The same test with another todo mark, written in the quote style it had.
 * @param {string} text @param {string} from @param {string} to
 */
export function retodo(text, from, to) {
  const mark = todoMark(text);
  if (!mark || mark.value !== from) throw new Error('the test does not carry that todo mark');
  return `${text.slice(0, mark.at)}todo: ${literal(to, mark.quote)}${text.slice(mark.at + mark.length)}`;
}

/**
 * The test's source.
 * @param {{ area: string, registry: string, data: RegistryData, inv: Invariant,
 *   c: Counterexample, todo: string, message: string }} o
 */
export function regressionText({ area, registry, data, inv, c, todo, message }) {
  const path = regressionPath(data, inv, c);
  const second = inv.form === 'round-trip' ? inv.inverse : inv.oracle;
  const otherModule = inv.oracle_module && inv.oracle_module !== inv.module;
  const t = `subject.${inv.target}`;
  const s = second ? `${otherModule ? 'oracle' : 'subject'}.${second}` : '';
  /** @type {Record<string, string[]>} */
  const bodies = {
    total: [`${t}(...args);`],
    holds: [`assert.equal(${t}(...args), true);`],
    idempotent: [`const once = ${t}(...args);`, `assert.deepEqual(${t}(once), once);`],
    'round-trip': [`assert.deepEqual(${s}(${t}(...structuredClone(args))), args[0]);`],
    differential: [
      '/** @param {(...a: any[]) => unknown} f */',
      'const run = (f) => {',
      '  try {',
      '    return { value: f(...structuredClone(args)) };',
      '  } catch {',
      '    return { threw: true };',
      '  }',
      '};',
      `assert.deepEqual(run(${t}), run(${s}));`,
    ],
    'order-independent': [
      `const reordered = ${tuple(c.variant ?? [])};`,
      `assert.deepEqual(${t}(...reordered), ${t}(...args));`,
    ],
  };
  const meta = {
    area,
    invariant: inv.id,
    args: c.args,
    ...(c.variant ? { variant: c.variant } : {}),
    message,
  };
  const lines = [
    `// An adversarial regression test (design 6.3): the pass broke invariant ${inv.id} of area`,
    `// ${area} (${registry}) with the arguments below. Once the fix is in, this test passes;`,
    '// then remove its todo mark. It stays unless a decision retires it.',
    '//',
    ...message
      .split('\n')
      .slice(0, 6)
      .map((l) => `// Found: ${oneLine(l.slice(0, 300))}`),
    `${META} ${oneLine(js(meta))}`,
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    `import * as subject from ${js(specifier(path, inv.module))};`,
    ...(otherModule
      ? [
          `import * as oracle from ${js(specifier(path, /** @type {string} */ (inv.oracle_module)))};`,
        ]
      : []),
    '',
    `test(${js(`invariant ${inv.id}: ${inv.statement}`)}, { todo: ${js(todo)} }, () => {`,
    `  const args = ${tuple(c.args)};`,
    ...bodies[inv.form].map((l) => `  ${l}`),
    '});',
    '',
  ];
  return lines.join('\n');
}

/**
 * Whether the test file fails, as node:test reports a failing todo test. Runs it with no secrets
 * in the environment.
 * @param {string} root @param {string} rel
 * @returns {{ fails: boolean, output: string }}
 */
export function regressionFails(root, rel) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', rel], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
    timeout: 120_000,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { fails: /^\s*not ok \d+ - .*# TODO/m.test(output), output };
}
