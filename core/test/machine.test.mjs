import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../lib/cli/main.mjs';
import {
  detectRole,
  machineResources,
  probeMachine,
  proposeProfile,
  reconcile,
  roleDefaults,
} from '../lib/machine/detect.mjs';
import { planDispatch } from '../lib/dispatch/plan.mjs';
import { settingsLocation, loadSettingsFile } from '../lib/settings/files.mjs';
import { validateSettings } from '../lib/settings/files.mjs';
import { FAKE_PROFILES } from '../harness/fake/fake.mjs';
import { tempDir } from './helpers/tmp.mjs';

/**
 * Fake probe sources. `files` maps a path to its text; `programs` maps "file arg arg" to output.
 * @param {Partial<import('../lib/machine/detect.mjs').Sources> & { files?: Record<string, string>, programs?: Record<string, string> }} o
 * @returns {import('../lib/machine/detect.mjs').Sources}
 */
function fake(o = {}) {
  const files = o.files ?? {};
  const programs = o.programs ?? {};
  return {
    platform: 'linux',
    arch: 'x64',
    release: '6.1.0',
    cores: 8,
    memoryBytes: 16 * 1024 ** 3,
    env: {},
    readText: (p) => files[p] ?? null,
    exists: (p) => p in files,
    run: (f, a) => programs[[f, ...a].join(' ')] ?? null,
    ...o,
  };
}

const SMI = 'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits';

/** One fixture per role. */
const FIXTURES = {
  dedicated: () => fake({ env: { PATH: '/usr/bin' } }),
  workstation: () =>
    fake({
      env: { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11', PATH: '/usr/bin' },
      files: { '/usr/bin/firefox': '' },
    }),
  'cloud-vm': () =>
    fake({
      env: { PATH: '/usr/bin' },
      files: { '/sys/class/dmi/id/sys_vendor': 'Amazon EC2\n', '/var/lib/cloud/instance': '' },
    }),
  ci: () => fake({ env: { CI: 'true', GITHUB_ACTIONS: 'true' } }),
};

/** @param {string[]} argv @param {NodeJS.ProcessEnv} env @param {import('../lib/machine/detect.mjs').Sources} machine */
async function hitld(argv, env, machine) {
  let out = '';
  const code = await main(argv, {
    out: (t) => (out += t),
    err: () => {},
    cwd: tmpdir(),
    env,
    machine,
  });
  return { code, result: JSON.parse(out) };
}

function home() {
  const base = tempDir('hitld-machine-');
  return { XDG_CONFIG_HOME: join(base, 'config'), XDG_DATA_HOME: join(base, 'data') };
}

for (const role of /** @type {const} */ (['dedicated', 'workstation', 'cloud-vm', 'ci'])) {
  test(`fixture: a ${role} machine detects as ${role} and gets its defaults`, () => {
    const probe = probeMachine(FIXTURES[role]());
    assert.equal(probe.role, role);
    assert.ok(probe.role_hints.length > 0);
    const d = roleDefaults(role, probe);
    const expected = {
      dedicated: { cores: 7, memory: 14745, confirm: true },
      workstation: { cores: 4, memory: 8192, confirm: true },
      'cloud-vm': { cores: 8, memory: 14745, confirm: false },
      ci: { cores: 8, memory: 14745, confirm: false },
    }[role];
    assert.equal(d.cores, expected.cores);
    assert.equal(d.memory_ceiling_mb, expected.memory);
    assert.equal(d.confirm, expected.confirm);
    const { profile } = proposeProfile(probe);
    assert.deepEqual(validateSettings('machine', profile), []);
    assert.equal(profile.kind, role);
  });
}

test('role hints: CI beats cloud, cloud beats headless, a desktop is a workstation', () => {
  assert.equal(
    detectRole(fake({ env: { CI: '1' }, files: { '/var/lib/cloud/instance': '' } })).role,
    'ci',
  );
  assert.equal(detectRole(fake({ env: { CI: 'false' } })).role, 'dedicated');
  assert.equal(detectRole(fake({ platform: 'darwin' })).role, 'workstation');
  assert.equal(
    detectRole(fake({ platform: 'darwin', env: { SSH_CONNECTION: '1 2 3 4' } })).role,
    'dedicated',
  );
});

test('probes: cores, memory, cgroup limits, GPUs, browsers and the OS, locally', () => {
  const probe = probeMachine(
    fake({
      env: { PATH: '/usr/bin:/opt/bin:relative' },
      files: {
        '/sys/fs/cgroup/cpu.max': '200000 100000\n',
        '/sys/fs/cgroup/memory.max': String(4 * 1024 ** 3),
        '/usr/bin/firefox': '',
        '/opt/bin/chromium': '',
      },
      programs: { [SMI]: 'Example GPU 1, 8192\nExample GPU 2, 8192\n' },
    }),
    new Date('2026-11-14T09:00:00Z'),
  );
  assert.equal(probe.at, '2026-11-14T09:00:00.000Z');
  assert.equal(probe.cores, 2);
  assert.equal(probe.memory_mb, 4096);
  assert.deepEqual(probe.gpus, [
    { name: 'Example GPU 1', memory_mb: 8192 },
    { name: 'Example GPU 2', memory_mb: 8192 },
  ]);
  assert.deepEqual(probe.browsers, ['chromium', 'firefox']);
  assert.deepEqual(probe.os, { platform: 'linux', release: '6.1.0', arch: 'x64' });
});

test('probes on macOS: system_profiler and app bundles; a missing tool is a note, not a failure', () => {
  const mac = fake({
    platform: 'darwin',
    env: { HOME: '/Users/example' },
    files: { '/Applications/Firefox.app': '', '/System/Applications/Safari.app': '' },
    programs: {
      'system_profiler -json SPDisplaysDataType': JSON.stringify({
        SPDisplaysDataType: [{ sppci_model: 'Example Graphics' }],
      }),
    },
  });
  const p = probeMachine(mac);
  assert.deepEqual(p.gpus, [{ name: 'Example Graphics' }]);
  assert.deepEqual(p.browsers, ['firefox', 'safari']);
  const none = probeMachine(fake({ platform: 'darwin' }));
  assert.deepEqual(none.gpus, []);
  assert.match(none.notes.join(' '), /system_profiler/);
});

test('Windows: a desktop is a workstation, an SSH session is dedicated, browsers from Program Files', () => {
  const win = fake({
    platform: 'win32',
    env: { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\example\\AppData\\Local' },
    files: {
      'C:\\Program Files\\Mozilla Firefox\\firefox.exe': '',
      'C:\\Users\\example\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe': '',
    },
  });
  const p = probeMachine(win);
  assert.equal(p.role, 'workstation');
  assert.deepEqual(p.role_hints, ['a Windows desktop', 'a logged-in session']);
  assert.deepEqual(p.browsers, ['chrome', 'firefox']);
  assert.match(p.notes.join(' '), /Windows: cores and memory from the os module/);
  assert.equal(
    detectRole(fake({ platform: 'win32', env: { SSH_CONNECTION: '1 2 3 4' } })).role,
    'dedicated',
  );
});

test('a later probe that finds less warns and uses the smaller value', () => {
  const first = proposeProfile(probeMachine(fake({ programs: { [SMI]: 'Example GPU, 8192' } })));
  /** @type {Record<string, any>} */
  const profile = { ...first.profile, cores: 6 };
  const later = probeMachine(fake({ cores: 4, memoryBytes: 8 * 1024 ** 3 }));
  const r = reconcile(profile, later);
  assert.equal(r.cores, 4);
  assert.equal(
    r.memory_ceiling_mb,
    8192 < profile.memory_ceiling_mb ? 8192 : profile.memory_ceiling_mb,
  );
  assert.ok(r.warnings.some((w) => /4 cores, the profile says 6/.test(w)));
  assert.ok(r.warnings.some((w) => /no GPU found now/.test(w)));
  const again = proposeProfile(later, profile);
  assert.equal(again.profile.cores, 4);
  assert.ok(again.warnings.length >= 2);
  assert.equal(again.profile.detected.cores, 4);
});

test('the kind the person set wins over the detected one', () => {
  const p = proposeProfile(probeMachine(FIXTURES.workstation()), {
    schema_version: 1,
    kind: 'dedicated',
    cores: 3,
  });
  assert.equal(p.role, 'dedicated');
  assert.equal(p.role_source, 'machine file');
  assert.equal(p.profile.cores, 3);
  assert.equal(p.profile.detected.kind, 'workstation');
});

test('hitld machine detect prints a proposal and writes nothing until --write', async () => {
  const env = home();
  const r = await hitld(['machine', 'detect'], env, FIXTURES.workstation());
  assert.equal(r.code, 0);
  assert.equal(r.result.written, false);
  assert.equal(r.result.kind, 'workstation');
  assert.equal(r.result.proposed.cores, 4);
  assert.equal(existsSync(settingsLocation('machine', { env }).path), false);

  const w = await hitld(['machine', 'detect', '--write'], env, FIXTURES.workstation());
  assert.equal(w.result.written, true);
  const file = loadSettingsFile('machine', { env });
  assert.deepEqual(file.errors, []);
  assert.equal(file.data?.kind, 'workstation');
  assert.ok(file.data?.detected.at);

  // A second detect starts from the file: the person's edits stay, the record refreshes.
  const again = await hitld(['machine', 'detect'], env, FIXTURES.workstation());
  assert.equal(again.result.kind_source, 'machine file');
});

test('a cloud VM or CI session gets its own profile at start, without asking', async () => {
  for (const role of /** @type {const} */ (['cloud-vm', 'ci'])) {
    const env = home();
    const r = await hitld(['machine', 'detect', '--write'], env, FIXTURES[role]());
    assert.equal(r.result.written, true);
    assert.match(r.result.confirmation, /without asking/);
    assert.equal(loadSettingsFile('machine', { env }).data?.kind, role);
  }
});

test('executors never write the profile, but may look at the proposal', async () => {
  const env = { ...home(), HITLD_ROLE: 'executor' };
  const look = await hitld(['machine', 'detect'], env, FIXTURES.ci());
  assert.equal(look.result.ok, true);
  const write = await hitld(['machine', 'detect', '--write'], env, FIXTURES.ci());
  assert.equal(write.code, 1);
  assert.equal(write.result.error, 'not-permitted');
  assert.equal(existsSync(settingsLocation('machine', { env }).path), false);
});

test('an item needing a resource this machine lacks is not dispatched, and the plan says why', () => {
  const items = [
    {
      id: 'W-1',
      kind: 'work',
      state: 'planned',
      classification: 'public',
      touches: ['a/**'],
      resources: ['gpu'],
    },
    {
      id: 'W-2',
      kind: 'work',
      state: 'planned',
      classification: 'public',
      touches: ['b/**'],
      resources: ['browser'],
    },
    { id: 'W-3', kind: 'work', state: 'planned', classification: 'public', touches: ['c/**'] },
  ];
  const sizing = { tier: 2, model: 'sonnet', effort: 'medium', estimate_tokens: 1000 };
  const sizes = new Map(items.map((i) => [i.id, /** @type {any} */ (sizing)]));
  const run = (/** @type {ReturnType<typeof machineResources>} */ machine) =>
    planDispatch({
      queue: items,
      sizes,
      running: [],
      cap: 3,
      capabilities: FAKE_PROFILES.full,
      gate: () => ({ mode: 'normal', allow: true, reason: 'ok' }),
      machine,
    });
  const bare = run(machineResources(null, probeMachine(FIXTURES.dedicated())));
  assert.deepEqual(
    bare.start.map((s) => s.item),
    ['W-3'],
  );
  assert.deepEqual(
    bare.held.map((h) => [h.item, h.reason, h.why]),
    [
      ['W-1', 'resource', 'waits: needs gpu; this machine has none'],
      ['W-2', 'resource', 'waits: needs browser; this machine has none'],
    ],
  );
  const rich = run(
    machineResources(
      null,
      probeMachine(
        fake({
          files: { '/usr/bin/firefox': '' },
          env: { PATH: '/usr/bin' },
          programs: { [SMI]: 'Example GPU, 1024' },
        }),
      ),
    ),
  );
  assert.equal(rich.start.length, 3);
});

test('a stored profile that recorded a GPU does not make one appear that a probe cannot find', () => {
  const stored = proposeProfile(
    probeMachine(fake({ programs: { [SMI]: 'Example GPU, 1024' } })),
  ).profile;
  const has = machineResources(stored, probeMachine(fake()));
  assert.equal(has.has('gpu'), false);
  assert.equal(has.has('quiet'), true);
});
