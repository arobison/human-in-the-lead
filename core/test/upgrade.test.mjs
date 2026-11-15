// Upgrades on a pin change (design part 16.5, Upgrades): the drift check at session start and at
// run start and resume, the upgrade plan, reports from executors on an earlier release, and a
// rollback that leaves newer data alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, EXIT } from '../lib/cli/main.mjs';
import { VERSION } from '../lib/version.mjs';
import { openStore } from '../lib/store/store.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { LEDGER_KEY, appendEvent, readLedger } from '../lib/ledger/ledger.mjs';
import { STATE_KEY } from '../lib/run/checkpoint.mjs';
import { releaseLease, resumeRun, startRun } from '../lib/run/run.mjs';
import { bumpVersion, parseVersion } from '../lib/release/semver.mjs';
import {
  VersionDriftError,
  checkDrift,
  dispatchedOn,
  readPin,
  reportVersion,
  sameMinor,
  sessionNotice,
} from '../lib/install/drift.mjs';
import { buildPlan, loadRecords, span } from '../lib/install/upgrade.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const v = /** @type {NonNullable<ReturnType<typeof parseVersion>>} */ (parseVersion(VERSION));
/** A release in the next minor, and one in the same minor, relative to this one. */
const NEXT_MINOR = `${v.major}.${v.minor + 1}.0`;
const OLDER_SAME_MINOR = `${v.major}.${v.minor}.0-alpha.1`;
const LEDGER_V = /** @type {number} */ (schemas().currentVersion('ledger-entry'));
const STATE_V = /** @type {number} */ (schemas().currentVersion('run-state'));

/**
 * A project: a repository root with an optional pin, and a store beside it.
 * @param {Record<string, unknown> | null} source the marketplace source, or null for no pin
 * @param {Record<string, unknown>} [extra] more fields on the marketplace entry
 */
function project(source, extra = {}) {
  const base = mkdtempSync(join(tmpdir(), 'hitld-upgrade-'));
  const root = join(base, 'repo');
  mkdirSync(join(root, '.git'), { recursive: true });
  if (source) {
    mkdirSync(join(root, '.claude'));
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({
        extraKnownMarketplaces: { 'human-in-the-lead': { source, ...extra } },
        enabledPlugins: { 'human-in-the-lead@human-in-the-lead': true },
      }),
    );
  }
  const storeDir = join(base, 'store');
  return { base, root, storeDir, store: openStore(storeDir) };
}

/** @param {string} ref */
const github = (ref) => ({ source: 'github', repo: 'owner/plugin', ref });

/**
 * @param {string[]} argv @param {string} cwd @param {NodeJS.ProcessEnv} [env]
 */
async function hitld(argv, cwd, env = {}) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env });
  return { code, json: JSON.parse(out) };
}

/** A ledger as an earlier release left it: a run started on `version`. @param {any} store @param {string} version */
function startedOn(store, version) {
  appendEvent(store, {
    id: 'run-started-r1',
    event: 'run-started',
    run: 'r1',
    session: 'old',
    host: 'laptop',
    skill_versions: { hitld_version: version },
  });
}

test('readPin tells a tag, a commit, a branch and a checkout apart', () => {
  assert.equal(readPin(project(null).root), null);
  const tag = readPin(project(github('v1.2.3')).root);
  assert.deepEqual([tag?.kind, tag?.version, tag?.ref], ['tag', '1.2.3', 'v1.2.3']);
  const sha = 'a'.repeat(40);
  assert.deepEqual(
    [readPin(project(github(sha)).root)?.kind, readPin(project(github(sha)).root)?.version],
    ['commit', null],
  );
  assert.equal(readPin(project(github('main')).root)?.kind, 'branch');
  assert.equal(readPin(project({ source: 'github', repo: 'owner/plugin' }).root)?.kind, 'branch');
  const dir = readPin(project({ source: 'directory', path: ROOT }).root);
  assert.deepEqual([dir?.kind, dir?.version], ['directory', VERSION]);
  assert.equal(readPin(project(github('v1.0.0'), { autoUpdate: true }).root)?.auto_update, true);
});

test('a session on the pinned release passes; one on another release is refused with the fix', () => {
  const pinned = project(github(`v${VERSION}`));
  const ok = checkDrift({ root: pinned.root, store: pinned.store });
  assert.equal(ok.refusal, null);
  assert.equal(ok.upgrade.due, false);
  assert.deepEqual(ok.warnings, []);

  // The pin moved ahead of this machine: update the plugin, then restart.
  const ahead = checkDrift({ root: project(github(`v${NEXT_MINOR}`)).root });
  assert.equal(ahead.refusal?.error, 'version-not-pinned');
  assert.match(
    ahead.refusal?.message ?? '',
    /claude plugin update human-in-the-lead@human-in-the-lead/,
  );
  assert.match(ahead.refusal?.message ?? '', /restart the session/);

  // The plugin moved without the pin: move the pin by a pull request, or turn off auto-update.
  const behind = checkDrift({ root: project(github(`v${OLDER_SAME_MINOR}`)).root });
  assert.equal(behind.refusal?.error, 'version-not-pinned');
  assert.match(behind.refusal?.message ?? '', /pull request the owner merges/);
  assert.match(behind.refusal?.message ?? '', /"autoUpdate": false/);

  // A checkout pin compares the checkout's own version.
  assert.equal(
    checkDrift({ root: project({ source: 'directory', path: ROOT }).root }).refusal,
    null,
  );
  assert.equal(
    checkDrift({ root: project({ source: 'directory', path: ROOT }).root, running: '0.0.1' })
      .refusal?.error,
    'version-not-pinned',
  );

  // No pin, a commit or a branch: nothing to compare, so nothing is refused.
  assert.equal(checkDrift({ root: project(null).root }).refusal, null);
  const commit = checkDrift({ root: project(github('b'.repeat(40))).root });
  assert.equal(commit.refusal, null);
  assert.match(commit.warnings[0], /a commit/);
  assert.match(checkDrift({ root: project(github('main')).root }).warnings[0], /which moves/);
  assert.match(
    checkDrift({ root: project(github(`v${VERSION}`), { autoUpdate: true }).root }).warnings[0],
    /"autoUpdate": false/,
  );
});

test('a pin ahead of the release that last wrote the data says an upgrade is due', () => {
  const p = project(github(`v${VERSION}`));
  startedOn(p.store, OLDER_SAME_MINOR);
  const d = checkDrift({ root: p.root, store: p.store });
  assert.equal(d.refusal, null);
  assert.equal(d.data.version, OLDER_SAME_MINOR);
  assert.deepEqual(
    [d.upgrade.due, d.upgrade.from, d.upgrade.to],
    [true, OLDER_SAME_MINOR, VERSION],
  );
  assert.match(d.upgrade.next ?? '', /hitld upgrade plan/);
});

test('hitld run start and run resume check the release first, and record nothing when refused', async () => {
  const off = project(github(`v${NEXT_MINOR}`));
  const me = ['--store', off.storeDir, '--session', 's-1', '--host', 'laptop'];
  const refused = await hitld(['run', 'start', ...me], off.root);
  assert.deepEqual([refused.code, refused.json.error], [EXIT.failed, 'version-not-pinned']);
  assert.equal(refused.json.version.pin.version, NEXT_MINOR);
  assert.equal(existsSync(join(off.storeDir, LEDGER_KEY)), false, 'nothing recorded');

  // A run an earlier release started, and handed over.
  const p = project(github(`v${VERSION}`));
  startRun(p.store, { session: 'old', host: 'laptop' });
  const text = /** @type {string} */ (p.store.read(LEDGER_KEY));
  p.store.write(
    LEDGER_KEY,
    text.replace(`"hitld_version":"${VERSION}"`, `"hitld_version":"${OLDER_SAME_MINOR}"`),
  );
  releaseLease(p.store, { session: 'old', host: 'laptop', reason: 'handover' });
  const mine = ['--store', p.storeDir, '--session', 's-2', '--host', 'laptop'];
  const resumed = await hitld(['run', 'resume', '--live', 'none', ...mine], p.root);
  assert.equal(resumed.code, EXIT.ok, JSON.stringify(resumed.json));
  assert.equal(resumed.json.version.upgrade.due, true);
  assert.equal(resumed.json.version.pin.version, VERSION);
  // Taking the lease records the release, so the upgrade is no longer due afterwards.
  const taken = readLedger(p.store).events.filter((e) => e.event === 'lease-taken');
  assert.equal(taken.at(-1)?.skill_versions?.hitld_version, VERSION);
  assert.equal(checkDrift({ root: p.root, store: p.store }).upgrade.due, false);

  // The pin moves on while the run goes on: the next resume on this machine is refused.
  writeFileSync(
    join(p.root, '.claude', 'settings.json'),
    JSON.stringify({
      extraKnownMarketplaces: { 'human-in-the-lead': { source: github(`v${NEXT_MINOR}`) } },
    }),
  );
  const again = await hitld(['run', 'resume', '--live', 'none', '--force', ...mine], p.root);
  assert.equal(again.json.error, 'version-not-pinned');
});

test('rollback: an older release refuses data a newer release wrote, and writes nothing', async () => {
  // A newer release wrote a ledger line and the run state at schema versions this one does not read.
  const p = project(github(`v${VERSION}`));
  startedOn(p.store, VERSION);
  const newer = bumpVersion(VERSION, 'minor');
  p.store.append(
    LEDGER_KEY,
    `${JSON.stringify({ schema_version: LEDGER_V + 1, id: 'E-90', event: 'lease-taken', at: '2026-11-15T00:00:00Z', run: 'r1', session: 'new', host: 'laptop', skill_versions: { hitld_version: newer } })}\n`,
  );
  const state = JSON.parse(p.store.read(STATE_KEY) ?? 'null') ?? {};
  p.store.write(STATE_KEY, JSON.stringify({ ...state, schema_version: STATE_V + 1 }));
  const ledgerBefore = p.store.read(LEDGER_KEY);
  const stateBefore = p.store.read(STATE_KEY);

  // Reverting the pin brought this release back; the data stays as the newer release left it.
  const d = checkDrift({ root: p.root, store: p.store });
  assert.equal(d.refusal?.error, 'newer-schema');
  assert.deepEqual(
    d.newer.map((n) => n.file),
    [LEDGER_KEY, STATE_KEY],
  );
  assert.equal(d.data.newest, newer);
  assert.throws(
    () => startRun(p.store, { session: 's-3', host: 'laptop', cwd: p.root, replace: true }),
    (e) => e instanceof VersionDriftError && e.code === 'newer-schema',
  );
  await assert.rejects(
    resumeRun(p.store, { session: 's-3', host: 'laptop', cwd: p.root, force: true }),
    (e) => e instanceof VersionDriftError && e.code === 'newer-schema',
  );
  const me = ['--store', p.storeDir, '--session', 's-3', '--host', 'laptop'];
  const start = await hitld(['run', 'start', '--replace', ...me], p.root);
  assert.deepEqual([start.code, start.json.error], [EXIT.failed, 'newer-schema']);
  assert.match(start.json.message, /never writes ahead/);
  assert.equal(p.store.read(LEDGER_KEY), ledgerBefore, 'the ledger is untouched');
  assert.equal(p.store.read(STATE_KEY), stateBefore, 'the run state is untouched');

  // Data a newer release wrote at schema versions this one reads is only a warning.
  const q = project(github(`v${VERSION}`));
  startedOn(q.store, newer);
  const soft = checkDrift({ root: q.root, store: q.store });
  assert.equal(soft.refusal, null);
  assert.match(soft.warnings.join('\n'), /no migration backwards/);
});

test('reports from executors on an earlier release are accepted within the same minor', () => {
  assert.equal(sameMinor('0.1.0', '0.1.3'), true);
  assert.equal(sameMinor('0.1.0-rc.1', '0.1.0'), true);
  assert.equal(sameMinor('0.1.0', '0.2.0'), false);
  assert.equal(reportVersion(VERSION, VERSION), null);
  assert.equal(reportVersion(undefined, VERSION), null);
  const same = reportVersion(OLDER_SAME_MINOR, VERSION);
  assert.deepEqual([same?.same_minor, 'warning' in (same ?? {})], [true, false]);
  const other = reportVersion('0.0.9', '0.1.0');
  assert.equal(other?.same_minor, false);
  assert.match(other?.warning ?? '', /nothing is in flight/);
  const p = project(null);
  appendEvent(p.store, {
    id: 'dispatched-D-1',
    event: 'dispatched',
    dispatch: 'D-1',
    item: 'W-1',
    skill_versions: { hitld_version: OLDER_SAME_MINOR },
  });
  assert.equal(dispatchedOn(readLedger(p.store).events, 'D-1'), OLDER_SAME_MINOR);
  assert.equal(dispatchedOn(readLedger(p.store).events, 'D-2'), null);
});

/** A directory of release records. @param {Record<string, string>} records tag to front matter and body */
function recordsDir(records) {
  const dir = mkdtempSync(join(tmpdir(), 'hitld-records-'));
  for (const [tag, text] of Object.entries(records)) writeFileSync(join(dir, `${tag}.md`), text);
  return dir;
}

/** @param {string} version @param {string} bump @param {string[]} delta @param {string[]} notes */
const record = (version, bump, delta, notes) =>
  [
    '---',
    `id: v${version}`,
    `version: ${version}`,
    `bump: ${bump}`,
    'interface_delta:',
    ...delta.map((d) => `  - ${d}`),
    'decision: owner',
    'classification: public',
    '---',
    '',
    '## Notes',
    '',
    ...(notes.length ? notes.map((n) => `- ${n}`) : ['No release notes.']),
    '',
  ].join('\n');

const RECORDS = {
  'v0.1.0': record('0.1.0', 'minor', ['additive cli: first release'], ['The first release.']),
  'v0.1.1': record('0.1.1', 'patch', ['fix cli: a fix'], ['A fix.']),
  'v0.2.0-rc.1': record('0.2.0', 'minor', ['breaking schemas: items rename x'], ['A candidate.']),
  'v0.2.0': record(
    '0.2.0',
    'minor',
    ['breaking schemas: items rename x', 'additive cli: hitld upgrade plan'],
    ['Items rename x; run hitld work migrate.'],
  ),
};
// The candidate's front matter names its own version.
RECORDS['v0.2.0-rc.1'] = RECORDS['v0.2.0-rc.1']
  .replace(/version: 0\.2\.0\n/, 'version: 0.2.0-rc.1\n')
  .replace('id: v0.2.0\n', 'id: v0.2.0-rc.1\n');

test('the upgrade plan reads the records on the way and lists the steps in order, by role', () => {
  const dir = recordsDir({ ...RECORDS, 'v9.9.9': 'not a record' });
  const all = loadRecords(dir);
  assert.deepEqual(
    all.map((r) => r.tag),
    ['v0.1.0', 'v0.1.1', 'v0.2.0-rc.1', 'v0.2.0'],
  );
  assert.deepEqual(all[3].notes, ['Items rename x; run hitld work migrate.']);
  const across = span(all, '0.1.1', '0.2.0');
  assert.deepEqual(
    across.map((r) => r.tag),
    ['v0.2.0'],
    'a candidate is covered by its full release',
  );
  assert.deepEqual(
    span(all, '0.1.1', '0.2.0-rc.1').map((r) => r.tag),
    ['v0.2.0-rc.1'],
  );

  const minor = buildPlan({ from: '0.1.1', to: '0.2.0', records: across, pinVersion: '0.2.0' });
  assert.equal(minor.same_minor, false);
  assert.equal(minor.breaking, true);
  assert.deepEqual(minor.migrations, [
    'hitld work migrate',
    'hitld config migrate',
    'hitld data migrate',
  ]);
  const order = minor.steps.map((s) => `${s.who}${s.run ? ` ${s.run[0]}` : ''}`);
  assert.deepEqual(order, [
    'owner',
    'chief-of-staff',
    'orchestrator hitld ledger in-flight',
    'every-machine claude plugin marketplace update human-in-the-lead',
    'every-machine',
    'chief-of-staff',
    'orchestrator hitld work migrate --dry-run',
    'every-machine hitld config migrate',
    'orchestrator hitld data migrate',
    'orchestrator hitld check contract',
    'executors',
  ]);
  assert.equal(minor.steps[0].done, true, 'the pin already names the target');
  assert.match(minor.steps[4].does, /Restart every session/);
  assert.match(minor.roles.executors[0], /None are running/);
  assert.equal(minor.roles.owner.length, 1);

  const patch = buildPlan({
    from: '0.1.0',
    to: '0.1.1',
    records: span(all, '0.1.0', '0.1.1'),
    inFlight: [{ dispatch: 'D-4' }],
  });
  assert.equal(patch.same_minor, true);
  assert.deepEqual(patch.migrations, [], 'a patch release names no migration');
  assert.deepEqual(patch.steps[2].run, ['hitld handover']);
  assert.match(patch.roles.executors[0], /accepts their reports.*D-4/);
});

test('hitld upgrade plan: from the pin and the ledger, read only', async () => {
  const dir = recordsDir(RECORDS);
  const p = project(github('v0.2.0'));
  startedOn(p.store, '0.1.1');
  const listing = () => [
    readdirSync(p.root).join(','),
    p.store.read(LEDGER_KEY),
    readdirSync(dir).join(','),
  ];
  const before = listing();
  const r = await hitld(['upgrade', 'plan', '--records', dir, '--store', p.storeDir], p.root);
  assert.equal(r.code, EXIT.ok, JSON.stringify(r.json));
  assert.deepEqual([r.json.from, r.json.to, r.json.due], ['0.1.1', '0.2.0', true]);
  assert.deepEqual(
    r.json.releases.map((/** @type {any} */ x) => x.tag),
    ['v0.2.0'],
  );
  assert.equal(r.json.version.refusal.error, 'version-not-pinned', 'this session is not on 0.2.0');
  assert.deepEqual(listing(), before, 'nothing changed');

  const missing = await hitld(
    ['upgrade', 'plan', '--records', dir, '--to', '0.3.0', '--store', p.storeDir],
    p.root,
  );
  assert.deepEqual([missing.code, missing.json.error], [EXIT.failed, 'not-found']);
  assert.match(missing.json.message, /claude plugin marketplace update human-in-the-lead/);

  const none = await hitld(['upgrade', 'plan', '--records', dir], project(null).root);
  assert.equal(none.json.error, 'usage');
  const same = await hitld(
    ['upgrade', 'plan', '--records', dir, '--from', '0.2.0', '--to', '0.2.0'],
    p.root,
  );
  assert.deepEqual([same.json.ok, same.json.due], [true, false]);
});

test('the session-start hook says what drifted, and nothing when all agree', () => {
  const env = { XDG_DATA_HOME: mkdtempSync(join(tmpdir(), 'hitld-upgrade-data-')) };
  assert.equal(sessionNotice({ cwd: project(github(`v${VERSION}`)).root, env }), '');
  const off = project(github(`v${NEXT_MINOR}`));
  const text = sessionNotice({ cwd: off.root, env });
  assert.match(text, /version-not-pinned/);
  const hook = join(ROOT, 'core/harness/claude-code/hooks/version-check.mjs');
  const out = execFileSync('node', [hook], {
    input: JSON.stringify({ cwd: off.root, hook_event_name: 'SessionStart' }),
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  assert.match(out, /pins \S+ \(ref v/);
  // An executor's session says nothing: it starts no run.
  const quiet = execFileSync('node', [hook], {
    input: JSON.stringify({ cwd: off.root }),
    env: { PATH: process.env.PATH, ...env, HITLD_DISPATCH: 'D-1' },
    encoding: 'utf8',
  });
  assert.equal(quiet, '');
  // A separate SessionStart entry, beside the one that sets the PATH.
  const hooks = JSON.parse(
    readFileSync(join(ROOT, 'core/harness/claude-code/hooks/hooks.json'), 'utf8'),
  );
  const commands = hooks.hooks.SessionStart.map((/** @type {any} */ h) => h.hooks[0].command);
  assert.ok(commands.some((/** @type {string} */ c) => c.endsWith('version-check.mjs"')));
  assert.ok(commands.some((/** @type {string} */ c) => c.endsWith('session-start.mjs"')));
});
