import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderBlock, findBlock, compareBlock, installBlock } from '../lib/contract/block.mjs';
import { checkContract } from '../lib/contract/check.mjs';
import { parseReport } from '../lib/contract/report.mjs';
import { VERSION } from '../lib/version.mjs';
import { main } from '../lib/cli/main.mjs';
import { tempDir } from './helpers/tmp.mjs';

const tmp = realpathSync(tempDir('hitld-contract-'));
const dir = () => mkdtempSync(join(tmp, 'p-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

test('the template is short, carries every rule the contract names, and no code-running key', () => {
  const block = renderBlock();
  assert.ok(block.split('\n').length <= 40, 'every agent loads it: keep it short');
  for (const must of [
    'first commit',
    'another machine',
    '`state: in-progress`',
    '`claimed_by: <your dispatch ID>`',
    '`state: done`',
    '`result`',
    '`bench_runs: none`',
    '`calls`',
    '(reversible)',
    'decision item',
    'benchmark tool',
    'Never add keys that run code',
    'Work-Item:',
    'Never call a failure flaky without a rerun',
  ]) {
    assert.ok(block.includes(must), must);
  }
  assert.ok(!block.includes('{{'));
  assert.deepEqual(findBlock(block).state, 'found');
  assert.equal(/** @type {any} */ (findBlock(block)).version, VERSION);
});

test('install creates the file, appends after the project text, and never touches text outside the markers', () => {
  const d = dir();
  assert.equal(installBlock(d).action, 'created');
  const own = '# Mine\n\nBuild with npm.\n';
  const e = dir();
  writeFileSync(join(e, 'AGENTS.md'), own);
  assert.equal(installBlock(e).action, 'added');
  const added = readFileSync(join(e, 'AGENTS.md'), 'utf8');
  assert.ok(added.startsWith(own + '\n<!-- hitld:contract begin'));
  // Update in place: text before and after survives, an old version is replaced.
  const old = renderBlock('0.0.0-old');
  writeFileSync(join(e, 'AGENTS.md'), `${own}\n${old}\n## After\nkeep me\n`);
  assert.equal(compareBlock(readFileSync(join(e, 'AGENTS.md'), 'utf8')).status, 'outdated');
  assert.equal(installBlock(e).action, 'updated');
  const updated = readFileSync(join(e, 'AGENTS.md'), 'utf8');
  assert.ok(updated.startsWith(own + '\n'));
  assert.ok(updated.endsWith('\n## After\nkeep me\n'));
  assert.equal(compareBlock(updated).status, 'current');
  assert.equal(installBlock(e).action, 'unchanged');
});

test('install refuses broken markers and changes nothing', () => {
  const d = dir();
  const broken = `x\n${renderBlock()}${renderBlock()}`;
  writeFileSync(join(d, 'AGENTS.md'), broken);
  const r = installBlock(d);
  assert.equal(r.ok, false);
  assert.equal(readFileSync(join(d, 'AGENTS.md'), 'utf8'), broken);
  assert.equal(compareBlock(broken).status, 'malformed');
  writeFileSync(join(d, 'AGENTS.md'), '<!-- hitld:contract begin v1 -->\nno end\n');
  assert.equal(checkContract(d).block, 'malformed');
});

test('check reports missing, outdated, modified (with the lines) and current', () => {
  const d = dir();
  assert.equal(checkContract(d).block, 'missing');
  assert.equal(checkContract(d).ok, false);
  installBlock(d);
  assert.deepEqual(checkContract(d).errors, []);
  const text = readFileSync(join(d, 'AGENTS.md'), 'utf8');
  writeFileSync(join(d, 'AGENTS.md'), text.replace('Scope.', 'Scope (loosened).'));
  const mod = checkContract(d);
  assert.equal(mod.block, 'modified');
  assert.ok(mod.drift?.some((l) => l.includes('loosened')));
  assert.ok(mod.drift?.some((l) => l.startsWith('missing:')));
  // A version drift is named with both versions.
  const out = checkContract(d, '9.9.9');
  assert.equal(out.block, 'outdated');
  assert.equal(out.found_version, VERSION);
  assert.equal(out.expected_version, '9.9.9');
});

test('check requires CLAUDE.md, when there is one, to import AGENTS.md', () => {
  const d = dir();
  installBlock(d);
  assert.equal(checkContract(d).claude_md, 'absent');
  writeFileSync(join(d, 'CLAUDE.md'), '# c\n');
  const bad = checkContract(d);
  assert.equal(bad.ok, false);
  assert.equal(bad.claude_md, 'missing-import');
  writeFileSync(join(d, 'CLAUDE.md'), '# c\n@AGENTS.md\n');
  assert.equal(checkContract(d).ok, true);
});

test('hitld check contract runs through the command line', async () => {
  const d = dir();
  installBlock(d);
  /** @type {string[]} */
  const out = [];
  const code = await main(['check', 'contract'], {
    cwd: d,
    env: process.env,
    out: (/** @type {string} */ s) => out.push(s),
    err: () => {},
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out.join('')).block, 'current');
});

const GOOD = `item: W-214
result: done | partial | blocked
commit: 3f9c2a1 (branch hitld/W-214-response-cache)
evidence:
  - npm test -- test/cache/http.test.ts: 14 passed
  - property test cache-key-stability: 1000 cases, 0 failures
bench_runs: R-1251 (first frame -27% vs R-1203)
deviations: touched src/cache/client.ts (one call site; key type changed)
calls:
  - kept the old cache directory name for compatibility (reversible)
questions: none
`.replace('done | partial | blocked', 'done');

test('parseReport reads the design example', () => {
  const { report, errors } = parseReport(GOOD);
  assert.deepEqual(errors, []);
  assert.equal(report?.result, 'done');
  assert.deepEqual(report?.commit, {
    sha: '3f9c2a1',
    branch: 'hitld/W-214-response-cache',
  });
  assert.equal(report?.evidence.length, 2);
  assert.deepEqual(report?.calls, [
    { text: 'kept the old cache directory name for compatibility', reversible: true },
  ]);
  assert.deepEqual(report?.questions, []);
  // One surrounding fence is tolerated.
  assert.deepEqual(parseReport('```\n' + GOOD + '```').errors, []);
});

test('parseReport refuses departures from the shape, each named', () => {
  const bad = (/** @type {string} */ text, /** @type {RegExp} */ re) => {
    const r = parseReport(text);
    assert.equal(r.report, null, text);
    assert.ok(
      r.errors.some((e) => re.test(e)),
      `${re} in ${JSON.stringify(r.errors)}`,
    );
  };
  bad(GOOD.replace('result: done', 'result: finished'), /result/);
  bad(GOOD.replace('result: done', 'result: done | partial | blocked'), /result/);
  bad(GOOD.replace(/^calls:\n.*\n/m, ''), /calls is missing/);
  bad(GOOD.replace('(reversible)', ''), /not marked \(reversible\)/);
  bad(GOOD.replace('item: W-214', 'item: 214'), /item/);
  bad('Here is my report:\n' + GOOD, /unexpected line/);
  bad(GOOD + 'result: partial\n', /result appears twice/);
  bad(
    GOOD.replace('commit: 3f9c2a1 (branch hitld/W-214-response-cache)', 'commit: soon'),
    /commit/,
  );
  bad('', /is missing/);
});

test('a report in the names before HITLD-82 (status, runs) parses, with a warning', () => {
  const old = GOOD.replace('result: done', 'status: done').replace('bench_runs:', 'runs:');
  const { report, errors, warnings } = parseReport(old);
  assert.deepEqual(errors, []);
  assert.equal(report?.result, 'done');
  assert.deepEqual(report?.bench_runs, ['R-1251 (first frame -27% vs R-1203)']);
  assert.deepEqual(warnings, [
    'status is now result: update the contract block (hitld install)',
    'runs is now bench_runs: update the contract block (hitld install)',
  ]);
  assert.deepEqual(parseReport(GOOD).warnings, []);
});

test('a blocked report may have no commit, and calls: none is an empty list', () => {
  const text = GOOD.replace('result: done', 'result: blocked')
    .replace(/commit: .*/, 'commit: none')
    .replace(/calls:\n.*\n/, 'calls: none\n')
    .replace('questions: none', 'questions:\n  - W-412: which key type?');
  const { report, errors } = parseReport(text);
  assert.deepEqual(errors, []);
  assert.equal(report?.commit, null);
  assert.deepEqual(report?.calls, []);
  assert.deepEqual(report?.questions, ['W-412: which key type?']);
});

test("the block's example uses the project's key, and the check compares against that key", () => {
  assert.match(renderBlock(VERSION, 'APP'), /^item: APP-214$/m);
  assert.match(renderBlock(), /^item: W-214$/m);
  assert.match(renderBlock(VERSION, 'bad key; rm'), /^item: W-214$/m, 'an invalid key falls back');
  assert.match(renderBlock(), /`Agent-Model:`/);
  const d = dir();
  installBlock(d, VERSION, 'APP');
  const text = readFileSync(join(d, 'AGENTS.md'), 'utf8');
  assert.equal(compareBlock(text, VERSION, 'APP').status, 'current');
  assert.equal(compareBlock(text, VERSION, 'W').status, 'modified');
});
