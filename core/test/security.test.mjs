import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePolicy } from '../lib/policy/policy.mjs';
import { schemas } from '../lib/schema/registry.mjs';
import { openStore } from '../lib/store/store.mjs';
import { fingerprintRuns, readSarif, relativePath } from '../lib/security/sarif.mjs';
import { runScanner } from '../lib/security/scan.mjs';
import {
  SECURITY_KEYS,
  acceptRisk,
  classify,
  expiredRiskQuestion,
  extendBaseline,
  readRecords,
  recordPending,
  recordVerdict,
  removeFixed,
  saveBaseline,
} from '../lib/security/records.mjs';
import { runMergeQueue } from '../lib/merge/queue.mjs';
import { securityGate } from '../lib/merge/security.mjs';
import {
  SECURITY_MERGE_SETTINGS,
  buildSecurityRepo,
  writeFixtureScanner,
} from '../lib/eval/security-fixtures.mjs';
import { STATUS_INPUT, git, item, makeConsumer, put, report } from './orchestrator-fixture.mjs';
import { recordStatusLine } from '../harness/claude-code/statusline.mjs';

const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'hitld-sec-')));

/** @param {{ uri: string, line: number, rule?: string }[]} results @param {string} [version] */
const sarif = (results, version = '1.0.0') =>
  JSON.stringify({
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'tool', version, rules: [{ id: 'r-indexed' }] } },
        results: results.map((r) => ({
          ...(r.rule ? { ruleId: r.rule } : { ruleIndex: 0 }),
          message: { text: `found at ${r.line}` },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: r.uri },
                region: { startLine: r.line },
              },
            },
          ],
        })),
      },
    ],
  });

// --- SARIF and fingerprints -------------------------------------------------------------------

test('sarif: reads the tool, version, rule (by id or index), location and message; refuses non-SARIF', () => {
  const runs = readSarif(
    sarif([
      { uri: 'src/a.js', line: 3, rule: 'r1' },
      { uri: 'b.js', line: 1 },
    ]),
  );
  assert.equal(runs[0].tool, 'tool');
  assert.equal(runs[0].version, '1.0.0');
  assert.deepEqual(
    runs[0].results.map((r) => [r.rule, r.path, r.startLine]),
    [
      ['r1', 'src/a.js', 3],
      ['r-indexed', 'b.js', 1],
    ],
  );
  assert.throws(() => readSarif('not json'), /not JSON/);
  assert.throws(() => readSarif('{"version":"2.1.0"}'), /no "runs"/);
  assert.throws(() => readSarif('{"runs":[{"tool":{"driver":{}}}]}'), /no tool.driver.name/);
});

test('sarif: a passing result is skipped; a suppressed one is still a finding', () => {
  const doc = JSON.parse(sarif([{ uri: 'a.js', line: 1, rule: 'r' }]));
  doc.runs[0].results.push({ ruleId: 'p', kind: 'pass', message: { text: 'ok' } });
  doc.runs[0].results[0].suppressions = [{ kind: 'inSource' }];
  assert.deepEqual(
    readSarif(JSON.stringify(doc))[0].results.map((r) => r.rule),
    ['r'],
  );
});

test('sarif: a location outside the scanned directory is not read', () => {
  const root = tmp();
  assert.equal(relativePath(root, 'src/a.js'), 'src/a.js');
  assert.equal(relativePath(root, `file://${join(root, 'src', 'a.js')}`), 'src/a.js');
  assert.equal(relativePath(root, '../outside.js'), null);
  assert.equal(relativePath(root, 'https://example.com/a.js'), null);
});

test('fingerprint: survives a line move and re-indentation, changes with the code at that place', () => {
  const root = tmp();
  const code = 'const a = 1;\nconst b = run(a);\nexport { b };\n';
  writeFileSync(join(root, 'a.js'), code);
  const [before] = fingerprintRuns(readSarif(sarif([{ uri: 'a.js', line: 2, rule: 'r' }])), root);
  writeFileSync(
    join(root, 'a.js'),
    `// one\n// two\n// three\n// four\n${code.replace('const b', '   const  b')}`,
  );
  const [moved] = fingerprintRuns(readSarif(sarif([{ uri: 'a.js', line: 6, rule: 'r' }])), root);
  assert.equal(moved.key, before.key);
  assert.equal(moved.fingerprint_from, 'code');
  writeFileSync(join(root, 'a.js'), code.replace('run(a)', 'run(a + 1)'));
  const [changed] = fingerprintRuns(readSarif(sarif([{ uri: 'a.js', line: 2, rule: 'r' }])), root);
  assert.notEqual(changed.key, before.key);
});

test('fingerprint: the same code twice in a file gets two keys; another rule another key', () => {
  const root = tmp();
  writeFileSync(join(root, 'a.js'), 'x();\n\n\n\n\n\n\nx();\n');
  const fs = fingerprintRuns(
    readSarif(
      sarif([
        { uri: 'a.js', line: 1, rule: 'r' },
        { uri: 'a.js', line: 8, rule: 'r' },
        { uri: 'a.js', line: 1, rule: 's' },
      ]),
    ),
    root,
  );
  assert.equal(new Set(fs.map((f) => f.key)).size, 3);
});

test('fingerprint: a link out of the scanned directory is not followed', () => {
  const root = tmp();
  const outside = tmp();
  writeFileSync(join(outside, 'secret.js'), 'secret\n');
  symlinkSync(join(outside, 'secret.js'), join(root, 'link.js'));
  const [f] = fingerprintRuns(readSarif(sarif([{ uri: 'link.js', line: 1, rule: 'r' }])), root);
  assert.equal(f.fingerprint_from, 'message');
});

// --- Records ------------------------------------------------------------------------------------

/** @param {string} key @param {string} [tool] @param {string} [version] */
const finding = (key, tool = 'tool', version = '1.0.0') => ({
  key,
  tool,
  version,
  rule: 'r',
  path: 'a.js',
  line: 1,
  fingerprint: `${key}abcd`,
  fingerprint_from: /** @type {const} */ ('code'),
  message: 'm',
  level: 'error',
});
const T1 = { tool: 'tool', version: '1.0.0' };
/** An answered decision, W-9, in a stand-in tracker. */
const ANSWERED = {
  decision: 'W-9',
  tracker: {
    get: () => ({
      id: 'W-9',
      kind: 'decision',
      state: 'done',
      answer: 'B',
      answered_at: '2030-01-01T00:00:00Z',
      answered_by: 'owner',
    }),
  },
};

test('records: the first scan makes the baseline; a new tool version extends it; nothing else adds', () => {
  const store = openStore(tmp());
  const r = readRecords(store);
  assert.equal(r.baseline, null);
  const first = extendBaseline(r, { tools: [T1], findings: [finding('aaaaaaaaaaaa')] });
  assert.equal(first.created, true);
  assert.equal(first.added, 1);
  const again = extendBaseline(r, { tools: [T1], findings: [finding('bbbbbbbbbbbb')] });
  assert.equal(again.added, 0, 'a known tool version adds nothing');
  const v2 = extendBaseline(r, {
    tools: [{ tool: 'tool', version: '2.0.0' }],
    findings: [finding('cccccccccccc', 'tool', '2.0.0')],
  });
  assert.equal(v2.added, 1);
  saveBaseline(store, r);
  const back = readRecords(store);
  assert.deepEqual(
    back.baseline?.map((e) => e.key),
    ['aaaaaaaaaaaa', 'cccccccccccc'],
  );
  const raw = JSON.parse(String(store.read(SECURITY_KEYS.baseline)));
  assert.equal(raw.classification, 'confidential');
  assert.deepEqual(schemas().validateEntity('security-records', raw), []);
});

test('records: a merged fix removes its finding from the baseline', () => {
  const r = readRecords(openStore(tmp()));
  extendBaseline(r, { tools: [T1], findings: [finding('aaaaaaaaaaaa'), finding('bbbbbbbbbbbb')] });
  assert.deepEqual(removeFixed(r, { tools: [T1], findings: [finding('bbbbbbbbbbbb')] }), [
    'aaaaaaaaaaaa',
  ]);
  assert.deepEqual(
    removeFixed(r, { tools: [{ tool: 'tool', version: '9' }], findings: [] }),
    [],
    'an unknown tool version removes nothing',
  );
});

test('records: classify lets through baseline, by-design, false-positive and accepted; not real', () => {
  const store = openStore(tmp());
  const r = readRecords(store);
  extendBaseline(r, { tools: [T1], findings: [finding('000000000000')] });
  saveBaseline(store, r);
  const pending = ['111111111111', '222222222222', '333333333333', '444444444444', '555555555555'];
  recordPending(
    store,
    pending.map((k) => finding(k)),
    { item: 'W-1', branch: 'b' },
  );
  recordVerdict(store, {
    key: '111111111111',
    verdict: 'by-design',
    reason: 'boundary at the sink',
  });
  recordVerdict(store, { key: '222222222222', verdict: 'false-positive', reason: 'not reachable' });
  recordVerdict(store, { key: '333333333333', verdict: 'real', reason: 'fixed, test t1' });
  const now = new Date('2030-01-01T00:00:00Z');
  acceptRisk(store, {
    key: '444444444444',
    expires: '2030-02-01',
    reason: 'planned',
    ...ANSWERED,
    now: () => now,
  });
  const all = ['000000000000', ...pending].map((k) => finding(k));
  const c = classify(all, readRecords(store), now);
  assert.deepEqual(
    c.new.map((f) => [f.key, f.recorded_real ?? false]),
    [
      ['333333333333', true],
      ['555555555555', false],
    ],
  );
  assert.equal(c.expired.length, 0);
  const later = classify(all, readRecords(store), new Date('2030-02-02T00:00:00Z'));
  assert.deepEqual(
    later.expired.map((e) => e.key),
    ['444444444444'],
  );
  assert.equal(later.new.length, 2, 'an expired risk is a decision, and does not block');
  assert.deepEqual(
    readRecords(store).pending.map((e) => e.key),
    ['555555555555'],
  );
  const q = expiredRiskQuestion(later.expired[0]);
  assert.deepEqual(schemas().validate('question', q), []);
  assert.equal(q.classification, 'confidential');
});

test('records: a verdict needs a known finding and its evidence; an accepted risk a future expiry', () => {
  const store = openStore(tmp());
  recordPending(store, [finding('abcdefabcdef')]);
  assert.throws(
    () => recordVerdict(store, { key: 'ffffffffffff', verdict: 'false-positive', reason: 'x' }),
    /no finding/,
  );
  assert.throws(
    () => recordVerdict(store, { key: 'abcdefabcdef', verdict: 'false-positive', reason: ' ' }),
    /evidence/,
  );
  assert.throws(
    () => recordVerdict(store, { key: 'abcdefabcdef', verdict: 'wontfix', reason: 'x' }),
    /must be one of/,
  );
  const now = () => new Date('2030-01-01T00:00:00Z');
  const base = { key: 'abcdefabcdef', reason: 'x', now, ...ANSWERED };
  assert.throws(() => acceptRisk(store, { ...base, expires: '2029-12-31' }), /future/);
  assert.throws(() => acceptRisk(store, { ...base, expires: 'soon' }), /YYYY-MM-DD/);
  const a = acceptRisk(store, { ...base, expires: '2030-06-01' });
  assert.equal(a.by, 'owner');
  assert.equal(a.decision, 'W-9');
});

test('records: accepting a risk needs an answered decision item, read through the tracker', () => {
  const store = openStore(tmp());
  recordPending(store, [finding('abcdefabcdef')]);
  const now = () => new Date('2030-01-01T00:00:00Z');
  /** @param {Record<string, unknown> | null} entity */
  const tracker = (entity) => ({
    /** @param {string} id */
    get: (id) => {
      if (!entity || id !== entity.id) throw new Error(`${id} is not in the tracker`);
      return entity;
    },
  });
  const base = { key: 'abcdefabcdef', expires: '2030-06-01', reason: 'x', decision: 'W-9', now };
  const AT = '2029-12-31T09:00:00Z';
  for (const [entity, why] of /** @type {[Record<string, unknown> | null, RegExp][]} */ ([
    [null, /not in the tracker/],
    [{ id: 'W-9', kind: 'work', state: 'done' }, /not a decision/],
    [{ id: 'W-9', kind: 'decision', state: 'planned' }, /not answered/],
    [{ id: 'W-9', kind: 'decision', state: 'dropped' }, /not answered/],
    [{ id: 'W-9', kind: 'decision', state: 'done', answer: '' }, /not answered/],
    // Done by hand, with no answer recorded: not an answered decision.
    [{ id: 'W-9', kind: 'decision', state: 'done' }, /not answered/],
    [{ id: 'W-9', kind: 'decision', state: 'done', answer: 'A' }, /not answered/],
    [
      { id: 'W-9', kind: 'decision', state: 'planned', answer: 'A', answered_at: AT },
      /not answered/,
    ],
    [
      {
        id: 'W-9',
        kind: 'decision',
        state: 'done',
        answer: 'A',
        answered_at: AT,
        answered_via: 'precedent',
        resolved_by_precedent: 'P-1',
      },
      /resolved by a precedent/,
    ],
    [
      {
        id: 'W-9',
        kind: 'decision',
        state: 'done',
        answer: 'A',
        answered_at: AT,
        answered_by: 'C-3',
      },
      /answered by C-3/,
    ],
  ])) {
    assert.throws(() => acceptRisk(store, { ...base, tracker: tracker(entity) }), why);
  }
  assert.throws(
    () => acceptRisk(store, { ...base, decision: 'soon', tracker: tracker(null) }),
    /cites the decision item/,
  );
  assert.equal(readRecords(store).accepted.length, 0);
});

test('records: a damaged file stops everything, rather than being read as empty', () => {
  const store = openStore(tmp());
  store.write(SECURITY_KEYS.baseline, '{ "schema_version": 1, "kind": "baseline" }');
  assert.throws(() => readRecords(store), /baseline\.json/);
  store.write(SECURITY_KEYS.baseline, '{');
  assert.throws(() => readRecords(store), /not valid JSON/);
});

// --- Policy and the scanner ---------------------------------------------------------------------

test('policy: merge.scanners has a documented default and is the only new setting that runs code', () => {
  const minimal = { schema_version: 1, project: { id: 'p', key: 'W' } };
  assert.deepEqual(resolvePolicy(minimal).policy?.merge.scanners, []);
  const merge = schemas().get('policy/merge');
  assert.ok(merge.properties.scanners.description);
  assert.ok(merge.properties.scanners.items.properties.command['x-hitld-executes']);
  assert.equal(merge.properties.scanners.items.properties.name['x-hitld-executes'], undefined);
  const ok = resolvePolicy({ ...minimal, merge: { scanners: [{ name: 's', command: 'x' }] } });
  assert.deepEqual(ok.errors, []);
  const bad = resolvePolicy({
    ...minimal,
    merge: { scanners: [{ name: 's', command: 'x', format: 'csv' }] },
  });
  assert.ok(bad.errors.some((e) => e.path === 'merge.scanners[0].format'));
});

test('scanner: SARIF from $HITLD_SARIF or standard output; no SARIF is a failure; exit status ignored', () => {
  const root = tmp();
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.js'), 'UNSAFE(1);\n');
  const s = writeFixtureScanner(join(tmp(), 'scanner.mjs'));
  const r = runScanner(s, root);
  assert.ok(r.ok);
  assert.equal(r.findings.length, 1, 'the fixture scanner exits 1 when it finds something');
  assert.deepEqual(r.tools, [{ tool: 'fixture-scanner', version: '1.0.0' }]);
  const stdout = runScanner({ name: 'out', command: `printf '%s' '${sarif([])}'` }, root);
  assert.ok(stdout.ok);
  const none = runScanner({ name: 'none', command: 'echo hello' }, root);
  assert.equal(none.ok, false);
  assert.match(none.ok ? '' : none.output, /wrote no SARIF/);
});

test("scanner: $HITLD_PRIMARY_ROOT is the caller's primary checkout, never inherited", () => {
  const root = tmp();
  const print = {
    name: 'print',
    command: `printf '%s' '${sarif([])}'; printf '%s' "\${HITLD_PRIMARY_ROOT-unset}" > "${join(root, 'seen')}"`,
  };
  const saved = process.env.HITLD_PRIMARY_ROOT;
  process.env.HITLD_PRIMARY_ROOT = '/somewhere/else';
  try {
    assert.ok(runScanner(print, root).ok);
    assert.equal(readFileSync(join(root, 'seen'), 'utf8'), 'unset');
    assert.ok(runScanner(print, root, { primaryRoot: '/the/primary' }).ok);
    assert.equal(readFileSync(join(root, 'seen'), 'utf8'), '/the/primary');
  } finally {
    if (saved === undefined) delete process.env.HITLD_PRIMARY_ROOT;
    else process.env.HITLD_PRIMARY_ROOT = saved;
  }
});

test('gate: a scanner script kept in the repository runs from the primary checkout, so a branch editing its copy changes nothing', async () => {
  const base = tmp();
  writeFixtureScanner(join(base, 'honest.mjs'));
  const honest = readFileSync(join(base, 'honest.mjs'), 'utf8');
  // The branch's copy reports nothing, whatever the code holds.
  const quiet = `import { writeFileSync } from 'node:fs';
writeFileSync(process.env.HITLD_SARIF, JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'fixture-scanner', version: '1.0.0' } }, results: [] }] }));
`;
  const { root } = buildSecurityRepo(join(base, 'repo'), {
    main: { 'scripts/scan.mjs': honest, 'src/app.js': 'export const ok = 1;\n' },
    branches: [
      {
        branch: 'hitld/W-1-quiet',
        item: 'W-1',
        files: { 'scripts/scan.mjs': quiet, 'src/new.js': 'UNSAFE(input);\n' },
      },
    ],
  });
  /** @param {string} command @param {string} storeDir */
  const merge = async (command, storeDir) =>
    runMergeQueue({
      repoRoot: root,
      entries: [{ item: 'W-1', branch: 'hitld/W-1-quiet' }],
      settings: { ...SECURITY_MERGE_SETTINGS, generated: [] },
      security: securityGate({
        store: openStore(join(base, storeDir)),
        scanners: [{ name: 'repo-script', command }],
        primaryRoot: root,
      }),
    });
  const before = git(root, 'rev-parse', 'main');
  // As this repository declares CodeQL: the primary checkout's copy runs on the branch's code.
  const primary = await merge(
    `"${process.execPath}" "\${HITLD_PRIMARY_ROOT:?unset}/scripts/scan.mjs"`,
    'store-primary',
  );
  assert.deepEqual(primary.merged, []);
  assert.equal(primary.rejected[0].reason, 'security');
  assert.deepEqual(
    primary.rejected[0].findings?.map((x) => [x.path, x.line]),
    [['src/new.js', 1]],
  );
  assert.equal(git(root, 'rev-parse', 'main'), before);
  // A relative path would run the branch's own copy, which hides the finding: why the variable.
  const relative = await merge(`"${process.execPath}" scripts/scan.mjs`, 'store-relative');
  assert.deepEqual(
    relative.merged.map((m) => m.item),
    ['W-1'],
  );
});

// --- The gate in the merge queue ----------------------------------------------------------------

/** @param {string} base */
function gateFixture(base) {
  const scanner = writeFixtureScanner(join(base, 'scanner.mjs'));
  const store = openStore(join(base, 'store'));
  const { root } = buildSecurityRepo(join(base, 'repo'), {
    main: { 'src/app.js': 'export const run = (x) => UNSAFE(x);\n' },
    branches: [
      {
        branch: 'hitld/W-1-clean',
        item: 'W-1',
        files: { 'src/two.js': 'export const two = 2;\n' },
      },
      { branch: 'hitld/W-2-adds', item: 'W-2', files: { 'src/new.js': 'UNSAFE(input);\n' } },
      {
        branch: 'hitld/W-3-fixes',
        item: 'W-3',
        files: { 'src/app.js': 'export const run = (x) => x;\n' },
      },
    ],
  });
  /** @param {string[]} items */
  const merge = async (...items) => {
    const gate = securityGate({ store, scanners: [scanner] });
    const r = await runMergeQueue({
      repoRoot: root,
      entries: items.map((i) => ({
        item: i,
        branch:
          { 'W-1': 'hitld/W-1-clean', 'W-2': 'hitld/W-2-adds', 'W-3': 'hitld/W-3-fixes' }[i] ?? '',
      })),
      settings: { ...SECURITY_MERGE_SETTINGS, generated: [] },
      security: gate,
    });
    return { r, summary: /** @type {Record<string, any>} */ (gate.summary()) };
  };
  return { store, root, merge };
}

test('gate: the first scan makes the baseline from main and a clean branch merges', async () => {
  const f = gateFixture(tmp());
  const { r, summary } = await f.merge('W-1');
  assert.deepEqual(
    r.merged.map((m) => m.item),
    ['W-1'],
  );
  assert.equal(summary.baseline.created, true);
  assert.equal(summary.baseline.size, 1);
  const baseline = readRecords(f.store);
  assert.equal(baseline.baseline?.[0].path, 'src/app.js');
});

test('gate: a new finding sends the branch back with it, and is kept for a verdict', async () => {
  const f = gateFixture(tmp());
  const { r } = await f.merge('W-2');
  assert.deepEqual(r.merged, []);
  assert.equal(r.rejected[0].reason, 'security');
  assert.deepEqual(
    r.rejected[0].findings?.map((x) => [x.path, x.line, x.rule]),
    [['src/new.js', 1, 'fixture/unsafe-call']],
  );
  const pending = readRecords(f.store).pending;
  assert.deepEqual(
    pending.map((e) => [e.item, e.branch]),
    [['W-2', 'hitld/W-2-adds']],
  );
});

test('gate: a merged fix removes its finding from the baseline', async () => {
  const f = gateFixture(tmp());
  await f.merge('W-1');
  assert.equal(readRecords(f.store).baseline?.length, 1);
  const { r, summary } = await f.merge('W-3');
  assert.deepEqual(
    r.merged.map((m) => m.item),
    ['W-3'],
  );
  assert.equal(summary.fixed.length, 1);
  assert.equal(readRecords(f.store).baseline?.length, 0);
});

test('gate: a scanner that writes no SARIF sends the branch back; nothing merges', async () => {
  const base = tmp();
  const f = gateFixture(base);
  const gate = securityGate({
    store: f.store,
    scanners: [{ name: 'broken', command: 'echo not sarif' }],
  });
  const before = git(f.root, 'rev-parse', 'main');
  const r = await runMergeQueue({
    repoRoot: f.root,
    entries: [{ item: 'W-1', branch: 'hitld/W-1-clean' }],
    settings: { ...SECURITY_MERGE_SETTINGS, generated: [] },
    security: gate,
  });
  assert.equal(r.rejected[0].reason, 'security');
  assert.match(String(r.rejected[0].output), /wrote no SARIF/);
  assert.equal(git(f.root, 'rev-parse', 'main'), before);
});

// --- The commands and the guard -----------------------------------------------------------------

test('commands: the merge scans with the primary checkout policy, never the branch; executors are refused', async () => {
  const base = tmp();
  const scanner = writeFixtureScanner(join(base, 'scanner.mjs'));
  const decisionItem = (/** @type {string} */ id, /** @type {Record<string, string>} */ more) =>
    item(
      { id, title: 'Accept a security finding as a risk', kind: 'decision', ...more },
      '\n## Question\n\nAccept the finding as a risk, or fix it now?\n',
    );
  const c = makeConsumer({
    files: {
      'work/items/W-4-accept-a-risk.md': decisionItem('W-4', { state: 'planned' }),
      // Set Done by hand, with no answer recorded: not the owner's answered decision.
      'work/items/W-5-accept-a-risk.md': decisionItem('W-5', {
        state: 'done',
      }),
      'work/initiatives/W-6-keep-it-safe.md': item(
        { id: 'W-6', title: 'Keep it safe', kind: 'initiative', state: 'planned', owner: 'owner' },
        '\n## Goal\n\n',
      ),
      'work/projects/W-7-security-findings.md': item(
        {
          id: 'W-7',
          title: 'Security findings',
          kind: 'project',
          state: 'planned',
          initiative: 'W-6',
          owner: 'owner',
        },
        '\n## Summary\n\n',
      ),
    },
    policy: {
      merge: { mode: 'queue', full_suite: ["node --test 'test/*.test.js'"], scanners: [scanner] },
    },
  });
  recordStatusLine(STATUS_INPUT(c.root), { cwd: c.root, env: c.env });
  assert.equal((await c.hitld(['run', 'start'])).exit, 0);
  const start = await c.hitld(['dispatch', 'start', 'W-1']);
  assert.equal(start.exit, 0, JSON.stringify(start.result));
  await c.hitld(['dispatch', 'handle', '--dispatch', 'D-1', '--harness-ref', 'agent-1']);
  const branch = start.result.branch;
  git(c.root, 'switch', '-q', '-c', branch);
  put(c.root, {
    'work/items/W-1-add-numbers.md': item({
      id: 'W-1',
      title: 'Add numbers',
      kind: 'work',
      state: 'done',
      priority: 'medium',
      touches: ['src/calc.js'],
    }),
    'src/calc.js': 'export const add = (a, b) => UNSAFE(a + b);\n',
    // The branch tries to switch the scanners off: policy is read from the primary checkout.
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'orch-fixture', key: 'W' },
      merge: { mode: 'queue', full_suite: ['true'], scanners: [] },
    }),
  });
  git(c.root, 'add', '-A');
  git(c.root, 'commit', '-q', '-m', 'W-1');
  const sha = git(c.root, 'rev-parse', 'HEAD');
  git(c.root, 'switch', '-q', 'main');
  const note = join(c.base, 'note.txt');
  writeFileSync(note, report({ item: 'W-1', sha, branch }));
  await c.hitld(['dispatch', 'complete', '--dispatch', 'D-1', '--report-file', note]);

  const merged = await c.hitld(['merge']);
  assert.deepEqual(merged.result.merged, [], JSON.stringify(merged.result));
  const back = merged.result.rejected[0];
  assert.equal(back.reason, 'security');
  assert.match(back.follow_up.message, /fixture\/unsafe-call at src\/calc\.js:1/);
  assert.equal(merged.result.security.baseline.created, true);

  const status = await c.hitld(['security', 'status']);
  assert.equal(status.exit, 0, JSON.stringify(status.result));
  const key = status.result.pending[0].finding;
  assert.match(key, /^[0-9a-f]{12}$/);

  for (const env of [{ HITLD_ROLE: 'executor' }, { HITLD_DISPATCH: 'D-1' }]) {
    const accept = await c.hitld(
      [
        'security',
        'accept',
        '--finding',
        key,
        '--expires',
        '2999-01-01',
        '--reason',
        'x',
        '--decision',
        'W-1',
      ],
      { env: { ...c.env, ...env } },
    );
    assert.equal(accept.result.error, 'not_permitted');
    assert.match(accept.result.message, /owner's decision/);
    const verdict = await c.hitld(
      ['security', 'verdict', '--finding', key, '--verdict', 'false-positive', '--reason', 'x'],
      { env: { ...c.env, ...env } },
    );
    assert.equal(verdict.result.error, 'not_permitted');
    const baseline = await c.hitld(['security', 'baseline'], { env: { ...c.env, ...env } });
    assert.equal(baseline.result.error, 'not_permitted');
  }
  const verdict = await c.hitld([
    'security',
    'verdict',
    '--finding',
    key,
    '--verdict',
    'false-positive',
    '--reason',
    'UNSAFE is a stand-in in this fixture',
  ]);
  assert.equal(verdict.exit, 0, JSON.stringify(verdict.result));
  assert.equal(verdict.result.verdict.item, 'W-1');
  const again = await c.hitld(['security', 'baseline']);
  assert.equal(again.exit, 0, JSON.stringify(again.result));
  assert.equal(again.result.scanners[0].added, 0, 'the tool version is already in the baseline');

  // Accepting a risk cites a decision item the owner answered, read through the tracker.
  /** @param {string} decision */
  const accept = (decision) =>
    c.hitld([
      'security',
      'accept',
      '--finding',
      key,
      '--expires',
      '2999-01-01',
      '--reason',
      'the fix waits for the parser rewrite',
      '--decision',
      decision,
    ]);
  const missing = await accept('W-99');
  assert.equal(missing.result.error, 'decision');
  assert.match(missing.result.message, /W-99 is not in the tracker/);
  const work = await accept('W-2');
  assert.match(work.result.message, /W-2 is a work item, not a decision/);
  const open = await accept('W-4');
  assert.equal(open.result.error, 'decision');
  assert.match(open.result.message, /W-4 is planned and not answered/);
  const handClosed = await accept('W-5');
  assert.equal(handClosed.result.error, 'decision');
  assert.match(handClosed.result.message, /W-5 is done and not answered/);

  // The owner's decision, asked and answered through the command line into the files tracker.
  const question = {
    title: 'Accept the unsafe call as a risk?',
    question: 'Accept the unsafe call in src/calc.js as a risk until the parser rewrite?',
    context: 'The scanner flags UNSAFE in src/calc.js. The parser rewrite removes the call.',
    options: [
      { label: 'Accept it', what_happens: 'the finding merges until the expiry' },
      { label: 'Fix it now', what_happens: 'the branch goes back to the executor' },
    ],
    recommendation: { option: 'A', why: 'The rewrite removes the call anyway.' },
    triggers: [{ basis: 'security', reason: 'accepting a real finding as a risk' }],
    paths: ['src/calc.js'],
    classification: 'public',
    parent: 'W-7',
  };
  const asked = await c.hitld(['rights', 'ask', '--question', JSON.stringify(question)]);
  assert.equal(asked.exit, 0, JSON.stringify(asked.result));
  assert.equal(asked.result.outcome, 'asked');
  const decision = asked.result.decision;
  const early = await accept(decision);
  assert.match(early.result.message, new RegExp(`${decision} is planned and not answered`));
  const answered = await c.hitld(['rights', 'answer', decision, '--answer', 'A']);
  assert.equal(answered.exit, 0, JSON.stringify(answered.result));
  const shown = await c.hitld(['work', 'show', decision, '--json']);
  assert.equal(shown.result.entity.state, 'done');
  assert.equal(shown.result.entity.answered_by, 'owner');
  assert.equal(shown.result.entity.answered_via, 'main-session');
  const ok = await accept(decision);
  assert.equal(ok.exit, 0, JSON.stringify(ok.result));
  assert.equal(ok.result.accepted.decision, decision);
  assert.equal(ok.result.accepted.by, 'owner');
});

const GUARD = fileURLToPath(new URL('../harness/claude-code/hooks/guard.mjs', import.meta.url));
/** @param {string} command @param {boolean} [executor] */
const guard = (command, executor = true) =>
  spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({
      ...(executor ? { agent_type: 'human-in-the-lead:executor-tier2' } : {}),
      tool_name: 'Bash',
      tool_input: { command },
    }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  }).stdout;

test('guard: an executor is denied the security records and accepting a risk; the owner is not', () => {
  const accept = guard(
    'hitld security accept --finding abcdefabcdef --expires 2999-01-01 --reason x',
  );
  assert.match(accept, /"deny"/);
  assert.match(accept, /owner's decision/);
  for (const command of [
    'node core/bin/hitld.mjs "security" verdict --finding abcdefabcdef --verdict false-positive',
    'hitld security baseline',
    'hitld security status',
    'cat ~/.local/share/human-in-the-lead/p/security/verdicts.json',
    'echo {} > "$XDG_DATA_HOME/human-in-the-lead/p/security/baseline.json"',
    'rm ~/.local/share/human-in-the-lead/p/security/accepted-risks.json',
  ]) {
    assert.match(guard(command), /"deny"/, command);
  }
  assert.equal(guard('npm test'), '');
  assert.equal(
    guard('hitld security accept --finding abcdefabcdef --expires 2999-01-01', false),
    '',
  );
});
