// The versioning rule for the person and machine files (design part 16.5), and the attention
// budget keys in the person file (design part 23.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { VERSION } from '../lib/version.mjs';
import { compareVersions } from '../lib/release/semver.mjs';
import { loadSettingsFile, settingsLocation, writeSettingsFile } from '../lib/settings/files.mjs';
import { effectiveSettings } from '../lib/settings/layers.mjs';
import { attentionDefaults, localZone } from '../lib/settings/attention.mjs';
import {
  SETTINGS_VERSIONS,
  lowestVersion,
  newerRefusal,
  pinWarnings,
  readsUpTo,
  stampLowest,
} from '../lib/settings/versions.mjs';
import { pinnedProjects } from '../lib/settings/pins.mjs';

/** A fresh home for settings. */
function home() {
  const base = mkdtempSync(join(tmpdir(), 'hitld-versions-'));
  const env = {
    XDG_CONFIG_HOME: join(base, 'config'),
    XDG_DATA_HOME: join(base, 'data'),
  };
  return { base, env };
}

/**
 * Plant a settings file, bypassing the writer.
 * @param {NodeJS.ProcessEnv} env @param {'person' | 'machine'} kind @param {unknown} data
 */
function plant(env, kind, data) {
  const loc = settingsLocation(kind, { env });
  mkdirSync(loc.dir, { recursive: true });
  writeFileSync(loc.path, JSON.stringify(data), { mode: 0o600 });
  return loc.path;
}

/** @param {NodeJS.ProcessEnv} env @param {'person' | 'machine'} kind */
const onDisk = (env, kind) =>
  JSON.parse(readFileSync(settingsLocation(kind, { env }).path, 'utf8'));

/**
 * A consuming project that pins hitld, as `hitld install` leaves it.
 * @param {Record<string, unknown>} source @param {string} [id]
 */
function pinnedProject(source, id = 'fixture') {
  const root = mkdtempSync(join(tmpdir(), 'hitld-versions-repo-'));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, '.human-in-the-lead'));
  mkdirSync(join(root, '.claude'));
  writeFileSync(
    join(root, '.human-in-the-lead', 'policy.json'),
    JSON.stringify({ schema_version: 1, project: { id, key: 'W' } }),
  );
  writeFileSync(
    join(root, '.claude', 'settings.json'),
    JSON.stringify({ extraKnownMarketplaces: { 'human-in-the-lead': { source } } }),
  );
  return root;
}

/**
 * A checkout of an older hitld: only the files that say what it reads.
 * @param {string} version @param {{ person: number, machine: number }} reads
 */
function oldCheckout(version, reads) {
  const dir = mkdtempSync(join(tmpdir(), 'hitld-old-checkout-'));
  mkdirSync(join(dir, 'schemas'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'human-in-the-lead', version }));
  for (const kind of /** @type {const} */ (['person', 'machine'])) {
    writeFileSync(
      join(dir, 'schemas', `${kind}.schema.json`),
      JSON.stringify({ $id: kind, 'x-hitld-schema-version': reads[kind] }),
    );
  }
  return dir;
}

/** @param {string[]} argv @param {string} cwd @param {NodeJS.ProcessEnv} env */
async function hitld(argv, cwd, env) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env });
  return { code, result: JSON.parse(out) };
}

// The table

test('the version table ends at the schema version, and every row is a release that exists', () => {
  const registry = schemas();
  for (const kind of /** @type {const} */ (['person', 'machine'])) {
    const rows = SETTINGS_VERSIONS[kind];
    assert.equal(rows.at(-1)?.version, registry.currentVersion(kind), kind);
    rows.forEach((row, i) => {
      assert.equal(row.version, i + 1, `${kind} versions run 1, 2, 3 without a gap`);
      assert.ok(
        compareVersions(row.from, VERSION) <= 0,
        `${kind} ${row.version} is not from a later release`,
      );
      if (i > 0) assert.ok(row.keys.length > 0, `${kind} ${row.version} says what it added`);
    });
  }
});

// The writer stamps the lowest version that expresses the content

test('a file that sets no attention key is stamped 1, and one that sets any is stamped 2', () => {
  assert.equal(lowestVersion('person', { schema_version: 2, max_executors: 3 }), 1);
  assert.equal(lowestVersion('person', { schema_version: 1, attention: {} }), 2);
  assert.equal(lowestVersion('machine', { schema_version: 1, cores: 2 }), 1);
  assert.deepEqual(stampLowest('person', { schema_version: 2, max_executors: 3 }), {
    schema_version: 1,
    max_executors: 3,
  });
});

test('writeSettingsFile stamps the lowest version, and stamps again on merge', () => {
  const { env } = home();
  writeSettingsFile('person', { schema_version: 2, max_executors: 3 }, { env, cwd: tmpdir() });
  assert.equal(onDisk(env, 'person').schema_version, 1, 'nothing new in it, so 1');
  writeSettingsFile(
    'person',
    { attention: { interrupts_per_day: 1 } },
    { env, cwd: tmpdir(), merge: true },
  );
  assert.equal(onDisk(env, 'person').schema_version, 2, 'attention needs 2');
  assert.equal(onDisk(env, 'person').max_executors, 3);
  writeSettingsFile('person', { schema_version: 2, max_executors: 2 }, { env, cwd: tmpdir() });
  assert.equal(onDisk(env, 'person').schema_version, 1, 'a file that needs less goes back to 1');
  writeSettingsFile('machine', { schema_version: 1, cores: 2 }, { env, cwd: tmpdir() });
  assert.equal(onDisk(env, 'machine').schema_version, 1);
});

// The reader accepts at or below its own, and refuses a newer one

test('a reader accepts its own version and older ones', () => {
  const { env } = home();
  plant(env, 'person', { schema_version: 1, max_executors: 2 });
  assert.equal(loadSettingsFile('person', { env }).data?.max_executors, 2);
  plant(env, 'person', { schema_version: 2, attention: { interrupts_per_day: 1 } });
  assert.equal(loadSettingsFile('person', { env }).data?.attention.interrupts_per_day, 1);
  plant(env, 'machine', { schema_version: 1, cores: 2 });
  assert.equal(loadSettingsFile('machine', { env }).data?.cores, 2);
});

test('a newer version is refused with an upgrade message that names the project', () => {
  const { env } = home();
  for (const [kind, newer] of /** @type {const} */ ([
    ['person', 3],
    ['machine', 2],
  ])) {
    // Keys this release does not know are not what is reported: the version is.
    plant(env, kind, { schema_version: newer, from_the_future: true });
    const f = loadSettingsFile(kind, { env });
    assert.equal(f.data, null);
    assert.equal(f.errors.length, 1);
    assert.match(
      f.errors[0].message,
      new RegExp(`schema_version is ${newer}, newer than this release`),
    );
    assert.match(f.errors[0].message, /upgrade human-in-the-lead \(hitld\)/);
    assert.deepEqual(f.newer, { found: newer, known: schemas().currentVersion(kind) });
  }
  assert.equal(newerRefusal('person', { schema_version: 2 }), null);
});

test('a file a newer release wrote is never replaced or merged into', () => {
  const { env } = home();
  const path = plant(env, 'person', { schema_version: 3, from_the_future: true });
  const before = readFileSync(path, 'utf8');
  assert.throws(
    () =>
      writeSettingsFile('person', { schema_version: 1, max_executors: 2 }, { env, cwd: tmpdir() }),
    /upgrade human-in-the-lead.*nothing was written/s,
  );
  assert.throws(
    () => writeSettingsFile('person', { max_executors: 2 }, { env, cwd: tmpdir(), merge: true }),
    /nothing was written/,
  );
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.throws(
    () => writeSettingsFile('person', { schema_version: 3 }, { env: home().env, cwd: tmpdir() }),
    /newer than this release knows/,
  );
});

// What a pinned release reads

test('a release reads the versions from its own first release on', () => {
  assert.equal(readsUpTo('person', '0.1.0-rc.1'), 2);
  assert.equal(readsUpTo('person', '0.1.0'), 2);
  assert.equal(readsUpTo('person', '0.1.0-beta.1'), 0, 'a release from before the file');
  assert.equal(readsUpTo('machine', '1.0.0'), 1);
});

test('pinWarnings names each pinned project that cannot read the file as it is', () => {
  const file = { schema_version: 2, attention: { interrupts_per_day: 1 } };
  const warnings = pinWarnings('person', file, [
    { project: 'old-checkout', version: '0.1.0', reads: { person: 1 }, where: 'a checkout' },
    { project: 'current', version: '0.1.0', where: 'ref v0.1.0' },
    { project: 'moving', version: null, where: 'ref main' },
    { project: 'ancient', version: '0.1.0-beta.1', where: 'its last run' },
  ]);
  assert.equal(warnings.length, 3);
  assert.match(
    warnings[0],
    /old-checkout pins human-in-the-lead 0\.1\.0, which reads the person file up to schema_version 1, and the file is at 2 \(it sets attention\)/,
  );
  assert.match(warnings[1], /moving pins human-in-the-lead at ref main, which names no release/);
  assert.match(warnings[2], /ancient .* from before the person file/);
  assert.deepEqual(
    pinWarnings('person', { schema_version: 1, max_executors: 2 }, [
      { project: 'old-checkout', version: '0.1.0', reads: { person: 1 }, where: 'a checkout' },
    ]),
    [],
    'a file at version 1 is readable by every release',
  );
  assert.deepEqual(
    pinWarnings('person', null, [{ project: 'x', version: '0.0.1', where: 'w' }]),
    [],
  );
});

test('pinnedProjects reads the current pin and the last run of every other project', () => {
  const { env } = home();
  const root = pinnedProject({ source: 'github', repo: 'owner/human-in-the-lead', ref: 'v0.1.0' });
  const store = join(env.XDG_DATA_HOME ?? '', 'human-in-the-lead', 'other');
  mkdirSync(store, { recursive: true });
  writeFileSync(
    join(store, 'ledger.jsonl'),
    [
      { id: 'E-1', event: 'run-started', skill_versions: { hitld_version: '0.0.9' } },
      { id: 'E-2', event: 'dispatched' },
      { id: 'E-3', event: 'run-started', skill_versions: { hitld_version: '0.1.0-rc.1' } },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n'),
  );
  mkdirSync(join(env.XDG_DATA_HOME ?? '', 'human-in-the-lead', '_machine'), { recursive: true });
  const pins = pinnedProjects({ cwd: root, env, project: 'fixture' });
  assert.deepEqual(
    pins.map((p) => [p.project, p.version, p.where]),
    [
      ['fixture', '0.1.0', 'ref v0.1.0'],
      ['other', '0.1.0-rc.1', 'its last run'],
    ],
  );
});

test('config explain warns when a project pinned on this machine cannot read the file', async () => {
  const { env } = home();
  const old = oldCheckout('0.1.0', { person: 1, machine: 1 });
  const root = pinnedProject({ source: 'directory', path: old });
  plant(env, 'person', { schema_version: 2, attention: { interrupts_per_day: 1 } });
  plant(env, 'machine', { schema_version: 1, cores: 2 });
  const out = await hitld(['config', 'explain', '--json'], root, env);
  const messages = out.result.warnings.map((/** @type {any} */ w) => w.message);
  assert.equal(messages.length, 1, JSON.stringify(messages));
  assert.match(
    messages[0],
    /the person file: fixture pins human-in-the-lead 0\.1\.0, which reads the person file up to schema_version 1/,
  );
  assert.match(messages[0], /it sets attention/);
  assert.match(messages[0], /update fixture's pin to 0\.1\.0-rc\.1 or later/);
  assert.equal(out.result.ok, true);

  // A person file with no attention key is version 1, which that checkout reads: no warning.
  plant(env, 'person', { schema_version: 1, max_executors: 2 });
  const quiet = await hitld(['config', 'explain', '--json'], root, env);
  assert.deepEqual(quiet.result.warnings, []);
});

test('config explain reports a newer person file as an error that says to upgrade', async () => {
  const { env } = home();
  const root = pinnedProject({ source: 'github', repo: 'o/r', ref: 'v0.1.0' });
  plant(env, 'person', { schema_version: 3 });
  const out = await hitld(['config', 'explain', '--json'], root, env);
  assert.equal(out.result.ok, false);
  assert.match(out.result.errors[0].message, /upgrade human-in-the-lead/);
});

// The attention keys

test('the attention keys have conservative defaults, and the person file takes its own values', () => {
  const d = attentionDefaults();
  assert.equal(d.decisions_per_digest, 5);
  assert.equal(d.interrupts_per_day, 3);
  assert.equal(
    d.non_urgent_at_once,
    0,
    'no non-urgent question interrupts unless the person allows it',
  );
  assert.deepEqual(d.quiet_hours, [{ from: '22:00', to: '07:00' }]);
  assert.equal(d.timezone, localZone());
  assert.equal(d.answering_window_minutes, 30);
  const { env } = home();
  plant(env, 'person', {
    schema_version: 2,
    attention: {
      decisions_per_digest: 8,
      quiet_hours: [],
      timezone: 'Europe/Paris',
      non_urgent_at_once: 2,
    },
  });
  const f = loadSettingsFile('person', { env });
  assert.deepEqual(f.errors, []);
  assert.equal(f.data?.attention.timezone, 'Europe/Paris');
  plant(env, 'person', {
    schema_version: 2,
    attention: { quiet_hours: [{ from: '25:00', to: '07:00' }] },
  });
  assert.notEqual(loadSettingsFile('person', { env }).errors.length, 0);
  plant(env, 'person', { schema_version: 2, attention: { decisions_per_digest: 0 } });
  assert.notEqual(loadSettingsFile('person', { env }).errors.length, 0);
});

/** @param {{ raw?: Record<string, any>, person?: Record<string, any> | null }} o */
function layers(o) {
  const raw = { schema_version: 1, project: { id: 'fixture', key: 'W' }, ...(o.raw ?? {}) };
  const { policy, errors } = resolvePolicy(raw);
  assert.deepEqual(errors, []);
  return effectiveSettings({
    project: /** @type {Record<string, any>} */ (policy),
    raw,
    person: o.person ?? null,
    machine: null,
    run: null,
  });
}

test("the project's ceiling lowers the person's budget and never raises it", () => {
  const none = layers({});
  assert.equal(none.attention.decisions_per_digest, 5);
  assert.equal(none.values.find((e) => e.key === 'attention.interrupts_per_day')?.layer, 'default');

  const own = layers({ person: { schema_version: 2, attention: { decisions_per_digest: 8 } } });
  assert.equal(own.attention.decisions_per_digest, 8);
  assert.equal(own.values.find((e) => e.key === 'attention.decisions_per_digest')?.layer, 'person');

  const capped = layers({
    raw: { attention: { decisions_per_digest_max: 6, interrupts_per_day_max: 1 } },
    person: { schema_version: 2, attention: { decisions_per_digest: 8, interrupts_per_day: 4 } },
  });
  assert.equal(capped.attention.decisions_per_digest, 6);
  assert.equal(capped.attention.interrupts_per_day, 1);
  const e = capped.values.find((v) => v.key === 'attention.decisions_per_digest');
  assert.equal(e?.layer, 'project');
  assert.equal(e?.overridden[0].value, 8);
  assert.match(e?.overridden[0].why ?? '', /looser/);

  const loose = layers({
    raw: { attention: { decisions_per_digest_max: 50 } },
    person: { schema_version: 2, attention: { decisions_per_digest: 8 } },
  });
  assert.equal(loose.attention.decisions_per_digest, 8, 'a higher ceiling has no effect');
});

test('an unknown time zone is an error that says what to write', () => {
  const eff = layers({ person: { schema_version: 2, attention: { timezone: 'Mars/Olympus' } } });
  assert.match(eff.errors[0].message, /not a time zone/);
});

test('a ceiling in the person file, or a budget in policy.json, is refused with its home', () => {
  const { env } = home();
  plant(env, 'person', { schema_version: 2, attention: { decisions_per_digest_max: 3 } });
  assert.match(
    loadSettingsFile('person', { env }).errors[0].message,
    /a project setting; it belongs in policy\.json/,
  );
  const policy = resolvePolicy({
    schema_version: 1,
    project: { id: 'x', key: 'W' },
    attention: { decisions_per_digest: 3 },
  });
  assert.notEqual(policy.errors.length, 0);
});
