import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFORMANCE_CHECKS, runConformance } from '../lib/tracker/conformance.mjs';
import { openTracker } from '../lib/tracker/files/tracker.mjs';
import { makeRepo, policyFor } from './tracker-fixture.mjs';

/** The files backend with the suite's fields declared in tracker.json. @type {import('../lib/tracker/conformance.mjs').BackendFactory} */
const filesBackend = (fields) => {
  const root = makeRepo({
    files: {
      '.human-in-the-lead/tracker.json': JSON.stringify({ schema_version: 1, fields }),
    },
  });
  return {
    adapter: openTracker({ repoRoot: root, policy: policyFor(), env: {} }),
    parent: 'W-2',
  };
};

/**
 * A small in-memory backend. `drop` makes it lose declared fields, to prove the suite catches it:
 * 'create' ignores them when an entity is made, 'update' loses them when one is changed,
 * 'transition' loses them on a state change.
 * @param {'none' | 'create' | 'update' | 'transition'} drop
 * @returns {import('../lib/tracker/conformance.mjs').BackendFactory}
 */
const memoryBackend = (drop) => (fields) => {
  const declared = new Map(fields.map((f) => [f.name, f]));
  /** @type {Map<string, Record<string, any>>} */
  const store = new Map();
  let n = 0;
  /** @param {string} name @param {unknown} v */
  const checked = (name, v) => {
    const def = declared.get(name);
    if (!def) throw new Error(`no field ${name}`);
    for (const m of Array.isArray(v) ? v : [v]) {
      const ok =
        def.type === 'string'
          ? typeof m === 'string'
          : def.type === 'boolean'
            ? typeof m === 'boolean'
            : typeof m === 'number' && (def.type === 'number' || Number.isInteger(m));
      if (!ok) throw new Error(`${name} must be ${def.type}`);
    }
  };
  /** @param {Record<string, any>} e */
  const withoutDeclared = (e) =>
    Object.fromEntries(Object.entries(e).filter(([k]) => !declared.has(k)));
  const adapter = /** @type {any} */ ({
    capabilities: () => ({
      closesOnMerge: false,
      claimInBranch: false,
      customFields: true,
      decisionKind: false,
      classificationEnforced: false,
      history: 'none',
    }),
    get(/** @type {string} */ id) {
      const e = store.get(id);
      if (!e) throw new Error(`${id} is not here`);
      return structuredClone(e);
    },
    query: (/** @type {Record<string, any>} */ filter) =>
      [...store.values()].filter((e) =>
        Object.entries(filter.fields ?? {}).every(([k, v]) => {
          if (!declared.has(k)) throw new Error(`no field ${k}`);
          return Array.isArray(e[k]) ? e[k].includes(v) : e[k] === v;
        }),
      ),
    create(/** @type {Record<string, any>} */ draft) {
      const id = `M-${++n}`;
      /** @type {Record<string, any>} */
      const entity = {
        ...(drop === 'create' ? withoutDeclared(draft) : draft),
        id,
        state: 'planned',
      };
      for (const k of declared.keys()) if (entity[k] !== undefined) checked(k, entity[k]);
      store.set(id, { ...entity, version: '1' });
      return id;
    },
    update(/** @type {string} */ id, /** @type {Record<string, any>} */ patch) {
      const e = store.get(id);
      if (!e) throw new Error(`${id} is not here`);
      for (const [k, v] of Object.entries(patch)) {
        if (!declared.has(k) && !(k in e)) throw new Error(`no field ${k}`);
        if (declared.has(k) && v !== null) checked(k, v);
      }
      const next = { ...(drop === 'update' ? withoutDeclared(e) : e), ...patch };
      for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
      store.set(id, { ...next, version: String(Number(e.version) + 1) });
      return String(Number(e.version) + 1);
    },
    transition(/** @type {string} */ id, /** @type {string} */ to) {
      const e = store.get(id);
      if (!e) throw new Error(`${id} is not here`);
      store.set(id, { ...(drop === 'transition' ? withoutDeclared(e) : e), state: to });
      return '1';
    },
    link() {},
    claim: () => ({}),
    history: () => [],
    renderViews() {},
  });
  return { adapter, parent: 'M-0' };
};

/** @param {import('../lib/tracker/conformance.mjs').ConformanceResult[]} results */
const failed = (results) => results.filter((r) => !r.ok).map((r) => r.name);

test('conformance: the files backend passes every check', async () => {
  const results = await runConformance(filesBackend);
  assert.equal(results.length, CONFORMANCE_CHECKS.length);
  assert.deepEqual(failed(results), [], JSON.stringify(results.filter((r) => !r.ok)));
});

test('conformance: a correct in-memory backend passes, so the suite is not tied to files', async () => {
  const results = await runConformance(memoryBackend('none'));
  assert.deepEqual(failed(results), [], JSON.stringify(results.filter((r) => !r.ok)));
});

for (const [drop, caught] of /** @type {const} */ ([
  ['create', 'holds every declared field on create, with its type'],
  ['update', 'keeps declared fields when another field is updated'],
  ['transition', 'keeps declared fields across a state change'],
])) {
  test(`conformance: a backend that drops declared fields on ${drop} fails`, async () => {
    const results = await runConformance(memoryBackend(drop));
    assert.ok(
      failed(results).includes(caught),
      `${caught} should fail; failed: ${failed(results)}`,
    );
  });
}
