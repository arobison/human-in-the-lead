import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemas, SchemaRegistry, TRACKER_KINDS } from '../lib/schema/registry.mjs';

const registry = schemas();

/** A valid example of every stand-alone data file, from the design where it gives one. */
const examples = {
  // Part 10.5: a recorded triage verdict, in the private store.
  invariants: {
    schema_version: 1,
    area: 'cache',
    tests_dir: 'test/adversary',
    fix_parent: 'W-1',
    invariants: [
      {
        id: 'key-round-trip',
        statement: 'A cache key read back after writing is the same key.',
        checked: '2026-11-20',
        form: 'round-trip',
        module: 'src/key.js',
        target: 'writeKey',
        inverse: 'readKey',
        args: [{ type: 'string', chars: 'ab:/', max_length: 12 }],
        runs: 500,
      },
    ],
  },
  'security-records': {
    schema_version: 1,
    kind: 'verdicts',
    classification: 'confidential',
    entries: [
      {
        key: '0123456789ab',
        tool: 'Example Scanner',
        rule: 'example/path-traversal',
        path: 'src/files.js',
        line: 12,
        fingerprint: '0123456789abcdef',
        at: '2026-11-14T12:00:00Z',
        verdict: 'false-positive',
        reason: 'the path passes the name pattern and containment before the read',
        item: 'W-7',
      },
    ],
  },
  // Design part 18.4: a feedback record, as `hitld feedback` writes it to the private store.
  feedback: {
    schema_version: 2,
    id: 'FB-1',
    kind: 'friction',
    words: 'That question was not worth asking.',
    created_at: '2026-11-14T12:00:00Z',
    hitld_version: '0.1.0',
    harness: { name: 'claude-code', version: 'unknown' },
    loop: 'decision rights',
    refs: ['W-3'],
    state: 'local',
    classification: 'confidential',
  },
  // Part 12.5: a Claude Code status line snapshot, as the status-line command writes it.
  'usage-snapshot': {
    schema_version: 1,
    at: '2026-11-14T12:00:00Z',
    source: 'claude-code-statusline',
    rate_limits: {
      five_hour: { used_percentage: 42, resets_at: 1794668400 },
      seven_day: { used_percentage: 17, resets_at: 1794900000 },
    },
  },
  // Part 5.2: a progress signal the watchdog reads, here a sample of the executor's worktree.
  'progress-signal': {
    schema_version: 1,
    at: '2026-11-14T12:05:00Z',
    dispatch: 'D-3',
    source: 'worktree',
    head: 'abc1234',
    commits: 2,
    dirty: 1,
    changed: 'a'.repeat(64),
  },
  // Part 13.3: what each recurring job last read, as `hitld cadence done` writes it.
  'cadence-state': {
    schema_version: 1,
    jobs: {
      digest: { at: '2026-11-14T12:00:00Z', through: 'E-41', trust_through: 7 },
      'review:owner': { at: '2026-11-14T12:00:00Z', trust_through: 9 },
    },
  },
  // Part 13.4: the person file, with a declared limit and a share between projects.
  person: {
    schema_version: 1,
    max_executors: 4,
    quota: {
      reserve: 0.3,
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
    kind: 'workstation',
    max_executors: 2,
    cores: 4,
    memory_ceiling_mb: 8192,
    capacity: { gpu: 4 },
    load: { max_per_core: 0.7 },
    detected: {
      at: '2026-11-14T09:00:00Z',
      cores: 8,
      memory_mb: 16384,
      gpus: [],
      browsers: ['firefox'],
    },
    env: { port_range: { min: 4100, max: 4199 }, secret_provider: 'keychain' },
  },
  tracker: {
    schema_version: 1,
    work_dir: 'work',
    folders: {
      initiative: 'initiatives',
      project: 'projects',
      item: 'items',
      milestone: 'milestones',
      release: 'releases',
    },
    optional_keys: ['touches', 'estimate_tokens'],
  },
  // Design part 3.2, Milestones and releases.
  milestone: {
    schema_version: 1,
    id: 'W-230',
    kind: 'milestone',
    title: 'Config errors explained',
    parent: 'W-201',
    state: 'planned',
    classification: 'public',
    outcome: 'A user with a bad config file sees which key is wrong and why.',
    done_when: [{ id: 'c1', text: 'An unknown key exits with status 2 and names the key.' }],
    constraints: [
      { id: 'W-214', clause: 'c1' },
      { id: 'W-215', clause: null },
    ],
    contributions: [{ id: 'W-216', value: 3, confidence: 0.7 }],
    appetite_tokens: 600000,
    deadline: { date: '2027-03-01', source: 'the conference demo' },
    check: { kind: 'integration-test', target: 'test/config/errors.test.ts' },
    check_results: [
      {
        result: 'pass',
        date: '2026-12-01',
        role: 'acceptance-author',
        evidence: 'run 41 at 3f9c2a1',
      },
    ],
  },
  release: {
    schema_version: 1,
    id: 'v0.4.0-rc.1',
    version: '0.4.0-rc.1',
    previous: 'v0.3.2',
    bump: 'minor',
    interface_delta: [{ impact: 'additive', surface: 'schemas', what: 'item gains release_note' }],
    decision: 'owner',
    items: ['W-214'],
    milestones: ['W-230'],
    classification: 'public',
  },
  // Design part 3.4, the file format example.
  item: {
    schema_version: 1,
    id: 'W-214',
    kind: 'work',
    title: 'Cache responses by request key',
    parent: 'W-201',
    state: 'planned',
    area: 'cache',
    category: 'platform',
    needs: ['W-209', 'W-213'],
    touches: ['src/cache/http/**', 'test/cache/http*'],
    serial: [],
    estimate_tokens: 180000,
    classification: 'public',
    opened_from: ['SIG-88'],
  },
  // Design part 2.2, step 3: a checked reproduction, as kept with its test (HITLD-30).
  reproduction: {
    schema_version: 1,
    signal: 'SIG-7',
    verdict: 'reproduced',
    base: '0123456789abcdef0123456789abcdef01234567',
    test: 'test/mean.test.js',
    failing: ['mean of two numbers'],
    expected_failure: 'mean([2, 4]) should be 3',
    runs: 2,
    checked_at: '2026-11-20T12:00:00.000Z',
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
    judgments: [
      {
        what: 'fits the strategy and is plausibly valuable',
        basis: 'gut-check',
        by: 'owner',
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
    state: 'planned',
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
  // Design part 3.2, Project: a project being shaped, with the shaping fields.
  project: {
    schema_version: 1,
    id: 'W-201',
    kind: 'project',
    title: 'Response cache',
    state: 'proposed',
    owner: 'owner',
    classification: 'public',
    plan: 'docs/design/0012-response-cache.md',
    problem: 'Repeated requests are slow.',
    signals: ['SIG-88'],
    evidence: ['run 41: median 900 ms for a repeated request'],
    options: [
      { label: 'do nothing', tradeoffs: 'Slow repeated requests continue.' },
      { label: 'cache by request key', tradeoffs: 'Fast; needs invalidation.' },
    ],
    value: 8,
    confidence: 0.6,
    cost_of_delay: { profile: 'standard', rate: 1 },
    appetite_tokens: 2000000,
    out_of_scope: ['a shared cache across machines'],
    risks: ['invalidation on schema change'],
  },
  precedent: {
    schema_version: 1,
    id: 'P-1',
    rule: 'When a dependency has a permissive license, allow it.',
    conditions: { rights_basis: ['security'], tags: ['dependency-license'] },
    sources: ['W-300'],
    scope: 'all',
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
    facts: { rights_basis: ['security'], tags: ['dependency-license'] },
  },
  contributor: {
    schema_version: 1,
    id: 'C-3',
    identities: [{ source: 'github', handle: 'someone' }],
    trust_level: 'L1',
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
    result: 'done',
    tokens: null,
    commit: '3f9c2a1',
  },
  'run-state': {
    schema_version: 1,
    run: { id: '2026-11-14-1', started_at: '2026-11-14T03:00:00Z' },
    scope: { items: ['W-214'], max_executors: 3 },
    in_flight: [],
    ledger_position: null,
    decisions_open: [],
    decisions_answered: [],
    controllers: {},
    quotas: null,
    merge_queue: { waiting: [], batch: null },
    lease: { host: 'example-laptop', session: 's-1', renewed_at: '2026-11-14T03:00:00Z' },
    checkpoint: { number: 1, prev_hash: null },
  },
  'audit-record': {
    schema_version: 1,
    what: { kind: 'decision-answered', subject: 'W-412' },
    who: { kind: 'human', person: 'owner', channel: 'remote-control' },
    at: '2026-11-14T03:00:00Z',
    prev_hash: null,
  },
  'store-devices': {
    schema_version: 1,
    devices: [
      {
        name: 'example-laptop',
        recipient: 'age1zvkyg2lqzraa2lnjvqej32nkuu0ues2s82hzrye869xeexvn73equnujwj',
        added: '2026-11-15',
      },
    ],
  },
  quarantine: {
    schema_version: 1,
    tests: [{ id: 'cart > totals', expires: '2026-11-29', fix_item: 'HITLD-140' }],
  },
  study: {
    schema_version: 1,
    id: 'PS-1',
    question: 'Do shorter briefs lower onboarding tokens?',
    verdict: null,
    classification: 'internal',
  },
  'bench-run': {
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
    suite: 'foundation',
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
        suite: 'foundation',
        category: 'policy',
        profile: 'none',
        result: 'pass',
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
  const errors = registry.validateEntity('bench-run', {
    ...examples['bench-run'],
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
    'milestone',
    'project',
    'work',
  ]);
  // The kinds before HITLD-90 are not entities any more: the migration moves them.
  for (const kind of ['initiative', 'opportunity', 'capability', 'learning']) {
    assert.ok(registry.validateTrackerEntity({ ...examples.item, kind }).length, kind);
  }
});

test('a project being shaped carries the shaping fields; its bet is a decision', () => {
  const project = /** @type {any} */ (examples.project);
  assert.deepEqual(registry.validateTrackerEntity({ ...project, decision: 'W-412' }), []);
  /** @type {[string, unknown][]} */
  const bad = [
    ['bet_by', 'owner'],
    ['no_gos', ['x']],
    ['confidence', 1.5],
    ['value', 0],
    ['cost_of_delay', { profile: 'soon' }],
  ];
  for (const [key, value] of bad) {
    assert.ok(registry.validateTrackerEntity({ ...project, [key]: value }).length, key);
  }
});

test('a public judgment carries what, basis and who; the time is not public', () => {
  const signal = /** @type {any} */ (examples.signal);
  const judgment = signal.judgments[0];
  const check = (/** @type {any} */ j) =>
    registry.validateEntity('signal', { ...signal, judgments: [j] });
  assert.deepEqual(check(judgment), []);
  assert.ok(check({ ...judgment, at: '2026-11-14' }).length, 'the time is private');
  assert.ok(check({ what: judgment.what, basis: judgment.reason }).length, 'who is required');
  assert.ok(check({ ...judgment, confidence: 0.7 }).length, 'private fields are not public');
});

test('item states are the five of the reference format', () => {
  for (const state of ['proposed', 'planned', 'in-progress', 'done', 'dropped']) {
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

test('the tracker schemas share the common fields', () => {
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
  for (const id of ['project', 'item', 'decision']) {
    const props = Object.keys(registry.get(id).properties);
    for (const field of common) assert.ok(props.includes(field), `${id} lacks ${field}`);
  }
});

test('a fresh registry loads the same schemas (no hidden state)', () => {
  const fresh = new SchemaRegistry();
  assert.deepEqual(fresh.versionedIds(), registry.versionedIds());
});
