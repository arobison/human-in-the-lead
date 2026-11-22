// `hitld release migrate` (HITLD-757, HITLD-752): move a repository's releases from before
// release packages into a package named main.
//
// Before packages, a repository had one release line: tags v<version>, records directly under
// <work dir>/releases/, named by their tag. The migration declares the package main in
// policy.json `release.packages`, owning every path, with the tag template v{version}, so every
// tag already made (HITLD's own v0.1.0-rc.1, which consuming projects pin) is main's tag as it
// is: no tag is renamed, moved or made, and every pin still resolves. Each record moves to
// <work dir>/releases/main/<version>.md and gains `package: main`; its id stays its tag.
//
// Without --apply it only reports the plan and writes nothing. With --apply, which is the
// owner's (the command line refuses it outside the owner's own turn), it writes policy.json and
// the moved records in one commit from a clean tree; nothing is pushed.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { POLICY_PATH } from '../policy/policy.mjs';
import { parseItem, renderItem } from '../tracker/files/frontmatter.mjs';
import { RELEASE_KEYS, packageReleasesDir, recordPath } from '../tracker/files/releases.mjs';
import { createExclusive, insidePath, mkdirInside } from '../tracker/files/safe.mjs';
import { git } from '../tracker/files/tree.mjs';
import { checkPackages, declaredPackages } from './packages.mjs';
import { packageTags } from './propose.mjs';

/**
 * @typedef {import('../tracker/files/tracker.mjs').FilesTracker} FilesTracker
 *
 * @typedef {object} MigrationPlan
 * @property {boolean} needed false when a package is already declared
 * @property {string[]} declared the packages already declared
 * @property {Record<string, unknown> | null} package the package the migration declares
 * @property {string} policy the policy file it changes
 * @property {{ from: string, to: string, tag: string }[]} moves the records it moves
 * @property {string[]} tags_kept every tag that stays main's, unchanged
 * @property {string[]} problems why it cannot be applied
 */

/** The package the migration declares. */
export const MAIN = 'main';

/**
 * The migration's plan. Reads only.
 * @param {FilesTracker} t
 * @param {{ surface?: string }} [options] surface: a committed surface file for main
 * @returns {MigrationPlan}
 */
export function planMigration(t, { surface } = {}) {
  const root = t.root();
  const layout = t.layout();
  const declared = (layout.packages ?? []).map((p) => p.name);
  if (declared.length) {
    return {
      needed: false,
      declared,
      package: null,
      policy: POLICY_PATH,
      moves: [],
      tags_kept: [],
      problems: [],
    };
  }
  /** @type {Record<string, unknown>} */
  const pkg = { name: MAIN, tag: 'v{version}', paths: ['**'] };
  if (surface !== undefined) pkg.surface = surface;
  if (existsSync(insidePath(root, 'package.json'))) pkg.version_source = 'package.json';
  const problems = checkPackages(declaredPackages({ release: { packages: [pkg] } }), { root });
  const records = t.releases().filter((r) => r.package === null);
  /** @type {MigrationPlan['moves']} */
  const moves = [];
  for (const r of records) {
    const version = r.data?.version;
    if (!r.data || typeof version !== 'string' || r.errors.length) {
      problems.push(`${r.path} does not read as a release record; fix it first`);
      continue;
    }
    const to = recordPath(layout, MAIN, version);
    if (existsSync(insidePath(root, to))) problems.push(`${to} already exists`);
    moves.push({ from: r.path, to, tag: String(r.data.id) });
  }
  return {
    needed: true,
    declared,
    package: pkg,
    policy: POLICY_PATH,
    moves,
    tags_kept: packageTags(root, { name: MAIN, tag: 'v{version}' }, { all: true }).map(
      (x) => x.tag,
    ),
    problems,
  };
}

/**
 * Apply the plan: write policy.json and the moved records, in one commit. The owner's.
 * @param {FilesTracker} t @param {MigrationPlan} plan
 * @returns {{ commit: string, files: string[] }}
 */
export function applyMigration(t, plan) {
  const root = t.root();
  const layout = t.layout();
  if (!plan.needed) throw new Error(`nothing to migrate: ${plan.declared.join(', ')} declared`);
  if (plan.problems.length) throw new Error(`not migrated: ${plan.problems.join('; ')}`);
  if (git(root, ['status', '--porcelain']).trim()) {
    throw new Error(
      'the working tree has uncommitted changes; the migration is made from a clean tree, in one commit',
    );
  }
  const policyFile = insidePath(root, plan.policy);
  const before = readFileSync(policyFile, 'utf8');
  const after = withPackage(before, /** @type {Record<string, unknown>} */ (plan.package));
  /** @type {string[]} */
  const files = [plan.policy];
  /** @type {string[]} */
  const created = [];
  try {
    writeFileSync(policyFile, after);
    mkdirInside(root, packageReleasesDir(layout, MAIN));
    for (const m of plan.moves) {
      const { data, body } = parseItem(readFileSync(insidePath(root, m.from), 'utf8'));
      const moved = renderItem({ ...data, package: MAIN }, RELEASE_KEYS, body);
      createExclusive(insidePath(root, m.to), moved);
      created.push(m.to);
      git(root, ['rm', '-q', '--', m.from]);
      files.push(m.from, m.to);
    }
    git(root, ['add', '--', plan.policy, ...created]);
    git(root, [
      'commit',
      '--no-verify',
      '--signoff',
      '-m',
      `release migrate: the repository-wide releases into the package ${MAIN}`,
      '-m',
      `Written by hitld release migrate in the owner's turn: policy.json declares the package ${MAIN} (tag template v{version}, so every tag already made stays as it is), and ${plan.moves.length} record(s) move into ${packageReleasesDir(layout, MAIN)}/.`,
      '--',
      ...files,
    ]);
  } catch (e) {
    // Put the tree back as it was.
    git(root, ['reset', '-q', '--', ...files], { allowFail: true });
    for (const m of plan.moves) git(root, ['checkout', '-q', '--', m.from], { allowFail: true });
    for (const f of created) rmSync(insidePath(root, f), { force: true });
    writeFileSync(policyFile, before);
    throw e;
  }
  return { commit: git(root, ['rev-parse', 'HEAD']).trim(), files };
}

/**
 * policy.json with the package declared. The rest of the file keeps its own text: the release
 * section goes in before the closing brace, written as a formatter would write it. A file that
 * already has a release section is written again whole.
 * @param {string} text @param {Record<string, unknown>} pkg
 */
export function withPackage(text, pkg) {
  const raw = JSON.parse(text);
  if (raw.release !== undefined || !/\}\s*$/.test(text)) {
    raw.release = { ...(raw.release ?? {}), packages: [pkg] };
    return `${JSON.stringify(raw, null, 2)}\n`;
  }
  const fields = Object.entries(pkg).map(
    ([k, v]) => `        ${JSON.stringify(k)}: ${JSON.stringify(v)}`,
  );
  const block = [
    '  "release": {',
    '    "packages": [',
    '      {',
    fields.join(',\n'),
    '      }',
    '    ]',
    '  }',
  ].join('\n');
  const body = text.replace(/\s*\}\s*$/, '');
  const out = `${body}${Object.keys(raw).length ? ',' : ''}\n${block}\n}\n`;
  JSON.parse(out); // never write a file that does not read back
  return out;
}
