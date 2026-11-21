// CI: which tests a run skipped and why, and whether each skip is expected on this platform
// (HITLD-185). It reads the lines core/test/helpers/skips-reporter.mjs wrote, checks each against
// core/test/expected-skips.json, writes the list to the job summary, and exits 1 when a skip is
// not expected here, or when the file of skips is missing (the run did not report).
//
//   node scripts/test-skips.mjs <skips.jsonl>

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const EXPECTED_SKIPS = join(ROOT, 'core', 'test', 'expected-skips.json');

/**
 * @typedef {{ file: string, name: string, reason: string }} Skip
 * @typedef {{ platforms: string[], reason: string, why: string, files: string[] }} Expected
 */

/** @param {string} text @returns {Skip[]} */
export function parseSkips(text) {
  return text
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/**
 * The entry that expects this skip on this platform, or null.
 * @param {Skip} skip @param {Expected[]} expected @param {string} platform
 */
export function expectedFor(skip, expected, platform) {
  return (
    expected.find(
      (e) =>
        e.platforms.includes(platform) &&
        e.files.includes(skip.file) &&
        skip.reason !== '' &&
        skip.reason.includes(e.reason),
    ) ?? null
  );
}

/**
 * @param {Skip[]} skips @param {Expected[]} expected @param {string} platform
 * @returns {{ expected: (Skip & { why: string })[], unexpected: Skip[] }}
 */
export function checkSkips(skips, expected, platform) {
  /** @type {(Skip & { why: string })[]} */
  const ok = [];
  /** @type {Skip[]} */
  const unexpected = [];
  for (const skip of skips) {
    const entry = expectedFor(skip, expected, platform);
    if (entry) ok.push({ ...skip, why: entry.why });
    else unexpected.push(skip);
  }
  return { expected: ok, unexpected };
}

/**
 * Text as one Markdown table cell: a backslash first, so the escapes added after it stay escapes,
 * then the pipe that would end the cell and the backtick that would open code; line breaks become
 * spaces.
 * @param {string} text
 */
export const cell = (text) =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/[|`]/g, '\\$&')
    .replace(/\r?\n|\r/g, ' ');

/**
 * The job summary, in Markdown.
 * @param {ReturnType<typeof checkSkips>} result @param {string} platform
 */
export function skipsSummary(result, platform) {
  const total = result.expected.length + result.unexpected.length;
  if (total === 0) return `### Skipped tests\n\nNo test skipped on ${platform}.\n`;
  const rows = [
    ...result.unexpected.map(
      (s) =>
        `| not expected | ${cell(s.file)} | ${cell(s.name)} | ${cell(s.reason || '(no reason given)')} |`,
    ),
    ...result.expected.map(
      (s) => `| expected | ${cell(s.file)} | ${cell(s.name)} | ${cell(s.reason)} |`,
    ),
  ];
  const verdict = result.unexpected.length
    ? `${result.unexpected.length} of them ${result.unexpected.length === 1 ? 'is' : 'are'} not expected on ${platform}: make the test run here, or add the skip to core/test/expected-skips.json with its reason.`
    : `Each is expected on ${platform} (core/test/expected-skips.json).`;
  return [
    '### Skipped tests',
    '',
    `${total} test(s) skipped. ${verdict}`,
    '',
    '| | File | Test | Reason |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

/** @param {string | undefined} file @param {NodeJS.ProcessEnv} env */
function main(file, env) {
  if (!file) throw new Error('usage: node scripts/test-skips.mjs <skips.jsonl>');
  if (!existsSync(file)) {
    throw new Error(`${file} does not exist: the test run did not report its skips`);
  }
  const { expected } = JSON.parse(readFileSync(EXPECTED_SKIPS, 'utf8'));
  const result = checkSkips(parseSkips(readFileSync(file, 'utf8')), expected, process.platform);
  const text = skipsSummary(result, process.platform);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  process.stdout.write(text);
  return result.unexpected.length ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    process.exit(main(process.argv[2], process.env));
  } catch (e) {
    process.stderr.write(`test-skips: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}
