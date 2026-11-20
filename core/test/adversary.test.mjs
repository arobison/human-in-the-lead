// The adversarial loop (design 6.3, HITLD-32): the invariant registry, the pass, and a break
// becoming a regression test. The first test is the pass itself on this repository's core area:
// it runs on every change, and fails on any break that has no open regression test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attackArea, openRegressions } from '../lib/adversary/attack.mjs';
import { changedFiles, dueRegistries } from '../lib/adversary/due.mjs';
import { evaluate } from '../lib/adversary/forms.mjs';
import { cases, draw, shrink } from '../lib/adversary/generate.mjs';
import { filePending, recordBreak } from '../lib/adversary/record.mjs';
import { CodedError } from '../lib/cli/errors.mjs';
import { readRegistry, registries } from '../lib/adversary/registry.mjs';
import { readRegression, regressionText, retodo } from '../lib/adversary/regression.mjs';
import { seededRandom } from '../lib/eval/util.mjs';
import { loadPolicy } from '../lib/policy/policy.mjs';
import { tempDir } from './helpers/tmp.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

test("the adversarial pass on this repository's core area finds no break without an open regression test", () => {
  const { policy } = loadPolicy({ cwd: ROOT });
  assert.ok(policy);
  const regs = registries(ROOT, /** @type {any} */ (policy));
  const core = regs.find((r) => r.area === 'core');
  assert.ok(core, 'kb/areas/core/invariants.json is the core area registry');
  assert.deepEqual(core.errors, []);
  const r = attackArea(ROOT, core);
  assert.deepEqual(r.errors, []);
  assert.equal(r.checked.length, core.data?.invariants.length, 'every invariant was attacked');
  assert.deepEqual(
    r.breaks.map((b) => `${b.invariant} ${JSON.stringify(b.args)}: ${b.message}`),
    [],
    'a new break: record it with hitld adversary record, or fix it',
  );
  for (const k of r.known) assert.ok(k.tests.length > 0);
});

test('generators: the same seed draws the same inputs, and every input is in its domain', () => {
  /** @type {import('../lib/adversary/generate.mjs').Gen[]} */
  const gens = [
    { type: 'string', chars: 'ab/', min_length: 1, max_length: 5 },
    { type: 'array', items: { type: 'integer', min: 3, max: 9 }, max_items: 4 },
    {
      type: 'object',
      properties: { on: { type: 'boolean' }, k: { type: 'enum', values: ['x', 'y'] } },
    },
  ];
  const a = [...cases(gens, 7, 50)];
  assert.deepEqual([...cases(gens, 7, 50)], a);
  assert.notDeepEqual([...cases(gens, 8, 50)], a);
  for (const [s, list, o] of a) {
    assert.match(/** @type {string} */ (s), /^[ab/]{1,5}$/);
    for (const n of /** @type {number[]} */ (list)) assert.ok(n >= 3 && n <= 9);
    assert.ok(/** @type {unknown[]} */ (list).length <= 4);
    assert.deepEqual(Object.keys(/** @type {object} */ (o)).sort(), ['k', 'on']);
  }
});

test('shrinking keeps the input in its domain and makes it small', () => {
  const g = /** @type {const} */ ({ type: 'string', chars: 'abx', min_length: 2, max_length: 30 });
  const rand = seededRandom(3);
  let big = '';
  while (!big.includes('x') || big.length < 20) big = /** @type {string} */ (draw(g, rand, 1));
  const small = shrink([g], [big], ([s]) => /** @type {string} */ (s).includes('x'));
  assert.equal(/** @type {string} */ (small[0]).length, 2, 'the minimum length holds');
  assert.match(/** @type {string} */ (small[0]), /x/);
  const list = { type: 'array', items: { type: 'integer', min: 5, max: 50 } };
  const [l] = shrink(/** @type {any} */ ([list]), [[40, 12, 33]], ([x]) =>
    /** @type {number[]} */ (x).some((n) => n > 30),
  );
  assert.deepEqual(l, [31]);
});

test('forms: each says what broke, and holds where it should', () => {
  /** @typedef {(...a: any[]) => any} F */
  const id = (/** @type {unknown} */ x) => x;
  assert.equal(evaluate({ form: 'round-trip' }, { target: id, second: id }, ['a']), null);
  assert.match(
    evaluate({ form: 'round-trip' }, { target: /** @type {F} */ ((s) => s + 'x'), second: id }, [
      'a',
    ])?.message ?? '',
    /not 'a'/,
  );
  assert.equal(
    evaluate({ form: 'idempotent' }, { target: /** @type {F} */ ((s) => s.trim()) }, [' a ']),
    null,
  );
  assert.ok(evaluate({ form: 'idempotent' }, { target: /** @type {F} */ ((n) => n + 1) }, [1]));
  const boom = () => {
    throw new Error('no');
  };
  assert.equal(evaluate({ form: 'differential' }, { target: boom, second: boom }, [1]), null);
  assert.match(evaluate({ form: 'total' }, { target: boom }, [1])?.message ?? '', /threw "no"/);
  assert.ok(evaluate({ form: 'holds' }, { target: () => 'yes' }, [1]));
  const first = evaluate(
    { form: 'order-independent' },
    { target: /** @type {F} */ ((l) => l[0]) },
    [[1, 2]],
  );
  assert.deepEqual(first?.variant, [[2, 1]]);
  assert.equal(
    evaluate({ form: 'order-independent' }, { target: /** @type {F} */ ((l) => l.length) }, [
      [1, 2],
    ]),
    null,
  );
});

/**
 * A repository with one area and its registry. @param {Record<string, string>} files
 * @param {Record<string, unknown>} [registry]
 */
function repo(files, registry) {
  const root = tempDir('adversary-');
  const git = (/** @type {string[]} */ ...args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  const all = {
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'adv', key: 'W' },
      rights: { areas: [{ name: 'lib', paths: ['src/**'] }] },
    }),
    'package.json': '{ "type": "module" }\n',
    'kb/areas/lib/invariants.json': JSON.stringify({
      schema_version: 1,
      area: 'lib',
      tests_dir: 'test/adversary',
      invariants: [
        {
          id: 'twice-is-once',
          statement: 'Applying f twice is applying it once.',
          checked: '2026-11-20',
          form: 'idempotent',
          module: 'src/f.js',
          target: 'f',
          args: [{ type: 'integer', min: -50, max: 50 }],
        },
      ],
      ...registry,
    }),
    ...files,
  };
  for (const [p, text] of Object.entries(all)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  return { root, git };
}

/** @param {string} root */
const regsOf = (root) => registries(root, /** @type {any} */ (loadPolicy({ cwd: root }).policy));

test('registry: the schema and the repository are both checked', () => {
  const { root } = repo({ 'src/f.js': 'export const f = (n) => Math.abs(n);\n' });
  const ok = readRegistry(root, 'kb/areas/lib/invariants.json', 'lib');
  assert.deepEqual(ok.errors, []);
  const bad = (/** @type {Record<string, unknown>} */ inv, extra = {}) => {
    const path = 'kb/areas/lib/bad.json';
    writeFileSync(
      join(root, path),
      JSON.stringify({
        schema_version: 1,
        area: 'lib',
        tests_dir: 'test/adversary',
        invariants: [
          {
            id: 'x',
            statement: 'x',
            checked: '2026-11-20',
            module: 'src/f.js',
            target: 'f',
            args: [{ type: 'boolean' }],
            form: 'total',
            ...inv,
          },
        ],
        ...extra,
      }),
    );
    return readRegistry(root, path, 'lib').errors.join('\n');
  };
  assert.match(bad({ form: 'round-trip' }), /needs inverse/);
  assert.match(bad({ module: '../outside.js' }), /leaves the repository root/);
  assert.match(bad({ module: 'src/missing.js' }), /does not exist/);
  assert.match(bad({ inverse: 'g' }), /inverse is not used by total/);
  assert.match(bad({ command: 'rm -rf /' }), /names code to run|command/);
  assert.match(bad({}, { area: 'other' }), /belongs to lib/);
});

test('the probe: what the code prints is not read as results, and it sees no secrets', () => {
  const { root } = repo(
    {
      'src/f.js':
        "export const f = (n) => { console.log('@@noise'); return Math.abs(n); };\nexport const env = () => Object.keys(process.env).filter((k) => k !== 'PATH').length === 0;\n",
    },
    {
      invariants: [
        {
          id: 'twice-is-once',
          statement: 'x',
          checked: '2026-11-20',
          form: 'idempotent',
          module: 'src/f.js',
          target: 'f',
          args: [{ type: 'integer' }],
        },
        {
          id: 'no-secrets',
          statement: 'x',
          checked: '2026-11-20',
          form: 'holds',
          module: 'src/f.js',
          target: 'env',
          args: [{ type: 'boolean' }],
          runs: 1,
        },
      ],
    },
  );
  const [reg] = regsOf(root);
  const prior = process.env.HITLD_TEST_SECRET;
  process.env.HITLD_TEST_SECRET = 'do-not-pass';
  try {
    const r = attackArea(root, reg);
    assert.deepEqual(r.errors, []);
    assert.deepEqual(r.breaks, []);
    assert.equal(r.checked.length, 2);
  } finally {
    if (prior === undefined) delete process.env.HITLD_TEST_SECRET;
    else process.env.HITLD_TEST_SECRET = prior;
  }
});

test('a break becomes a todo regression test, its fix item pending until filed on main', () => {
  const { root, git } = repo({ 'src/f.js': 'export const f = (n) => (n > 9 ? n - 1 : n);\n' });
  const [reg] = regsOf(root);
  const r = attackArea(root, reg);
  assert.equal(r.breaks.length, 1);
  assert.deepEqual(r.breaks[0].args, [11], 'the smallest counterexample');
  const refusing = {
    get: () => ({}),
    createEntity: () => {
      throw new CodedError('not-permitted', 'only the orchestrator creates tracker entities');
    },
  };
  // Any other failure to file is not a refusal: it propagates, and nothing is written.
  assert.throws(() =>
    recordBreak(root, reg, 'twice-is-once', {
      tracker: () => ({
        get: () => ({}),
        createEntity: () => {
          throw new Error('disk');
        },
      }),
    }),
  );
  assert.equal(git('status', '--porcelain').trim(), '');
  const rec = recordBreak(root, reg, 'twice-is-once', {
    tracker: () => refusing,
    env: { HITLD_DISPATCH: 'D-5', HITLD_ROLE: 'adversary' },
  });
  assert.ok(rec.ok);
  if (!rec.ok) return;
  assert.equal(rec.fix, null);
  assert.match(rec.pending?.reason ?? '', /only the orchestrator/);
  assert.match(rec.pending?.draft.body ?? '', /## Done when/);
  assert.match(
    git('log', '-1', '--format=%s%n%b'),
    /its fix item pending[\s\S]*Dispatch: D-5\nAgent-Role: adversary/,
  );
  assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').trim().split('\n'), [rec.test]);
  assert.deepEqual(openRegressions(root, 'test/adversary', 'twice-is-once'), [rec.test]);
  const again = attackArea(root, reg);
  assert.equal(again.breaks.length, 0);
  assert.equal(again.known.length, 1, 'known while its regression test is open');
  const twice = recordBreak(root, reg, 'twice-is-once', { tracker: () => refusing });
  assert.equal(twice.ok, false, 'recorded once');

  const filing = {
    get: () => ({}),
    createEntity: (/** @type {Record<string, unknown>} */ d) => {
      assert.equal(d.state, 'proposed');
      mkdirSync(join(root, 'work/items'), { recursive: true });
      writeFileSync(join(root, 'work/items/W-7-fix.md'), `---\nid: W-7\n---\n${d.body}`);
      return { id: 'W-7', path: 'work/items/W-7-fix.md' };
    },
  };
  const f = filePending(root, [reg], { tracker: () => filing });
  assert.deepEqual(f.skipped, []);
  assert.deepEqual(
    f.filed.map((x) => [x.test, x.fix]),
    [[rec.test, 'W-7']],
  );
  assert.match(readRegression(readFileSync(join(root, rec.test), 'utf8'))?.todo ?? '', /^W-7: /);
  assert.deepEqual(
    git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort(),
    [rec.test, 'work/items/W-7-fix.md'].sort(),
    'the item and the test that names it, in one commit',
  );
  assert.deepEqual(filePending(root, [reg], { tracker: () => filing }).filed, [], 'filed once');
});

test('a false break records nothing', () => {
  const { root, git } = repo({ 'src/f.js': 'export const f = (n) => Math.abs(n);\n' });
  const [reg] = regsOf(root);
  const r = recordBreak(root, reg, 'twice-is-once', {
    args: [-3],
    tracker: () => {
      throw new Error('no item is filed for a false break');
    },
  });
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.reason : '', /^not a break/);
  assert.equal(git('status', '--porcelain').trim(), '');
});

test('a regression test reads back after a formatter rewrites it, and its todo mark changes in place', () => {
  /** @type {any} */
  const data = { tests_dir: 'test/adversary' };
  const inv = /** @type {any} */ ({
    id: 'i',
    statement: 'It\'s "fine".',
    form: 'holds',
    module: 'src/p.js',
    target: 'p',
  });
  const text = regressionText({
    area: 'lib',
    registry: 'kb/areas/lib/invariants.json',
    data,
    inv,
    c: { args: ['a\u2028b'] },
    todo: 'fix item pending: It\'s "fine".',
    message: 'line one\nline two',
  });
  for (const line of text.split('\n').filter((l) => l.startsWith('//'))) {
    assert.doesNotMatch(line, /[\u2028\u2029\r]/);
  }
  const r = readRegression(text);
  assert.deepEqual(r?.args, ['a\u2028b']);
  assert.equal(r?.todo, 'fix item pending: It\'s "fine".');
  // As Prettier with singleQuote writes it: single quotes, the option on its own line.
  const formatted = text.replace(
    /\{ todo: "(.*)" \}/,
    (_m, body) => `{\n    todo: '${JSON.parse(`"${body}"`).replace(/'/g, "\\'")}',\n  }`,
  );
  assert.notEqual(formatted, text);
  assert.equal(readRegression(formatted)?.todo, 'fix item pending: It\'s "fine".');
  const filed = retodo(formatted, 'fix item pending: It\'s "fine".', 'W-3: it\'s "fine".');
  assert.equal(readRegression(filed)?.todo, 'W-3: it\'s "fine".');
  assert.match(filed, /todo: 'W-3: it\\'s "fine"\.'/);
});

test('due: an area is due when a change touches its paths or its registry', () => {
  const { root, git } = repo({ 'src/f.js': 'export const f = (n) => n;\n', 'README.md': 'x\n' });
  const regs = regsOf(root);
  git('switch', '-q', '-c', 'change');
  writeFileSync(join(root, 'README.md'), 'y\n');
  assert.deepEqual(dueRegistries(regs, changedFiles(root, 'main')), []);
  writeFileSync(join(root, 'src/new.js'), 'export {};\n');
  const due = dueRegistries(regs, changedFiles(root, 'main'));
  assert.deepEqual(
    due.map((d) => [d.registry.area, d.changed]),
    [['lib', ['src/new.js']]],
  );
  git('add', '-A');
  git('commit', '-q', '-m', 'change');
  const reg = readFileSync(join(root, 'kb/areas/lib/invariants.json'), 'utf8');
  writeFileSync(join(root, 'kb/areas/lib/invariants.json'), reg.replace('Applying', 'Applying'));
  assert.equal(dueRegistries(regs, changedFiles(root, 'main')).length, 1);
});
