// The plugin's hooks know an executor by its checkout as well as by its subagent type and
// HITLD_DISPATCH (HITLD-781): a session whose HEAD holds a dispatch's claim commit that no main
// branch holds yet gets the executor guard, so a session started without the variable, such as
// one started in the cloud, is guarded too.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/tmp.mjs';

const HOOKS = fileURLToPath(new URL('../harness/claude-code/hooks/', import.meta.url));
const OUTSIDE = realpathSync(tempDir('hitld-781-outside-'));

/** @param {string} cwd @param {...string} args */
const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();

/**
 * A repository on `main` with one commit, and a branch `hitld/W-1-fix` whose first commit is the
 * claim, in the form `hitld work claim` writes.
 * @param {{ claimBody?: string, main?: string }} [options]
 */
function repo({ claimBody = 'Work-Item: W-1\nDispatch: D-01KAH2Q7RS4XV9TB', main = 'main' } = {}) {
  const root = realpathSync(tempDir('hitld-781-'));
  git(root, 'init', '-q', '-b', main);
  mkdirSync(join(root, 'work/items'), { recursive: true });
  writeFileSync(join(root, 'work/items/W-1.md'), '---\nid: W-1\nstate: planned\n---\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'start');
  git(root, 'switch', '-q', '-c', 'hitld/W-1-fix');
  writeFileSync(join(root, 'work/items/W-1.md'), '---\nid: W-1\nstate: in-progress\n---\n');
  git(root, 'commit', '-q', '-am', 'claim: W-1', '-m', claimBody);
  return root;
}

/**
 * Run a hook as Claude Code would: the hook input on stdin, from a directory outside any checkout
 * unless the input or CLAUDE_PROJECT_DIR names one.
 * @param {string} script @param {Record<string, any>} input @param {Record<string, string>} [env]
 */
const hook = (script, input, env = {}) =>
  spawnSync(process.execPath, [join(HOOKS, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    cwd: OUTSIDE,
    env: { PATH: process.env.PATH ?? '', ...env },
  });

/**
 * The guard's decision on a Bash command: 'deny', or '' when it lets the command through.
 * @param {string} command @param {Record<string, any>} where hook input fields (cwd, agent_type)
 * @param {Record<string, string>} [env]
 */
const decide = (command, where, env) => {
  const out = hook('guard.mjs', { tool_name: 'Bash', tool_input: { command }, ...where }, env);
  return out.stdout ? JSON.parse(out.stdout).hookSpecificOutput.permissionDecision : '';
};

test('a session on a claim branch gets the executor guard without HITLD_DISPATCH; one on main or another branch does not', () => {
  const root = repo();
  for (const refused of ['git push origin HEAD', 'hitld merge', 'hitld rights answer --answer A']) {
    assert.equal(decide(refused, { cwd: root }), 'deny', refused);
  }
  assert.equal(decide('hitld work close W-1', { cwd: root }), '');
  assert.equal(decide('npm test', { cwd: root }), '');
  // The report check holds the same session to the fixed report shape.
  const stop = hook('report-check.mjs', { cwd: root, last_assistant_message: 'All done!' });
  assert.equal(JSON.parse(stop.stdout).decision, 'block');

  // The owner or orchestrator, in the same repository on main, or on a branch with no claim
  // (a branch named like an executor's, such as a tracker publish branch, included).
  git(root, 'switch', '-q', 'main');
  assert.equal(decide('git push origin main', { cwd: root }), '');
  assert.equal(decide('hitld merge', { cwd: root }), '');
  assert.equal(hook('report-check.mjs', { cwd: root, last_assistant_message: 'hi' }).stdout, '');
  for (const branch of ['feature', 'hitld/tracker-W-1-abcdef12']) {
    git(root, 'switch', '-q', '-c', branch, 'main');
    assert.equal(decide('git push origin HEAD', { cwd: root }), '', branch);
  }
  // Outside any repository: nobody's checkout, so nobody's claim.
  assert.equal(decide('git push', { cwd: OUTSIDE }), '');
});

test('the checkout guard holds when the executor renames its branch, detaches HEAD, changes directory or uses a subagent', () => {
  const root = repo();
  git(root, 'branch', '-m', 'innocent');
  assert.equal(decide('git push origin HEAD', { cwd: root }), 'deny', 'renamed branch');
  git(root, 'switch', '-q', '--detach');
  assert.equal(decide('git push origin HEAD', { cwd: root }), 'deny', 'detached HEAD');
  // A cd out of the checkout moves the session's cwd, not its project directory.
  assert.equal(
    decide('git -C .. push', { cwd: OUTSIDE }, { CLAUDE_PROJECT_DIR: root }),
    'deny',
    'changed directory',
  );
  // A subagent of another type, working in the executor's checkout.
  for (const agent_type of ['general-purpose', 'Explore']) {
    assert.equal(decide('git push', { cwd: root, agent_type }), 'deny', agent_type);
  }
  // The same subagent types in the owner's checkout are not executors.
  const owner = repo();
  git(owner, 'switch', '-q', 'main');
  assert.equal(decide('git push', { cwd: owner, agent_type: 'general-purpose' }), '');
});

test('a merged claim, or a claim by a person rather than a dispatch, does not make an executor', () => {
  const root = repo();
  git(root, 'switch', '-q', 'main');
  git(root, 'merge', '-q', '--ff-only', 'hitld/W-1-fix');
  assert.equal(decide('git push origin main', { cwd: root }), '', 'on main after the merge');
  git(root, 'switch', '-q', '-c', 'next', 'main');
  assert.equal(decide('git push', { cwd: root }), '', 'a branch from main after the merge');
  // Merged on the remote only: origin/main holds the claim, the local main does not.
  const clone = realpathSync(tempDir('hitld-781-clone-'));
  git(dirname(clone), 'clone', '-q', root, clone);
  assert.equal(decide('git push', { cwd: clone }), '', 'a fresh clone of the merged main');

  const handle = repo({ claimBody: 'Work-Item: W-1' });
  assert.equal(decide('git push origin HEAD', { cwd: handle }), '', "a person's own claim");
});

test('when it cannot tell, the checkout guard fails closed', () => {
  // No main branch to tell a merged claim from an open one.
  const root = repo({ main: 'trunk' });
  git(root, 'branch', '-D', 'trunk');
  assert.equal(decide('git push origin HEAD', { cwd: root }), 'deny', 'no main branch');
  // git cannot be started: nobody can say whose checkout this is.
  const noGit = realpathSync(tempDir('hitld-781-nogit-'));
  assert.equal(decide('git push', { cwd: OUTSIDE }, { PATH: noGit }), 'deny', 'no git');
  // Not a repository the session can read (a file where the directory should be).
  const notDir = join(OUTSIDE, 'a-file');
  writeFileSync(notDir, '');
  assert.equal(decide('git push', { cwd: notDir }), 'deny', 'cwd is not a directory');
});

/**
 * Give `root` an `origin`: a bare repository beside it, as a clone would have.
 * @param {string} root @returns {string} the remote's URL
 */
const withOrigin = (root) => {
  const url = join(realpathSync(tempDir('hitld-793-origin-')), 'r.git');
  git(dirname(url), 'init', '-q', '--bare', url);
  git(root, 'remote', 'add', 'origin', url);
  return url;
};

test('an executor may push its own claim branch, alone, and nothing else (HITLD-746, HITLD-765)', () => {
  const root = repo();
  withOrigin(root);
  for (const allowed of [
    'git push -u origin hitld/W-1-fix',
    'git push --set-upstream origin hitld/W-1-fix',
    'git push origin hitld/W-1-fix',
  ]) {
    assert.equal(decide(allowed, { cwd: root }), '', allowed);
    // Known by its variable as well as by its checkout.
    assert.equal(decide(allowed, { cwd: root }, { HITLD_DISPATCH: 'D-01KAH2Q7RS4XV9TB' }), '');
  }
  for (const refused of [
    'git push origin main',
    'git push origin HEAD',
    'git push',
    'git push -u origin hitld/W-1-fix:main',
    'git push -f origin hitld/W-1-fix',
    'git push --force-with-lease origin hitld/W-1-fix',
    'git push origin +hitld/W-1-fix',
    'git push origin hitld/W-1-fix main',
    'git push --all origin',
    'git push --tags origin hitld/W-1-fix',
    'git push --delete origin hitld/W-1-fix',
    'git push elsewhere hitld/W-1-fix',
    'git push origin hitld/W-2-other',
    'git push origin hitld/W-1-fix && git push origin main',
    'git push origin hitld/W-1-fix; git push origin main',
    'git push origin hitld/W-1-fix\ngit push origin main',
    'git -C .. push origin hitld/W-1-fix',
    'cd .. && git push origin hitld/W-1-fix',
  ]) {
    assert.equal(decide(refused, { cwd: root }), 'deny', refused);
  }
  // Another local branch: not the one checked out, so not its own.
  git(root, 'branch', 'other');
  assert.equal(decide('git push origin other', { cwd: root }), 'deny');
  // An executor known only by its variable, in a checkout with no claim, pushes nothing.
  const bare = repo();
  git(bare, 'switch', '-q', '-c', 'plain', 'main');
  assert.equal(
    decide('git push -u origin plain', { cwd: bare }, { HITLD_DISPATCH: 'D-01KAH2Q7RS4XV9TB' }),
    'deny',
  );
  // Detached HEAD: no branch is its own.
  git(root, 'switch', '-q', '--detach');
  assert.equal(decide('git push -u origin hitld/W-1-fix', { cwd: root }), 'deny', 'detached');
});

test('a fetch chained with the own branch push is refused with a reason that says to run them as two commands (HITLD-1037)', () => {
  const root = repo();
  withOrigin(root);
  /** @param {string} command */
  const reason = (command) => {
    const out = hook('guard.mjs', { tool_name: 'Bash', tool_input: { command }, cwd: root });
    const o = out.stdout ? JSON.parse(out.stdout).hookSpecificOutput : {};
    assert.equal(o.permissionDecision, 'deny', command);
    return String(o.permissionDecisionReason);
  };
  for (const chained of [
    'git fetch origin main && git push -u origin hitld/W-1-fix',
    'git fetch origin; git push origin hitld/W-1-fix',
    'git push -u origin hitld/W-1-fix && git fetch origin',
    'git fetch origin\ngit push --set-upstream origin hitld/W-1-fix',
  ]) {
    const why = reason(chained);
    assert.match(why, /as a command of its own/, chained);
    assert.match(why, /git push -u origin hitld\/W-1-fix alone/, chained);
  }
  // Anything chained with another branch's push, or a push that is not the own one, gets the
  // plain rule: the hint names only the push the executor may make.
  for (const other of [
    'git fetch origin && git push origin hitld/W-2-other',
    'git fetch origin && git push origin main',
    'git fetch origin && git push -f origin hitld/W-1-fix',
  ]) {
    assert.doesNotMatch(reason(other), /as a command of its own/, other);
  }
  // The two commands, run apart, are what the hint asks for: the push alone goes.
  assert.equal(decide('git fetch origin main', { cwd: root }), '');
  assert.equal(decide('git push -u origin hitld/W-1-fix', { cwd: root }), '');
});

test('the claim branch push goes only to the project remote, and every other push is refused (HITLD-791, HITLD-793)', () => {
  const root = repo();
  const url = withOrigin(root);
  git(root, 'branch', 'hitld/W-2-other');
  git(root, 'tag', '-a', 'v1', '-m', 'v1');
  const allowed = 'git push -u origin hitld/W-1-fix';
  assert.equal(decide(allowed, { cwd: root }), '', allowed);
  const refused = {
    main: ['git push origin main', 'git push -u origin main', 'git push origin HEAD:main'],
    'another branch': [
      'git push origin hitld/W-2-other',
      'git push origin hitld/W-1-fix hitld/W-2-other',
    ],
    'a refspec naming another ref': [
      'git push origin hitld/W-1-fix:main',
      'git push origin hitld/W-1-fix:refs/heads/main',
      'git push origin hitld/W-1-fix:hitld/W-1-fix',
      'git push origin HEAD',
      'git push origin refs/heads/hitld/W-1-fix',
      'git push origin',
      'git push',
    ],
    force: [
      'git push --force origin hitld/W-1-fix',
      'git push -f origin hitld/W-1-fix',
      'git push --force-with-lease origin hitld/W-1-fix',
      'git push --force-if-includes origin hitld/W-1-fix',
      'git push origin +hitld/W-1-fix',
    ],
    'ref-deleting forms': [
      'git push --delete origin hitld/W-1-fix',
      'git push -d origin hitld/W-1-fix',
      'git push origin :hitld/W-1-fix',
      'git push origin --delete hitld/W-1-fix',
      'git push --prune origin hitld/W-1-fix',
    ],
    'mirror and all': ['git push --mirror origin', 'git push --all origin'],
    tags: [
      'git push --tags origin hitld/W-1-fix',
      'git push --follow-tags origin hitld/W-1-fix',
      'git push origin v1',
      'git push origin refs/tags/v1',
      'git push origin tag v1',
    ],
    'another remote': [
      'git push elsewhere hitld/W-1-fix',
      `git push ${url} hitld/W-1-fix`,
      'git push --repo=elsewhere origin hitld/W-1-fix',
    ],
    'git options before push': [
      'git -c remote.origin.push=refs/heads/hitld/W-1-fix:refs/heads/main push origin hitld/W-1-fix',
      'git -C . push origin hitld/W-1-fix',
    ],
    'remote rewiring': [
      'git remote set-url origin https://example.com/other.git',
      'git remote set-url --push origin https://example.com/other.git',
      'git remote add elsewhere https://example.com/other.git',
      'git remote rename origin old',
      'git remote remove origin',
      'git remote rm origin',
      'git remote set-head origin hitld/W-1-fix',
    ],
  };
  for (const [what, commands] of Object.entries(refused)) {
    for (const c of commands) assert.equal(decide(c, { cwd: root }), 'deny', `${what}: ${c}`);
  }
  // Reading the remotes stays open.
  assert.equal(decide('git remote -v', { cwd: root }), '');
  assert.equal(decide('git remote get-url origin', { cwd: root }), '');

  // Configuration that sends the same words elsewhere, or sends more than the branch.
  for (const [key, value] of [
    ['remote.origin.push', 'refs/heads/hitld/W-1-fix:refs/heads/main'],
    ['remote.origin.pushurl', 'https://example.com/other.git'],
    ['remote.origin.mirror', 'true'],
    [`url.https://example.com/other.git.insteadOf`, url],
    [`url.https://example.com/other.git.pushInsteadOf`, url],
    ['push.followTags', 'true'],
    ['push.recurseSubmodules', 'on-demand'],
    ['submodule.recurse', 'true'],
  ]) {
    git(root, 'config', key, value);
    assert.equal(decide(allowed, { cwd: root }), 'deny', `${key}=${value}`);
    git(root, 'config', '--unset', key);
  }
  git(root, 'config', '--add', 'remote.origin.url', 'https://example.com/other.git');
  assert.equal(decide(allowed, { cwd: root }), 'deny', 'a second URL');
  git(root, 'config', '--unset', 'remote.origin.url', 'example');

  // Not a hitld/ branch: even holding the claim and checked out, it is not a claim branch.
  git(root, 'branch', '-m', 'hitld/W-1-fix', 'work-1');
  assert.equal(decide('git push -u origin work-1', { cwd: root }), 'deny', 'not hitld/');
  git(root, 'branch', '-m', 'work-1', 'hitld/W-1-fix');

  // The allowed push, run: the remote gets that branch and nothing else.
  assert.equal(decide(allowed, { cwd: root }), '', 'clean again');
  git(root, 'push', '-q', '-u', 'origin', 'hitld/W-1-fix');
  assert.equal(git(url, 'for-each-ref', '--format=%(refname)'), 'refs/heads/hitld/W-1-fix');
});

test('the claim branch push fails closed when the guard cannot tell the branch or the remote (HITLD-793)', () => {
  const allowed = 'git push -u origin hitld/W-1-fix';
  // No origin: no project remote to push to.
  const noOrigin = repo();
  assert.equal(decide(allowed, { cwd: noOrigin }), 'deny', 'no origin');
  // git answers about the branch but not about the remote or its configuration.
  const root = repo();
  withOrigin(root);
  const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const shim = realpathSync(tempDir('hitld-793-shim-'));
  writeFileSync(
    join(shim, 'git'),
    `#!/bin/sh\ncase "$3" in remote|config) exit 128;; esac\nexec ${realGit} "$@"\n`,
    { mode: 0o755 },
  );
  const PATH = `${shim}:${process.env.PATH ?? ''}`;
  assert.equal(decide('git status', { cwd: root }, { PATH }), '', 'the shim answers the rest');
  assert.equal(decide(allowed, { cwd: root }, { PATH }), 'deny', 'git cannot tell the remote');
  // git cannot be started: neither the branch nor the remote is known.
  const noGit = realpathSync(tempDir('hitld-793-nogit-'));
  assert.equal(decide(allowed, { cwd: root }, { PATH: noGit }), 'deny', 'no git');
  // Detached HEAD: no branch to call its own.
  git(root, 'switch', '-q', '--detach');
  assert.equal(decide(allowed, { cwd: root }), 'deny', 'detached');
});
