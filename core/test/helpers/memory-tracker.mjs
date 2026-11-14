// A stand-in TrackerAdapter (core/lib/tracker/interface.mjs) held in memory, so piece (e) is tested
// before the files backend (piece (a)) exists. It does what the files backend must: validate every
// entity against its kind's schema on every write, check versions, and refuse an unknown item.

import { schemas } from '../../lib/schema/registry.mjs';
import { formatErrors } from '../../lib/schema/validate.mjs';

/**
 * @typedef {import('../../lib/tracker/interface.mjs').TrackerAdapter & { items: Map<string, Record<string, any>> }} MemoryTracker
 */

/**
 * @param {{ key?: string }} [options]
 * @returns {MemoryTracker}
 */
export function createMemoryTracker({ key = 'W' } = {}) {
  /** @type {Map<string, Record<string, any>>} */
  const items = new Map();
  /** @type {Map<string, { at: string, from: string | null, to: string, ref: object }[]>} */
  const changes = new Map();
  let n = 0;
  let clock = 0;

  /** @param {Record<string, any>} entity */
  const check = (entity) => {
    const errors = schemas().validateTrackerEntity(entity);
    if (errors.length) throw new Error(`${entity.id}: ${formatErrors(errors)}`);
  };
  /** @param {string} id */
  const need = (id) => {
    const e = items.get(id);
    if (!e) throw new Error(`no item ${id}`);
    return e;
  };
  /** @param {string} id */
  const version = (id) => `v${id}.${++clock}`;
  /** @type {Map<string, string>} */
  const versions = new Map();
  /** @param {string} id @param {string} expected */
  const expect = (id, expected) => {
    if (expected !== undefined && versions.get(id) !== expected) {
      throw new Error(
        `${id} changed since it was read (version ${versions.get(id)}, expected ${expected})`,
      );
    }
  };
  /** @param {string} id */
  const bump = (id) => {
    const v = version(id);
    versions.set(id, v);
    return v;
  };

  return {
    items,
    capabilities: () => ({
      closesOnMerge: false,
      claimInBranch: false,
      customFields: true,
      decisionKind: true,
      classificationEnforced: false,
      history: 'partial',
    }),
    get(id) {
      return { ...structuredClone(need(id)), _version: versions.get(id) };
    },
    query(filter) {
      const kinds = filter.kind === undefined ? null : [filter.kind].flat();
      const states = filter.state === undefined ? null : [filter.state].flat();
      return [...items.values()]
        .filter((e) => !kinds || kinds.includes(e.kind))
        .filter((e) => !states || states.includes(e.state))
        .filter((e) => filter.area === undefined || e.area === filter.area)
        .filter((e) => filter.needs === undefined || (e.needs ?? []).includes(filter.needs))
        .filter((e) => filter.parent === undefined || e.parent === filter.parent)
        .map((e) => structuredClone(e));
    },
    create(draft) {
      const id = `${key}-${++n}`;
      /** @type {Record<string, any>} */
      const entity = { ...structuredClone(draft), id };
      check(entity);
      items.set(id, entity);
      bump(id);
      changes.set(id, [{ at: String(clock), from: null, to: String(entity.state), ref: {} }]);
      return id;
    },
    update(id, patch, expectedVersion) {
      const e = need(id);
      expect(id, expectedVersion);
      const next = { ...e };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k];
        else next[k] = structuredClone(v);
      }
      check(next);
      items.set(id, next);
      return bump(id);
    },
    transition(id, to, _reason, via) {
      const e = need(id);
      const next = { ...e, state: to };
      check(next);
      changes.get(id)?.push({ at: String(++clock), from: e.state, to, ref: via });
      items.set(id, next);
      return bump(id);
    },
    link(from, relation, to) {
      const e = need(from);
      need(to);
      const next = { ...e };
      if (relation === 'needs' || relation === 'opened_from') {
        next[relation] = [...new Set([...(e[relation] ?? []), to])];
      } else {
        next[relation] = to;
      }
      check(next);
      items.set(from, next);
      bump(from);
    },
    claim() {
      throw new Error('the stand-in tracker does not claim');
    },
    history: (id) => /** @type {any} */ (changes.get(id) ?? []),
    renderViews() {},
  };
}
