// A path may hold a carriage return, a line feed, U+2028 or U+2029 (git forbids only NUL and
// "/"). Every decision that reads a glob gives such a path the same answer as a plain name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globMatch } from '../lib/precedent/glob.mjs';
import { areasOf, evidenceFor, waitsForOwner } from '../lib/merge/owner.mjs';
import { judge, STRICT } from '../lib/guard/classification.mjs';
import { MERGE_SETTINGS } from '../lib/eval/orchestrator-fixtures.mjs';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { tempDir } from './helpers/tmp.mjs';

/** The four line-break characters, by name. */
const BREAKS = /** @type {const} */ ([
  ['a carriage return', '\r'],
  ['a line feed', '\n'],
  ['U+2028', ' '],
  ['U+2029', ' '],
]);

/** A file name holding the line break, and the plain name it stands beside. @param {string} c */
const names = (c) => ({ odd: `x${c}y.md`, plain: 'xy.md' });

for (const [label, c] of BREAKS) {
  test(`globs: a name with ${label} matches ** and **/ wherever * matches it`, () => {
    const { odd } = names(c);
    assert.ok(globMatch('a/*', `a/${odd}`));
    assert.ok(globMatch('a/**', `a/${odd}`));
    assert.ok(globMatch('**', `a/${odd}`));
    assert.ok(globMatch('**', c));
    assert.ok(globMatch('a/**', `a/${c}`));
    assert.ok(globMatch('**/*.md', `a/b/${odd}`));
    assert.ok(globMatch(`**/${odd}`, odd));
    // A directory with the line break in its name, crossed by ** and **/.
    assert.ok(globMatch('a/**', `a/d${c}e/f.md`));
    assert.ok(globMatch('**/f.md', `a/d${c}e/f.md`));
    assert.ok(globMatch('a/**/f.md', `a/d${c}e/f.md`));
    // Still bounded: ** does not reach outside its prefix, and * stays in one segment.
    assert.ok(!globMatch('a/**', `b/${odd}`));
    assert.ok(!globMatch('a/*', `a/d${c}e/f.md`));
    assert.ok(!globMatch('a?b', `a${c}/b`));
    assert.ok(globMatch('a?b', `a${c}b`));
  });
}

// This repository's own settings for the decisions below.
const OWNER_PATHS = ['**', '!work/**', 'work/releases/**'];
const AREAS = [
  { name: 'tracker', paths: ['work/*', 'work/items/**'] },
  { name: 'releases', paths: ['work/releases/**'] },
  { name: 'core', paths: ['core/**'] },
  { name: 'docs', paths: ['docs/**'] },
];

for (const [label, c] of BREAKS) {
  const { odd, plain } = names(c);

  test(`owner gate: a branch changing only a name with ${label} waits as a plain name does`, () => {
    const policy = { merge: { owner_paths: OWNER_PATHS, owner_areas: [] } };
    for (const dir of ['core/lib', 'docs', 'work/releases', 'work/items', '']) {
      const at = (/** @type {string} */ n) => (dir ? `${dir}/${n}` : n);
      assert.equal(
        waitsForOwner([at(odd)], policy),
        waitsForOwner([at(plain)], policy),
        `under ${JSON.stringify(dir)}`,
      );
    }
    assert.equal(waitsForOwner([`core/${odd}`], policy), true);
    assert.equal(waitsForOwner([`work/items/${odd}`], policy), false);
    // By area: owner_areas alone.
    const byArea = { merge: { owner_paths: [], owner_areas: ['docs'] }, rights: { areas: AREAS } };
    assert.equal(waitsForOwner([`docs/${odd}`], byArea), true);
    assert.equal(waitsForOwner([`core/${odd}`], byArea), false);
  });

  test(`area lookup: a name with ${label} falls in the area a plain name does`, () => {
    const policy = { rights: { areas: AREAS } };
    for (const dir of ['core/lib', 'docs', 'work/releases', 'work/items', 'work', 'elsewhere']) {
      assert.deepEqual(
        areasOf([`${dir}/${odd}`], policy),
        areasOf([`${dir}/${plain}`], policy),
        `under ${dir}`,
      );
    }
    assert.deepEqual(areasOf([`core/${odd}`], policy), ['core']);
  });

  test(`sensitive and public globs: a name with ${label} is flagged as a plain name is`, () => {
    const { policy } = resolvePolicy({
      schema_version: 1,
      project: { id: 'test', key: 'W' },
      dispatch: { sensitive_globs: ['secrets/**', '**/auth/**'] },
      merge: { public_globs: ['schemas/**', 'core/lib/cli/**'] },
    });
    assert.ok(policy);
    const root = tempDir('hitld-line-break-');
    /** @param {string} n */
    const changed = (n) => [`secrets/${n}`, `core/auth/${n}`, `schemas/${n}`, `core/lib/cli/${n}`];
    /** @param {string[]} files */
    const shown = (files) =>
      evidenceFor({
        repoRoot: root,
        tested: {
          item: 'W-1',
          branch: 'b',
          commit: 'c'.repeat(40),
          parent: 'p'.repeat(40),
          changed: files,
        },
        branchSha: 'c'.repeat(40),
        touches: ['src/**'],
        settings: { ...MERGE_SETTINGS, generated: [...MERGE_SETTINGS.generated] },
        policy: /** @type {any} */ (policy),
      });
    const a = shown(changed(odd));
    const b = shown(changed(plain));
    assert.equal(a.sensitive.length, 2);
    assert.equal(b.sensitive.length, 2);
    assert.equal(a.public_surface.files.length, 2);
    assert.equal(b.public_surface.files.length, 2);
    assert.deepEqual(
      a.reads.map((r) => r.trigger),
      b.reads.map((r) => r.trigger),
    );
  });

  test(`commit guard: a name with ${label} under a private path is refused as a plain name is`, () => {
    const rules = { ...STRICT, privatePaths: ['research/**', '**/private/*'] };
    for (const p of ['research', 'research/deep', 'src/private']) {
      const a = judge(`${p}/${odd}`, [], rules);
      const b = judge(`${p}/${plain}`, [], rules);
      assert.equal(a?.rule, 'private-path', `under ${p}`);
      assert.equal(b?.rule, 'private-path', `under ${p}`);
    }
    assert.equal(judge(`src/${odd}`, [], rules), null);
  });
}
