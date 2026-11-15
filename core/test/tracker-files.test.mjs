import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schemas } from '../lib/schema/registry.mjs';
import { parseItem, renderItem, slugify } from '../lib/tracker/files/frontmatter.mjs';
import { checkBlocks, loadTrackerConfig, resolveLayout } from '../lib/tracker/files/config.mjs';
import { keyOrder } from '../lib/tracker/files/format.mjs';
import { checkItems } from '../lib/tracker/files/check.mjs';
import { buildGraph } from '../lib/tracker/files/graph.mjs';
import { loadWorkTree } from '../lib/tracker/files/tree.mjs';
import {
  criticalPaths,
  renderLists,
  viewBlocked,
  viewDecisions,
  viewProjects,
  viewReady,
} from '../lib/tracker/files/views.mjs';
import { itemText, makeRepo, policyFor, put } from './tracker-fixture.mjs';

/** @param {string} root @param {Record<string, unknown>} [config] */
function layoutOf(root, config = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'hitld-cfg-'));
  writeFileSync(join(dir, 'tracker.json'), JSON.stringify({ schema_version: 1, ...config }));
  const { config: c, errors } = loadTrackerConfig({ repoRoot: root, configDir: dir });
  assert.deepEqual(errors, []);
  return resolveLayout(/** @type {any} */ (c), policyFor());
}

// --- The front matter ----------------------------------------------------------------

test('front matter: scalars, inline and block lists, quotes', () => {
  const { data, body, errors } = parseItem(
    "---\nid: W-1\ntitle: \"A: quoted\"\nneeds: [W-2, W-3]\nmilestones:\n  - one\n  - two\nreason: 'it''s'\n---\n\nHello\n",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(data, {
    id: 'W-1',
    title: 'A: quoted',
    needs: ['W-2', 'W-3'],
    milestones: ['one', 'two'],
    reason: "it's",
  });
  assert.equal(body, '\nHello\n');
});

test('front matter: anchors, aliases, tags, block strings and maps are refused', () => {
  for (const bad of ['&a x', '*a', '!!str x', '|', '>', '{a: 1}']) {
    const { errors } = parseItem(`---\ntitle: ${bad}\n---\n`);
    assert.match(errors[0], /uses YAML this format doesn't allow/, bad);
  }
  assert.deepEqual(parseItem('no front matter').errors, ['no frontmatter']);
});

test('front matter: a duplicate key, a stray list entry and a bad line are named', () => {
  const { errors } = parseItem('---\nid: W-1\nid: W-2\n  - x\nnot a pair\n---\n');
  assert.deepEqual(errors, [
    'frontmatter line 3: "id" appears twice',
    'frontmatter line 4: a list entry with no key above it',
    'frontmatter line 5: not "key: value"',
  ]);
});

test('front matter: a hostile key stays data and never touches the prototype', () => {
  const { data } = parseItem('---\n__proto__: x\nconstructor: y\n---\n');
  assert.deepEqual(Object.keys(data ?? {}), ['__proto__', 'constructor']);
  assert.equal(/** @type {any} */ ({}).x, undefined);
  assert.equal(Object.getPrototypeOf(data), Object.prototype);
});

test('front matter: what is written reads back, and the fixed key order holds', () => {
  const layout = { optionalKeys: [], fields: [] };
  const data = {
    state: 'planned',
    title: 'Has: a colon, and a "quote"',
    id: 'W-1',
    kind: 'work',
    needs: ['W-2'],
    project: 'W-9',
  };
  const text = renderItem(data, keyOrder('work', /** @type {any} */ (layout)), '\n## Done when\n');
  assert.match(
    text,
    /^---\nid: W-1\ntitle: .*\nkind: work\nstate: planned\nproject: W-9\nneeds: \[W-2\]\n---\n/,
  );
  const back = parseItem(text);
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.data, data);
  assert.equal(
    renderItem(back.data ?? {}, keyOrder('work', /** @type {any} */ (layout)), back.body),
    text,
  );
});

test('front matter: a list member with a comma or a leading star is quoted so it reads back', () => {
  const text = renderItem({ id: 'W-1', kind: 'work', touches: ['src/**', 'a,b', '*.md'] }, [
    'id',
    'kind',
    'touches',
  ]);
  assert.deepEqual(parseItem(text).data?.touches, ['src/**', 'a,b', '*.md']);
});

test('slugify follows the reference format: lower case ASCII, at most 48 characters', () => {
  assert.equal(
    slugify('Cache `response` entries by request key!'),
    'cache-response-entries-by-request-key',
  );
  assert.equal(slugify('Café déjà vu'), 'cafe-deja-vu');
  assert.equal(slugify('???'), 'item');
  assert.ok(slugify('word '.repeat(30)).length <= 48);
});

// --- Settings -------------------------------------------------------------------------

test('tracker.json: every setting has a default, and a missing file is the reference layout', () => {
  const root = makeRepo({ commit: false });
  const { config, errors, path } = loadTrackerConfig({ repoRoot: root });
  assert.deepEqual(errors, []);
  assert.equal(path?.endsWith('tracker.json'), true);
  assert.equal(config?.work_dir, 'work');
  assert.deepEqual(config?.folders, {
    initiative: 'initiatives',
    project: 'projects',
    item: 'items',
    milestone: 'milestones',
    release: 'releases',
  });
  assert.equal(config?.main_branch, undefined, 'the main branch is policy.json merge.main_branch');
  assert.deepEqual(config?.bundle_refs, ['refs/bundles/']);
  assert.deepEqual(config?.optional_keys, []);
});

test('tracker.json: the names before HITLD-82 are still read, each with a warning', () => {
  const root = makeRepo({ commit: false });
  const dir = mkdtempSync(join(tmpdir(), 'hitld-cfg-'));
  writeFileSync(
    join(dir, 'tracker.json'),
    JSON.stringify({
      schema_version: 1,
      lists_readme: 'README.md',
      main_branch: 'trunk',
      optional_keys: ['changelog', 'tier_hint', 'touches'],
    }),
  );
  const { config, errors, warnings } = loadTrackerConfig({ repoRoot: root, configDir: dir });
  assert.deepEqual(errors, []);
  assert.equal(config?.lists_file, 'README.md');
  assert.deepEqual(config?.optional_keys, ['release_note', 'tier_override', 'touches']);
  assert.equal(warnings.length, 4);
  assert.match(warnings.join('\n'), /"main_branch" moved to policy\.json merge\.main_branch/);
  assert.equal(
    resolveLayout(/** @type {Record<string, any>} */ (config), { project: { key: 'W' } })
      .mainBranch,
    'trunk',
  );
});

test('tracker.json: paths must stay inside the repository; unknown keys are refused', () => {
  const root = makeRepo({ commit: false });
  for (const bad of [
    { work_dir: '../outside' },
    { work_dir: '/abs' },
    { folders: { item: 'a/b' } },
    { folders: { item: '..' } },
    { views_dir: 'x\\y' },
    { main_branch: '-x' },
    { surprise: 1 },
    { on_status_change: 'rm -rf /' },
    { optional_keys: ['not_a_key'] },
  ]) {
    const dir = mkdtempSync(join(tmpdir(), 'hitld-cfg-'));
    writeFileSync(join(dir, 'tracker.json'), JSON.stringify({ schema_version: 1, ...bad }));
    const { config, errors } = loadTrackerConfig({ repoRoot: root, configDir: dir });
    assert.equal(config, null, JSON.stringify(bad));
    assert.ok(errors.length > 0, JSON.stringify(bad));
  }
});

test('tracker.json: the schema_version is required and a newer one is refused', () => {
  const root = makeRepo({ commit: false });
  const dir = mkdtempSync(join(tmpdir(), 'hitld-cfg-'));
  writeFileSync(join(dir, 'tracker.json'), '{}');
  assert.deepEqual(loadTrackerConfig({ repoRoot: root, configDir: dir }).errors, [
    { path: 'schema_version', message: 'is required' },
  ]);
  writeFileSync(join(dir, 'tracker.json'), '{"schema_version": 2}');
  assert.match(
    loadTrackerConfig({ repoRoot: root, configDir: dir }).errors[0].message,
    /newer than this release/,
  );
});

test('reserved ID blocks must not overlap, and an open-ended block must be last', () => {
  assert.deepEqual(checkBlocks([{ name: 'b', from: 100000 }]), []);
  assert.deepEqual(
    checkBlocks([
      { name: 'a', from: 1000, to: 1999 },
      { name: 'b', from: 2000, to: 2999 },
    ]),
    [],
  );
  assert.match(
    checkBlocks([
      { name: 'a', from: 1000, to: 2000 },
      { name: 'b', from: 2000 },
    ])[0],
    /overlap/,
  );
  assert.match(
    checkBlocks([
      { name: 'a', from: 1000 },
      { name: 'b', from: 5000 },
    ])[0],
    /overlap/,
  );
  assert.match(checkBlocks([{ name: 'a', from: 9, to: 3 }])[0], /ends \(3\) before it starts/);
  assert.throws(
    () =>
      resolveLayout(
        /** @type {any} */ (loadTrackerConfig({ repoRoot: '.' }).config),
        policyFor([
          { name: 'a', from: 10, to: 20 },
          { name: 'b', from: 15 },
        ]),
      ),
    /overlap/,
  );
});

// --- The check ------------------------------------------------------------------------

test('the check passes the fixture tracker', () => {
  const root = makeRepo({ commit: false });
  const layout = layoutOf(root);
  assert.deepEqual(checkItems(loadWorkTree(root, layout), layout, { root }), []);
});

/** @param {Record<string, string>} files @param {Record<string, unknown>} [config] */
function problemsFor(files, config) {
  const root = makeRepo({ files, commit: false });
  const layout = layoutOf(root, config);
  return checkItems(loadWorkTree(root, layout), layout, { root });
}

test('the check names what is wrong, in the reference check’s words', () => {
  const problems = problemsFor({
    'work/items/W-7-nofm.md': 'text only\n',
    'work/items/W-8-bad.md': itemText({
      id: 'W-8',
      title: 'Bad',
      kind: 'work',
      state: 'Wip',
      project: 'W-2',
      priority: 'huge',
      created: '13-11-2026',
      foo: 'bar',
      onStatusChange: 'rm -rf /',
      needs: 'W-3',
    }),
    'work/items/W-9-x.md': itemText({
      id: 'W-10',
      title: 'Mismatch',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
    }),
    'work/items/W-11-Bad_Slug.md': itemText({
      id: 'W-11',
      title: 'Slug',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
    }),
    'work/items/W-12-folder.md': itemText({
      id: 'W-12',
      title: 'F',
      kind: 'project',
      state: 'planned',
      initiative: 'W-1',
      owner: 'owner',
    }),
    'work/items/W-13-dropped.md': itemText({
      id: 'W-13',
      title: 'D',
      kind: 'work',
      state: 'dropped',
      project: 'W-2',
    }),
    'work/items/W-14-reason.md': itemText({
      id: 'W-14',
      title: 'R',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
      reason: 'x',
      claimed_by: 'me',
    }),
    'work/items/W-15-wip.md': itemText({
      id: 'W-15',
      title: 'W',
      kind: 'work',
      state: 'in-progress',
      project: 'W-2',
    }),
    'work/items/W-16-dec.md': itemText({
      id: 'W-16',
      title: 'D',
      kind: 'decision',
      state: 'planned',
      project: 'W-2',
    }),
    'work/items/W-17-ext.md': itemText({
      id: 'W-17',
      title: 'E',
      kind: 'external',
      state: 'planned',
      project: 'W-4',
      milestone: 'gamma',
      needs: ['W-2', 'W-99', 'W-17'],
    }),
    'work/items/W-18-a.md': itemText({
      id: 'W-18',
      title: 'A',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
      needs: ['W-19'],
    }),
    'work/items/W-19-b.md': itemText({
      id: 'W-19',
      title: 'B',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
      needs: ['W-18'],
    }),
    'work/items/W-18-again.md': itemText({
      id: 'W-18',
      title: 'A2',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
    }),
    'work/projects/W-20-p.md': itemText({
      id: 'W-20',
      title: 'P',
      kind: 'project',
      state: 'planned',
      plan: 'docs/missing.md',
      initiative: 'W-1',
      decision: 'W-3',
    }),
  });
  const expected = [
    'work/items/W-7-nofm.md: no frontmatter',
    'work/items/W-8-bad.md: "onStatusChange" is a key some tools run as code; never allowed',
    'work/items/W-8-bad.md: "foo" isn\'t an allowed key for a work',
    'work/items/W-8-bad.md: "needs" must be a list',
    'work/items/W-8-bad.md: state "Wip" isn\'t one of proposed, planned, in-progress, done, dropped',
    'work/items/W-8-bad.md: "priority" is retired: order is derived (design part 2.4, Q30); run hitld work migrate',
    'work/items/W-8-bad.md: created "13-11-2026" isn\'t YYYY-MM-DD',
    "work/items/W-9-x.md: file name doesn't start with its id W-10",
    "work/items/W-11-Bad_Slug.md: file name isn't W-<n>-<slug>.md (lower-case slug)",
    'work/items/W-12-folder.md: a project belongs in projects/, not items/',
    'work/items/W-13-dropped.md: dropped needs a reason',
    'work/items/W-14-reason.md: a reason is only for dropped',
    'work/items/W-14-reason.md: claimed_by, but planned',
    'work/items/W-15-wip.md: in-progress needs claimed_by (who has it)',
    'work/items/W-16-dec.md: a decision needs a decider',
    'work/items/W-17-ext.md: an external item needs waiting_on (who we wait on)',
    'work/projects/W-20-p.md: "initiative" is retired: initiatives are milestones now: a long outcome is a milestone with no parent (design part 3.2); run hitld work migrate',
  ];
  for (const e of expected) assert.ok(problems.includes(e), `missing: ${e}`);
  for (const e of [
    'W-18: in both work/items/W-18-a.md and work/items/W-18-again.md',
    'work/items/W-17-ext.md: project W-4 is a work, not a project',
    'work/items/W-17-ext.md: needs W-2, a project; needs name items and milestones only',
    'work/items/W-17-ext.md: "milestone" is retired: milestones are their own files now (design part 3.2); run hitld work migrate',
    "work/items/W-17-ext.md: needs W-99, which doesn't exist",
    'work/items/W-17-ext.md: needs itself',
    "work/projects/W-20-p.md: plan docs/missing.md doesn't exist",
    'work/projects/W-20-p.md: decision W-3 is a work, not a decision',
    'cycle: W-18 → W-19 → W-18',
  ]) {
    assert.ok(problems.includes(e), `missing: ${e}\n${problems.join('\n')}`);
  }
  assert.ok(problems.some((p) => p.includes('W-8-bad.md: needs W-3')) === false);
});

test('the check refuses a code-running key through the entity schema too', () => {
  const problems = problemsFor({
    'work/items/W-7-x.md': itemText({
      id: 'W-7',
      title: 'X',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
      script: 'x',
    }),
  });
  assert.ok(problems.some((p) => p.includes('"script" is a key some tools run as code')));
});

test('optional keys are allowed only when tracker.json turns them on, and are typed', () => {
  const files = {
    'work/items/W-7-sized.md': itemText({
      id: 'W-7',
      title: 'Sized',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
      estimate_tokens: '180000',
      touches: ['src/a/**', 'test/a*'],
      area: 'cache',
    }),
  };
  assert.ok(
    problemsFor(files).some((p) =>
      p.includes('"estimate_tokens" isn\'t an allowed key for a work'),
    ),
  );
  assert.deepEqual(
    problemsFor(files, { optional_keys: ['estimate_tokens', 'touches', 'area'] }),
    [],
  );
  const bad = {
    'work/items/W-7-sized.md': itemText({
      id: 'W-7',
      title: 'Sized',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
      estimate_tokens: 'lots',
      area: 'Not Lower',
    }),
  };
  const problems = problemsFor(bad, { optional_keys: ['estimate_tokens', 'area'] });
  assert.ok(
    problems.some((p) => /schema: estimate_tokens must be integer/.test(p)),
    problems.join('\n'),
  );
  assert.ok(problems.some((p) => /; area /.test(p)));
});

test('a decision carries its answer keys, typed by the decision schema; a work item does not', () => {
  const answered = {
    id: 'W-7',
    title: 'Which license?',
    kind: 'decision',
    state: 'done',
    project: 'W-2',
    decider: 'owner',
    answer: '"A. MIT: the usual one"',
    rationale: 'Simple.',
    answered_at: '2026-11-14T10:00:00Z',
    answered_via: 'main-session',
    answered_by: 'owner',
    precedent: 'P-1',
  };
  assert.deepEqual(problemsFor({ 'work/items/W-7-which-license.md': itemText(answered) }), []);
  const { answered_by: _, precedent: __, ...rest } = answered;
  const resolved = { ...rest, answered_via: 'precedent', resolved_by_precedent: 'P-2' };
  assert.deepEqual(problemsFor({ 'work/items/W-7-which-license.md': itemText(resolved) }), []);
  const bad = problemsFor({
    'work/items/W-7-which-license.md': itemText({
      ...answered,
      answered_at: 'yesterday',
      answered_by: 'someone',
      precedent: 'W-3',
    }),
  });
  for (const key of ['answered_at', 'answered_by', 'precedent']) {
    assert.ok(
      bad.some((p) => new RegExp(`(schema: |; )${key} `).test(p)),
      `${key}: ${bad.join('\n')}`,
    );
  }
  const work = problemsFor({
    'work/items/W-7-sized.md': itemText({
      id: 'W-7',
      title: 'Sized',
      kind: 'work',
      state: 'done',
      project: 'W-2',
      answer: 'yes',
    }),
  });
  assert.ok(work.some((p) => p.includes(`"answer" isn't an allowed key for a work`)));
});

test('front matter: a value of several lines is written on one line and reads back', () => {
  const data = { id: 'W-1', kind: 'decision', answer: `Neither: 'wait',\nthen "ask" again` };
  const text = renderItem(data, ['id', 'kind', 'answer']);
  assert.equal(text.split('\n').filter((l) => l.startsWith('answer: ')).length, 1);
  const back = parseItem(text);
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.data, data);
});

test('nothing above the repository’s classification ceiling', () => {
  const files = {
    'work/items/W-7-secretive.md': itemText({
      id: 'W-7',
      title: 'S',
      kind: 'work',
      state: 'planned',
      project: 'W-2',
      classification: 'confidential',
    }),
  };
  const problems = problemsFor(files, { optional_keys: ['classification'] });
  assert.deepEqual(problems, [
    'work/items/W-7-secretive.md: classification "confidential" in its front matter is above the repository\'s ceiling "public"',
  ]);
});

test('no work item is in-progress on the main branch, and nothing but a work item is ever in-progress', () => {
  const files = {
    'work/items/W-7-claimed.md': itemText({
      id: 'W-7',
      title: 'C',
      kind: 'work',
      state: 'in-progress',
      project: 'W-2',
      claimed_by: 'D-1',
    }),
    'work/items/W-8-asked.md': itemText({
      id: 'W-8',
      title: 'E',
      kind: 'external',
      state: 'in-progress',
      project: 'W-2',
      waiting_on: 'them',
    }),
  };
  const root = makeRepo({ files, commit: false });
  const layout = layoutOf(root);
  const items = loadWorkTree(root, layout);
  assert.deepEqual(checkItems(items, layout, { root }), [
    'work/items/W-8-asked.md: a external is never in-progress: only work items are claimed',
  ]);
  const onMain = checkItems(items, layout, { root, onMain: true });
  assert.equal(onMain.length, 2);
  assert.match(
    onMain[0],
    /W-7-claimed\.md: in-progress on main; a claim belongs on the executor's branch/,
  );
});

test('paths and key are settings: a tracker elsewhere, under another key, needs no conversion', () => {
  const root = makeRepo({ commit: false });
  const text = itemText({
    id: 'ZZ-7',
    title: 'Elsewhere',
    kind: 'work',
    state: 'planned',
    project: 'ZZ-2',
  });
  put(root, {
    'packages/x/tasks/goals/ZZ-1-goal.md': itemText({
      id: 'ZZ-1',
      title: 'G',
      kind: 'milestone',
      state: 'planned',
      owner: 'owner',
    }),
    'packages/x/tasks/deliverables/ZZ-2-p.md': itemText({
      id: 'ZZ-2',
      title: 'P',
      kind: 'project',
      state: 'planned',
      owner: 'owner',
    }),
    'packages/x/tasks/all/ZZ-7-elsewhere.md': text,
  });
  const dir = mkdtempSync(join(tmpdir(), 'hitld-cfg-'));
  writeFileSync(
    join(dir, 'tracker.json'),
    JSON.stringify({
      schema_version: 1,
      work_dir: 'packages/x/tasks',
      folders: { milestone: 'goals', project: 'deliverables', item: 'all' },
    }),
  );
  const { config } = loadTrackerConfig({ repoRoot: root, configDir: dir });
  const layout = resolveLayout(/** @type {any} */ (config), policyFor([], { key: 'ZZ' }));
  const items = loadWorkTree(root, layout);
  assert.equal(items.length, 3);
  assert.deepEqual(checkItems(items, layout, { root }), []);
});

// --- Views ------------------------------------------------------------------------------

test('views: ready, blocked, decisions and projects over the fixture', () => {
  const root = makeRepo({ commit: false });
  const layout = layoutOf(root);
  const g = buildGraph(loadWorkTree(root, layout));
  assert.equal(
    viewReady(g),
    'W-2 The project\n  W-4  Second step\n  W-6  decision: Which way?\n\n2 ready\n',
  );
  assert.equal(
    viewBlocked(g),
    'W-2 The project\n  W-5  Third step\n      ← W-4 Second step\n        W-6 Which way?\n\n1 blocked\n',
  );
  assert.equal(
    viewDecisions(g),
    'W-2 The project\n  W-6  Which way? (owner)\n      waited on by W-5\n\n1 open decision(s) for owner\n',
  );
  assert.equal(viewDecisions(g, 'someone-else'), '\n0 open decision(s) for someone-else\n');
  assert.equal(
    viewProjects(g),
    'W-2 The project [Planned], led by owner\n  1 of 4 done, 2 ready, 1 blocked\n  waits on: nothing open\n  waited on by: nothing open\n',
  );
});

test('views: the lists carry milestones, links and each status', () => {
  const root = makeRepo({
    commit: false,
    files: {
      'work/milestones/W-7-alpha.md': itemText({
        id: 'W-7',
        title: 'Alpha',
        kind: 'milestone',
        state: 'planned',
        project: 'W-2',
        constraints: ['W-4 c?'],
      }),
    },
  });
  const g = buildGraph(loadWorkTree(root, layoutOf(root)));
  const lists = renderLists(g, { linkBase: './' });
  assert.match(
    lists,
    /^### The project\n\n\[W-2\]\(\.\/projects\/W-2-the-project\.md\), Planned, led by owner: 1 of 4 done/,
  );
  assert.match(
    lists,
    /Milestone: Alpha \(\[W-7\]\(\.\/milestones\/W-7-alpha\.md\), Planned\)\n\n- \[ \] \[W-4\]\(\.\/items\/W-4-second-step\.md\) Second step\. Needs W-3\./,
  );
  assert.match(lists, /No milestone\n\n- \[x\] \[W-3\].* First step\. Done\./);
  assert.match(lists, /decision: Which way\?\. Needs nothing\. Decided by owner\./);
});

test('views: the critical path is the longest open chain, weighted by estimate_tokens when present', () => {
  const root = makeRepo({
    commit: false,
    files: {
      'work/items/W-4-second-step.md': itemText({
        id: 'W-4',
        title: 'Second step',
        kind: 'work',
        state: 'planned',
        project: 'W-2',
        needs: ['W-3'],
        estimate_tokens: '500',
      }),
    },
  });
  const layout = layoutOf(root, { optional_keys: ['estimate_tokens'] });
  const g = buildGraph(loadWorkTree(root, layout));
  const [top] = criticalPaths(g);
  assert.deepEqual(
    top.chain.map((n) => n.data.id),
    ['W-4', 'W-5'],
  );
  assert.equal(top.weight, 501);
});

test('the tracker schema validates its own defaults and rejects what it should', () => {
  const s = schemas();
  assert.deepEqual(s.validateEntity('tracker', { schema_version: 1 }), []);
  assert.equal(s.validateEntity('tracker', { schema_version: 1, backend: 'linear' }).length, 1);
});
