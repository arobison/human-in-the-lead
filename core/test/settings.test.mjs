import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  chownSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import { policyDefaults, resolvePolicy } from '../lib/policy/policy.mjs';
import {
  loadSettingsFile,
  machineDir,
  settingsLocation,
  writeSettingsFile,
} from '../lib/settings/files.mjs';
import {
  effectiveSettings,
  loadEffectivePolicy,
  movedKeyWarnings,
} from '../lib/settings/layers.mjs';
import { proposeMigration } from '../lib/settings/migrate.mjs';
import { envSettings } from '../lib/env/config.mjs';

const posixOnly = { skip: process.platform === 'win32' };

/** A fresh home for settings: XDG_CONFIG_HOME and XDG_DATA_HOME under a private temporary dir. */
function home() {
  const base = mkdtempSync(join(tmpdir(), 'hitld-settings-'));
  const env = { XDG_CONFIG_HOME: join(base, 'config'), XDG_DATA_HOME: join(base, 'data') };
  return { base, env };
}

/**
 * Plant a settings file directly, bypassing the writer.
 * @param {NodeJS.ProcessEnv} env @param {'person' | 'machine'} kind @param {unknown} data
 */
function plant(env, kind, data) {
  const loc = settingsLocation(kind, { env });
  mkdirSync(loc.dir, { recursive: true });
  writeFileSync(loc.path, typeof data === 'string' ? data : JSON.stringify(data), { mode: 0o600 });
  return loc.path;
}

/** A consuming project with a policy.json. @param {Record<string, unknown>} [extra] */
function projectRepo(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hitld-settings-repo-'));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, '.human-in-the-lead'));
  const raw = { schema_version: 1, project: { id: 'fixture', key: 'W' }, ...extra };
  writeFileSync(join(root, '.human-in-the-lead', 'policy.json'), JSON.stringify(raw, null, 2));
  return root;
}

/**
 * The layers for effectiveSettings, from a policy.json and settings data.
 * @param {{ raw?: Record<string, any>, person?: Record<string, any> | null, machine?: Record<string, any> | null, run?: Record<string, any> | null }} o
 */
function layers(o) {
  const raw = { schema_version: 1, project: { id: 'fixture', key: 'W' }, ...(o.raw ?? {}) };
  const { policy, errors } = resolvePolicy(raw);
  assert.deepEqual(errors, []);
  return effectiveSettings({
    project: /** @type {Record<string, any>} */ (policy),
    raw,
    person: o.person ?? null,
    machine: o.machine ?? null,
    run: o.run ?? null,
  });
}

/** @param {ReturnType<typeof layers>} eff @param {string} key */
const entry = (eff, key) => {
  const e = eff.values.find((v) => v.key === key);
  assert.ok(e, `no entry ${key}`);
  return e;
};

/** @param {string[]} argv @param {string} cwd @param {NodeJS.ProcessEnv} env */
async function hitld(argv, cwd, env) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env });
  return { code, result: JSON.parse(out) };
}

// Locations

test('the person file is configuration and the machine file sits beside the registry', () => {
  const env = { XDG_CONFIG_HOME: '/c', XDG_DATA_HOME: '/d' };
  assert.equal(settingsLocation('person', { env }).path, '/c/human-in-the-lead/person.json');
  assert.equal(
    settingsLocation('machine', { env }).path,
    '/d/human-in-the-lead/_machine/machine.json',
  );
  assert.equal(machineDir({ env }), '/d/human-in-the-lead/_machine');
  const relative = { XDG_CONFIG_HOME: 'rel', XDG_DATA_HOME: 'rel' };
  assert.equal(
    settingsLocation('person', { env: relative, home: '/h' }).path,
    '/h/.config/human-in-the-lead/person.json',
  );
  assert.equal(
    settingsLocation('machine', { env: relative, home: '/h' }).path,
    '/h/.local/share/human-in-the-lead/_machine/machine.json',
  );
});

// Loading: data only, trusted

test('an absent settings file is not an error: that layer is not set', () => {
  const { env } = home();
  const f = loadSettingsFile('person', { env });
  assert.equal(f.present, false);
  assert.equal(f.data, null);
  assert.deepEqual(f.errors, []);
});

test('a valid person file loads', () => {
  const { env } = home();
  plant(env, 'person', { schema_version: 1, max_executors: 2 });
  const f = loadSettingsFile('person', { env });
  assert.deepEqual(f.errors, []);
  assert.equal(f.data?.max_executors, 2);
});

test('unknown and code-running keys are refused', () => {
  const { env } = home();
  plant(env, 'person', { schema_version: 1, surprise: 1 });
  assert.match(loadSettingsFile('person', { env }).errors[0].message, /is not a known key/);
  plant(env, 'machine', { schema_version: 1, env: { setup_script: 'make' } });
  const errors = loadSettingsFile('machine', { env }).errors;
  assert.match(errors[0].path, /env\.setup_script$/);
  assert.match(errors[0].message, /names code to run/);
});

test('a key in the wrong layer is refused with its home named', () => {
  const { env } = home();
  plant(env, 'person', { schema_version: 1, env: { port_range: { min: 5000, max: 5010 } } });
  assert.match(
    loadSettingsFile('person', { env }).errors[0].message,
    /is a machine setting; it belongs in machine\.json/,
  );
  plant(env, 'machine', { schema_version: 1, quota: { reserve: 0.3 } });
  assert.match(
    loadSettingsFile('machine', { env }).errors[0].message,
    /is a person setting; it belongs in person\.json/,
  );
  plant(env, 'machine', { schema_version: 1, env: { worktree_setup: ['npm ci'] } });
  assert.match(
    loadSettingsFile('machine', { env }).errors[0].message,
    /is a project setting; it belongs in policy\.json/,
  );
  plant(env, 'person', { schema_version: 1, merge: { mode: 'queue' } });
  assert.match(loadSettingsFile('person', { env }).errors[0].message, /a project setting/);
});

test('a newer schema_version is refused', () => {
  const { env } = home();
  plant(env, 'person', { schema_version: 3 });
  assert.match(loadSettingsFile('person', { env }).errors[0].message, /newer than this release/);
});

test('a settings file owned by another user is refused', posixOnly, () => {
  const { env } = home();
  plant(env, 'person', { schema_version: 1 });
  const other = (process.getuid?.() ?? 0) + 4242;
  const f = loadSettingsFile('person', { env, uid: other });
  assert.equal(f.data, null);
  assert.match(f.errors[0].message, /owned by another user/);
});

test('a group- or world-writable settings file is refused', posixOnly, () => {
  const { env } = home();
  const path = plant(env, 'machine', { schema_version: 1 });
  chmodSync(path, 0o620);
  assert.match(loadSettingsFile('machine', { env }).errors[0].message, /mode 620/);
  chmodSync(path, 0o602);
  assert.match(loadSettingsFile('machine', { env }).errors[0].message, /mode 602/);
  chmodSync(path, 0o600);
  assert.deepEqual(loadSettingsFile('machine', { env }).errors, []);
});

test('a settings file in a writable directory is refused', posixOnly, () => {
  const { env } = home();
  plant(env, 'person', { schema_version: 1 });
  chmodSync(settingsLocation('person', { env }).dir, 0o777);
  assert.match(
    loadSettingsFile('person', { env }).errors[0].message,
    /is in .*human-in-the-lead, which is writable by group or others/,
  );
});

/**
 * Link the person file to a file in a dotfiles git repository, as GNU Stow would.
 * @param {string} base @param {NodeJS.ProcessEnv} env @param {unknown} data
 */
function dotfilesLink(base, env, data) {
  const dotfiles = join(base, 'dotfiles');
  mkdirSync(join(dotfiles, '.git'), { recursive: true });
  const target = join(dotfiles, 'person.json');
  writeFileSync(target, JSON.stringify(data), { mode: 0o600 });
  const loc = settingsLocation('person', { env });
  mkdirSync(loc.dir, { recursive: true });
  symlinkSync(target, loc.path);
  return { dotfiles, target };
}

test('a symlink into a dotfiles git repository loads', () => {
  const { base, env } = home();
  dotfilesLink(base, env, { schema_version: 1, max_executors: 2 });
  const f = loadSettingsFile('person', { env });
  assert.deepEqual(f.errors, []);
  assert.equal(f.data?.max_executors, 2);
});

test('a symlink whose target is group- or world-writable is refused', posixOnly, () => {
  const { base, env } = home();
  const { dotfiles, target } = dotfilesLink(base, env, { schema_version: 1 });
  chmodSync(target, 0o620);
  assert.match(loadSettingsFile('person', { env }).errors[0].message, /links to .*mode 620/);
  chmodSync(target, 0o600);
  chmodSync(dotfiles, 0o777);
  assert.match(
    loadSettingsFile('person', { env }).errors[0].message,
    /is in .*dotfiles, which is writable by group or others/,
  );
  chmodSync(dotfiles, 0o755);
  assert.deepEqual(loadSettingsFile('person', { env }).errors, []);
});

test('a symlink whose target is owned by someone else is refused', posixOnly, () => {
  const { base, env } = home();
  const { target } = dotfilesLink(base, env, { schema_version: 1 });
  if (process.getuid?.() === 0) {
    // As root, give the target itself to someone else: the link and its directory stay ours.
    chownSync(target, 4242, 4242);
    const f = loadSettingsFile('person', { env });
    assert.equal(f.data, null);
    assert.match(f.errors[0].message, /links to .*person\.json, which is owned by another user/);
  } else {
    const other = (process.getuid?.() ?? 0) + 4242;
    const f = loadSettingsFile('person', { env, uid: other });
    assert.equal(f.data, null);
    assert.match(f.errors[0].message, /owned by another user/);
  }
});

test('a dangling symlink is reported, not followed', () => {
  const { base, env } = home();
  const loc = settingsLocation('person', { env });
  mkdirSync(loc.dir, { recursive: true });
  symlinkSync(join(base, 'missing.json'), loc.path);
  const f = loadSettingsFile('person', { env });
  assert.equal(f.present, true);
  assert.match(f.errors[0].message, /cannot be read/);
});

test('a settings file inside a managed project is refused', () => {
  const { base, env } = home();
  mkdirSync(join(base, '.human-in-the-lead'));
  plant(env, 'person', { schema_version: 1 });
  const f = loadSettingsFile('person', { env });
  assert.equal(f.data, null);
  assert.match(f.errors[0].message, /a project HITLd manages/);
});

test('a symlink into a managed project is refused', () => {
  const { base, env } = home();
  const { dotfiles } = dotfilesLink(base, env, { schema_version: 1 });
  mkdirSync(join(dotfiles, '.human-in-the-lead'));
  assert.match(loadSettingsFile('person', { env }).errors[0].message, /a project HITLd manages/);
});

test('a settings file in another git repository loads', () => {
  const { base, env } = home();
  mkdirSync(join(base, '.git'));
  plant(env, 'person', { schema_version: 1 });
  assert.deepEqual(loadSettingsFile('person', { env }).errors, []);
});

// Strictest layer wins, one test per value

test('cap: the smallest of person, machine, project and run wins', () => {
  const all = layers({
    person: { schema_version: 1, max_executors: 5 },
    machine: { schema_version: 1, max_executors: 4 },
    raw: { execution: { max_executors: { value: 3, min: 1, max: 6 } } },
    run: { max_executors: 2 },
  });
  assert.equal(all.cap, 2);
  assert.equal(entry(all, 'executors.cap').layer, 'run');
  assert.deepEqual(
    entry(all, 'executors.cap').overridden.map((o) => o.layer),
    ['person', 'machine', 'project'],
  );
  assert.equal(layers({ person: { schema_version: 1, max_executors: 1 } }).cap, 1);
  assert.equal(layers({ machine: { schema_version: 1, max_executors: 2 } }).cap, 2);
  // The project's own cap (its default, 3) always counts: a looser person has no effect.
  const looser = layers({ person: { schema_version: 1, max_executors: 8 } });
  assert.equal(looser.cap, 3);
  assert.equal(entry(looser, 'executors.cap').layer, 'default');
  assert.equal(entry(looser, 'executors.cap').overridden[0].layer, 'person');
});

test('cap: executors already running elsewhere count against the person and machine', () => {
  const raw = { schema_version: 1, project: { id: 'fixture', key: 'W' } };
  const { policy } = resolvePolicy(raw);
  const eff = effectiveSettings({
    project: /** @type {Record<string, any>} */ (policy),
    raw,
    person: { schema_version: 1, max_executors: 3 },
    machine: null,
    running: { person: 2 },
  });
  assert.equal(eff.cap, 1);
});

test('reserve: the largest of person and project wins; a looser project has no effect', () => {
  const stricter = layers({
    person: { schema_version: 1, quota: { reserve: 0.2 } },
    raw: { quota: { reserve: 0.3 } },
  });
  assert.equal(entry(stricter, 'quota.reserve').value, 0.3);
  assert.equal(entry(stricter, 'quota.reserve').layer, 'project');
  assert.equal(stricter.policy.quota.reserve, 0.3);
  const looser = layers({
    person: { schema_version: 1, quota: { reserve: 0.2 } },
    raw: { quota: { reserve: 0.1 } },
  });
  const e = entry(looser, 'quota.reserve');
  assert.equal(e.value, 0.2);
  assert.equal(e.layer, 'person');
  assert.deepEqual(
    e.overridden.map((o) => [o.layer, o.value]),
    [['project', 0.1]],
  );
  // The person may set a reserve below the default for themselves.
  const own = layers({ person: { schema_version: 1, quota: { reserve: 0.1 } } });
  assert.equal(own.policy.quota.reserve, 0.1);
  assert.equal(entry(layers({}), 'quota.reserve').layer, 'default');
});

test('thresholds: economize_below and critical_below take the earlier (larger) threshold', () => {
  for (const k of ['economize_below', 'critical_below']) {
    const p = { schema_version: 1, quota: { [k]: 0.3 } };
    const stricter = layers({ person: p, raw: { quota: { [k]: 0.35 } } });
    assert.equal(stricter.policy.quota[k], 0.35, k);
    const looser = layers({ person: p, raw: { quota: { [k]: 0.05 } } });
    assert.equal(looser.policy.quota[k], 0.3, k);
    assert.equal(entry(looser, `quota.${k}`).overridden[0].layer, 'project', k);
  }
});

test('thresholds: notification shares from every layer apply', () => {
  const eff = layers({
    person: { schema_version: 1, quota: { notify_used: [0.5, 0.9] } },
    raw: { quota: { notify_used: [0.25, 0.5] } },
  });
  assert.deepEqual(eff.policy.quota.notify_used, [0.25, 0.5, 0.9]);
});

test('limits: a project limit with the same id only tightens the person limit', () => {
  const personLimit = {
    id: 'api',
    unit: 'usd',
    window: 'monthly_utc',
    limit: 100,
    source: 'declared',
    hard: false,
  };
  const person = { schema_version: 1, quota: { limits: [personLimit] } };
  const lower = layers({
    person,
    raw: { quota: { limits: [{ ...personLimit, limit: 40, hard: true, reserve: 0.5 }] } },
  });
  assert.deepEqual(lower.policy.quota.limits, [
    { ...personLimit, limit: 40, hard: true, reserve: 0.5 },
  ]);
  assert.equal(entry(lower, 'quota.limits.api').layer, 'person+project');
  const higher = layers({ person, raw: { quota: { limits: [{ ...personLimit, limit: 500 }] } } });
  assert.deepEqual(higher.policy.quota.limits, [personLimit]);
  assert.match(entry(higher, 'quota.limits.api').overridden[0].why, /no stricter/);
  // The person's list replaces the defaults.
  assert.deepEqual(layers({ person }).policy.quota.limits, [personLimit]);
});

test('limits: a project run budget is added to the person limits', () => {
  const run = {
    id: 'run-tokens',
    unit: 'tokens',
    window: 'run',
    limit: 1000,
    source: 'estimated',
    hard: false,
  };
  const eff = layers({ raw: { quota: { limits: [run] } } });
  const ids = eff.policy.quota.limits.map((/** @type {any} */ l) => l.id);
  assert.deepEqual(ids, ['claude-five-hour', 'claude-weekly', 'run-tokens']);
  assert.deepEqual(
    movedKeyWarnings({
      raw: { quota: { limits: [run] } },
      person: null,
      machine: null,
      project: {},
    }),
    [],
  );
});

test('port range: the overlap of machine and project; a project cannot widen it', () => {
  const machine = { schema_version: 1, env: { port_range: { min: 4100, max: 4199 } } };
  const narrower = layers({ machine, raw: { env: { port_range: { min: 4150, max: 4160 } } } });
  assert.deepEqual(narrower.policy.env.port_range, { min: 4150, max: 4160 });
  assert.equal(entry(narrower, 'env.port_range').layer, 'project');
  const wider = layers({ machine, raw: { env: { port_range: { min: 3000, max: 9000 } } } });
  assert.deepEqual(wider.policy.env.port_range, { min: 4100, max: 4199 });
  assert.equal(entry(wider, 'env.port_range').layer, 'machine');
  const partial = layers({ machine, raw: { env: { port_range: { min: 4180, max: 4300 } } } });
  assert.deepEqual(partial.policy.env.port_range, { min: 4180, max: 4199 });
  const apart = layers({ machine, raw: { env: { port_range: { min: 5000, max: 5100 } } } });
  assert.match(apart.errors[0].message, /does not overlap/);
  assert.deepEqual(envSettings(narrower.policy).portRange, { min: 4150, max: 4160 });
});

test("worktree root: the machine's, or a project subdirectory under it", () => {
  const machine = { schema_version: 1, env: { worktree_root: '/srv/wt' } };
  assert.equal(layers({ machine }).policy.env.worktree_root, '/srv/wt');
  assert.equal(
    layers({ machine, raw: { env: { worktree_root: 'proj' } } }).policy.env.worktree_root,
    '/srv/wt/proj',
  );
  const outside = layers({ machine, raw: { env: { worktree_root: '/tmp/wt' } } });
  assert.equal(outside.policy.env.worktree_root, '/srv/wt');
  assert.equal(entry(outside, 'env.worktree_root').overridden[0].layer, 'project');
  const escape = layers({ machine, raw: { env: { worktree_root: '../x' } } });
  assert.equal(escape.policy.env.worktree_root, '/srv/wt');
  assert.match(
    layers({ machine: { schema_version: 1, env: { worktree_root: 'rel' } } }).errors[0].message,
    /absolute/,
  );
});

test('secret provider: a project may narrow auto, never widen or change it', () => {
  const auto = { schema_version: 1, env: { secret_provider: 'auto' } };
  assert.equal(
    layers({ machine: auto, raw: { env: { secret_provider: 'keychain' } } }).policy.env
      .secret_provider,
    'keychain',
  );
  const keychain = { schema_version: 1, env: { secret_provider: 'keychain' } };
  const widen = layers({ machine: keychain, raw: { env: { secret_provider: 'auto' } } });
  assert.equal(widen.policy.env.secret_provider, 'keychain');
  const sideways = layers({ machine: keychain, raw: { env: { secret_provider: 'env' } } });
  assert.equal(sideways.policy.env.secret_provider, 'keychain');
  assert.equal(entry(sideways, 'env.secret_provider').overridden[0].layer, 'project');
});

// Moved keys

test('moved keys in policy.json still load, with a warning naming their new home', () => {
  const raw = {
    quota: { reserve: 0.3, forecast_hours: 3 },
    env: { port_range: { min: 5000, max: 5010 }, worktree_root: '/srv/wt' },
  };
  const eff = layers({ raw });
  assert.equal(eff.policy.quota.reserve, 0.3);
  assert.deepEqual(eff.policy.env.port_range, { min: 5000, max: 5010 });
  const homes = eff.warnings.map((w) => [w.path, w.home]);
  assert.deepEqual(homes, [
    ['quota.reserve', 'person'],
    ['quota.forecast_hours', 'person'],
    ['env.port_range', 'machine'],
    ['env.worktree_root', 'machine'],
  ]);
  assert.match(eff.warnings[0].message, /moved to the person file \(person\.json\)/);
  // Once the person file sets the reserve, the project's larger one is a legitimate tightening.
  const later = layers({ raw, person: { schema_version: 1, quota: { reserve: 0.25 } } });
  assert.ok(!later.warnings.some((w) => w.path === 'quota.reserve'));
});

test('hitld check policy shows the moved-key warnings', async () => {
  const root = projectRepo({ quota: { reserve: 0.3 } });
  const { env } = home();
  const { code, result } = await hitld(['check', 'policy'], root, env);
  assert.equal(code, 0);
  assert.match(result.warnings[0], /quota\.reserve, which moved to the person file/);
});

// The effective policy reaches the consumers

test('loadEffectivePolicy layers the files over policy.json; an invalid file refuses', () => {
  const root = projectRepo({ quota: { reserve: 0.3 } });
  const { env } = home();
  plant(env, 'person', { schema_version: 1, quota: { reserve: 0.4 }, max_executors: 2 });
  plant(env, 'machine', { schema_version: 1, env: { port_range: { min: 6000, max: 6009 } } });
  const r = loadEffectivePolicy({ cwd: root, env });
  assert.deepEqual(r.errors, []);
  assert.equal(r.policy?.quota.reserve, 0.4);
  assert.deepEqual(r.policy?.env.port_range, { min: 6000, max: 6009 });
  assert.equal(r.settings?.cap, 2);
  // The project policy itself, and its hash, are unchanged.
  assert.equal(r.project?.quota.reserve, 0.3);
  plant(env, 'person', { schema_version: 1, on_change: 'x' });
  const bad = loadEffectivePolicy({ cwd: root, env });
  assert.equal(bad.policy, null);
  assert.match(bad.errors[0].message, /names code to run/);
});

test('hitld quota status uses the person reserve', async () => {
  const root = projectRepo();
  const { env } = home();
  plant(env, 'person', { schema_version: 1, quota: { reserve: 0.5 } });
  const { code, result } = await hitld(['quota', 'status'], root, env);
  assert.equal(code, 0, JSON.stringify(result));
  assert.ok(result.quotas.every((/** @type {any} */ q) => q.reserve_share === 0.5));
});

// config explain

test('hitld config explain --json: each value, its layer, and what it overrode', async () => {
  const root = projectRepo({ quota: { reserve: 0.1 } });
  const { env } = home();
  plant(env, 'person', { schema_version: 1, quota: { reserve: 0.25 }, max_executors: 2 });
  const { code, result } = await hitld(['config', 'explain', '--json'], root, env);
  assert.equal(code, 0, JSON.stringify(result));
  const reserve = result.values.find((/** @type {any} */ v) => v.key === 'quota.reserve');
  assert.deepEqual(
    { value: reserve.value, layer: reserve.layer, over: reserve.overridden[0].value },
    { value: 0.25, layer: 'person', over: 0.1 },
  );
  assert.equal(result.cap, 2);
  assert.equal(result.files.person.present, true);
  assert.equal(result.files.machine.present, false);
  const text = await hitld(['config', 'explain'], root, env);
  assert.match(
    text.result.text,
    /quota\.reserve\s+0\.25 {2}\[person\]\n\s+over project 0\.1: looser/,
  );
});

test('hitld config explain works outside a project, from the defaults', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hitld-settings-nowhere-'));
  const { env } = home();
  plant(env, 'machine', { schema_version: 1, max_executors: 1 });
  const { code, result } = await hitld(['config', 'explain', '--json'], cwd, env);
  assert.equal(code, 0, JSON.stringify(result));
  assert.equal(result.cap, 1);
  assert.equal(result.files.policy.present, false);
});

// config write

test('hitld config write refuses executors', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hitld-settings-cwd-'));
  const { env } = home();
  const data = JSON.stringify({ schema_version: 1, max_executors: 9 });
  for (const extra of [
    { HITLD_ROLE: 'executor' },
    { HITLD_DISPATCH: 'D-4' },
    { HITLD_DISPATCH: 'anything' },
  ]) {
    const { code, result } = await hitld(['config', 'write', 'person', '--data', data], cwd, {
      ...env,
      ...extra,
    });
    assert.equal(code, 1);
    assert.equal(result.error, 'not-permitted', JSON.stringify(extra));
  }
  assert.equal(existsSync(settingsLocation('person', { env }).path), false);
  assert.throws(
    () =>
      writeSettingsFile('person', JSON.parse(data), {
        env: { ...env, HITLD_ROLE: 'executor' },
        cwd,
      }),
    /executors never write settings/,
  );
});

test('hitld config write validates, then writes a private file', posixOnly, async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hitld-settings-cwd-'));
  const { env } = home();
  const bad = await hitld(
    ['config', 'write', 'machine', '--data', '{"schema_version":1,"gpu_count":4}'],
    cwd,
    env,
  );
  assert.equal(bad.code, 1);
  assert.match(bad.result.message, /gpu_count is not a known key/);
  const check = await hitld(
    ['config', 'write', 'machine', '--check', '--data', '{"schema_version":1}'],
    cwd,
    env,
  );
  assert.equal(check.result.ok, true);
  const loc = settingsLocation('machine', { env });
  assert.equal(existsSync(loc.path), false);
  const ok = await hitld(
    [
      'config',
      'write',
      'machine',
      '--data',
      '{"schema_version":1,"kind":"workstation","max_executors":2}',
    ],
    cwd,
    env,
  );
  assert.equal(ok.code, 0, JSON.stringify(ok.result));
  assert.equal(statSync(loc.path).mode & 0o777, 0o600);
  assert.equal(statSync(loc.dir).mode & 0o777, 0o700);
  const merged = await hitld(
    [
      'config',
      'write',
      'machine',
      '--merge',
      '--data',
      '{"schema_version":1,"env":{"secret_provider":"keychain"}}',
    ],
    cwd,
    env,
  );
  assert.equal(merged.code, 0, JSON.stringify(merged.result));
  assert.deepEqual(JSON.parse(readFileSync(loc.path, 'utf8')), {
    schema_version: 1,
    kind: 'workstation',
    max_executors: 2,
    env: { secret_provider: 'keychain' },
  });
});

test('config write refuses a location inside a managed project, and keeps a symlink', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hitld-settings-cwd-'));
  const inTree = home();
  mkdirSync(join(inTree.base, '.human-in-the-lead'));
  assert.throws(
    () => writeSettingsFile('person', { schema_version: 1 }, { env: inTree.env, cwd }),
    /a project HITLd manages/,
  );
  const linked = home();
  const loc = settingsLocation('person', { env: linked.env });
  mkdirSync(loc.dir, { recursive: true });
  symlinkSync(join(linked.base, 'target.json'), loc.path);
  assert.throws(
    () => writeSettingsFile('person', { schema_version: 1 }, { env: linked.env, cwd }),
    /symbolic link/,
  );
});

// config migrate

test('config migrate proposes the files, and with --yes moves the keys without loosening', async () => {
  const run = {
    id: 'run-tokens',
    unit: 'tokens',
    window: 'run',
    limit: 1000,
    source: 'estimated',
    hard: false,
  };
  const api = {
    id: 'api',
    unit: 'usd',
    window: 'monthly_utc',
    limit: 20,
    source: 'declared',
    hard: true,
  };
  const root = projectRepo({
    quota: { reserve: 0.3, limits: [api, run] },
    env: { port_range: { min: 5000, max: 5010 }, secret_provider: 'keychain', branch_prefix: 'w' },
  });
  const { env } = home();
  const before = loadEffectivePolicy({ cwd: root, env });
  const proposal = await hitld(['config', 'migrate'], root, env);
  assert.equal(proposal.code, 0, JSON.stringify(proposal.result));
  assert.equal(proposal.result.written, false);
  assert.deepEqual(proposal.result.person.data.quota, { reserve: 0.3, limits: [api] });
  assert.deepEqual(proposal.result.machine.data.env, {
    port_range: { min: 5000, max: 5010 },
    secret_provider: 'keychain',
  });
  assert.equal(existsSync(settingsLocation('person', { env }).path), false);

  const cwdEnv = { ...env, HITLD_ROLE: 'executor' };
  assert.equal(
    (await hitld(['config', 'migrate', '--yes'], root, cwdEnv)).result.error,
    'not-permitted',
  );

  const done = await hitld(['config', 'migrate', '--yes'], root, env);
  assert.equal(done.code, 0, JSON.stringify(done.result));
  const policy = JSON.parse(readFileSync(join(root, '.human-in-the-lead', 'policy.json'), 'utf8'));
  assert.deepEqual(policy.quota, { limits: [run] });
  assert.deepEqual(policy.env, { branch_prefix: 'w' });
  const after = loadEffectivePolicy({ cwd: root, env });
  assert.deepEqual(after.errors, []);
  assert.deepEqual(after.warnings, []);
  assert.deepEqual(after.policy, before.policy);
  const again = await hitld(['config', 'migrate'], root, env);
  assert.match(again.result.message, /nothing to move/);
});

test('settings under their names before HITLD-82 load with a warning, and config migrate renames them', async () => {
  const root = projectRepo({
    dispatch: { report_at: 2 },
    tiers: { 1: { executor: 'background', model: 'small', effort: 'low' } },
  });
  const { env } = home();
  plant(env, 'person', { schema_version: 1, executors_max: 2, quota: { economize_at: 0.4 } });
  plant(env, 'machine', { schema_version: 1, role: 'cloud_vm', executors_max: 3 });
  const before = loadEffectivePolicy({ cwd: root, env });
  assert.deepEqual(before.errors, []);
  assert.equal(before.policy?.dispatch.report_at_budget_multiple, 2);
  assert.equal(before.policy?.tiers['1'].runs_as, 'background');
  assert.equal(before.settings?.cap, 2);
  assert.deepEqual(
    before.warnings.map((w) => [w.home, w.path]),
    [
      ['project', 'dispatch.report_at'],
      ['project', 'tiers.1.executor'],
      ['person', 'executors_max'],
      ['person', 'quota.economize_at'],
      ['machine', 'executors_max'],
      ['machine', 'role'],
      ['machine', 'kind=cloud_vm'],
    ],
  );
  const done = await hitld(['config', 'migrate', '--yes'], root, env);
  assert.equal(done.code, 0, JSON.stringify(done.result));
  assert.deepEqual(loadSettingsFile('person', { env }).data, {
    schema_version: 1,
    max_executors: 2,
    quota: { economize_below: 0.4 },
  });
  assert.deepEqual(loadSettingsFile('machine', { env }).data, {
    schema_version: 1,
    kind: 'cloud-vm',
    max_executors: 3,
  });
  const policy = JSON.parse(readFileSync(join(root, '.human-in-the-lead', 'policy.json'), 'utf8'));
  assert.deepEqual(policy.dispatch, { report_at_budget_multiple: 2 });
  assert.deepEqual(loadEffectivePolicy({ cwd: root, env }).warnings, []);
});

test('migration keeps the stricter value when the person file already sets one', () => {
  const plan = proposeMigration({
    raw: {
      schema_version: 1,
      project: { id: 'p', key: 'W' },
      quota: {
        limits: [
          {
            id: 'api',
            unit: 'usd',
            window: 'monthly_utc',
            limit: 5,
            source: 'declared',
            hard: false,
          },
        ],
      },
    },
    person: {
      schema_version: 1,
      quota: {
        limits: [
          {
            id: 'api',
            unit: 'usd',
            window: 'monthly_utc',
            limit: 50,
            source: 'declared',
            hard: true,
          },
        ],
      },
    },
    machine: null,
  });
  assert.deepEqual(plan.person?.quota.limits, [
    { id: 'api', unit: 'usd', window: 'monthly_utc', limit: 5, source: 'declared', hard: true },
  ]);
  assert.equal(plan.machine, null);
});

test('the defaults are unchanged when no settings file exists', () => {
  const eff = layers({});
  const d = policyDefaults();
  assert.equal(eff.policy.quota.reserve, d.quota.reserve);
  assert.deepEqual(eff.policy.quota.limits, d.quota.limits);
  assert.deepEqual(eff.policy.env.port_range, d.env.port_range);
  assert.equal(eff.policy.env.worktree_root, undefined);
  assert.equal(eff.cap, d.execution.max_executors.value);
  assert.deepEqual(eff.warnings, []);
});

test('fillWildcards replaces every wildcard in a renamed path, in order', async () => {
  const { fillWildcards } = await import('../lib/settings/renamed.mjs');
  assert.equal(
    fillWildcards('tiers.*.executor', 'tiers.*.runs_as', ['tiers', '2', 'executor']),
    'tiers.2.runs_as',
  );
  assert.equal(
    fillWildcards('a.*.b.*.c', 'a.*.x.*.y', ['a', 'k1', 'b', 'k2', 'c']),
    'a.k1.x.k2.y',
    'both wildcards take their own key',
  );
  assert.equal(fillWildcards('plain.key', 'plain.new_key', ['plain', 'key']), 'plain.new_key');
});
