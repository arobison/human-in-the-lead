// The tracker backend conformance suite (design part 3.4, "Who owns the format").
//
// A backend is judged by what it keeps. This module checks any backend against the tracker
// interface (core/lib/tracker/interface.mjs) through the interface alone, with a set of declared
// project fields: a backend that drops, retypes or mangles a declared field fails. The files
// backend runs it in core/test/tracker-conformance.test.mjs; another backend runs it the same way:
//
//   import { runConformance } from 'human-in-the-lead/core/lib/tracker/conformance.mjs';
//   const results = await runConformance((fields) => ({ adapter: myBackend(fields), parent: 'P-1' }));
//
// The factory gets the fields the suite needs declared, and returns a fresh backend that has them
// declared, with the ID of an existing container (a project) that new items go under.

import assert from 'node:assert/strict';
import { TRACKER_METHODS } from './interface.mjs';

/**
 * @typedef {import('./interface.mjs').TrackerAdapter} TrackerAdapter
 * @typedef {{ name: string, type: 'string' | 'integer' | 'number' | 'boolean', list?: boolean, values?: string[], description: string }} FieldSpec
 * @typedef {{ adapter: TrackerAdapter, parent: string }} ConformanceBackend
 * @typedef {(fields: FieldSpec[]) => ConformanceBackend | Promise<ConformanceBackend>} BackendFactory
 * @typedef {{ name: string, ok: boolean, error?: string }} ConformanceResult
 */

/** The declared fields the suite needs a backend to hold: one of each type, and a list. */
export const CONFORMANCE_FIELDS = Object.freeze(
  /** @type {FieldSpec[]} */ ([
    { name: 'team', type: 'string', description: 'The team that owns the work.' },
    { name: 'points', type: 'integer', description: 'A size estimate in whole points.' },
    { name: 'weight', type: 'number', description: 'A relative weight.' },
    { name: 'urgent', type: 'boolean', description: 'Whether the work is urgent.' },
    { name: 'labels', type: 'string', list: true, description: 'Free labels.' },
    { name: 'sizes', type: 'integer', list: true, description: 'Candidate sizes.' },
  ]),
);

/** The declared values a draft carries. */
const VALUES = Object.freeze({
  team: 'core',
  points: 3,
  weight: 1.5,
  urgent: true,
  labels: ['alpha', 'beta'],
  sizes: [1, 2, 5],
});

/** @param {unknown} e */
const picked = (e) =>
  Object.fromEntries(
    Object.keys(VALUES).map((k) => [k, /** @type {Record<string, unknown>} */ (e)[k]]),
  );

/**
 * @param {ConformanceBackend} b
 * @param {Record<string, unknown>} [extra]
 */
function make(b, extra = {}) {
  const id = b.adapter.create({
    kind: 'work',
    title: 'Conformance item',
    parent: b.parent,
    ...VALUES,
    ...extra,
  });
  return id;
}

/** @param {TrackerAdapter} a @param {string} id */
const read = (a, id) => /** @type {Record<string, unknown>} */ (a.get(id));

/** @type {{ name: string, run: (b: ConformanceBackend) => void }[]} */
export const CONFORMANCE_CHECKS = [
  {
    name: 'implements every interface method',
    run({ adapter }) {
      for (const m of TRACKER_METHODS) {
        assert.equal(typeof (/** @type {any} */ (adapter)[m]), 'function', `${m} is missing`);
      }
      const caps = adapter.capabilities();
      assert.equal(typeof caps.customFields, 'boolean');
      assert.ok(['full', 'partial', 'none'].includes(caps.history));
    },
  },
  {
    name: 'holds every declared field on create, with its type',
    run(b) {
      const id = make(b);
      assert.deepEqual(picked(b.adapter.get(id)), VALUES);
    },
  },
  {
    name: 'keeps declared fields when another field is updated',
    run(b) {
      const id = make(b);
      const before = read(b.adapter, id);
      b.adapter.update(id, { title: 'Renamed' }, /** @type {string} */ (before.version));
      const after = read(b.adapter, id);
      assert.equal(after.title, 'Renamed');
      assert.deepEqual(picked(after), VALUES);
    },
  },
  {
    name: 'keeps declared fields across a state change',
    run(b) {
      const id = make(b);
      b.adapter.transition(id, 'Dropped', 'conformance check', {});
      const after = read(b.adapter, id);
      assert.equal(after.state, 'Dropped');
      assert.deepEqual(picked(after), VALUES);
    },
  },
  {
    name: 'changes and removes a declared field on update',
    run(b) {
      const id = make(b);
      const v1 = /** @type {string} */ (read(b.adapter, id).version);
      b.adapter.update(id, { points: 8, labels: ['gamma'], urgent: null }, v1);
      const after = read(b.adapter, id);
      assert.equal(after.points, 8);
      assert.deepEqual(after.labels, ['gamma']);
      assert.equal(after.urgent, undefined);
      assert.equal(after.team, 'core');
    },
  },
  {
    name: 'refuses a value that is not of the declared type, and changes nothing',
    run(b) {
      const id = make(b);
      const before = read(b.adapter, id);
      assert.throws(() =>
        b.adapter.update(id, { points: 'many' }, /** @type {string} */ (before.version)),
      );
      assert.throws(() => b.adapter.update(id, { urgent: 'maybe' }, String(before.version)));
      assert.deepEqual(picked(b.adapter.get(id)), VALUES);
    },
  },
  {
    name: 'refuses a field nobody declared',
    run(b) {
      const id = make(b);
      assert.throws(() =>
        b.adapter.update(id, { undeclared_field: 'x' }, String(read(b.adapter, id).version)),
      );
    },
  },
  {
    name: 'queries by a declared field',
    run(b) {
      const one = make(b, { team: 'core', points: 3, labels: ['alpha'] });
      const two = make(b, { team: 'web', points: 5, labels: ['beta', 'gamma'] });
      const ids = (/** @type {Record<string, unknown>} */ fields) =>
        b.adapter
          .query({ fields })
          .map((e) => e.id)
          .sort();
      assert.deepEqual(ids({ team: 'web' }), [two]);
      assert.deepEqual(ids({ points: 3 }), [one]);
      assert.deepEqual(ids({ labels: 'gamma' }), [two]);
      assert.deepEqual(ids({ team: 'core', points: 5 }), []);
      assert.ok(ids({ labels: 'beta' }).includes(two));
    },
  },
  {
    name: 'refuses a query on a field nobody declared',
    run(b) {
      make(b);
      assert.throws(() => b.adapter.query({ fields: { undeclared_field: 'x' } }));
    },
  },
];

/**
 * Run the suite against a backend. Each check gets a fresh backend from the factory. A check that
 * throws fails; the rest still run.
 * @param {BackendFactory} factory
 * @returns {Promise<ConformanceResult[]>}
 */
export async function runConformance(factory) {
  /** @type {ConformanceResult[]} */
  const results = [];
  for (const check of CONFORMANCE_CHECKS) {
    try {
      check.run(await factory(CONFORMANCE_FIELDS.map((f) => ({ ...f }))));
      results.push({ name: check.name, ok: true });
    } catch (e) {
      results.push({
        name: check.name,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}
