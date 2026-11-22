// The adversarial loop (design 6.3, HITLD-32): the invariant registry, the pass, and a break
// becoming a regression test. The first test is the pass itself on this repository's core area:
// it runs on every change, and fails on any break that has no open regression test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { attackArea, openRegressions } from '../lib/adversary/attack.mjs';
import { changedFiles, dueRegistries } from '../lib/adversary/due.mjs';
import { evaluate } from '../lib/adversary/forms.mjs';
import { cases, draw, shrink } from '../lib/adversary/generate.mjs';
import { filePending, recordBreak } from '../lib/adversary/record.mjs';
import { CodedError } from '../lib/cli/errors.mjs';
import { readRegistry, registries } from '../lib/adversary/registry.mjs';
import {
  literal,
  readRegression,
  regressionFails,
  regressionText,
  retodo,
} from '../lib/adversary/regression.mjs';
import { main } from '../lib/cli/main.mjs';
import { moduleFor, REGISTRY, VARIANTS } from '../lib/eval/adversary-fixtures.mjs';
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
 * @param {Record<string, unknown>} [registry] @param {Record<string, unknown>} [policyExtra]
 */
function repo(files, registry, policyExtra = {}) {
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
      rights: { areas: [{ name: 'lib', paths: ['src/**', 'test/**'] }] },
      ...policyExtra,
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

/** A tracker that refuses to create items, as the files tracker does off main. */
const refusing = {
  get: () => ({}),
  createEntity: () => {
    throw new CodedError('not-permitted', 'only the orchestrator creates tracker entities');
  },
};

/** A tracker that files items into the repository, as W-7, W-8 and so on. @param {string} root */
function filingTracker(root) {
  let n = 7;
  /** @type {Record<string, unknown>[]} */
  const made = [];
  return {
    made,
    get: (/** @type {string} */ id) => {
      if (!/^W-(7|8|9)$/.test(id)) throw new Error(`no item ${id}`);
      return {};
    },
    createEntity: (/** @type {Record<string, unknown>} */ d) => {
      made.push(d);
      const id = `W-${n++}`;
      mkdirSync(join(root, 'work/items'), { recursive: true });
      writeFileSync(join(root, `work/items/${id}-fix.md`), `---\nid: ${id}\n---\n${d.body}`);
      return { id, path: `work/items/${id}-fix.md` };
    },
  };
}

test('a break becomes a todo regression test, its fix item pending until filed on main', () => {
  const { root, git } = repo({ 'src/f.js': 'export const f = (n) => (n > 9 ? n - 1 : n);\n' });
  const [reg] = regsOf(root);
  const r = attackArea(root, reg);
  assert.equal(r.breaks.length, 1);
  assert.deepEqual(r.breaks[0].args, [11], 'the smallest counterexample');
  // Any other failure to file is not a refusal: it propagates, and nothing is left behind.
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
  assert.deepEqual(
    openRegressions(root, 'test/adversary', 'twice-is-once').map((o) => o.test),
    [rec.test],
  );
  const again = attackArea(root, reg);
  assert.equal(again.breaks.length, 0);
  assert.equal(again.known.length, 1, 'known while its regression test is open');
  const twice = recordBreak(root, reg, 'twice-is-once', { tracker: () => refusing });
  assert.equal(twice.ok, false, 'recorded once');

  const tracker = filingTracker(root);
  const f = filePending(root, [reg], { tracker: () => tracker });
  assert.deepEqual(f.skipped, []);
  assert.deepEqual(
    f.filed.map((x) => [x.tests, x.fix]),
    [[[rec.test], 'W-7']],
  );
  assert.equal(tracker.made[0].state, 'proposed');
  assert.match(readRegression(readFileSync(join(root, rec.test), 'utf8'))?.todo ?? '', /^W-7: /);
  assert.deepEqual(
    git('show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort(),
    [rec.test, 'work/items/W-7-fix.md'].sort(),
    'the item and the test that names it, in one commit',
  );
  assert.deepEqual(filePending(root, [reg], { tracker: () => tracker }).filed, [], 'filed once');
});

test('--fix must be an existing item ID: it cannot carry trailers into the commit', () => {
  const { root, git } = repo({ 'src/f.js': 'export const f = (n) => (n > 9 ? n - 1 : n);\n' });
  const [reg] = regsOf(root);
  const tracker = filingTracker(root);
  const forged = 'W-1\n\nWork-Item: W-999\nDispatch: D-77\nSigned-off-by: Eve <e@x>';
  const bad = recordBreak(root, reg, 'twice-is-once', { tracker: () => tracker, fix: forged });
  assert.equal(bad.ok, false);
  assert.match(!bad.ok ? bad.reason : '', /must be an item ID/);
  const missing = recordBreak(root, reg, 'twice-is-once', { tracker: () => tracker, fix: 'W-1' });
  assert.match(!missing.ok ? missing.reason : '', /no item W-1/);
  assert.equal(git('status', '--porcelain').trim(), '');
  assert.equal(git('rev-list', '--count', 'HEAD').trim(), '1');
  const ok = recordBreak(root, reg, 'twice-is-once', { tracker: () => tracker, fix: 'W-8' });
  assert.ok(ok.ok);
  assert.match(
    git('log', '-1', '--format=%B'),
    /^W-8: regression test[\s\S]*\n\nWork-Item: W-8\s*$/,
  );
  assert.equal(tracker.made.length, 0, 'no item filed when one is named');
});

test('the item is filed only after its test is shown to fail', () => {
  const { root } = repo({ 'src/f.js': 'export const f = (n) => (n > 9 ? n - 1 : n);\n' });
  const [reg] = regsOf(root);
  const rec = recordBreak(root, reg, 'twice-is-once', {
    tracker: () => ({
      get: () => ({}),
      createEntity: () => {
        const dir = join(root, 'test/adversary');
        const [file] = readdirSync(dir);
        assert.ok(regressionFails(root, `test/adversary/${file}`).fails, 'the test fails first');
        mkdirSync(join(root, 'work/items'), { recursive: true });
        writeFileSync(join(root, 'work/items/W-7-fix.md'), '---\nid: W-7\n---\n');
        return { id: 'W-7', path: 'work/items/W-7-fix.md' };
      },
    }),
  });
  assert.ok(rec.ok);
});

test('known means the same counterexample: a second break of an invariant shows while the first is open', () => {
  // f breaks idempotence at n = 11 (an off-by-one above 9) and at n = -20 (another bug below -19).
  const { root } = repo({
    'src/f.js': 'export const f = (n) => (n > 9 ? n - 1 : n < -19 ? n + 1 : n);\n',
  });
  const [reg] = regsOf(root);
  const first = attackArea(root, reg);
  assert.equal(first.breaks.length, 1);
  const rec = recordBreak(root, reg, 'twice-is-once', {
    args: first.breaks[0].args,
    tracker: () => refusing,
  });
  assert.ok(rec.ok);
  const second = attackArea(root, reg);
  assert.equal(second.breaks.length, 1, 'the other bug is a new break, not known');
  assert.notDeepEqual(second.breaks[0].args, first.breaks[0].args);
  assert.equal(second.known.length, 1);
});

test('an open regression test that passes now fails the pass: its todo mark must go', () => {
  const { root, git } = repo({ 'src/f.js': 'export const f = (n) => (n > 9 ? n - 1 : n);\n' });
  const [reg] = regsOf(root);
  const rec = recordBreak(root, reg, 'twice-is-once', { tracker: () => refusing });
  assert.ok(rec.ok);
  writeFileSync(join(root, 'src/f.js'), 'export const f = (n) => n;\n');
  git('commit', '-qam', 'the fix');
  const r = attackArea(root, reg);
  assert.deepEqual(r.breaks, []);
  assert.match(r.errors.join('\n'), /passes now: .*remove its todo mark/);
});

test("an invariant's tests are its own: an ID that prefixes another's does not share them", () => {
  const inv = (/** @type {string} */ id, /** @type {string} */ target) => ({
    id,
    statement: `${id} holds.`,
    checked: '2026-11-20',
    form: 'idempotent',
    module: 'src/f.js',
    target,
    args: [{ type: 'integer', min: -50, max: 50 }],
  });
  const { root } = repo(
    {
      'src/f.js':
        'export const f = (n) => Math.abs(n);\nexport const g = (n) => (n > 9 ? n - 1 : n);\n',
    },
    { invariants: [inv('a', 'f'), inv('a-b', 'g')] },
  );
  const [reg] = regsOf(root);
  const rec = recordBreak(root, reg, 'a-b', { tracker: () => refusing });
  assert.ok(rec.ok);
  if (!rec.ok) return;
  assert.match(rec.test, /adversary-a-b-/);
  assert.deepEqual(openRegressions(root, 'test/adversary', 'a'), []);
  assert.equal(openRegressions(root, 'test/adversary', 'a-b').length, 1);
});

test('tests_dir lies inside the area and the repository, through no link out', () => {
  const { root } = repo({ 'src/f.js': 'export const f = (n) => n;\n' });
  const rel = 'kb/areas/lib/invariants.json';
  const text = readFileSync(join(root, rel), 'utf8');
  writeFileSync(join(root, rel), text.replace('"test/adversary"', '"docs/adversary"'));
  assert.match(readRegistry(root, rel, 'lib', ['src/**', 'test/**']).errors.join(), /not inside/);
  const outside = tempDir('adversary-outside-');
  mkdirSync(join(root, 'test'), { recursive: true });
  symlinkSync(outside, join(root, 'test/adversary'));
  writeFileSync(join(root, rel), text);
  assert.match(
    readRegistry(root, rel, 'lib', ['src/**', 'test/**']).errors.join(),
    /leads outside the repository/,
  );
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

const FORMATTED = `// hitld-adversary: {"area":"lib","invariant":"i","args":["todo: 'x'"],"message":"m","todo":"fix item pending: It's \\"fine\\"."}
// Found: todo: 'not the mark'
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as subject from '../../src/p.js';

test(
  'invariant i: todo: "not the mark either"',
  {
    todo: 'fix item pending: It\\'s "fine".',
  },
  () => {
    const args = /** @type {[any]} */ (["todo: 'x'"]);
    assert.equal(subject.p(...args), true);
  },
);
`;

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
  assert.equal(r?.marked, true);
  // As Prettier with singleQuote leaves it, with "todo:" in the counterexample, a comment and
  // the title: only the option in the test call is the mark.
  const f = readRegression(FORMATTED);
  assert.equal(f?.marked, true);
  const filed = retodo(FORMATTED, 'fix item pending: It\'s "fine".', "W-3: a \\ and 'quote'.");
  assert.equal(readRegression(filed)?.todo, "W-3: a \\ and 'quote'.");
  assert.ok(filed.includes("    todo: 'W-3: a \\\\ and \\'quote\\'.',\n"), filed);
  assert.ok(filed.includes(`["todo: 'x'"]`), 'the counterexample is untouched');
  assert.ok(filed.includes("// Found: todo: 'not the mark'"), 'the comment is untouched');
  assert.throws(() => retodo(FORMATTED, 'something else', 'W-3'), /does not carry/);
  const unmarked = FORMATTED.replace("    todo: 'fix item pending: It\\'s \"fine\".',\n", '');
  assert.equal(
    readRegression(unmarked)?.marked,
    false,
    'a test whose todo mark is gone is not open',
  );
});

test('literal: one-pass escaping gives a string JavaScript reads back exactly', () => {
  for (const s of ['plain', "it's", 'a "q"', 'back\\slash\\', 'line\nbreak\u2028\r', '\\\'"']) {
    for (const q of ["'", '"']) {
      const lit = literal(s, q);
      assert.equal(new Function(`return ${lit};`)(), s, lit);
    }
  }
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
  // The registry alone: a change outside the area's paths that still gets its pass.
  git('stash', '-u', '-q');
  const rel = 'kb/areas/lib/invariants.json';
  const reg = JSON.parse(readFileSync(join(root, rel), 'utf8'));
  reg.invariants[0].statement = 'Applying f twice gives what applying it once gives.';
  writeFileSync(join(root, rel), JSON.stringify(reg));
  assert.deepEqual(
    dueRegistries(regs, changedFiles(root, 'main')).map((d) => d.changed),
    [[rel]],
    'the registry alone changed',
  );
});

test('the pass tries several seeds: every seeded bug of the fixture area is found at seeds 1 to 10, and no clean control raises anything', () => {
  for (const [variant, spec] of Object.entries(VARIANTS)) {
    if (!spec.part) continue;
    const root = tempDir('adversary-seeds-');
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'kb/areas/text'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{ "type": "module" }\n');
    writeFileSync(join(root, 'src/text.js'), moduleFor(/** @type {any} */ (variant)));
    writeFileSync(join(root, 'kb/areas/text/invariants.json'), JSON.stringify(REGISTRY));
    const rel = 'kb/areas/text/invariants.json';
    const { data, errors } = readRegistry(root, rel, 'text');
    const reg = { area: 'text', path: rel, paths: ['src/**'], data, errors };
    for (let seed = 1; seed <= 10; seed++) {
      const r = attackArea(root, reg, { seed });
      assert.deepEqual(r.errors, []);
      assert.deepEqual(
        r.breaks.map((b) => b.invariant),
        spec.breaks ? [spec.breaks] : [],
        `${variant} at seed ${seed}`,
      );
    }
  }
});

test('executors are refused the commands that record breaks and file items', async () => {
  const { root } = repo({ 'src/f.js': 'export const f = (n) => (n > 9 ? n - 1 : n);\n' });
  for (const argv of [
    ['adversary', 'record', '--area', 'lib', '--invariant', 'twice-is-once'],
    ['adversary', 'attack', '--record'],
    ['adversary', 'file'],
  ]) {
    const r = await hitld(argv, root, { HITLD_ROLE: 'executor' });
    assert.equal(r.exit, 1, argv.join(' '));
    assert.equal(r.result.error, 'not-permitted', argv.join(' '));
  }
  const plain = await hitld(['adversary', 'attack'], root, { HITLD_ROLE: 'executor' });
  assert.equal(plain.result.ok, false, 'reading the pass is allowed: it reports the break');
  assert.equal(plain.result.breaks.length, 1);
});

test('adversary file refuses under merge through pull requests, with the drafts and the path to take', async () => {
  const { root } = repo(
    { 'src/f.js': 'export const f = (n) => (n > 9 ? n - 1 : n);\n' },
    undefined,
    { merge: { mode: 'owner', via: 'pull-request' } },
  );
  const [reg] = regsOf(root);
  const rec = recordBreak(root, reg, 'twice-is-once', { tracker: () => refusing });
  assert.ok(rec.ok);
  const r = await hitld(['adversary', 'file'], root, {});
  assert.equal(r.result.ok, false);
  assert.match(r.result.reason, /pull-request/);
  assert.match(r.result.next, /adversary file --test <test> --fix <ID>/);
  assert.deepEqual(
    r.result.pending.map((/** @type {any} */ p) => p.tests),
    [[rec.ok ? rec.test : '']],
  );
});

/**
 * Run hitld in a repository. @param {string[]} argv @param {string} cwd
 * @param {Record<string, string>} env
 */
async function hitld(argv, cwd, env) {
  let out = '';
  const exit = await main(argv, {
    out: (t) => (out += t),
    err: () => {},
    cwd,
    env: { PATH: process.env.PATH, ...env },
  });
  return { exit, result: JSON.parse(out) };
}

const GUARD = fileURLToPath(new URL('../harness/claude-code/hooks/guard.mjs', import.meta.url));
/** @param {string} command @param {string | null} agentType */
const guard = (command, agentType) =>
  spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({
      ...(agentType ? { agent_type: agentType } : {}),
      tool_name: 'Bash',
      tool_input: { command },
    }),
    encoding: 'utf8',
    // Outside any checkout: the guard also reads the checkout for a claim (HITLD-781).
    cwd: tmpdir(),
    env: { PATH: process.env.PATH },
  }).stdout;

test('guard: an executor is denied every hitld adversary command (default deny); the adversary is not', () => {
  for (const command of [
    'hitld adversary file',
    'hitld adversary attack --record',
    'node core/bin/hitld.mjs adversary record --area core --invariant x',
    'hitld adversary attack --base main',
    'hitld adversary due',
  ]) {
    assert.match(guard(command, 'human-in-the-lead:executor-tier2'), /"deny"/, command);
    assert.equal(guard(command, 'human-in-the-lead:adversary'), '', command);
  }
});

test('record shrinks a given counterexample first: one defect is recorded once', () => {
  const { root } = repo({ 'src/f.js': 'export const f = (n) => (n > 9 ? n - 1 : n);\n' });
  const [reg] = regsOf(root);
  const rec = recordBreak(root, reg, 'twice-is-once', { args: [40], tracker: () => refusing });
  assert.ok(rec.ok);
  assert.deepEqual(rec.ok ? rec.args : null, [11]);
  const after = attackArea(root, reg);
  assert.deepEqual(after.breaks, [], 'the pass finds nothing new');
  const same = recordBreak(root, reg, 'twice-is-once', { args: [33], tracker: () => refusing });
  assert.match(!same.ok ? same.reason : '', /already recorded/);
});

test('the search says when it stopped at its limit of recorded shrinks', () => {
  const { root } = repo({ 'src/f.js': 'export const f = (n) => (n > 9 ? n - 1 : n);\n' });
  const [reg] = regsOf(root);
  assert.ok(recordBreak(root, reg, 'twice-is-once', { tracker: () => refusing }).ok);
  const r = attackArea(root, reg);
  assert.deepEqual(r.breaks, []);
  assert.deepEqual(r.checked, [{ id: 'twice-is-once', runs: r.checked[0].runs, capped: true }]);
});

test('a link or directory among the regression tests is passed over with a warning', () => {
  const { root } = repo({ 'src/f.js': 'export const f = (n) => (n > 9 ? n - 1 : n);\n' });
  const [reg] = regsOf(root);
  mkdirSync(join(root, 'test/adversary/adversary-twice-is-once-dir.test.js'), { recursive: true });
  symlinkSync(
    join(root, 'nowhere.js'),
    join(root, 'test/adversary/adversary-twice-is-once-gone.test.js'),
  );
  const r = attackArea(root, reg);
  assert.deepEqual(r.errors, []);
  assert.equal(r.breaks.length, 1);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings.join('\n'), /-dir\.test\.js is not a regular file[\s\S]*-gone\.test\.js/);
  assert.ok(recordBreak(root, reg, 'twice-is-once', { tracker: () => refusing }).ok);
});

test('an open regression test that cannot load is reported as that, not as fixed', () => {
  const { root, git } = repo({ 'src/f.js': 'export const f = (n) => (n > 9 ? n - 1 : n);\n' });
  const [reg] = regsOf(root);
  assert.ok(recordBreak(root, reg, 'twice-is-once', { tracker: () => refusing }).ok);
  git('mv', 'src/f.js', 'src/g.js');
  const r = attackArea(root, reg);
  assert.match(r.errors.join('\n'), /could not load: Error \[ERR_MODULE_NOT_FOUND\]/);
  assert.doesNotMatch(r.errors.join('\n'), /passes now/);
});

test('tests_dir: nothing is made outside the repository through a link on the way', () => {
  const outside = tempDir('adversary-outside-');
  const { root } = repo(
    { 'src/f.js': 'export const f = (n) => (n > 9 ? n - 1 : n);\n' },
    { tests_dir: 'test/sub/deep' },
  );
  symlinkSync(outside, join(root, 'test'));
  const reg = {
    area: 'lib',
    path: 'kb/areas/lib/invariants.json',
    paths: ['src/**', 'test/**'],
    data: JSON.parse(readFileSync(join(root, 'kb/areas/lib/invariants.json'), 'utf8')),
    errors: [],
  };
  const r = recordBreak(root, reg, 'twice-is-once', { tracker: () => refusing });
  assert.match(!r.ok ? r.reason : '', /leads outside the repository/);
  assert.deepEqual(readdirSync(outside), [], 'nothing was made outside');
});

test('a lone surrogate in a statement reads back the same from the test call and the metadata', () => {
  const lit = literal('a\ud800b', "'");
  assert.equal(lit, "'a\\ud800b'");
  assert.equal(new Function(`return ${lit};`)(), 'a\ud800b');
});

test('adversary file under pull requests with nothing pending is ok, with nothing to file', async () => {
  const { root } = repo({ 'src/f.js': 'export const f = (n) => Math.abs(n);\n' }, undefined, {
    merge: { mode: 'owner', via: 'pull-request' },
  });
  const r = await hitld(['adversary', 'file'], root, {});
  assert.equal(r.exit, 0);
  assert.deepEqual(r.result, { ok: true, filed: [], skipped: [], pending: [] });
});
