// `hitld release migrate` (HITLD-757, HITLD-752): move a repository's releases from before
// release packages into a package named main.
//
// Before packages, a repository had one release line: tags v<version>, records directly under
// <work dir>/releases/, named by their tag. The migration declares the package main in
// policy.json `release.packages`, owning every path, with the tag template v{version}, so every
// tag already made (HITLD's own v0.1.0-rc.1, which consuming projects pin) is main's tag as it
// is: no tag is renamed, moved or made, and every pin still resolves. Each record moves to
// <work dir>/releases/main/<version>.md and gains `package: main`; its id stays its tag. When
// main is declared already and records from before packages are left, it moves them and leaves
// policy.json as it is (HITLD-899).
//
// Without --apply it only reports the plan and writes nothing. With --apply, which is the
// owner's (the command line refuses it outside the owner's own turn), it writes policy.json and
// the moved records in one commit from a clean tree, through the repository's own hooks and
// after the commit guard's checks; nothing is pushed.

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import {
  checkStaged,
  isTermRefusal,
  judgeTerms,
  problemLines,
  rulesFrom,
} from '../guard/classification.mjs';
import { POLICY_PATH, loadPolicy } from '../policy/policy.mjs';
import { formatErrors } from '../schema/validate.mjs';
import { parseItem, renderItem } from '../tracker/files/frontmatter.mjs';
import { RELEASE_KEYS, packageReleasesDir, recordPath } from '../tracker/files/releases.mjs';
import { createExclusive, insidePath, mkdirInside } from '../tracker/files/safe.mjs';
import { git } from '../tracker/files/tree.mjs';
import { checkPackages, declaredPackages, tagFor } from './packages.mjs';
import { packageTags } from './propose.mjs';

/**
 * @typedef {import('../tracker/files/tracker.mjs').FilesTracker} FilesTracker
 * @typedef {import('../guard/private-terms.mjs').Matcher} Matcher
 *
 * @typedef {object} MigrationPlan
 * @property {boolean} needed false when a package is declared and no record from before
 *   packages is left
 * @property {string[]} declared the packages already declared
 * @property {Record<string, unknown> | null} package the package the migration declares; null
 *   when main is declared already, and policy.json is left as it is
 * @property {string} policy the policy file it changes
 * @property {{ from: string, to: string, tag: string }[]} moves the records it moves
 * @property {string[]} tags_kept every tag that stays main's, unchanged
 * @property {string[]} problems why it cannot be applied
 */

/** The package the migration declares. */
export const MAIN = 'main';

/**
 * The migration's plan. Reads only.
 *
 * It is needed while no package is declared (it declares main), and whenever records from before
 * packages are left (HITLD-899): with main declared already, it moves them into main; with
 * packages declared but not main, the records have no package to go to, and it says so as a
 * problem.
 * @param {FilesTracker} t
 * @param {{ surface?: string }} [options] surface: a committed surface file for the package main
 *   the migration declares
 * @returns {MigrationPlan}
 */
export function planMigration(t, { surface } = {}) {
  const root = t.root();
  const layout = t.layout();
  const packages = layout.packages ?? [];
  const declared = packages.map((p) => p.name);
  const records = t.releases().filter((r) => (r.package ?? null) === null);
  if (declared.length && !records.length) {
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
  /** @type {string[]} */
  const problems = [];
  /** @type {Record<string, unknown> | null} */
  let pkg = null;
  /** @type {{ name: string, tag: string } | undefined} */
  let target;
  if (!declared.length) {
    pkg = { name: MAIN, tag: 'v{version}', paths: ['**'] };
    if (surface !== undefined) pkg.surface = surface;
    if (existsSync(insidePath(root, 'package.json'))) pkg.version_source = 'package.json';
    problems.push(...checkPackages(declaredPackages({ release: { packages: [pkg] } }), { root }));
    target = { name: MAIN, tag: 'v{version}' };
  } else {
    target = packages.find((p) => p.name === MAIN);
    if (!target) {
      problems.push(
        `release.packages declares ${declared.join(', ')} but no package named ${MAIN} is declared; records from before packages move into ${MAIN}: declare it (tag template v{version}, so every tag already made stays its tag), then run the migration again`,
      );
    } else if (surface !== undefined) {
      problems.push(
        `${MAIN} is declared already: --surface only declares the package; set its surface in ${POLICY_PATH} instead`,
      );
    }
  }
  /** @type {MigrationPlan['moves']} */
  const moves = [];
  for (const r of target ? records : []) {
    const version = r.data?.version;
    if (!r.data || typeof version !== 'string' || r.errors.length) {
      problems.push(`${r.path} does not read as a release record; fix it first`);
      continue;
    }
    const tag = String(r.data.id);
    const to = recordPath(layout, MAIN, version);
    if (existsSync(insidePath(root, to))) problems.push(`${to} already exists`);
    const as = tagFor(/** @type {{ name: string, tag: string }} */ (target), version);
    if (as !== tag) {
      problems.push(
        `${r.path}: ${MAIN}'s tag template (${target?.tag}) gives ${as}, not ${tag}; a moved record keeps its tag`,
      );
    }
    moves.push({ from: r.path, to, tag });
  }
  return {
    needed: true,
    declared,
    package: pkg,
    policy: POLICY_PATH,
    moves,
    tags_kept: target ? packageTags(root, target, { all: true }).map((x) => x.tag) : [],
    problems,
  };
}

/**
 * Apply the plan: write policy.json (when the plan declares main) and the moved records, in one
 * commit. The owner's.
 *
 * The commit goes through the repository's own hooks. Before it, the staged change is checked
 * here as the commit guard checks it (HITLD-899), so a checkout without the hooks gets the same
 * rules: policy.json reads back, and no staged file is above the classification ceiling or holds
 * a term from the private term list, nor does the commit message.
 * @param {FilesTracker} t @param {MigrationPlan} plan
 * @param {{ terms?: Matcher[] }} [options] terms: the private term list's matchers (the command
 *   line reads them from the private store)
 * @returns {{ commit: string, files: string[] }}
 */
export function applyMigration(t, plan, { terms = [] } = {}) {
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
  /** @type {string[]} */
  const files = plan.package ? [plan.policy] : [];
  /** @type {string[]} */
  const created = [];
  const into = packageReleasesDir(layout, MAIN);
  const message = [
    `release migrate: the repository-wide releases into the package ${MAIN}`,
    plan.package
      ? `Written by hitld release migrate in the owner's turn: policy.json declares the package ${MAIN} (tag template v{version}, so every tag already made stays as it is), and ${plan.moves.length} record(s) move into ${into}/.`
      : `Written by hitld release migrate in the owner's turn: the package ${MAIN} is declared already, and ${plan.moves.length} record(s) move into ${into}/.`,
  ];
  try {
    if (plan.package) writeFileSync(policyFile, withPackage(before, plan.package));
    mkdirInside(root, into);
    for (const m of plan.moves) {
      const { data, body } = parseItem(readFileSync(insidePath(root, m.from), 'utf8'));
      const moved = renderItem({ ...data, package: MAIN }, RELEASE_KEYS, body);
      createExclusive(insidePath(root, m.to), moved);
      created.push(m.to);
      git(root, ['rm', '-q', '--', m.from]);
      files.push(m.from, m.to);
    }
    git(root, ['add', '--', ...(plan.package ? [plan.policy] : []), ...created]);
    guardStaged(root, layout.defaultClassification, message.join('\n\n'), terms);
    git(root, ['commit', '--signoff', ...message.flatMap((m) => ['-m', m]), '--', ...files]);
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
 * The commit guard's rules on the staged change and on the commit message. A refusal names the
 * file, the rule, and a term's kind and line, never the term; nothing is committed.
 * @param {string} root @param {string | undefined} defaultClassification
 * @param {string} message @param {Matcher[]} terms
 */
function guardStaged(root, defaultClassification, message, terms) {
  const loaded = loadPolicy({ cwd: root });
  if (!loaded.policy) {
    throw new Error(
      `not migrated: ${POLICY_PATH} does not read back: ${formatErrors(loaded.errors).split('\n').join('; ')}`,
    );
  }
  const rules = { ...rulesFrom(loaded.policy, defaultClassification), terms };
  const refused = checkStaged(root, rules).refused;
  const said = judgeTerms('the commit message', message, rules);
  if (said) refused.push(said);
  if (refused.length) {
    const termed = refused.some(isTermRefusal)
      ? '; a term from the private term list is named by its kind and line: refer to it by its role instead'
      : '';
    throw new Error(`not migrated: ${problemLines(refused).join('; ')}${termed}`);
  }
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
