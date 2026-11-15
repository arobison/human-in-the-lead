// The interface delta between two surfaces, and the bump it proposes (design parts 3.2 and 16.5).
//
// Each change is marked:
//   breaking  something a user relied on is gone or means something else: a schema, field,
//             command, argument, alias, output field, report key or trailer removed; a type
//             changed; a field or argument newly required; an allowed value removed; the read
//             API's api_version raised
//   additive  something new that nothing has to use: a schema, optional field, command, optional
//             argument, alias, output field, report key, trailer or allowed value added; a
//             required field made optional
//   fix       the executor contract's wording changed, with its report shape and trailers the same
//
// The bump comes from the delta alone (principle 10): breaking proposes major, or minor while the
// version is 0.y.z (flagged breaking); additive proposes minor; anything else, internal change
// included however large, proposes patch.

import { bumpVersion, parseVersion } from './semver.mjs';

/**
 * @typedef {import('./surface.mjs').Surface} Surface
 * @typedef {import('../tracker/files/releases.mjs').DeltaEntry} DeltaEntry
 * @typedef {import('./semver.mjs').Bump} Bump
 */

/** An empty surface: what there was before the first release. @returns {Surface} */
export const emptySurface = () => ({
  surface_version: 1,
  schemas: {},
  cli: {},
  report: [],
  trailers: [],
  contract: null,
  read_api: null,
});

/**
 * @param {string[]} before @param {string[]} after
 * @returns {{ added: string[], removed: string[] }}
 */
const setDiff = (before, after) => ({
  added: after.filter((x) => !before.includes(x)),
  removed: before.filter((x) => !after.includes(x)),
});

/**
 * The changes from one surface to another.
 * @param {Surface} before @param {Surface} after
 * @returns {DeltaEntry[]}
 */
export function diffSurface(before, after) {
  /** @type {DeltaEntry[]} */
  const out = [];
  /** @param {'breaking' | 'additive' | 'fix'} impact @param {string} surface @param {string} what */
  const add = (impact, surface, what) => out.push({ impact, surface, what });

  // Schemas. The report schema is the report shape, so it counts there.
  const ids = [...new Set([...Object.keys(before.schemas), ...Object.keys(after.schemas)])].sort();
  for (const id of ids) {
    const surface = id === 'report' ? 'report' : 'schemas';
    const a = before.schemas[id];
    const b = after.schemas[id];
    if (!a) {
      add('additive', surface, `schema ${id} added`);
      continue;
    }
    if (!b) {
      add('breaking', surface, `schema ${id} removed`);
      continue;
    }
    const paths = [...new Set([...Object.keys(a.fields), ...Object.keys(b.fields)])].sort();
    for (const p of paths) {
      const fa = a.fields[p];
      const fb = b.fields[p];
      if (!fa) {
        if (fb.required) add('breaking', surface, `${id}: ${p} added, required`);
        else add('additive', surface, `${id}: ${p} added`);
        continue;
      }
      if (!fb) {
        add('breaking', surface, `${id}: ${p} removed`);
        continue;
      }
      if (fa.type !== fb.type) add('breaking', surface, `${id}: ${p} type ${fa.type} → ${fb.type}`);
      if (!fa.required && fb.required) add('breaking', surface, `${id}: ${p} now required`);
      if (fa.required && !fb.required) add('additive', surface, `${id}: ${p} now optional`);
      const v = setDiff(fa.values ?? [], fb.values ?? []);
      if (fa.values && fb.values) {
        if (v.removed.length) {
          add('breaking', surface, `${id}: ${p} no longer allows ${v.removed.join(', ')}`);
        }
        if (v.added.length) add('additive', surface, `${id}: ${p} allows ${v.added.join(', ')}`);
      }
    }
  }

  // The command line (and the MCP tools generated from the same table).
  const names = [...new Set([...Object.keys(before.cli), ...Object.keys(after.cli)])].sort();
  for (const name of names) {
    const a = before.cli[name];
    const b = after.cli[name];
    if (!a) {
      add('additive', 'cli', `hitld ${name} added`);
      continue;
    }
    if (!b) {
      add('breaking', 'cli', `hitld ${name} removed`);
      continue;
    }
    const args = [...new Set([...Object.keys(a.args), ...Object.keys(b.args)])].sort();
    for (const arg of args) {
      const x = a.args[arg];
      const y = b.args[arg];
      const label = `hitld ${name} ${y?.positional || x?.positional ? `<${arg}>` : `--${arg}`}`;
      if (!x) {
        if (y.required) add('breaking', 'cli', `${label} added, required`);
        else add('additive', 'cli', `${label} added`);
      } else if (!y) add('breaking', 'cli', `${label} removed`);
      else {
        if (x.type !== y.type) add('breaking', 'cli', `${label} type ${x.type} → ${y.type}`);
        if (!x.required && y.required) add('breaking', 'cli', `${label} now required`);
        if (x.required && !y.required) add('additive', 'cli', `${label} now optional`);
        if (x.positional !== y.positional) {
          add('breaking', 'cli', `${label} ${y.positional ? 'now positional' : 'now an option'}`);
        }
      }
    }
    const al = setDiff(a.aliases, b.aliases);
    for (const x of al.removed) add('breaking', 'cli', `hitld ${name}: alias ${x} removed`);
    for (const x of al.added) add('additive', 'cli', `hitld ${name}: alias ${x} added`);
    if (a.output && b.output) {
      const o = setDiff(a.output, b.output);
      for (const f of o.removed) add('breaking', 'cli', `hitld ${name} JSON: ${f} removed`);
      for (const f of o.added) add('additive', 'cli', `hitld ${name} JSON: ${f} added`);
    }
  }

  // The contract: the report shape, the trailers, then its wording.
  const r = setDiff(before.report, after.report);
  for (const k of r.removed) add('breaking', 'report', `report key ${k} removed`);
  for (const k of r.added) add('additive', 'report', `report key ${k} added`);
  const t = setDiff(before.trailers, after.trailers);
  for (const k of t.removed) add('breaking', 'trailers', `trailer ${k} removed`);
  for (const k of t.added) add('additive', 'trailers', `trailer ${k} added`);
  if (before.contract === null && after.contract !== null) {
    add('additive', 'contract', 'executor contract added');
  } else if (before.contract !== null && after.contract === null) {
    add('breaking', 'contract', 'executor contract removed');
  } else if (before.contract !== after.contract) {
    add('fix', 'contract', "the executor contract's wording changed");
  }

  // The read API: its version rises only when a field is removed, renamed or retyped.
  if (before.read_api !== null && after.read_api !== null && after.read_api > before.read_api) {
    add('breaking', 'read-api', `api_version ${before.read_api} → ${after.read_api}`);
  } else if (before.read_api === null && after.read_api !== null) {
    add('additive', 'read-api', `read API added (api_version ${after.read_api})`);
  }
  return out;
}

/**
 * The bump a delta proposes from a base version, and why.
 * @param {DeltaEntry[]} delta
 * @param {string} base the last full release's version (0.0.0 before the first)
 * @returns {{ bump: Bump, breaking: boolean, version: string, reason: string }}
 */
export function proposeBump(delta, base) {
  const v = parseVersion(base);
  if (!v || v.pre !== null) throw new Error(`base "${base}" is not a full release version`);
  const count = (/** @type {string} */ impact) => delta.filter((e) => e.impact === impact).length;
  const breaking = count('breaking');
  const additive = count('additive');
  const fixes = count('fix');
  /** @type {Bump} */
  let bump;
  /** @type {string} */
  let reason;
  if (breaking) {
    bump = v.major === 0 ? 'minor' : 'major';
    reason =
      v.major === 0
        ? `${breaking} breaking change(s): minor while the version is 0.y.z, flagged breaking`
        : `${breaking} breaking change(s): major`;
  } else if (additive) {
    bump = 'minor';
    reason = `${additive} additive change(s), none breaking: minor`;
  } else {
    bump = 'patch';
    reason = fixes
      ? `${fixes} fix(es) to the interface, nothing added or removed: patch`
      : 'no change to the public interface: internal change proposes patch at most';
  }
  return { bump, breaking: breaking > 0, version: bumpVersion(base, bump), reason };
}
