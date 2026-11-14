import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemas, SchemaRegistry, TRACKER_KINDS } from '../lib/schema/registry.mjs';

const registry = schemas();

/** A valid example of every stand-alone data file, from the design where it gives one. */
const examples = {
  // Part 12.5: a Claude Code status line snapshot, as piece (h)'s status-line command writes it.
  'usage-snapshot': {
    schema_version: 1,
    at: '2026-11-14T12:00:00Z',
    source: 'claude-code-statusline',
    rate_limits: {
      five_hour: { used_percentage: 42, resets_at: 1794668400 },
      seven_day: { used_percentage: 17, resets_at: 1794900000 },
    },
  },
  // Part 13.4: the person file, with a declared limit and a share between projects.
  person: {
    schema_version: 1,
    executors_max: 4,
    quota: {
      owner_reserve: 0.3,
      limits: [
        {
          id: 'api-monthly',
          unit: 'usd',
          window: 'monthly_utc',
          limit: 50,
          source: 'declared',
          hard: true,
        },
      ],
    },
    projects: { 'example-project': { share: 2 } },
  },
  // Part 13.4: the machine file.
  machine: {
    schema_version: 1,
    role: 'workstation',
    executors_max: 2,
    env: { port_range: { min: 4100, max: 4199 }, secret_provider: 'keychain' },
  },
  tracker: {
    schema_version: 1,
    work_dir: 'work',
    folders: { initiative: 'initiatives', project: 'projects', item: 'items' },
    main_branch: 'main',
    optional_keys: ['touches', 'estimate_tokens'],
  },
  // Design part 3.4, the file format example.
  item: {
    schema_version: 1,
    id: 'W-214',
    kind: 'work',
    title: 'Cache responses by request key',
    parent: 'W-201',
    state: 'Planned',
    area: 'cache',
    category: 'platform',
    needs: ['W-209', 'W-213'],
    touches: ['src/cache/http/**', 'test/cache/http*'],
    serial: [],
    estimate_tokens: 180000,
    classification: 'public',
    opened_from: ['SIG-88'],
  },
  // signals/SIG-1-definition-of-ready.md in this repository, as parsed front matter.
  signal: {
    schema_version: 1,
    id: 'SIG-1',
    kind: 'idea',
    state: 'new',
    source: 'note (owner conversation, 2026-11-14)',
    author: 'owner',
    received_at: '2026-11-14',
    summary: 'Definition of ready before dispatch.',
    route: null,
    classification: 'public',
    judgements: [
      {
        what: 'fits the strategy and is plausibly valuable',
        basis: 'gut-check',
        by: 'owner',
        at: '2026-11-14',
      },
    ],
    provenance: ['recorded from the owner conversation, 2026-11-14'],
    design_refs: [{ related: '05-execution.md#51-sizing-tiers' }],
  },
  // Design part 4.2, the decision question example.
  decision: {
    schema_version: 1,
    id: 'W-412',
    kind: 'decision',
    title: 'Response cache key and locale',
    state: 'Planned',
    classification: 'public',
    question: 'Should the response cache key include the locale?',
    context: 'Keys without it are stable across driver updates.',
    options: [
      { label: 'A', what_happens: 'Include it: always correct', reversible: true },
      { label: 'B', what_happens: 'Exclude it: faster after upgrades', reversible: true },
    ],
    recommendation: { option: 'A', why: 'Correctness beats a cold cache after upgrades.' },
    decider: 'owner',
    rights_basis: 'novelty',
    reversibility: 'two-way',
  },
  initiative: {
    schema_version: 1,
    id: 'W-1',
    kind: 'initiative',
    title: 'Request pipeline',
    state: 'Planned',
    classification: 'public',
  },
  project: {
    schema_version: 1,
    id: 'W-201',
    kind: 'project',
    title: 'Response cache',
    parent: 'W-1',
    state: 'Planned',
    owner: 'owner',
    classification: 'public',
  },
  opportunity: {
    schema_version: 1,
    id: 'W-90',
    kind: 'opportunity',
    problem: 'First frame is slow in large scenes.',
    signals: ['SIG-88'],
    options: [{ label: 'do nothing', tradeoffs: 'Slow first frames continue.' }],
    confidence: 0.6,
    cost_of_delay: { profile: 'standard', rate: 1 },
    state: 'shaping',
    classification: 'public',
  },
  precedent: {
    schema_version: 1,
    id: 'P-1',
    rule: 'When a dependency has a permissive licence, allow it.',
    conditions: { rights_basis: ['security'], tags: ['dependency-licence'] },
    sources: ['W-300'],
    scope: 'project',
    state: 'active',
    classification: 'public',
  },
  'trust-event': {
    schema_version: 1,
    kind: 'application',
    at: '2026-11-14T03:00:00Z',
    area: 'cache',
    subject: 'W-413',
    precedent: 'P-1',
    facts: { rights_basis: ['security'], tags: ['dependency-licence'] },
  },
  contributor: {
    schema_version: 1,
    id: 'C-3',
    identities: [{ source: 'github', handle: 'someone' }],
    trust_level: 'T1',
    classification: 'internal',
  },
  'ledger-entry': {
    schema_version: 1,
    id: 'E-1',
    event: 'reported',
    dispatch: 'D-7',
    item: 'W-214',
    tier: 2,
    at: '2026-11-14T03:00:00Z',
    outcome: 'done',
    tokens: null,
    commit: '3f9c2a1',
  },
  'run-state': {
    schema_version: 1,
    run: { id: '2026-11-14-1', started_at: '2026-11-14T03:00:00Z' },
    scope: { items: ['W-214'], concurrency_cap: 3 },
    in_flight: [],
    ledger_position: null,
    open_questions: [],
    decisions_this_run: [],
    controllers: {},
    quotas: null,
    merge_queue: { waiting: [], batch: null },
    lease: { host: 'laptop', session: 's-1', renewed_at: '2026-11-14T03:00:00Z' },
    checkpoint: { number: 1, prev_hash: null },
  },
  'audit-record': {
    schema_version: 1,
    what: { kind: 'decision-answered', subject: 'W-412' },
    who: { kind: 'human', person: 'owner', channel: 'remote-control' },
    at: '2026-11-14T03:00:00Z',
    prev_hash: null,
  },
  study: {
    schema_version: 1,
    id: 'PS-1',
    question: 'Do shorter briefs lower onboarding tokens?',
    verdict: null,
    classification: 'internal',
  },
  run: {
    schema_version: 1,
    id: 'R-1203',
    commit: 'abcdef1',
    configuration: { scene: 'standard' },
    results: { first_frame_ms: 812 },
    classification: 'public',
  },
  'eval-scenario': {
    schema_version: 1,
    id: 'foundation/policy-check',
    piece: 'foundation',
    category: 'policy',
    description: 'hitld check policy accepts a valid policy.',
    mode: 'offline',
    fixture: { generator: 'repo' },
    steps: [{ id: 'check', action: 'cli', with: { argv: ['check', 'policy'] } }],
    graders: [{ grader: 'equals', with: { path: 'steps.check.result.ok', value: true } }],
  },
  'eval-result': {
    schema_version: 1,
    id: 'EV-20261114T031500Z-86b14a',
    at: '2026-11-14T03:15:00.000Z',
    mode: 'offline',
    plugin: { name: 'human-in-the-lead', version: '0.0.0', commit: null },
    schema_versions: { item: 1 },
    harness: { adapter: 'fake', profiles: ['full'] },
    policy_hash: null,
    policy_source: 'defaults',
    settings: { seed: 1, profiles: ['full'], scenario_filter: null, settings_hash: '86b14a88e19f' },
    scenario_set: { version: 'ae8968eb1a39', count: 1 },
    scenarios: [
      {
        id: 'foundation/policy-check',
        piece: 'foundation',
        category: 'policy',
        profile: 'none',
        status: 'pass',
        score: 1,
        graders: [
          { id: 'ok', grader: 'equals', passed: true, message: 'steps.check.result.ok is true' },
        ],
        wall_ms: 12,
        tokens: null,
        transcript: null,
      },
    ],
    summary: {
      total: 1,
      passed: 1,
      failed: 0,
      errors: 0,
      not_applicable: 0,
      tokens: 0,
      wall_ms: 12,
      categories: { policy: { score: 1, scenarios: 1 } },
    },
  },
};

test('every stand-alone schema has a valid example here', () => {
  const ids = registry.versionedIds().filter((id) => id !== 'policy');
  assert.deepEqual(ids.sort(), Object.keys(examples).sort());
});

for (const [id, example] of Object.entries(examples)) {
  test(`${id}: the example validates`, () => {
    assert.deepEqual(registry.validateEntity(id, example), []);
  });

  test(`${id}: an unknown key is rejected`, () => {
    const errors = registry.validateEntity(id, { ...example, surprise: 1 });
    assert.deepEqual(errors, [{ path: 'surprise', message: 'is not a known key' }]);
  });

  test(`${id}: a code-running key is refused`, () => {
    const errors = registry.validateEntity(id, { ...example, on_status_change: 'curl x | sh' });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'on_status_change');
    assert.match(errors[0].message, /names code to run/);
  });

  test(`${id}: schema_version is required, and a newer one is refused`, () => {
    const { schema_version: _, ...without } = /** @type {Record<string, unknown>} */ (example);
    assert.deepEqual(registry.validateEntity(id, without), [
      { path: 'schema_version', message: 'is required' },
    ]);
    const current = /** @type {number} */ (registry.currentVersion(id));
    const newer = registry.validateEntity(id, { ...example, schema_version: current + 1 });
    assert.match(
      newer[0].message,
      new RegExp(`newer than this release knows \\(${current}\\); upgrade hitld`),
    );
  });
}

test('free-form data is still checked for code-running keys', () => {
  const errors = registry.validateEntity('run', {
    ...examples.run,
    configuration: { steps: [{ post_run: 'rm -rf ~' }] },
  });
  assert.equal(errors[0].path, 'configuration.steps[0].post_run');
});

test('derived fields are not stored', () => {
  for (const field of ['ready', 'blocked', 'claimed', 'stage', 'critical_path', 'lead_time']) {
    const errors = registry.validateEntity('item', { ...examples.item, [field]: true });
    assert.match(errors[0].message, /not a known key/, field);
  }
});

test('tracker front matter is validated by its kind', () => {
  assert.deepEqual(registry.validateTrackerEntity(examples.item), []);
  assert.deepEqual(registry.validateTrackerEntity(examples.decision), []);
  assert.deepEqual(registry.validateTrackerEntity({ ...examples.item, kind: 'external' }), []);
  const errors = registry.validateTrackerEntity({ ...examples.item, kind: 'task' });
  assert.equal(errors[0].path, 'kind');
  assert.deepEqual(Object.keys(TRACKER_KINDS).sort(), [
    'decision',
    'external',
    'initiative',
    'opportunity',
    'project',
    'work',
  ]);
});

test('item states are the five of the reference format', () => {
  for (const state of ['Proposed', 'Planned', 'In progress', 'Done', 'Dropped']) {
    assert.deepEqual(registry.validateEntity('item', { ...examples.item, state }), [], state);
  }
  assert.equal(registry.validateEntity('item', { ...examples.item, state: 'Open' }).length, 1);
});

test('a decision outside the rights bases is rejected', () => {
  const errors = registry.validateEntity('decision', {
    ...examples.decision,
    rights_basis: 'gut-feel',
  });
  assert.equal(errors[0].path, 'rights_basis');
});

test('untrusted text fields are declared', () => {
  assert.deepEqual(registry.untrustedFields('signal'), ['body']);
});

test('the four tracker schemas share the common fields', () => {
  const common = [
    'schema_version',
    'id',
    'kind',
    'title',
    'parent',
    'state',
    'owner',
    'area',
    'category',
    'classification',
    'opened_from',
  ];
  for (const id of ['initiative', 'project', 'item', 'decision']) {
    const props = Object.keys(registry.get(id).properties);
    for (const field of common) assert.ok(props.includes(field), `${id} lacks ${field}`);
  }
});

test('a fresh registry loads the same schemas (no hidden state)', () => {
  const fresh = new SchemaRegistry();
  assert.deepEqual(fresh.versionedIds(), registry.versionedIds());
});
