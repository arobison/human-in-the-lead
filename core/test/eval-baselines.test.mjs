// The committed baseline (HITLD-100, design part 17.5 and 17.9): the accepted offline baseline is
// a file in evals/baselines/ of the primary checkout, with nothing machine-specific in it. The gate
// reads it first and the private store's copy second, and CI fails when none matches.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from 'node:fs';
import { hostname, tmpdir, userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitAll, git, repoOnMain } from './eval-git.mjs';
import { main } from '../lib/cli/main.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { openStore } from '../lib/store/store.mjs';
import { PROFILES } from '../lib/eval/profiles.mjs';
import {
  acceptBaseline,
  baselineKey,
  committedBaselinePath,
  committedForm,
  findBaseline,
  machineSpecificProblems,
  readBaseline,
  settingsHash,
} from '../lib/eval/results.mjs';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const tmp = () => realpathSync.native(mkdtempSync(join(tmpdir(), 'hitld-eval-baselines-test-')));

/** @param {string} name @param {boolean} valid the item the scenario validates is valid */
const scenario = (name, valid = true) => ({
  schema_version: 1,
  id: `t/${name}`,
  suite: 't',
  category: 'schema',
  description: 'validates an item',
  mode: 'offline',
  steps: [
    {
      id: 'v',
      action: 'schema.validate',
      with: {
        schema: 'item',
        entity: true,
        data: {
          schema_version: 1,
          id: 'FX-1',
          kind: 'work',
          title: 'x',
          state: 'proposed',
          classification: 'public',
        },
      },
    },
  ],
  graders: [{ grader: 'equals', with: { path: 'steps.v.valid', value: valid } }],
});

/** @param {string} dir @param {string} name @param {boolean} [valid] */
function putScenario(dir, name, valid = true) {
  const folder = join(dir, 'evals', 'scenarios', 't');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${name}.scenario.json`), JSON.stringify(scenario(name, valid)));
}

/**
 * A directory with its own evals, and a private store of its own. `hitld` runs a command in it.
 * A repository on main with everything committed, unless it is given a directory or `git: false`.
 * @param {{ cwd?: string, data?: string, env?: Record<string, string>, git?: boolean }} [where]
 */
function workspace(where = {}) {
  const cwd = where.cwd ?? tmp();
  const data = where.data ?? tmp();
  putScenario(cwd, 'a');
  if (where.cwd === undefined && where.git !== false) repoOnMain(cwd);
  /** @param {string[]} argv @param {Record<string, string>} [more] */
  const hitld = async (argv, more = {}) => {
    /** @type {string[]} */
    const out = [];
    const code = await main(argv, {
      out: (t) => out.push(t),
      err: () => {},
      cwd,
      env: { XDG_DATA_HOME: data, ...where.env, ...more },
    });
    return { code, json: JSON.parse(out.join('') || 'null') };
  };
  const store = () => openStore(join(data, 'human-in-the-lead', 'hitld-evals'));
  // A run's ID starts with the second it was made in, so two runs of one workspace wait for
  // different seconds.
  let last = 0;
  const offline = async (/** @type {string[]} */ extra = []) => {
    const wait = (Math.floor(Date.now() / 1000) + 1) * 1000 - Date.now();
    if (Math.floor(Date.now() / 1000) === last) await new Promise((r) => setTimeout(r, wait));
    last = Math.floor(Date.now() / 1000);
    return hitld(['eval', '--offline', '--evals-dir', 'evals', ...extra]);
  };
  return { cwd, data, hitld, store, offline };
}

/** The stored run `id` in a workspace's private store. @param {ReturnType<typeof workspace>} w @param {string} id */
const stored = (w, id) => JSON.parse(w.store().read(`eval/results/${id}.json`) ?? 'null');

const committedFiles = (/** @type {string} */ cwd) => {
  const dir = join(cwd, 'evals', 'baselines');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};

test('the baseline key is the mode, the seed and the profiles: nothing of the machine is in it', async () => {
  // Pinned: this is the key of this repository's committed baseline at the default seed. A change
  // to the profiles or the key's inputs moves it, and so asks for a new baseline.
  const profiles = Object.keys(PROFILES).sort();
  assert.equal(settingsHash({ mode: 'offline', seed: 1, profiles }), '86b14a88e19f');
  assert.equal(
    settingsHash({ mode: 'offline', seed: 1, profiles: [...profiles].reverse() }),
    '86b14a88e19f',
    'the order of the profiles does not matter',
  );
  assert.notEqual(settingsHash({ mode: 'offline', seed: 2, profiles }), '86b14a88e19f');

  // The same suite from two directories, two private stores, and two machines' worth of
  // environment gives the same key and the same committed baseline.
  const one = workspace({
    env: { HOSTNAME: 'example-laptop', USER: 'someone', HOME: '/home/someone' },
  });
  const two = workspace({ env: { HOSTNAME: 'runner-1', USER: 'runner', CI: 'true' } });
  const a = await one.offline();
  const b = await two.offline();
  assert.equal(a.code, 0);
  assert.equal(b.code, 0);
  const runA = stored(one, a.json.run);
  const runB = stored(two, b.json.run);
  assert.equal(runA.settings.settings_hash, runB.settings.settings_hash);
  const forms = [runA, runB].map((r) => ({ ...committedForm(r), id: 0, at: 0 }));
  assert.deepEqual(forms[0], forms[1]);
});

test('the committed form keeps what the gate needs and drops what is machine-specific', async () => {
  const w = workspace();
  const ran = await w.offline();
  const run = stored(w, ran.json.run);
  // A run that quotes paths, a host, an account and a store key, as a failing grader might.
  run.plugin.commit = 'a'.repeat(40);
  run.gate = { ok: true, baseline: null, failures: [], notes: [`see ${w.cwd}`] };
  run.scenarios[0].reason = `cannot read ${w.cwd}/evals/x.json`;
  run.scenarios[0].wall_ms = 1234;
  run.scenarios[0].transcript = `eval/transcripts/${run.id}/t__a@none.json`;
  run.scenarios[0].graders[0].message = `${w.cwd}/evals/x.json on ${hostname()} for ${userInfo().username}`;
  run.scenarios[0].graders[0].actual = '/home/someone/.local/share/human-in-the-lead';
  run.scenarios[0].graders[0].path = 'steps.v.valid';
  assert.ok(machineSpecificProblems(run, [w.cwd]).length > 0, 'the run itself is not clean');

  const form = committedForm(run);
  assert.deepEqual(machineSpecificProblems(form, [w.cwd, w.data]), []);
  assert.deepEqual(schemas().validateEntity('eval-result', form), []);
  assert.equal(form.gate, undefined);
  assert.equal(form.plugin.commit, null);
  assert.equal(form.summary.wall_ms, 0);
  for (const s of form.scenarios) {
    assert.equal(s.wall_ms, 0);
    assert.equal(s.transcript, null);
    assert.equal(s.reason, undefined);
    for (const g of s.graders)
      assert.deepEqual(Object.keys(g), ['id', 'grader', 'passed', 'message']);
  }
  // What the gate reads is kept.
  assert.equal(form.scenarios[0].id, run.scenarios[0].id);
  assert.equal(form.scenarios[0].result, 'pass');
  assert.equal(form.scenarios[0].tokens, run.scenarios[0].tokens);
  assert.deepEqual(form.summary.categories, run.summary.categories);
  assert.equal(form.settings.settings_hash, run.settings.settings_hash);
  assert.equal(form.scenario_set.version, run.scenario_set.version);
  // Idempotent.
  assert.deepEqual(committedForm(form), form);
});

test('the check finds paths, hosts, accounts, addresses and private-store content', () => {
  const found = (/** @type {unknown} */ v, extra = /** @type {string[]} */ ([])) =>
    machineSpecificProblems({ k: v }, extra).length > 0;
  for (const dirty of [
    '/tmp/hitld-eval-x/data/a.md',
    '/home/someone/project',
    'in /var/lib/thing and more',
    'C:\\Users\\someone\\x',
    '~/projects/x',
    'file:///srv/x',
    'eval/results/EV-20261114T031500Z-ab12cd.json',
    '/x/.local/share/human-in-the-lead',
    'someone@example.org',
    'build-host.internal',
    'example-laptop.local',
    '10.0.3.7',
    // This machine's own names (the check skips ones under four characters).
    ...[hostname(), `account ${userInfo().username}`].filter(
      (t) => hostname().length >= 4 && userInfo().username.length >= 4 && t,
    ),
  ]) {
    assert.ok(found(dirty), `${dirty} is machine-specific`);
  }
  assert.ok(found('plain text about a store', ['plain text']), 'an extra string is checked');
  for (const clean of [
    'foundation/policy-check',
    'copilot-cloud-agent',
    '0.1.0-rc.1',
    'steps.v.valid is true',
    'c025faa36fbcbbc8b792350dd87b3c757f459d9c408cbccdd7b58159cd4acd76',
    'ledger and/or merge',
    '2026-11-15T06:25:10.914Z',
    '',
  ]) {
    assert.ok(!found(clean), `${JSON.stringify(clean)} is clean`);
  }
  assert.ok(machineSpecificProblems({ '/tmp/a': 1 }).length > 0, 'a key counts too');
});

test('acceptBaseline refuses to write a baseline that carries anything from the machine', async () => {
  const w = workspace();
  const ran = await w.offline();
  const run = stored(w, ran.json.run);
  const root = tmp();
  // A category named after a path: it survives the committed form, so the check must catch it.
  run.scenarios[0].category = `${w.cwd}/evals`;
  assert.throws(
    () => acceptBaseline({ store: w.store(), root, result: run }),
    /stays on this machine/,
  );
  assert.deepEqual(committedFiles(root), []);
  assert.equal(readBaseline(w.store(), run), null, 'nothing reached the private store either');
});

test('every baseline committed in this repository is valid, clean and in its committed form', () => {
  const dir = join(REPO, 'evals', 'baselines');
  const names = existsSync(dir) ? readdirSync(dir).sort() : [];
  for (const name of names) {
    const text = readFileSync(join(dir, name), 'utf8');
    const doc = JSON.parse(text);
    assert.deepEqual(schemas().validateEntity('eval-result', doc), [], name);
    assert.deepEqual(
      machineSpecificProblems(doc, [REPO]),
      [],
      `${name} carries something machine-specific`,
    );
    assert.equal(
      name,
      `${doc.mode}-${doc.settings.settings_hash}.json`,
      'the file name is the key',
    );
    assert.equal(doc.mode, 'offline');
    assert.equal(doc.settings.scenario_filter, null, 'a baseline comes from a full run');
    assert.equal(doc.summary.failed + doc.summary.errors, 0, 'a baseline has no failing scenario');
    assert.equal(doc.accepted?.by, 'owner');
    assert.deepEqual(
      committedForm(doc),
      { ...doc, accepted: doc.accepted },
      `${name} is a committed form`,
    );
    assert.equal(
      text,
      `${JSON.stringify(doc, null, 2)}\n`,
      `${name} is written the way the command writes it`,
    );
  }
});

test('eval accept writes the committed baseline and keeps the private copy; it does not commit', async () => {
  const w = workspace();
  const root = w.cwd;
  const head = git(root, 'rev-parse', 'HEAD');
  const ran = await w.offline();
  const run = stored(w, ran.json.run);
  const key = run.settings.settings_hash;

  const r = await w.hitld(['eval', 'accept', '--result', ran.json.run]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  const file = join(root, 'evals', 'baselines', `offline-${key}.json`);
  assert.equal(r.json.committed, file);
  assert.match(r.json.text, /commit it/);
  assert.ok(existsSync(file));
  assert.deepEqual(committedFiles(root), [`offline-${key}.json`]);
  // The private store keeps its copy, in full (with the grader messages the committed one lacks).
  const kept = JSON.parse(w.store().read(baselineKey('offline', key)) ?? 'null');
  assert.equal(kept.id, ran.json.run);
  assert.notEqual(kept.scenarios[0].graders[0].message, '');
  // What reaches the shared private store has only keys that code from before this change knows:
  // not the run's checkout, and not the gate's baseline source. Nor does the recorded run.
  for (const doc of [kept, run]) {
    assert.equal(doc.gate.baseline_source, undefined);
  }
  assert.equal(kept.checkout, undefined);
  const before = Object.keys(schemas().get('eval-result').properties).filter(
    (k) => k !== 'checkout',
  );
  assert.deepEqual(
    Object.keys(kept).filter((k) => !before.includes(k)),
    [],
  );
  assert.deepEqual(
    Object.keys(kept.gate).filter((k) => !['ok', 'baseline', 'failures', 'notes'].includes(k)),
    [],
  );
  assert.deepEqual(run.checkout, { commit: head, dirty: false });
  // The committed one is the stripped form, and carries the acceptance.
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(doc.id, ran.json.run);
  assert.deepEqual(doc.accepted, r.json.accepted);
  assert.deepEqual(machineSpecificProblems(doc, [root, w.data]), []);
  // Nothing was committed or staged: the owner does that.
  assert.equal(git(root, 'rev-parse', 'HEAD'), head);
  assert.match(git(root, 'status', '--porcelain'), /\?\? evals\/baselines\//);
  assert.equal(git(root, 'diff', '--cached', '--name-only'), '');
});

test('the baseline goes to the primary checkout, never to a linked worktree; executors are refused', async () => {
  const w = workspace();
  const primary = w.cwd;
  const linked = join(tmp(), 'linked');
  git(primary, 'worktree', 'add', '-q', '-b', 'work', linked);
  const inLinked = workspace({ cwd: linked, data: w.data });
  const ran = await inLinked.offline();
  assert.equal(ran.code, 0, JSON.stringify(ran.json));

  // From the worktree an executor's accept is refused, and writes nothing anywhere.
  const refused = await inLinked.hitld(['eval', 'accept', '--result', ran.json.run]);
  assert.equal(refused.code, 1);
  assert.equal(refused.json.error, 'not-permitted');
  const dispatched = await w.hitld(['eval', 'accept', '--result', ran.json.run], {
    HITLD_DISPATCH: 'D-1',
  });
  assert.equal(dispatched.json.error, 'not-permitted');
  assert.deepEqual(committedFiles(primary), []);
  assert.deepEqual(committedFiles(linked), []);

  // The library, called from the worktree on the owner's behalf, still writes in the primary.
  const { evalOffline } = await import('../lib/eval/offline.mjs');
  const done = await evalOffline({
    cwd: linked,
    env: { XDG_DATA_HOME: w.data },
    evalsDir: 'evals',
    acceptBaseline: true,
  });
  assert.equal(done.ok, true, JSON.stringify(done));
  const committed = String(done.baseline_committed);
  assert.equal(committed, join(primary, 'evals', 'baselines', basename(committed)));
  assert.equal(committedFiles(primary).length, 1);
  assert.deepEqual(committedFiles(linked), []);
});

test('the gate reads the committed baseline first, the private store second, and says which', async () => {
  const w = workspace();
  const first = await w.offline();
  assert.equal(first.json.gate.baseline, null);
  assert.equal(first.json.gate.baseline_source, null);
  const run = stored(w, first.json.run);
  const key = run.settings.settings_hash;

  // Only the private store has one.
  const { writeBaseline } = await import('../lib/eval/results.mjs');
  writeBaseline(w.store(), run, new Date(Date.now() - 1000));
  const fromStore = await w.offline();
  assert.equal(fromStore.json.gate.baseline, run.id);
  assert.equal(fromStore.json.gate.baseline_source, 'private-store');
  assert.ok(fromStore.json.gate.notes.some((/** @type {string} */ n) => /private store/.test(n)));

  // A committed one wins over the store's, whatever the store holds.
  const accepted = await w.hitld(['eval', 'accept', '--result', fromStore.json.run]);
  assert.equal(accepted.code, 0, JSON.stringify(accepted.json));
  const forged = { ...run, id: 'EV-20200101T000000Z-aaaaaa' };
  w.store().write(baselineKey('offline', key), JSON.stringify(forged));
  const fromFile = await w.offline();
  assert.equal(fromFile.json.gate.baseline, fromStore.json.run);
  assert.equal(fromFile.json.gate.baseline_source, 'committed');
  assert.ok(
    fromFile.json.gate.notes.some((/** @type {string} */ n) =>
      n.includes(`evals/baselines/offline-${key}.json`),
    ),
  );
  // The result recorded in the store keeps the note, not the new key, and still validates.
  const recorded = stored(w, fromFile.json.run);
  assert.equal(recorded.gate.baseline_source, undefined);
  assert.ok(recorded.gate.notes.some((/** @type {string} */ n) => /committed in evals/.test(n)));
  assert.deepEqual(schemas().validateEntity('eval-result', recorded), []);

  // With the file gone the store's is used again.
  rmSync(join(w.cwd, 'evals', 'baselines'), { recursive: true });
  const back = await w.offline();
  assert.equal(back.json.gate.baseline_source, 'private-store');
  assert.equal(back.json.gate.baseline, forged.id);

  // findBaseline is what the commands use.
  const none = findBaseline({ store: null, root: w.cwd }, run);
  assert.deepEqual(none, {
    baseline: null,
    source: null,
    path: `evals/baselines/offline-${key}.json`,
  });
});

test('--require-baseline fails without a committed baseline, the private store notwithstanding; a new scenario is a note', async () => {
  const w = workspace();
  const ran = await w.offline();
  assert.equal(ran.code, 0);
  // Nothing committed: it fails, and says where the file belongs.
  const missing = await w.offline(['--require-baseline']);
  assert.equal(missing.code, 1);
  assert.equal(missing.json.error, 'no-committed-baseline');
  assert.match(missing.json.message, /evals\/baselines\/offline-[0-9a-f]{12}\.json is missing/);
  // The run itself is still one the owner can accept: the gate's verdict is not the failure.
  assert.equal(missing.json.gate.ok, true);

  // A baseline only in the private store does not count.
  const { writeBaseline } = await import('../lib/eval/results.mjs');
  writeBaseline(w.store(), stored(w, ran.json.run), new Date(Date.now() - 1000));
  const storeOnly = await w.offline(['--require-baseline']);
  assert.equal(storeOnly.code, 1);
  assert.equal(storeOnly.json.error, 'no-committed-baseline');
  assert.equal(storeOnly.json.gate.baseline, null);

  // Accepted and committed: it passes.
  const run2 = await w.offline();
  assert.equal((await w.hitld(['eval', 'accept', '--result', run2.json.run])).code, 0);
  const ok = await w.offline(['--require-baseline']);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.equal(ok.json.gate.baseline_source, 'committed');

  // A scenario the baseline has not seen is a note, not a failure.
  putScenario(w.cwd, 'b');
  const added = await w.offline(['--require-baseline']);
  assert.equal(added.code, 0, JSON.stringify(added.json));
  assert.ok(added.json.gate.notes.some((/** @type {string} */ n) => /new scenario: t\/b/.test(n)));

  // One that passed in the baseline and fails now is a failure.
  putScenario(w.cwd, 'a', false);
  const regressed = await w.offline(['--require-baseline']);
  assert.equal(regressed.code, 1);
  assert.ok(
    regressed.json.gate.failures.some((/** @type {any} */ f) => f.kind === 'scenario-regressed'),
  );
});

test('a baseline accepted on one machine gates a machine with an empty private store, as CI does', async () => {
  const machine = workspace();
  const ran = await machine.offline();
  const accepted = await machine.hitld(['eval', 'accept', '--result', ran.json.run]);
  assert.equal(accepted.code, 0);
  const file = accepted.json.committed;

  // The same repository checked out elsewhere (what CI does), with its own empty store.
  const ci = workspace({ env: { CI: 'true', HOSTNAME: 'runner-7' } });
  assert.deepEqual(committedFiles(ci.cwd), []);
  mkdirSync(join(ci.cwd, 'evals', 'baselines'));
  copyFileSync(file, join(ci.cwd, 'evals', 'baselines', basename(file)));
  assert.deepEqual(ci.store().list('eval/baselines/'), []);
  const gated = await ci.offline(['--require-baseline']);
  assert.equal(gated.code, 0, JSON.stringify(gated.json));
  assert.equal(gated.json.gate.baseline, ran.json.run);
  assert.equal(gated.json.gate.baseline_source, 'committed');
  assert.equal(gated.json.gate.failures.length, 0);
});

test('a committed baseline that is invalid, or filed under another key, is an error, never quietly skipped', async () => {
  const w = workspace();
  const ran = await w.offline();
  const run = stored(w, ran.json.run);
  const key = run.settings.settings_hash;
  const dir = join(w.cwd, 'evals', 'baselines');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `offline-${key}.json`), '{"schema_version": 3}');
  assert.throws(() => findBaseline({ store: null, root: w.cwd }, run), /not a valid eval result/);
  const other = {
    ...committedForm(run),
    settings: { ...run.settings, settings_hash: '000000000000' },
  };
  writeFileSync(join(dir, `offline-${key}.json`), JSON.stringify(other));
  assert.throws(
    () => findBaseline({ store: null, root: w.cwd }, run),
    /holds settings offline-000000000000/,
  );
});

test('the plugin build leaves the committed baselines out', async () => {
  const { expectedFiles } = await import('../lib/packaging/build.mjs');
  for (const path of expectedFiles().keys()) {
    assert.ok(!path.startsWith(join('evals', 'baselines')), path);
  }
});

// A baseline judges main: only a run of a commit on main with a clean tree is accepted.

/** @param {ReturnType<typeof workspace>} w @param {string} id */
const accept = (w, id) => w.hitld(['eval', 'accept', '--result', id]);

test('accept: a run on main’s head is accepted, and so is a run on an older main commit', async () => {
  const w = workspace();
  const older = await w.offline();
  assert.equal(stored(w, older.json.run).checkout.commit, git(w.cwd, 'rev-parse', 'HEAD'));
  // Main moves on; the run is of a commit that is still on main.
  writeFileSync(join(w.cwd, 'notes.txt'), 'later');
  commitAll(w.cwd, 'main moves on');
  const accepted = await accept(w, older.json.run);
  assert.equal(accepted.code, 0, JSON.stringify(accepted.json));
  // And the run on the new head, too.
  const head = await w.offline();
  assert.equal(stored(w, head.json.run).checkout.commit, git(w.cwd, 'rev-parse', 'HEAD'));
  assert.equal((await accept(w, head.json.run)).code, 0);
});

test('accept: a run on a branch commit that is not on main is refused as not-on-main', async () => {
  const w = workspace();
  git(w.cwd, 'switch', '-q', '-c', 'feature');
  writeFileSync(join(w.cwd, 'notes.txt'), 'only on the branch');
  commitAll(w.cwd, 'branch work');
  const ran = await w.offline();
  assert.equal(stored(w, ran.json.run).checkout.dirty, false);
  const refused = await accept(w, ran.json.run);
  assert.equal(refused.code, 1);
  assert.equal(refused.json.error, 'not-on-main');
  assert.match(refused.json.message, /not on main/);
  assert.match(refused.json.message, /run the suite on main/);
  assert.deepEqual(committedFiles(w.cwd), []);
  assert.equal(w.store().list('eval/baselines/').length, 0);
  // The owner's --accept-baseline on the branch is refused the same way, and writes nothing.
  const direct = await w.offline(['--accept-baseline']);
  assert.equal(direct.code, 1);
  assert.equal(direct.json.error, 'not-on-main');
  assert.equal(direct.json.baseline_accepted, undefined);
  assert.deepEqual(committedFiles(w.cwd), []);
  assert.equal(w.store().list('eval/baselines/').length, 0);
  // Once the branch is on main, the same kind of run is accepted.
  git(w.cwd, 'switch', '-q', 'main');
  git(w.cwd, 'merge', '-q', '--ff-only', 'feature');
  const onMain = await w.offline();
  assert.equal((await accept(w, onMain.json.run)).code, 0);
});

test('accept: a run with uncommitted changes is refused as dirty-tree, tracked or untracked', async () => {
  const w = workspace();
  const clean = await w.offline();
  assert.equal(stored(w, clean.json.run).checkout.dirty, false);

  const scenarioFile = join(w.cwd, 'evals', 'scenarios', 't', 'a.scenario.json');
  writeFileSync(scenarioFile, JSON.stringify(scenario('a', true), null, 1));
  const tracked = await w.offline();
  assert.equal(stored(w, tracked.json.run).checkout.dirty, true);
  const refused = await accept(w, tracked.json.run);
  assert.equal(refused.code, 1);
  assert.equal(refused.json.error, 'dirty-tree');
  assert.match(refused.json.message, /uncommitted changes/);
  assert.match(refused.json.message, /run the suite on main/);
  git(w.cwd, 'checkout', '--', '.');

  writeFileSync(join(w.cwd, 'scratch.txt'), 'not committed');
  const untracked = await w.offline();
  assert.equal(stored(w, untracked.json.run).checkout.dirty, true);
  assert.equal((await accept(w, untracked.json.run)).json.error, 'dirty-tree');
  const direct = await w.offline(['--accept-baseline']);
  assert.equal(direct.json.error, 'dirty-tree');
  assert.deepEqual(committedFiles(w.cwd), []);

  // A baseline file left uncommitted by an earlier accept does not make the tree dirty.
  rmSync(join(w.cwd, 'scratch.txt'));
  assert.equal((await accept(w, clean.json.run)).code, 0);
  assert.equal(committedFiles(w.cwd).length, 1);
  const after = await w.offline();
  assert.equal(stored(w, after.json.run).checkout.dirty, false);
});

test('accept: a run that recorded no commit (not a git checkout, or an older run) is refused as no-commit', async () => {
  const w = workspace({ git: false });
  const ran = await w.offline();
  assert.deepEqual(stored(w, ran.json.run).checkout, { commit: null, dirty: null });
  const refused = await accept(w, ran.json.run);
  assert.equal(refused.json.error, 'no-commit');
  assert.equal((await w.offline(['--accept-baseline'])).json.error, 'no-commit');

  const old = workspace();
  const made = await old.offline();
  const doc = stored(old, made.json.run);
  delete doc.checkout;
  old.store().write(`eval/results/${made.json.run}.json`, JSON.stringify(doc));
  assert.equal((await accept(old, made.json.run)).json.error, 'no-commit');
});

test('accept: a commit only on the main branch’s upstream counts as on main', async () => {
  const w = workspace();
  const remote = tmp();
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(w.cwd, 'remote', 'add', 'origin', remote);
  git(w.cwd, 'push', '-q', '-u', 'origin', 'main');
  // A commit that reached the remote's main, while the local main branch is behind it.
  writeFileSync(join(w.cwd, 'notes.txt'), 'merged remotely');
  commitAll(w.cwd, 'remote main moves on');
  git(w.cwd, 'push', '-q', 'origin', 'main');
  const ran = await w.offline();
  git(w.cwd, 'switch', '-q', '--detach', 'HEAD');
  git(w.cwd, 'branch', '-q', '-f', 'main', 'HEAD~1');
  git(w.cwd, 'switch', '-q', 'main');
  assert.notEqual(git(w.cwd, 'rev-parse', 'main'), stored(w, ran.json.run).checkout.commit);
  assert.equal((await accept(w, ran.json.run)).code, 0);
});

test('the results page offers no accept command for a run that is not on main', async () => {
  const w = workspace();
  git(w.cwd, 'switch', '-q', '-c', 'feature');
  writeFileSync(join(w.cwd, 'notes.txt'), 'only on the branch');
  commitAll(w.cwd, 'branch work');
  const ran = await w.offline();
  const page = await w.hitld(['eval', 'report', '--result', ran.json.run]);
  const html = readFileSync(page.json.html, 'utf8');
  assert.doesNotMatch(html, /hitld eval accept --result/);
  assert.match(html, /is not on main/);
});
