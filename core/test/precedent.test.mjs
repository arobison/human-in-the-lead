import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { globMatch } from '../lib/precedent/glob.mjs';
import { matchPrecedents, meets, resolveByPrecedent } from '../lib/precedent/match.mjs';
import {
  draftPrecedent,
  exceptionFromFacts,
  narrowPrecedent,
  retirePrecedent,
} from '../lib/precedent/create.mjs';
import { parsePrecedent, renderPrecedent } from '../lib/precedent/store.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { makeProject } from './helpers/project.mjs';
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

/** @param {Record<string, any>} [more] */
/** The owner's question. */
const ownerRoute = /** @type {any} */ ({ decider: 'owner', deciders: ['owner'] });

/** @param {any} facts @param {any[]} ps @param {Record<string, any>} [options] */
const match = (facts, ps, options = {}) =>
  matchPrecedents(facts, ps, { route: ownerRoute, ...options });

const precedent = (more = {}) => ({
  schema_version: 1,
  id: 'P-1',
  rule: 'When a new dependency has a permissive license, allow it.',
  conditions: { rights_basis: ['security'], tags: ['dependency-license'] },
  sources: ['W-3'],
  scope: 'all',
  decider: 'owner',
  state: 'active',
  classification: 'public',
  ...more,
});

test('globs: * stays in a segment, ** crosses segments, ? is one character', () => {
  assert.ok(globMatch('src/cache/**', 'src/cache/http/key.ts'));
  assert.ok(globMatch('src/cache/**', 'src/cache/key.ts'));
  assert.ok(!globMatch('src/cache/**', 'src/api/key.ts'));
  assert.ok(globMatch('src/*.ts', 'src/a.ts'));
  assert.ok(!globMatch('src/*.ts', 'src/deep/a.ts'));
  assert.ok(globMatch('**/package.json', 'package.json'));
  assert.ok(globMatch('**/package.json', 'tools/x/package.json'));
  assert.ok(globMatch('a?.ts', 'ab.ts'));
  assert.ok(!globMatch('a?.ts', 'a/.ts'));
  assert.ok(!globMatch('a.b', 'axb'), 'a dot is a dot');
});

test('conditions: each structured condition must hold', () => {
  const facts = {
    areas: ['cache'],
    item_kinds: ['work'],
    rights_basis: ['security'],
    paths: ['src/cache/a.ts'],
    tags: ['x', 'y'],
  };
  assert.ok(meets({ areas: ['cache', 'api'] }, facts).ok);
  assert.ok(!meets({ areas: ['api'] }, facts).ok);
  assert.ok(!meets({ areas: ['cache'] }, { ...facts, areas: ['cache', 'api'] }).ok);
  assert.ok(meets({ item_kinds: ['work', 'external'] }, facts).ok);
  assert.ok(!meets({ item_kinds: ['decision'] }, facts).ok);
  assert.ok(meets({ rights_basis: ['security', 'novelty'] }, facts).ok);
  assert.ok(!meets({ rights_basis: ['novelty'] }, facts).ok);
  assert.ok(meets({ paths: ['src/**'] }, facts).ok);
  assert.ok(!meets({ paths: ['docs/**'] }, facts).ok);
  assert.ok(meets({ tags: ['x'] }, facts).ok);
  assert.ok(!meets({ tags: ['x', 'z'] }, facts).ok);
  assert.match(meets({ tags: ['x', 'z'] }, facts).reason, /lacks tags z/);
});

test('a condition the question gives no fact for is not met', () => {
  assert.ok(!meets({ areas: ['cache'] }, {}).ok);
  assert.ok(!meets({ paths: ['src/**'] }, {}).ok);
  assert.ok(!meets({ item_kinds: ['work'] }, {}).ok);
});

test('matching: candidates and why the others are out', () => {
  const facts = { rights_basis: ['security'], tags: ['dependency-license', 'npm'] };
  const m = match(facts, [
    precedent(),
    precedent({ id: 'P-2', conditions: { rights_basis: ['novelty'] } }),
    precedent({ id: 'P-3', state: 'retired' }),
    precedent({ id: 'P-4', scope: 'area:cache' }),
  ]);
  assert.deepEqual(
    m.candidates.map((c) => c.id),
    ['P-1'],
  );
  assert.deepEqual(
    m.excluded.map((e) => e.id),
    ['P-2', 'P-3', 'P-4'],
  );
  assert.match(m.excluded[1].reason, /retired/);
  assert.match(m.excluded[2].reason, /scoped to area cache/);
  assert.equal(m.candidates[0].needs_judgment, false);
});

test('a precedent scoped to an area covers questions inside that area only', () => {
  const p = precedent({ scope: 'area:cache', conditions: { rights_basis: ['security'] } });
  const inside = match({ rights_basis: ['security'], areas: ['cache'] }, [p]);
  assert.equal(inside.candidates.length, 1);
  assert.equal(
    match({ rights_basis: ['security'], areas: ['cache', 'api'] }, [p]).candidates.length,
    0,
  );
  assert.equal(match({ rights_basis: ['security'] }, [p]).candidates.length, 0);
});

test('plain-language conditions and text exceptions need a judgment; structured exceptions do not', () => {
  const facts = {
    rights_basis: ['security'],
    tags: ['dependency-license'],
    paths: ['package.json'],
  };
  const text = precedent({
    conditions: { rights_basis: ['security'], text: 'and the package is widely used' },
    exceptions: ['a package with a native build step'],
  });
  const m = match(facts, [text]);
  assert.equal(m.candidates[0].needs_judgment, true);
  assert.deepEqual(m.candidates[0].judge, [
    'condition: and the package is widely used',
    'exception: a package with a native build step',
  ]);
  const structured = precedent({
    exceptions: [{ when: { paths: ['package.json'] }, why: 'root manifest' }],
  });
  const out = match(facts, [structured]);
  assert.equal(out.candidates.length, 0);
  assert.match(out.excluded[0].reason, /exception 1 applies: root manifest/);
  const elsewhere = match({ ...facts, paths: ['tools/package.json'] }, [structured]);
  assert.equal(elsewhere.candidates.length, 1);
});

test('a rule basis in precedent.not_for_bases is never resolved by precedent', () => {
  const { policy } = makeProject();
  const m = match(
    { rights_basis: ['rule-change'] },
    [precedent({ conditions: { rights_basis: ['rule-change'] } })],
    { policy },
  );
  assert.equal(m.candidates.length, 0);
  assert.equal(m.blocked, 'rule-change');
});

test('one clear candidate resolves; several, or an unjudged fit, go to the decider', () => {
  const clear = { id: 'P-1', precedent: precedent(), needs_judgment: false, judge: [] };
  const vague = {
    id: 'P-2',
    precedent: precedent({ id: 'P-2' }),
    needs_judgment: true,
    judge: ['x'],
  };
  assert.equal(resolveByPrecedent([clear]).resolved?.id, 'P-1');
  assert.equal(resolveByPrecedent([clear, { ...clear, id: 'P-9' }]).resolved, null);
  assert.equal(resolveByPrecedent([vague]).resolved, null);
  assert.equal(resolveByPrecedent([vague], { 'P-2': true }).resolved?.id, 'P-2');
  assert.equal(resolveByPrecedent([vague], { 'P-2': false }).remaining.length, 0);
  assert.equal(resolveByPrecedent([clear, vague], { 'P-2': false }).resolved?.id, 'P-1');
  assert.equal(resolveByPrecedent([]).resolved, null);
});

test('creating a precedent: the offer, the decision, the policy it was checked under', () => {
  const offer = {
    summary: 'licenses',
    rule: 'When a dependency is permissively licensed, allow it.',
    conditions: { rights_basis: ['security'], tags: ['dependency-license'] },
  };
  const p = draftPrecedent({
    id: 'P-7',
    decider: 'owner',
    offer,
    decisionId: 'W-12',
    classification: 'internal',
    policyHash: 'a'.repeat(64),
    at: '2026-11-14T10:00:00Z',
  });
  assert.deepEqual(schemas().validateEntity('precedent', p), []);
  assert.deepEqual(p.sources, ['W-12']);
  assert.equal(p.scope, 'all');
  assert.equal(p.state, 'active');
  assert.deepEqual(p.checked, { at: '2026-11-14T10:00:00Z', policy_hash: 'a'.repeat(64) });
  assert.equal(p.classification, 'internal');
});

test('narrowing the offer: words go into the rule, structured values intersect', () => {
  const offer = {
    summary: 's',
    rule: 'When a cache key varies by an external version, include it.',
    conditions: { areas: ['cache', 'api'], tags: ['cache-key'] },
  };
  const base = {
    id: 'P-2',
    decider: 'owner',
    offer,
    decisionId: 'W-1',
    classification: 'public',
    policyHash: null,
    at: '2026-11-14',
  };
  const p = draftPrecedent({
    ...base,
    narrow: { text: 'cache keys', areas: ['cache'], paths: ['src/cache/**'] },
  });
  assert.deepEqual(p.conditions.areas, ['cache']);
  assert.deepEqual(p.conditions.paths, ['src/cache/**']);
  assert.equal(p.conditions.text, 'cache keys');
  assert.match(p.rule, /include it, only for cache keys\.$/);
  assert.deepEqual(schemas().validateEntity('precedent', p), []);
  assert.throws(() => draftPrecedent({ ...base, narrow: { areas: ['docs'] } }), /shares nothing/);
});

test('an overrule narrows by an exception, or retires when no attribute tells the case apart', () => {
  const p = precedent();
  const when = exceptionFromFacts({
    rights_basis: ['security'],
    tags: ['npm'],
    paths: ['package.json'],
  });
  assert.deepEqual(when, { paths: ['package.json'], tags: ['npm'] });
  assert.equal(exceptionFromFacts({ rights_basis: ['security'], item_kinds: ['work'] }), null);
  const narrowed = narrowPrecedent(p, {
    when: /** @type {any} */ (when),
    why: 'native build',
    at: '2026-11-15',
  });
  assert.equal(narrowed.state, 'active');
  assert.deepEqual(narrowed.exceptions, [{ when, why: 'native build' }]);
  assert.deepEqual(schemas().validateEntity('precedent', narrowed), []);
  const retired = retirePrecedent(p, { why: 'wrong', at: '2026-11-15' });
  assert.equal(retired.state, 'retired');
  assert.deepEqual(schemas().validateEntity('precedent', retired), []);
});

test('a public precedent is a file in the repository, and the front matter is plain JSON', () => {
  const project = makeProject();
  const place = project.precedents.put(precedent());
  assert.equal(place, 'repository');
  const dir = join(project.root, 'precedents');
  const [file] = readdirSync(dir);
  assert.match(file, /^P-1-when-a-new-dependency-has-a-permissive\.md$/);
  const text = readFileSync(join(dir, file), 'utf8');
  assert.match(text, /^---\n\{/);
  assert.deepEqual(parsePrecedent(text, file), precedent());
  assert.equal(renderPrecedent(precedent()), text);
  assert.deepEqual(project.precedents.get('P-1'), precedent());
  assert.equal(project.precedents.get('P-9'), null);
});

test('a precedent above the repository ceiling lives in the private store, and secret is refused', () => {
  const project = makeProject();
  assert.equal(
    project.precedents.put(precedent({ id: 'P-1', classification: 'public' })),
    'repository',
  );
  assert.equal(
    project.precedents.put(precedent({ id: 'P-2', classification: 'internal' })),
    'private store',
  );
  assert.equal(
    project.precedents.put(precedent({ id: 'P-3', classification: 'confidential' })),
    'private store',
  );
  assert.ok(!existsSync(join(project.root, 'precedents', 'P-2.md')));
  assert.deepEqual(readdirSync(join(project.root, 'precedents')).length, 1);
  assert.deepEqual(project.store.list('precedents/'), [
    'precedents/P-2.json',
    'precedents/P-3.json',
  ]);
  assert.throws(
    () => project.precedents.put(precedent({ id: 'P-4', classification: 'secret' })),
    /secret/,
  );
  assert.deepEqual(
    project.precedents.list().map((p) => p.id),
    ['P-1', 'P-2', 'P-3'],
  );
  assert.equal(project.precedents.nextId(), 'P-4');
});

test('an invalid precedent is not stored, and updating one keeps its file', () => {
  const project = makeProject();
  assert.throws(() => project.precedents.put(precedent({ scope: 'everywhere' })), /scope/);
  project.precedents.put(precedent());
  project.precedents.put({ ...precedent(), state: 'retired' });
  assert.equal(readdirSync(join(project.root, 'precedents')).length, 1);
  assert.equal(project.precedents.get('P-1')?.state, 'retired');
});

test('a symbolic link at a precedent file is refused, never written through', needsSymlink, () => {
  const project = makeProject();
  const outside = tempDir('hitld-outside-');
  const target = join(outside, 'authorized_keys');
  writeFileSync(target, 'keep me\n');
  mkdirSync(join(project.root, 'precedents'));
  symlinkSync(target, join(project.root, 'precedents', 'P-1-planted.md'));
  assert.throws(() => project.precedents.put(precedent()), /not a regular file/);
  assert.throws(() => project.precedents.list(), /not a regular file/);
  assert.equal(readFileSync(target, 'utf8'), 'keep me\n');
});

test(
  'a symbolic link at the precedents directory is refused, never written through',
  needsSymlink,
  () => {
    const project = makeProject();
    const outside = tempDir('hitld-outside-');
    symlinkSync(outside, join(project.root, 'precedents'));
    assert.throws(() => project.precedents.put(precedent()), /symbolic link/);
    assert.deepEqual(readdirSync(outside), []);
  },
);

test('a front-matter file that is not JSON data is refused with its name', () => {
  assert.throws(
    () => parsePrecedent('---\nid: P-1\n---\n', 'P-1.md'),
    /P-1.md: the front matter is not JSON/,
  );
  assert.throws(() => parsePrecedent('no front matter', 'P-1.md'), /no front matter/);
});
