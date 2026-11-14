// Synthetic repositories and a fixture scanner for the security gate's scenarios and tests (design
// parts 10.5 and 17.2). Public, generated, nothing from a real project.
//
// The fixture scanner stands in for any tool that writes SARIF: it reports each line under src/
// that calls UNSAFE( as a finding of rule fixture/unsafe-call. It is written outside the
// repository under test, so a branch cannot change it.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitAll, fixtureGit, putFiles } from './orchestrator-fixtures.mjs';

const SCANNER = `import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const version = process.argv[2] ?? '1.0.0';
const results = [];
const walk = (dir) => {
  let names = [];
  try { names = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of names.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(dir, d.name);
    if (d.isDirectory()) walk(p);
    else if (d.name.endsWith('.js')) {
      readFileSync(p, 'utf8').split('\\n').forEach((line, i) => {
        if (line.includes('UNSAFE(')) {
          results.push({
            ruleId: 'fixture/unsafe-call',
            level: 'error',
            message: { text: 'A call of UNSAFE at line ' + (i + 1) },
            locations: [{ physicalLocation: { artifactLocation: { uri: p.split('\\\\').join('/') }, region: { startLine: i + 1 } } }],
          });
        }
      });
    }
  }
};
walk('src');
const sarif = JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'fixture-scanner', version } }, results }] });
if (process.env.HITLD_SARIF) writeFileSync(process.env.HITLD_SARIF, sarif);
else process.stdout.write(sarif);
process.exit(results.length ? 1 : 0);
`;

/**
 * Write the fixture scanner to a path outside the repository and return its policy entry.
 * @param {string} path @param {{ version?: string }} [options]
 * @returns {{ name: string, command: string }}
 */
export function writeFixtureScanner(path, options = {}) {
  writeFileSync(path, SCANNER);
  return {
    name: 'fixture',
    command: `"${process.execPath}" "${path}" ${options.version ?? '1.0.0'}`,
  };
}

/**
 * A repository on main with the given files and a passing suite, and branches each changing some
 * files, made from main or from another branch.
 * @param {string} root an absent or empty directory
 * @param {{ main: Record<string, string>, branches: { branch: string, item: string, from?: string, files: Record<string, string> }[] }} spec
 */
export function buildSecurityRepo(root, spec) {
  fixtureGit(process.cwd(), 'init', '-q', '-b', 'main', root);
  fixtureGit(root, 'config', 'user.name', 'Fixture');
  fixtureGit(root, 'config', 'user.email', 'fixture@example.invalid');
  fixtureGit(root, 'config', 'commit.gpgsign', 'false');
  putFiles(root, {
    'package.json': '{ "type": "module" }\n',
    'test/ok.test.js': "import { test } from 'node:test';\ntest('ok', () => {});\n",
    ...spec.main,
  });
  commitAll(root, 'main');
  for (const b of spec.branches) {
    fixtureGit(root, 'switch', '-q', '-c', b.branch, b.from ?? 'main');
    putFiles(root, b.files);
    commitAll(root, b.branch);
    fixtureGit(root, 'switch', '-q', 'main');
  }
  return { root, entries: spec.branches.map((b) => ({ item: b.item, branch: b.branch })) };
}

/** The merge settings the fixture is built for. */
export const SECURITY_MERGE_SETTINGS = Object.freeze({
  mainBranch: 'main',
  batchMax: 4,
  fastChecks: [],
  fullSuite: ["node --test 'test/*.test.js'"],
  generated: [],
  flakeReruns: 0,
});

/** @param {string} sandbox */
export const securityPaths = (sandbox) => ({
  repo: join(sandbox, 'security-repo'),
  store: join(sandbox, 'security-store'),
  scanner: join(sandbox, 'fixture-scanner.mjs'),
});
