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
  viewInitiatives,
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
    status: 'Planned',
    title: 'Has: a colon, and a "quote"',
    id: 'W-1',
    kind: 'work',
    needs: ['W-2'],
    project: 'W-9',
  };
  const text = renderItem(data, keyOrder('work', /** @type {any} */ (layout)), '\n## Done when\n');
  assert.match(
    text,
    /^---\nid: W-1\ntitle: .*\nkind: work\nstatus: Planned\nproject: W-9\nneeds: \[W-2\]\n---\n/,
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
  assert.equal(config?.main_branch, 'main');
  assert.deepEqual(config?.bundle_refs, ['refs/bundles/']);
  assert.deepEqual(config?.optional_keys, []);
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
      status: 'Wip',
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
      status: 'Planned',
      project: 'W-2',
    }),
    'work/items/W-11-Bad_Slug.md': itemText({
      id: 'W-11',
      title: 'Slug',
      kind: 'work',
      status: 'Planned',
      project: 'W-2',
    }),
    'work/items/W-12-folder.md': itemText({
      id: 'W-12',
      title: 'F',
      kind: 'project',
      status: 'Planned',
      initiative: 'W-1',
      lead: 'owner',
    }),
    'work/items/W-13-dropped.md': itemText({
      id: 'W-13',
      title: 'D',
      kind: 'work',
      status: 'Dropped',
      project: 'W-2',
    }),
    'work/items/W-14-reason.md': itemText({
      id: 'W-14',
      title: 'R',
      kind: 'work',
      status: 'Planned',
      project: 'W-2',
      reason: 'x',
      claimed: 'me',
    }),
    'work/items/W-15-wip.md': itemText({
      id: 'W-15',
      title: 'W',
      kind: 'work',
      status: 'In progress',
      project: 'W-2',
    }),
    'work/items/W-16-dec.md': itemText({
      id: 'W-16',
      title: 'D',
      kind: 'decision',
      status: 'Planned',
      project: 'W-2',
    }),
    'work/items/W-17-ext.md': itemText({
      id: 'W-17',
      title: 'E',
      kind: 'external',
      status: 'Planned',
      project: 'W-4',
      milestone: 'gamma',
      needs: ['W-1', 'W-99', 'W-17'],
    }),
    'work/items/W-18-a.md': itemText({
      id: 'W-18',
      title: 'A',
      kind: 'work',
      status: 'Planned',
      project: 'W-2',
      needs: ['W-19'],
    }),
    'work/items/W-19-b.md': itemText({
      id: 'W-19',
      title: 'B',
      kind: 'work',
      status: 'Planned',
      project: 'W-2',
      needs: ['W-18'],
    }),
    'work/items/W-18-again.md': itemText({
      id: 'W-18',
      title: 'A2',
      kind: 'work',
      status: 'Planned',
      project: 'W-2',
    }),
    'work/projects/W-20-p.md': itemText({
      id: 'W-20',
      title: 'P',
      kind: 'project',
      status: 'Planned',
      plan: 'docs/missing.md',
    }),
  });
  const expected = [
    'work/items/W-7-nofm.md: no frontmatter',
    'work/items/W-8-bad.md: "onStatusChange" is a key some tools run as code; never allowed',
    'work/items/W-8-bad.md: "foo" isn\'t an allowed key for a work',
    'work/items/W-8-bad.md: "needs" must be a list',
    'work/items/W-8-bad.md: status "Wip" isn\'t one of Proposed, Planned, In progress, Done, Dropped',
    'work/items/W-8-bad.md: "priority" is retired: order is derived (design part 2.4, Q30); run hitld work migrate',
    'work/items/W-8-bad.md: created "13-11-2026" isn\'t YYYY-MM-DD',
    "work/items/W-9-x.md: file name doesn't start with its id W-10",
    "work/items/W-11-Bad_Slug.md: file name isn't W-<n>-<slug>.md (lower-case slug)",
    'work/items/W-12-folder.md: a project belongs in projects/, not items/',
    'work/items/W-13-dropped.md: Dropped needs a reason',
    'work/items/W-14-reason.md: a reason is only for Dropped',
    'work/items/W-14-reason.md: claimed, but Planned',
    'work/items/W-15-wip.md: In progress needs claimed (who has it)',
    'work/items/W-16-dec.md: a decision needs decided-by',
    'work/items/W-17-ext.md: an external item needs party (who we wait on)',
    'work/projects/W-20-p.md: a project needs a lead',
    'work/projects/W-20-p.md: a project needs an initiative',
  ];
  for (const e of expected) assert.ok(problems.includes(e), `missing: ${e}`);
  for (const e of [
    'W-18: in both work/items/W-18-a.md and work/items/W-18-again.md',
    'work/items/W-17-ext.md: project W-4 is a work, not a project',
    'work/items/W-17-ext.md: needs W-1, a initiative; needs name items and milestones only',
    'work/items/W-17-ext.md: "milestone" is retired: milestones are their own files now (design part 3.2); run hitld work migrate',
    "work/items/W-17-ext.md: needs W-99, which doesn't exist",
    'work/items/W-17-ext.md: needs itself',
    "work/projects/W-20-p.md: plan docs/missing.md doesn't exist",
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
      status: 'Planned',
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
      status: 'Planned',
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
      status: 'Planned',
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

test('nothing above the repository’s classification ceiling', () => {
  const files = {
    'work/items/W-7-secretive.md': itemText({
      id: 'W-7',
      title: 'S',
      kind: 'work',
      status: 'Planned',
      project: 'W-2',
      classification: 'confidential',
    }),
  };
  const problems = problemsFor(files, { optional_keys: ['classification'] });
  assert.deepEqual(problems, [
    'work/items/W-7-secretive.md: classification "confidential" in its front matter is above the repository\'s ceiling "public"',
  ]);
});

test('no work item is In progress on the main branch, but containers and external items may be', () => {
  const files = {
    'work/items/W-7-claimed.md': itemText({
      id: 'W-7',
      title: 'C',
      kind: 'work',
      status: 'In progress',
      project: 'W-2',
      claimed: 'D-1',
    }),
    'work/items/W-8-asked.md': itemText({
      id: 'W-8',
      title: 'E',
      kind: 'external',
      status: 'In progress',
      project: 'W-2',
      party: 'them',
    }),
  };
  const root = makeRepo({ files, commit: false });
  const layout = layoutOf(root);
  const items = loadWorkTree(root, layout);
  assert.deepEqual(checkItems(items, layout, { root }), []);
  const onMain = checkItems(items, layout, { root, onMain: true });
  assert.equal(onMain.length, 1);
  assert.match(
    onMain[0],
    /W-7-claimed\.md: In progress on main; a claim belongs on the executor's branch/,
  );
});

test('paths and key are settings: a tracker elsewhere, under another key, needs no conversion', () => {
  const root = makeRepo({ commit: false });
  const text = itemText({
    id: 'ZZ-7',
    title: 'Elsewhere',
    kind: 'work',
    status: 'Planned',
    project: 'ZZ-2',
  });
  put(root, {
    'packages/x/tasks/groups/ZZ-1-goal.md': itemText({
      id: 'ZZ-1',
      title: 'G',
      kind: 'initiative',
      status: 'Planned',
      lead: 'owner',
    }),
    'packages/x/tasks/deliverables/ZZ-2-p.md': itemText({
      id: 'ZZ-2',
      title: 'P',
      kind: 'project',
      status: 'Planned',
      initiative: 'ZZ-1',
      lead: 'owner',
    }),
    'packages/x/tasks/all/ZZ-7-elsewhere.md': text,
  });
  const dir = mkdtempSync(join(tmpdir(), 'hitld-cfg-'));
  writeFileSync(
    join(dir, 'tracker.json'),
    JSON.stringify({
      schema_version: 1,
      work_dir: 'packages/x/tasks',
      folders: { initiative: 'groups', project: 'deliverables', item: 'all' },
    }),
  );
  const { config } = loadTrackerConfig({ repoRoot: root, configDir: dir });
  const layout = resolveLayout(/** @type {any} */ (config), policyFor([], { key: 'ZZ' }));
  const items = loadWorkTree(root, layout);
  assert.equal(items.length, 3);
  assert.deepEqual(checkItems(items, layout, { root }), []);
});

// --- Views ------------------------------------------------------------------------------

test('views: ready, blocked, decisions, projects and initiatives over the fixture', () => {
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
  assert.equal(
    viewInitiatives(g),
    'W-1 The goal [Planned]\n  W-2 The project: 1 of 4 done, 2 ready, 1 blocked\n  all: 1 of 4 done, 2 ready, 1 blocked\n  open decisions: 1; waiting outside: 0\n',
  );
});

test('views: the lists carry milestones, links and each status', () => {
  const root = makeRepo({
    commit: false,
    files: {
      'work/milestones/W-7-alpha.md': itemText({
        id: 'W-7',
        title: 'Alpha',
        kind: 'capability',
        status: 'Planned',
        project: 'W-2',
        needs: ['W-4 c?'],
      }),
    },
  });
  const g = buildGraph(loadWorkTree(root, layoutOf(root)));
  const lists = renderLists(g, { linkBase: './' });
  assert.match(
    lists,
    /^### The goal\n\n\[W-1\]\(\.\/initiatives\/W-1-goal\.md\), Planned: 1 of 4 done/,
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
        status: 'Planned',
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
