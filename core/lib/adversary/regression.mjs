// A break becomes a regression test (design 6.3, step 3): a node:test file in the area's tests
// directory that checks the invariant on the counterexample, marked todo with its fix item, so the
// suite stays green while the fix is open and the test starts passing when the fix lands. The
// test stands alone: it imports only the area's own modules, and checks what the pass checked.

import { spawnSync } from 'node:child_process';
import { posix } from 'node:path';
import { counterexampleDigest } from './forms.mjs';

/**
 * @typedef {import('./registry.mjs').Invariant} Invariant
 * @typedef {import('./registry.mjs').RegistryData} RegistryData
 * @typedef {{ args: unknown[], variant?: unknown[] }} Counterexample
 * @typedef {{ area: string, invariant: string, args: unknown[], variant?: unknown[],
 *   message: string, todo: string, digest: string, marked: boolean }} Regression
 *   todo: the mark as written; marked: the test still carries a todo option
 */

/** The regression test file name prefix for an invariant: for naming only. @param {string} id */
export const testPrefix = (id) => `adversary-${id}-`;

/**
 * The regression test's path, repository-relative.
 * @param {RegistryData} data @param {Invariant} inv @param {Counterexample} c
 */
export function regressionPath(data, inv, c) {
  const ext = inv.module.endsWith('.mjs') ? 'mjs' : 'js';
  return posix.join(data.tests_dir, `${testPrefix(inv.id)}${counterexampleDigest(c)}.test.${ext}`);
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

/** A character as a \u escape. @param {string} c */
const escaped = (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;

/** Text for a comment line: no character that would end the line. @param {string} t */
const oneLine = (t) => t.replace(/[\r\n\u2028\u2029]/g, escaped);

/**
 * A JavaScript string literal in the given quote, built in one pass: the quote and the backslash
 * are escaped, and every control or line-ending character and every lone surrogate is written as
 * a \u escape, as JSON.stringify writes them.
 * @param {string} s @param {string} quote ' or "
 */
export function literal(s, quote) {
  let out = quote;
  for (const c of s) {
    const code = c.charCodeAt(0);
    if (c === quote || c === '\\') out += `\\${c}`;
    else if (
      code < 0x20 ||
      code === 0x7f ||
      c === '\u2028' ||
      c === '\u2029' ||
      (c.length === 1 && code >= 0xd800 && code <= 0xdfff) // a lone surrogate, as JSON writes it
    ) {
      out += escaped(c);
    } else out += c;
  }
  return `${out}${quote}`;
}

/** The line that carries the break as data: the counterexample and the todo mark. */
const META = '// hitld-adversary:';

/** The todo mark of a test whose fix item is not filed yet. @param {string} statement */
export const pendingTodo = (statement) => `fix item pending: ${statement}`;

/** The todo mark once the fix item is filed. @param {string} id @param {string} statement */
export const filedTodo = (id, statement) => `${id}: ${statement}`;

/**
 * The end of the string literal that opens at `at`, past its closing quote, or -1. Only escapes
 * are skipped; nothing is decoded.
 * @param {string} text @param {number} at
 */
function literalEnd(text, at) {
  const quote = text[at];
  for (let i = at + 1; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === quote) return i + 1;
    else if (text[i] === '\n' && quote !== '`') return -1;
  }
  return -1;
}

/**
 * Where the todo option's string literal sits in the test call, or null. The search starts at the
 * `test(` call, past the comments and the metadata line, and skips every string literal on the
 * way, so a counterexample or a title that holds "todo:" is never taken for the option.
 * @param {string} text
 * @returns {{ start: number, end: number, quote: string } | null}
 */
function todoLiteral(text) {
  const call = /^test\(/m.exec(text);
  if (!call) return null;
  for (let i = call.index; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = literalEnd(text, i);
      if (end < 0) return null;
      i = end - 1;
      continue;
    }
    if (c === '=' && text[i + 1] === '>') return null; // the test's body: no option before it
    if (text.startsWith('todo', i) && !/[\w$]/.test(text[i - 1] ?? '')) {
      let j = i + 4;
      while (/\s/.test(text[j] ?? '')) j++;
      if (text[j] !== ':') continue;
      j++;
      while (/\s/.test(text[j] ?? '')) j++;
      if (text[j] !== '"' && text[j] !== "'") return null;
      const end = literalEnd(text, j);
      return end < 0 ? null : { start: j, end, quote: text[j] };
    }
  }
  return null;
}

/**
 * The break a regression test records, or null when the file is not one.
 * @param {string} text
 * @returns {Regression | null}
 */
export function readRegression(text) {
  const line = text.split('\n').find((l) => l.startsWith(`${META} `));
  if (!line) return null;
  try {
    const meta = JSON.parse(line.slice(META.length + 1));
    if (typeof meta.invariant !== 'string' || !Array.isArray(meta.args)) return null;
    return {
      ...meta,
      todo: typeof meta.todo === 'string' ? meta.todo : '',
      digest: counterexampleDigest(meta),
      marked: todoLiteral(text) !== null,
    };
  } catch {
    return null;
  }
}

/**
 * The same test with another todo mark: in the metadata line, and in the test call in the quote
 * style it had.
 * @param {string} text @param {string} from @param {string} to
 */
export function retodo(text, from, to) {
  const r = readRegression(text);
  const at = todoLiteral(text);
  if (!r || !at || r.todo !== from) throw new Error('the test does not carry that todo mark');
  const swapped = `${text.slice(0, at.start)}${literal(to, at.quote)}${text.slice(at.end)}`;
  return swapped
    .split('\n')
    .map((l) => {
      if (!l.startsWith(`${META} `)) return l;
      const meta = JSON.parse(l.slice(META.length + 1));
      return `${META} ${oneLine(js({ ...meta, todo: to }))}`;
    })
    .join('\n');
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
    todo,
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
    `test(${js(`invariant ${inv.id}: ${inv.statement}`)}, { todo: ${literal(todo, '"')} }, () => {`,
    `  const args = ${tuple(c.args)};`,
    ...bodies[inv.form].map((l) => `  ${l}`),
    '});',
    '',
  ];
  return lines.join('\n');
}

/**
 * Whether the test file fails, as node:test reports a failing todo test. Runs it with no secrets
 * in the environment. loaded false: the file did not get as far as its test (it does not import
 * or parse), and cause says why.
 * @param {string} root @param {string} rel
 * @returns {{ fails: boolean, loaded: boolean, cause: string, output: string }}
 */
export function regressionFails(root, rel) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', rel], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
    timeout: 120_000,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const loaded = /^\s*(?:not )?ok \d+ - invariant /m.test(output);
  const cause = loaded
    ? ''
    : (output.match(/^#?\s*((?:[A-Z][A-Za-z]*Error|Error)\b[^\n]*)/m)?.[1] ??
        output.trim().split('\n').slice(-3).join(' ')) ||
      (r.error ? r.error.message : 'no output');
  return { fails: loaded && /^\s*not ok \d+ - .*# TODO/m.test(output), loaded, cause, output };
}
