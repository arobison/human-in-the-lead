// Releases (design parts 2.7, 3.2 and 16.5): versions, the interface surface and its delta, the
// proposed bump, release records, and `hitld release propose` and `make`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../lib/cli/main.mjs';
import { commands as releaseCommands } from '../lib/cli/commands/release.mjs';
import { diffSurface, emptySurface, proposeBump } from '../lib/release/delta.mjs';
import { contractShape, schemaFields, surfaceOf } from '../lib/release/surface.mjs';
import {
  bumpBetween,
  bumpVersion,
  compareVersions,
  isPrerelease,
  nextPrerelease,
} from '../lib/release/semver.mjs';
import { proposeRelease } from '../lib/release/propose.mjs';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import { commitAll, git, itemText, makeRepo, policyFor, put } from './tracker-fixture.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SURFACE_SOURCE = readFileSync(join(ROOT, 'core/lib/release/surface.mjs'), 'utf8');

const open = (/** @type {string} */ root, env = {}) =>
  openTracker({ repoRoot: root, policy: policyFor(), env });

/** @param {string[]} argv @param {string} cwd @param {NodeJS.ProcessEnv} [env] */
async function hitld(argv, cwd, env = {}) {
  let out = '';
  const code = await main(argv, { out: (t) => (out += t), err: () => {}, cwd, env });
  return { code, json: JSON.parse(out) };
}

/** A schema with the given properties. @param {Record<string, unknown>} properties */
const schema = (properties, required = ['id']) =>
  JSON.stringify({
    $id: 'thing',
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });

/**
 * A fixture repository with settings, a schema and its own copy of the surface reader, so a tag
 * of it can be read back.
 */
function releaseRepo() {
  const root = makeRepo({
    files: {
      '.human-in-the-lead/policy.json': JSON.stringify({
        schema_version: 1,
        project: { id: 'fixture', key: 'W' },
      }),
      'schemas/thing.schema.json': schema({ id: { type: 'string' }, name: { type: 'string' } }),
      'core/lib/release/surface.mjs': SURFACE_SOURCE,
      'package.json': '{ "version": "0.0.0" }\n',
    },
    commit: false,
  });
  chmodSync(join(root, '.human-in-the-lead', 'policy.json'), 0o644);
  commitAll(root, 'fixture');
  return root;
}

// --- Versions ------------------------------------------------------------------------------

test('versions order as semver does, pre-releases first', () => {
  const sorted = ['1.0.0', '0.1.0', '0.1.0-rc.10', '0.1.0-rc.2', '0.1.0-beta.1', '0.2.0'].sort(
    compareVersions,
  );
  assert.deepEqual(sorted, [
    '0.1.0-beta.1',
    '0.1.0-rc.2',
    '0.1.0-rc.10',
    '0.1.0',
    '0.2.0',
    '1.0.0',
  ]);
  assert.equal(bumpVersion('0.1.0', 'minor'), '0.2.0');
  assert.equal(bumpVersion('1.4.2', 'major'), '2.0.0');
  assert.equal(bumpVersion('0.0.0', 'minor'), '0.1.0');
  assert.equal(bumpBetween('0.1.0', '0.1.1'), 'patch');
  assert.equal(bumpBetween('0.0.0', '0.1.0-rc.1'), 'minor');
  assert.equal(bumpBetween('0.1.0', '0.1.0'), null);
  assert.equal(isPrerelease('0.1.0-rc.1'), true);
  assert.equal(
    nextPrerelease('0.1.0', 'rc', ['v0.1.0-rc.1', 'v0.1.0-rc.2', 'v0.0.9-rc.7']),
    '0.1.0-rc.3',
  );
  assert.equal(nextPrerelease('0.1.0', 'rc', []), '0.1.0-rc.1');
  assert.throws(() => nextPrerelease('0.1.0', 'RC1', []), /lower-case letters/);
});

// --- The surface and its delta --------------------------------------------------------------

test('the surface reads schemas, built commands, the report shape, trailers and the read API', async () => {
  const s = await surfaceOf(ROOT);
  assert.equal(s.read_api, 1);
  assert.deepEqual(s.report, [
    'item',
    'status',
    'commit',
    'evidence',
    'runs',
    'deviations',
    'calls',
    'questions',
  ]);
  assert.deepEqual(s.trailers, [
    'Work-Item',
    'Dispatch',
    'Agent-Role',
    'Agent-Model',
    'Agent-Effort',
  ]);
  assert.ok(s.schemas.milestone.fields['needs[].clause']);
  assert.ok(s.schemas.release.fields.interface_delta);
  assert.deepEqual(s.cli['release propose'].output?.includes('interface_delta'), true);
  assert.equal(s.cli['mcp'], undefined, 'a command not yet built is not surface');
  const c = contractShape('a\n```\nitem: x\nstatus: y\n```\nCommit trailers: `Work-Item:`.\n');
  assert.deepEqual([c.report, c.trailers], [['item', 'status'], ['Work-Item']]);
  const fields = schemaFields(JSON.parse(schema({ id: { type: 'string' } })));
  assert.deepEqual(fields, { id: { type: 'string', required: true } });
});

/** A surface with one schema and one command. @param {Partial<import('../lib/release/surface.mjs').Surface>} [over] */
function surface(over = {}) {
  return {
    ...emptySurface(),
    schemas: {
      item: {
        version: 1,
        fields: {
          id: { type: 'string', required: true },
          state: { type: 'enum', required: true, values: ['Planned', 'Done'] },
        },
      },
    },
    cli: {
      'work show': {
        args: { id: { type: 'string', required: true, positional: true } },
        aliases: [],
        output: ['api_version', 'entity', 'ok'],
      },
    },
    report: ['item', 'status'],
    trailers: ['Work-Item'],
    contract: 'aaa',
    read_api: 1,
    ...over,
  };
}

test('the delta marks each change breaking, additive or fix', () => {
  const base = surface();
  assert.deepEqual(diffSurface(base, surface()), []);
  const next = surface({
    schemas: {
      item: {
        version: 2,
        fields: {
          id: { type: 'integer', required: true },
          state: { type: 'enum', required: true, values: ['Planned', 'Dropped'] },
          note: { type: 'string', required: false },
        },
      },
      release: { version: 1, fields: {} },
    },
    cli: {
      'work show': {
        args: {
          id: { type: 'string', required: true, positional: true },
          json: { type: 'boolean', required: false, positional: false },
        },
        aliases: [],
        output: ['entity', 'ok'],
      },
    },
    report: ['item', 'status', 'runs'],
    trailers: [],
    contract: 'bbb',
    read_api: 2,
  });
  assert.deepEqual(diffSurface(base, next), [
    { impact: 'breaking', area: 'schemas', what: 'item: id type string → integer' },
    { impact: 'additive', area: 'schemas', what: 'item: note added' },
    { impact: 'breaking', area: 'schemas', what: 'item: state no longer allows Done' },
    { impact: 'additive', area: 'schemas', what: 'item: state allows Dropped' },
    { impact: 'additive', area: 'schemas', what: 'schema release added' },
    { impact: 'additive', area: 'cli', what: 'hitld work show --json added' },
    { impact: 'breaking', area: 'cli', what: 'hitld work show JSON: api_version removed' },
    { impact: 'additive', area: 'report', what: 'report key runs added' },
    { impact: 'breaking', area: 'trailers', what: 'trailer Work-Item removed' },
    { impact: 'fix', area: 'contract', what: "the executor contract's wording changed" },
    { impact: 'breaking', area: 'read-api', what: 'api_version 1 → 2' },
  ]);
});

test('the bump comes from the delta alone: breaking is major, or minor under 0.y.z, flagged', () => {
  const additive = diffSurface(surface(), surface({ report: ['item', 'status', 'runs'] }));
  assert.deepEqual(proposeBump(additive, '0.3.1'), {
    bump: 'minor',
    breaking: false,
    version: '0.4.0',
    basis: '1 additive change(s), none breaking: minor',
  });
  const removed = diffSurface(surface(), surface({ report: ['item'] }));
  assert.equal(proposeBump(removed, '1.2.0').bump, 'major');
  assert.equal(proposeBump(removed, '1.2.0').version, '2.0.0');
  assert.deepEqual(proposeBump(removed, '0.3.1'), {
    bump: 'minor',
    breaking: true,
    version: '0.4.0',
    basis: '1 breaking change(s): minor while the version is 0.y.z, flagged breaking',
  });
  assert.equal(proposeBump([], '0.3.1').bump, 'patch');
  assert.match(proposeBump([], '0.3.1').basis, /internal change proposes patch at most/);
  assert.throws(() => proposeBump([], '0.3.1-rc.1'), /not a full release/);
});

// --- propose and make ------------------------------------------------------------------------

test('with no tag yet, propose says so and treats the whole surface as initial', async () => {
  const root = releaseRepo();
  const p = await hitld(['release', 'propose', '--json'], root);
  assert.equal(p.code, 0, JSON.stringify(p.json));
  assert.equal(p.json.last_tag, null);
  assert.equal(p.json.base, null);
  assert.equal(p.json.initial, true);
  assert.equal(p.json.version, '0.1.0');
  assert.equal(p.json.tag, 'v0.1.0');
  assert.match(
    p.json.basis,
    /^no release tag yet, so the whole public interface is the initial surface/,
  );
  assert.ok(p.json.interface_delta.every((/** @type {any} */ e) => e.impact === 'additive'));
  assert.deepEqual(p.json.items, ['W-3']);
  assert.deepEqual(p.json.warnings, [
    'package.json says 0.0.0; set it to 0.1.0 before the release is made',
  ]);
  const rc = await hitld(['release', 'propose', '--pre', 'rc'], root);
  assert.equal(rc.json.version, '0.1.0-rc.1');
  assert.equal(rc.json.prerelease, true);
  assert.match(rc.json.prerelease_rule, /never the base/);
});

test('release make refuses outside the owner’s own turn', async () => {
  const root = releaseRepo();
  const executor = await hitld(['release', 'make'], root, { HITLD_ROLE: 'executor' });
  assert.equal(executor.code, 1);
  assert.equal(executor.json.error, 'not_permitted');
  assert.match(executor.json.message, /owner's, through the main session/);
  const dispatched = await hitld(['release', 'make'], root, { HITLD_DISPATCH: 'D-4' });
  assert.equal(dispatched.json.error, 'not_permitted');
  const make = releaseCommands.find((c) => c.name === 'release make');
  assert.equal(make?.mcp, false);
  const viaTool = await make?.run?.({}, { cwd: root, env: {} });
  assert.equal(viaTool?.error, 'not_permitted');
  assert.match(String(viaTool?.message), /not the human command line/);
  git(root, 'worktree', 'add', '-q', '-b', 'side', join(root, '..', `wt-${Date.now()}`));
  const wt = git(root, 'worktree', 'list', '--porcelain').match(/^worktree (.*wt-\d+)$/m)?.[1];
  const linked = await hitld(['release', 'make'], String(wt));
  assert.match(linked.json.message, /linked worktree/);
  assert.equal(git(root, 'tag', '--list').trim(), '', 'nothing was tagged');
});

test('release make writes the record and the tag, never pushes, and the record is read back', async () => {
  const root = releaseRepo();
  const remote = mkdtempSync(join(tmpdir(), 'hitld-remote-'));
  git(remote, 'init', '-q', '--bare');
  git(root, 'remote', 'add', 'origin', remote);

  const low = await hitld(['release', 'make', '--version', '0.0.1'], root);
  assert.equal(low.code, 1);
  assert.match(
    low.json.message,
    /0\.0\.1 is a patch release, but the interface delta proposes minor/,
  );

  const rc = await hitld(['release', 'make', '--pre', 'rc'], root);
  assert.equal(rc.code, 0, JSON.stringify(rc.json));
  assert.equal(rc.json.tag, 'v0.1.0-rc.1');
  assert.equal(rc.json.prerelease, true);
  assert.equal(rc.json.pushed, false);
  assert.match(rc.json.next, /Nothing was pushed/);
  assert.equal(git(root, 'tag', '--list').trim(), 'v0.1.0-rc.1');
  assert.equal(git(root, 'cat-file', '-t', 'v0.1.0-rc.1').trim(), 'tag', 'an annotated tag');
  assert.equal(git(root, 'log', '-1', '--format=%s').trim(), 'release record: v0.1.0-rc.1');
  assert.match(
    git(root, 'log', '-1', '--format=%B'),
    /^Signed-off-by: Fixture <fixture@example\.invalid>$/m,
    'signed off by the person who ran it (DCO)',
  );
  assert.equal(git(remote, 'tag', '--list').trim(), '', 'never pushed');
  const record = readFileSync(join(root, 'work/releases/v0.1.0-rc.1.md'), 'utf8');
  assert.match(
    record,
    /^---\nid: v0\.1\.0-rc\.1\nversion: 0\.1\.0-rc\.1\nbump: minor\ninterface_delta: \[/,
  );
  assert.match(record, /\ndecision: owner\nitems: \[W-3\]\nclassification: public\n---\n/);
  let t = open(root);
  assert.deepEqual(t.check().problems, []);
  assert.equal(t.get('W-3').released_in, null, 'a pre-release does not set released_in');

  const next = await hitld(['release', 'propose', '--pre', 'rc'], root);
  assert.equal(next.json.last_tag, 'v0.1.0-rc.1');
  assert.equal(next.json.base, null, 'a pre-release is never the base');
  assert.equal(next.json.version, '0.1.0-rc.2');

  const full = await hitld(['release', 'make', '--decision', 'W-6'], root);
  assert.equal(full.code, 0, JSON.stringify(full.json));
  assert.equal(full.json.tag, 'v0.1.0');
  t = open(root);
  assert.deepEqual(t.check().problems, []);
  assert.equal(t.get('W-3').released_in, 'v0.1.0');
  const shown = await hitld(['work', 'show', 'v0.1.0', '--json'], root);
  assert.equal(shown.json.api_version, 1);
  assert.equal(shown.json.entity.kind, 'release');
  assert.equal(shown.json.entity.decision, 'W-6');
  assert.equal(shown.json.entity.prerelease, false);
  assert.deepEqual(shown.json.entity.interface_delta[0], {
    impact: 'additive',
    area: 'schemas',
    what: 'schema thing added',
  });
  const listed = await hitld(['work', 'query', '--kind', 'release', '--json'], root);
  assert.deepEqual(listed.json.entities.map((/** @type {any} */ e) => e.id).sort(), [
    'v0.1.0',
    'v0.1.0-rc.1',
  ]);
  assert.match(t.renderViewTexts().unreleased, /^\n0 merged item\(s\) not in a release\n$/);
  const again = await hitld(['release', 'make', '--version', '0.1.0'], root);
  assert.match(again.json.message, /not above the last full release, 0\.1\.0/);
});

test('after a release, the delta is read against the tag’s own surface', async () => {
  const root = releaseRepo();
  assert.equal((await hitld(['release', 'make'], root)).code, 0);
  put(root, {
    'schemas/thing.schema.json': schema({
      id: { type: 'string' },
      name: { type: 'string' },
      note: { type: 'string' },
    }),
  });
  commitAll(root, 'an optional field');
  const additive = await hitld(['release', 'propose'], root);
  assert.equal(additive.json.base, 'v0.1.0');
  assert.deepEqual(additive.json.interface_delta, [
    { impact: 'additive', area: 'schemas', what: 'thing: note added' },
  ]);
  assert.equal(additive.json.version, '0.2.0');
  put(root, { 'schemas/thing.schema.json': schema({ id: { type: 'string' } }) });
  commitAll(root, 'remove a field');
  const breaking = await hitld(['release', 'propose'], root);
  assert.equal(breaking.json.bump, 'minor');
  assert.equal(breaking.json.breaking, true);
  assert.deepEqual(breaking.json.interface_delta, [
    { impact: 'breaking', area: 'schemas', what: 'thing: name removed' },
  ]);
  put(root, {
    'schemas/thing.schema.json': schema({ id: { type: 'string' }, name: { type: 'string' } }),
    'src/x.js': 'x\n',
  });
  commitAll(root, 'internal only');
  const internal = await hitld(['release', 'propose'], root);
  assert.equal(internal.json.bump, 'patch');
  assert.equal(internal.json.version, '0.1.1');
});

test('propose lists unmet gates, missing changelog lines and drafts notes; make waits for gates', async () => {
  const root = makeRepo({
    files: {
      '.human-in-the-lead/policy.json': JSON.stringify({
        schema_version: 1,
        project: { id: 'fixture', key: 'W' },
      }),
      '.human-in-the-lead/tracker.json': JSON.stringify({
        schema_version: 1,
        optional_keys: ['changelog'],
      }),
      'work/milestones/W-7-ready.md': itemText({
        id: 'W-7',
        title: 'Ready',
        kind: 'capability',
        status: 'Planned',
        project: 'W-2',
        needs: ['W-3 c?'],
      }),
      'work/items/W-8-release.md': itemText({
        id: 'W-8',
        title: 'Release',
        kind: 'work',
        status: 'Planned',
        project: 'W-2',
        needs: ['W-7'],
      }),
      'work/items/W-9-shipped.md': itemText({
        id: 'W-9',
        title: 'Shipped',
        kind: 'work',
        status: 'Done',
        project: 'W-2',
        changelog: 'Config errors name the key.',
      }),
    },
    commit: false,
  });
  for (const f of ['policy.json', 'tracker.json'])
    chmodSync(join(root, '.human-in-the-lead', f), 0o644);
  commitAll(root, 'fixture');
  put(root, { 'schemas/thing.schema.json': schema({ id: { type: 'string' } }) });
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'a schema', '-m', 'Work-Item: W-3');
  const t = open(root);
  const p = await proposeRelease(t, {});
  assert.deepEqual(p.gates, [
    { item: 'W-8', milestone: 'W-7', title: 'Ready', state: 'Planned', check_due: true },
  ]);
  assert.deepEqual(p.notes, ['Config errors name the key. (W-9)']);
  assert.deepEqual(p.missing_changelog, [{ item: 'W-3', files: ['schemas/thing.schema.json'] }]);
  const refused = await hitld(['release', 'make', '--item', 'W-8'], root);
  assert.equal(refused.code, 1);
  assert.match(
    refused.json.message,
    /the release waits for its gates: W-7 Ready \(Planned, check due\)/,
  );
});
