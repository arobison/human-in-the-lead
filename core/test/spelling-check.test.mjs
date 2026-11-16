// The spelling check: tracked text files hold no British spelling (core/lib/spelling/). This file
// plants British forms on purpose, so it is on the check's allowlist.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED,
  MARKER,
  checkSpelling,
  checkText,
  formatSpellingReport,
} from '../lib/spelling/check.mjs';
import { americanOf, americanize } from '../lib/spelling/words.mjs';
import { tempDir } from './helpers/tmp.mjs';

const CHECKOUT = fileURLToPath(new URL('../../', import.meta.url));
const BIN = join(CHECKOUT, 'core/bin/spelling-check.mjs');

/** @param {(dir: string) => void} body */
function inTemp(body) {
  const dir = tempDir('hitld-spelling-test-');
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** @param {string} dir @param {Record<string, string | Buffer>} files */
function put(dir, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

test('each British form on the list is found, with its American form', () => {
  /** @type {Record<string, string>} */
  const pairs = {
    enrol: 'enroll',
    enrols: 'enrolls',
    enrolment: 'enrollment',
    unenrol: 'unenroll',
    judgement: 'judgment',
    judgements: 'judgments',
    licence: 'license',
    licences: 'licenses',
    licenced: 'licensed',
    behaviour: 'behavior',
    behavioural: 'behavioral',
    labelled: 'labeled',
    labelling: 'labeling',
    labour: 'labor',
    defence: 'defense',
    cancelled: 'canceled',
    travelled: 'traveled',
    travelling: 'traveling',
    modelled: 'modeled',
    modelling: 'modeling',
    programme: 'program',
    honour: 'honor',
    honoured: 'honored',
    favour: 'favor',
    favourite: 'favorite',
    colour: 'color',
    neighbouring: 'neighboring',
    flavoured: 'flavored',
    normalise: 'normalize',
    normalisation: 'normalization',
    recognise: 'recognize',
    organise: 'organize',
    optimise: 'optimize',
    summarised: 'summarized',
    prioritising: 'prioritizing',
    analyse: 'analyze',
    analysed: 'analyzed',
    analysing: 'analyzing',
    whilst: 'while',
    artefact: 'artifact',
  };
  for (const [british, american] of Object.entries(pairs)) {
    assert.equal(americanOf(british), american, british);
    assert.deepEqual(
      checkText(`See the ${british} note.`, 'a.md', { allowed: [] }).map((f) => [
        f.word,
        f.american,
      ]),
      [[british, american]],
      british,
    );
  }
});

test('American spellings and words that only look British are left alone', () => {
  const fine =
    'enroll enrolled enrolling enrollment unenrolled judgment license licensed licensing behavior labeled ' +
    'canceled cancellation traveled modeled program honor favor color normalize recognize analyze analyses ' +
    'otherwise promise raise rise surprise noise revise precise exercise praise advertise compromise ' +
    'sources hours yourself resource journal bisection';
  assert.deepEqual(checkText(fine, 'a.md', { allowed: [] }), []);
});

test('an identifier is checked word by word: camelCase, snake_case, kebab-case and a path', () => {
  const found = (/** @type {string} */ text) =>
    checkText(text, 'a.mjs', { allowed: [] }).map((f) => f.word);
  assert.deepEqual(found('const judgementWeight = 1;'), ['judgement']);
  assert.deepEqual(found('needs_judgement: true'), ['judgement']);
  assert.deepEqual(found('NEEDS_JUDGEMENT'), ['JUDGEMENT']);
  assert.deepEqual(found('rights/judgement-never-settles-a-call'), []); // a protected name
  assert.deepEqual(found('rights/judgement-raises-the-estimate'), ['judgement']);
  assert.deepEqual(found('core/lib/judgement/judgement.mjs'), ['judgement', 'judgement']);
  assert.deepEqual(found('#judgement'), ['judgement']);
  assert.deepEqual(found('assertEnrolled(OrganiseTheFiles)'), ['Organise']);
});

test('a finding has its file, line, word and the American form; the report says what to do', () => {
  const findings = checkText('fine\nthe Behaviour of it\nand a labelled box', 'docs/x.md', {
    allowed: [],
  });
  assert.deepEqual(findings, [
    { file: 'docs/x.md', line: 2, word: 'Behaviour', american: 'behavior' },
    { file: 'docs/x.md', line: 3, word: 'labelled', american: 'labeled' },
  ]);
  const report = formatSpellingReport({ checked: 1, findings });
  assert.match(report, /docs\/x\.md:2: "Behaviour" is British; write "behavior"/);
  assert.match(report, /2 British spellings in 1 files/);
  assert.match(formatSpellingReport({ checked: 3, findings: [] }), /3 files, no British spellings/);
});

test('americanize rewrites a text and keeps each word in its case', () => {
  assert.equal(
    americanize('Enrol it. The judgementWeight of NEEDS_JUDGEMENT, otherwise licenced.'),
    'Enroll it. The judgmentWeight of NEEDS_JUDGMENT, otherwise licensed.',
  );
});

test('a line with the marker is left alone, and only that line', () => {
  const text = `a matcher input: enrol it // ${MARKER}\nand another: enrol it`;
  assert.deepEqual(
    checkText(text, 'a.mjs', { allowed: [] }).map((f) => f.line),
    [2],
  );
});

test('an allowlist entry covers a file, a folder, or only the lines that contain a text', () => {
  const text = 'a judgement\nrights/judgement-raises-the-estimate';
  const lines = (
    /** @type {string} */ file,
    /** @type {import('../lib/spelling/check.mjs').Allowed[]} */ allowed,
  ) => checkText(text, file, { allowed }).map((f) => f.line);
  assert.deepEqual(lines('x/a.json', []), [1, 2]);
  assert.deepEqual(lines('x/a.json', [{ path: 'x/a.json', reason: 'r' }]), []);
  assert.deepEqual(lines('x/y/a.json', [{ path: 'x/', reason: 'r' }]), []);
  assert.deepEqual(lines('xx/a.json', [{ path: 'x/', reason: 'r' }]), [1, 2]);
  assert.deepEqual(
    lines('x/a.json', [{ path: 'x/a.json', contains: 'raises-the', reason: 'r' }]),
    [1],
  );
});

test('every allowlist entry says why', () => {
  for (const entry of ALLOWED) {
    assert.ok(entry.reason.length > 10, entry.path);
    assert.ok(entry.path.length > 0);
  }
});

test('checkSpelling reads the named files, and skips the generated copy and binary files', () => {
  inTemp((dir) => {
    put(dir, {
      'docs/a.md': 'A clean line.\nA judgement.\n',
      'plugins/human-in-the-lead/docs/a.md': 'A judgement.\n',
      'img.bin': Buffer.from([0, 1, 2, 106, 117, 100, 103, 101, 109, 101, 110, 116]),
    });
    const report = checkSpelling(dir, {
      files: ['docs/a.md', 'plugins/human-in-the-lead/docs/a.md', 'img.bin', 'gone.md'],
      allowed: [],
    });
    assert.equal(report.checked, 1);
    assert.deepEqual(
      report.findings.map((f) => `${f.file}:${f.line}:${f.word}`),
      ['docs/a.md:2:judgement'],
    );
  });
});

test('the command fails on a planted British spelling in a tracked file, and passes without it', () => {
  inTemp((dir) => {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    put(dir, { 'README.md': 'Plain words.\n', 'src/a.mjs': '// The behaviour of it.\n' });
    execFileSync('git', ['add', '-A'], { cwd: dir });

    const bad = spawnSync('node', [BIN, '--repo', dir], { encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /src\/a\.mjs:1: "behaviour" is British; write "behavior"/);

    put(dir, { 'src/a.mjs': '// The behavior of it.\n' });
    const good = spawnSync('node', [BIN, '--repo', dir], { encoding: 'utf8' });
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /no British spellings/);

    put(dir, { 'src/a.mjs': `// The behaviour of it. ${MARKER}\n` });
    assert.equal(spawnSync('node', [BIN, '--repo', dir], { encoding: 'utf8' }).status, 0);
  });
});

test('the command reports a directory that is not a repository as a bad call', () => {
  inTemp((dir) => {
    const r = spawnSync('node', [BIN, '--repo', dir], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /spelling-check:/);
  });
});
