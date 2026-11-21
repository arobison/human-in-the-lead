import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import {
  chmodSync,
  rmSync,
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  findPolicyFile,
  findRepoRoot,
  loadPolicy,
  ownershipProblem,
  policyDefaults,
  policyHash,
  resolvePolicy,
  POLICY_PATH,
} from '../lib/policy/policy.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { removeTempDir, tempDir } from './helpers/tmp.mjs';

/** Whether this machine lets the tests create symbolic links (Windows needs Developer Mode or admin). */
const canSymlink = (() => {
  const dir = tempDir('hitld-link-probe-');
  try {
    symlinkSync(join(dir, 'target'), join(dir, 'link'));
    return true;
  } catch {
    return false;
  } finally {
    removeTempDir(dir);
  }
})();
const needsSymlink = {
  skip: !canSymlink && 'Windows: creating symbolic links needs Developer Mode or admin',
};
// Expected on Windows only (core/test/expected-skips.json).
const posixOnly = {
  skip: process.platform === 'win32' && 'Windows: no POSIX file modes or owners to refuse by',
};

const minimal = { schema_version: 1, project: { id: 'fixture', key: 'W' } };

test('defaults: tiers 0 to 3', () => {
  const { tiers } = policyDefaults();
  assert.deepEqual(tiers['0'], { runs_as: 'orchestrator', model: 'own', effort: 'own' });
  assert.deepEqual(tiers['1'], { runs_as: 'background', model: 'small', effort: 'medium' });
  assert.deepEqual(tiers['2'], { runs_as: 'background', model: 'small', effort: 'high' });
  assert.deepEqual(tiers['3'], { runs_as: 'session', model: 'large', effort: 'high' });
});

test('defaults: the concurrency cap with its bounds', () => {
  assert.deepEqual(policyDefaults().execution.max_executors, { value: 3, min: 1, max: 6 });
});

test("defaults: quotas keep the owner's reserve; plan windows are soft", () => {
  const { quota } = policyDefaults();
  assert.equal(quota.reserve, 0.25);
  assert.ok(quota.critical_below < quota.economize_below);
  assert.deepEqual(
    quota.limits.map((/** @type {any} */ l) => [l.id, l.window, l.hard]),
    [['claude-weekly', 'weekly', false]],
  );
});

test('defaults: rights rules route to the owner unless an area owner is allowed', () => {
  const { rights } = policyDefaults();
  for (const basis of [
    'one-way-door',
    'public-commitment',
    'relationship',
    'budget',
    'security',
    'rule-change',
  ]) {
    assert.deepEqual(rights.rules[basis], { decider: 'owner' }, basis);
  }
  assert.deepEqual(rights.rules['blast-radius'], {
    decider: 'area-owner',
    owner_when: ['cross-area'],
  });
  assert.deepEqual(rights.areas, []);
  assert.equal(rights.agent_spend_max_tokens, 100000);
});

test("defaults: the owner's gut checks start high", () => {
  const { weights } = policyDefaults().judgment;
  assert.equal(weights.owner['gut-check'], 0.8);
  assert.ok(weights.owner['gut-check'] > weights.default['gut-check']);
});

test('defaults: the project has no default ID or key', () => {
  assert.deepEqual(policyDefaults().project, {
    classification_ceiling: 'public',
    private_paths: [],
  });
});

test('every default is documented beside it', () => {
  const registry = schemas();
  /** @param {any} s @param {any} root @param {string} path */
  const visit = (s, root, path) => {
    if (s.default !== undefined) {
      assert.ok(s.description, `${path} has a default but no description`);
      return;
    }
    if (s.$ref) {
      const t = registry.resolve(s.$ref, root);
      return visit(t.schema, t.root, path);
    }
    for (const [k, sub] of Object.entries(s.properties ?? {})) visit(sub, root, `${path}.${k}`);
  };
  const root = registry.get('policy');
  visit(root, root, 'policy');
});

test('the defaults with a project ID and key form a valid policy', () => {
  const { policy, errors } = resolvePolicy(minimal);
  assert.deepEqual(errors, []);
  assert.equal(policy?.execution.max_executors.value, 3);
});

test('templates/policy.json is valid', () => {
  const template = JSON.parse(
    readFileSync(new URL('../../templates/policy.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(resolvePolicy(template).errors, []);
});

test('objects merge with the defaults; arrays replace them', () => {
  const { policy } = resolvePolicy({
    ...minimal,
    execution: { concurrency: { value: 5 } },
    judgment: { weights: { 'C-3': { 'gut-check': 0.5, considered: 0.7 } } },
    quota: { limits: [] },
  });
  assert.deepEqual(policy?.execution.max_executors, { value: 5, min: 1, max: 6 });
  assert.equal(policy?.judgment.weights.owner['gut-check'], 0.8);
  assert.equal(policy?.judgment.weights['C-3'].considered, 0.7);
  assert.deepEqual(policy?.quota.limits, []);
});

test('a policy section under its name before HITLD-121 is read under the new one, with a warning', () => {
  const old = { weights: { 'C-3': { 'gut-check': 0.5, considered: 0.7 } }, lift: 0.25 };
  const { policy, errors, renamed } = resolvePolicy({ ...minimal, judgement: old }); // spelling-ok
  assert.deepEqual(errors, []);
  assert.equal(policy?.judgment.weights['C-3'].considered, 0.7);
  assert.equal(policy?.judgment.lift, 0.25);
  assert.equal(policy?.judgment.weights.owner['gut-check'], 0.8, 'the rest is the default');
  assert.deepEqual(
    renamed.map((r) => [r.from, r.to]),
    [['judgement', 'judgment']], // spelling-ok
  );
  assert.match(renamed[0].message, /judgement is now judgment/); // spelling-ok
  // Both names: the new one wins, and the old one is not read.
  const both = resolvePolicy({ ...minimal, judgement: old, judgment: { lift: 0.75 } }); // spelling-ok
  assert.equal(both.policy?.judgment.lift, 0.75);
  assert.equal(both.policy?.judgment.weights['C-3'], undefined);
});

test('a value outside its bounds is refused', () => {
  const { errors } = resolvePolicy({ ...minimal, execution: { concurrency: { value: 9 } } });
  assert.deepEqual(errors, [
    { path: 'execution.max_executors', message: 'value 9 is above its bound max 6' },
  ]);
});

test('unknown keys are refused, with a suggestion', () => {
  const { errors } = resolvePolicy({ ...minimal, execution: { max_executor: { value: 2 } } });
  assert.equal(errors[0].path, 'execution.max_executor');
  assert.match(errors[0].message, /did you mean "max_executors"/);
});

test('code-running keys are refused in policy too', () => {
  const { errors } = resolvePolicy({ ...minimal, project: { ...minimal.project, on_load: 'x' } });
  assert.match(errors[0].message, /names code to run/);
});

test('__proto__ in policy.json is refused and pollutes nothing', () => {
  const raw = JSON.parse(
    '{"schema_version":1,"project":{"id":"fixture","key":"W"},"execution":{"__proto__":{"polluted":true}}}',
  );
  const { errors } = resolvePolicy(raw);
  assert.equal(errors[0].path, 'execution.__proto__');
  assert.equal(/** @type {any} */ ({}).polluted, undefined);
});

test('the project ID and key are required, and reserved keys are refused', () => {
  const missing = resolvePolicy({ schema_version: 1 }).errors.map((e) => e.path);
  assert.deepEqual(missing, ['project.id', 'project.key']);
  const reserved = resolvePolicy({ schema_version: 1, project: { id: 'x', key: 'SIG' } });
  assert.equal(reserved.errors[0].path, 'project.key');
  const unsafe = resolvePolicy({ schema_version: 1, project: { id: '../up', key: 'W' } });
  assert.equal(unsafe.errors[0].path, 'project.id');
});

test('schema_version must come from the file, and a newer one is refused', () => {
  assert.deepEqual(resolvePolicy({ project: minimal.project }).errors, [
    { path: 'schema_version', message: 'is required' },
  ]);
  assert.match(
    resolvePolicy({ ...minimal, schema_version: 2 }).errors[0].message,
    /newer than this release knows/,
  );
});

test('an area may delegate rule bases to its owners', () => {
  const area = {
    name: 'cache',
    paths: ['src/cache/**'],
    owners: ['C-3'],
    may_decide: ['novelty'],
  };
  assert.deepEqual(resolvePolicy({ ...minimal, rights: { areas: [area] } }).errors, []);
  const bad = resolvePolicy({ ...minimal, rights: { areas: [{ ...area, may_decide: ['all'] }] } });
  assert.equal(bad.errors[0].path, 'rights.areas[0].may_decide[0]');
});

/** Write a policy.json under dir, mode 644. @param {string} dir @param {unknown} [policy] */
function plant(dir, policy = minimal) {
  mkdirSync(join(dir, '.human-in-the-lead'), { recursive: true });
  const path = join(dir, POLICY_PATH);
  writeFileSync(path, JSON.stringify(policy));
  chmodSync(path, 0o644);
  return path;
}

test('loadPolicy finds policy.json in a parent directory within the repository', () => {
  const root = tempDir('hitld-policy-');
  mkdirSync(join(root, '.git'));
  const path = plant(root);
  mkdirSync(join(root, 'src', 'deep'), { recursive: true });
  const result = loadPolicy({ cwd: join(root, 'src', 'deep') });
  assert.deepEqual(result.errors, []);
  assert.equal(result.path, path);
  assert.match(result.hash ?? '', /^[0-9a-f]{64}$/);
});

test('a policy.json planted above the repository root is ignored', () => {
  const outer = tempDir('hitld-policy-');
  plant(outer);
  const repo = join(outer, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'src'));
  assert.equal(findPolicyFile(join(repo, 'src')), null);
  assert.match(loadPolicy({ cwd: join(repo, 'src') }).errors[0].message, /was not found/);
});

test('outside a repository only the given directory is searched', () => {
  const outer = tempDir('hitld-policy-');
  plant(outer);
  mkdirSync(join(outer, 'sub'));
  assert.equal(findPolicyFile(join(outer, 'sub')), null);
  assert.equal(findPolicyFile(outer), join(outer, POLICY_PATH));
});

test("a worktree's .git file counts as the repository root", () => {
  const outer = tempDir('hitld-policy-');
  plant(outer);
  const wt = join(outer, 'wt');
  mkdirSync(join(wt, 'src'), { recursive: true });
  writeFileSync(join(wt, '.git'), 'gitdir: /elsewhere/.git/worktrees/wt\n');
  assert.equal(findPolicyFile(join(wt, 'src')), null);
  const path = plant(wt);
  assert.equal(findPolicyFile(join(wt, 'src')), path);
});

test('a group- or world-writable policy file is refused', posixOnly, () => {
  const root = tempDir('hitld-policy-');
  const path = plant(root);
  chmodSync(path, 0o666);
  const result = loadPolicy({ cwd: root });
  assert.equal(result.policy, null);
  assert.match(result.errors[0].message, /writable by group or others \(mode 666\)/);
  chmodSync(path, 0o664);
  assert.match(loadPolicy({ cwd: root }).errors[0].message, /mode 664/);
  chmodSync(path, 0o644);
  assert.deepEqual(loadPolicy({ cwd: root }).errors, []);
});

/** A fresh repository with a valid policy.json. */
function repo() {
  const root = tempDir('hitld-policy-');
  mkdirSync(join(root, '.git'));
  return { root, path: plant(root) };
}

test('a symlinked policy file is refused', needsSymlink, () => {
  const { root, path } = repo();
  renameSync(path, join(root, 'real-policy.json'));
  symlinkSync(join(root, 'real-policy.json'), path);
  const result = loadPolicy({ cwd: root });
  assert.equal(result.policy, null);
  assert.match(result.errors[0].message, /is a symbolic link/);
});

test('a FIFO planted as the policy file is refused without blocking', posixOnly, () => {
  const { path } = repo();
  const root = path.slice(0, path.indexOf('/.human-in-the-lead'));
  rmSync(path);
  execFileSync('mkfifo', [path]);
  const result = loadPolicy({ cwd: root });
  assert.equal(result.policy, null);
  assert.match(result.errors[0].message, /not a regular file/);
});

test('a policy file that resolves outside the repository root is refused', needsSymlink, () => {
  const { root } = repo();
  const elsewhere = tempDir('hitld-elsewhere-');
  plant(elsewhere);
  const hitldDir = join(root, '.human-in-the-lead');
  renameSync(hitldDir, join(root, 'moved'));
  symlinkSync(join(elsewhere, '.human-in-the-lead'), hitldDir);
  assert.match(loadPolicy({ cwd: root }).errors[0].message, /outside the repository root/);
  const explicit = loadPolicy({ cwd: root, path: join(elsewhere, POLICY_PATH) });
  assert.match(explicit.errors[0].message, /outside the repository root/);
});

test('a group-writable directory between the file and the root is refused', posixOnly, () => {
  const { root } = repo();
  const hitldDir = join(root, '.human-in-the-lead');
  chmodSync(hitldDir, 0o775);
  assert.match(
    loadPolicy({ cwd: root }).errors[0].message,
    /is in .*\.human-in-the-lead, which is writable by group or others \(mode 775\)/,
  );
  chmodSync(hitldDir, 0o755);
  chmodSync(root, 0o777);
  assert.match(
    loadPolicy({ cwd: root }).errors[0].message,
    /writable by group or others \(mode 777\)/,
  );
  chmodSync(root, 0o700);
  assert.deepEqual(loadPolicy({ cwd: root }).errors, []);
});

test('a .git marker owned by another user does not make a repository', posixOnly, () => {
  const { root } = repo();
  const uid = /** @type {() => number} */ (process.getuid)();
  assert.equal(findRepoRoot(join(root, '.human-in-the-lead'), { uid }), root);
  assert.equal(findRepoRoot(join(root, '.human-in-the-lead'), { uid: uid + 1 }), null);
});

test('ownershipProblem: another owner, root, and group or world write', () => {
  assert.equal(ownershipProblem({ uid: 501, mode: 0o100644 }, 501), null);
  assert.equal(
    ownershipProblem({ uid: 502, mode: 0o100644 }, 501),
    'owned by another user (uid 502)',
  );
  assert.equal(ownershipProblem({ uid: 0, mode: 0o40755 }, 501, { allowRoot: true }), null);
  assert.match(ownershipProblem({ uid: 0, mode: 0o40755 }, 501) ?? '', /another user \(uid 0\)/);
  assert.match(ownershipProblem({ uid: 501, mode: 0o40775 }, 501) ?? '', /mode 775/);
  assert.match(ownershipProblem({ uid: 501, mode: 0o100646 }, 501) ?? '', /mode 646/);
});

test('loadPolicy reports a missing or unreadable file plainly', () => {
  const root = tempDir('hitld-policy-');
  assert.match(loadPolicy({ cwd: root }).errors[0].message, /was not found/);
  writeFileSync(join(root, 'broken.json'), '{ "schema_version": 1,');
  chmodSync(join(root, 'broken.json'), 0o644);
  assert.match(loadPolicy({ cwd: root, path: 'broken.json' }).errors[0].message, /cannot be read/);
});

test('the policy hash does not depend on key order', () => {
  const a = resolvePolicy(minimal).policy;
  const b = resolvePolicy({ project: { key: 'W', id: 'fixture' }, schema_version: 1 }).policy;
  assert.ok(a && b);
  assert.equal(policyHash(a), policyHash(b));
});
