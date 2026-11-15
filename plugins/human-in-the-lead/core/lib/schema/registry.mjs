// Loads the versioned JSON Schemas from schemas/ and validates data against them.
//
// Seams: a new schema is a new file schemas/<id>.schema.json; a new policy.json section is a new
// file schemas/policy/<section>.schema.json. Neither needs a change here.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSchema, validate } from './validate.mjs';

/**
 * @typedef {import('./validate.mjs').Schema} Schema
 * @typedef {import('./validate.mjs').ValidationError} ValidationError
 */

/** The schemas/ directory of this checkout or installed copy. */
export const SCHEMA_DIR = fileURLToPath(new URL('../../../schemas/', import.meta.url));

/** Tracker entity kinds (design part 3.2) and the schema each uses. */
export const TRACKER_KINDS = Object.freeze({
  project: 'project',
  work: 'item',
  external: 'item',
  decision: 'decision',
  milestone: 'milestone',
});

/** @param {unknown} v */
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

export class SchemaRegistry {
  /** @param {string} [dir] */
  constructor(dir = SCHEMA_DIR) {
    /** @type {Map<string, Schema>} */
    this.schemas = new Map();
    /** @type {string[]} */
    this.policySections = [];
    this.#load(dir);
  }

  /** @param {string} dir */
  #load(dir) {
    /** @param {string} file @param {boolean} allowExecutes */
    const add = (file, allowExecutes) => {
      const schema = JSON.parse(readFileSync(file, 'utf8'));
      if (!schema.$id) throw new Error(`${file}: schema has no $id`);
      const problems = checkSchema(schema, file, { allowExecutes });
      if (problems.length) throw new Error(problems.join('\n'));
      if (this.schemas.has(schema.$id)) throw new Error(`${file}: duplicate $id ${schema.$id}`);
      this.schemas.set(schema.$id, schema);
      return schema;
    };
    for (const f of readdirSync(dir).sort()) {
      if (f.endsWith('.schema.json')) add(join(dir, f), false);
    }
    const policyDir = join(dir, 'policy');
    if (existsSync(policyDir)) {
      for (const f of readdirSync(policyDir).sort()) {
        if (!f.endsWith('.schema.json')) continue;
        const s = add(join(policyDir, f), true);
        const section = s.$id.replace(/^policy\//, '');
        if (s.$id !== `policy/${section}` || `${section}.schema.json` !== f) {
          throw new Error(`${f}: a policy section's $id must be policy/<file name>`);
        }
        this.policySections.push(section);
      }
    }
    this.schemas.set('policy', this.#policyRoot());
    for (const [id, schema] of this.schemas) this.#checkRefs(schema, id);
  }

  /** The policy.json schema, assembled from one file per section. @returns {Schema} */
  #policyRoot() {
    /** @type {Record<string, Schema>} */
    const properties = { schema_version: { $ref: 'common#/$defs/schemaVersion' } };
    for (const s of this.policySections) properties[s] = { $ref: `policy/${s}` };
    return {
      $id: 'policy',
      title: 'policy.json',
      description:
        'Every tunable setting, with the owner bounds (design part 11.2). Assembled from schemas/policy/*.schema.json.',
      'x-hitld-schema-version': 1,
      type: 'object',
      properties,
      required: ['schema_version', 'project'],
      additionalProperties: false,
    };
  }

  /** Fail at load time on a $ref that does not resolve. @param {any} s @param {string} id */
  #checkRefs(s, id) {
    if (!isObject(s)) return;
    const root = this.schemas.get(id);
    if (typeof s.$ref === 'string') this.resolve(s.$ref, /** @type {Schema} */ (root));
    for (const v of Object.values(s)) {
      if (Array.isArray(v)) v.forEach((x) => this.#checkRefs(x, id));
      else if (isObject(v)) this.#checkRefs(v, id);
    }
  }

  /**
   * Resolve a $ref: "other-id", "other-id#/$defs/x" or "#/$defs/x" (within `from`).
   * @param {string} ref
   * @param {Schema} from the root schema the reference appears in
   * @returns {{ schema: Schema, root: Schema }}
   */
  resolve(ref, from) {
    const [base, pointer = ''] = ref.split('#');
    const root = base ? this.schemas.get(base) : from;
    if (!root) throw new Error(`unresolved $ref "${ref}": no schema with $id "${base}"`);
    let target = root;
    for (const part of pointer.split('/').filter(Boolean)) {
      target = target?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    if (!isObject(target)) throw new Error(`unresolved $ref "${ref}"`);
    return { schema: target, root };
  }

  /** @param {string} id */
  get(id) {
    const s = this.schemas.get(id);
    if (!s) throw new Error(`no schema "${id}"`);
    return s;
  }

  /** The schema IDs that describe stand-alone data files (they carry schema_version). */
  versionedIds() {
    return [...this.schemas.values()]
      .filter((s) => s['x-hitld-schema-version'] !== undefined)
      .map((s) => /** @type {string} */ (s.$id));
  }

  /** @param {string} id */
  currentVersion(id) {
    return /** @type {number | undefined} */ (this.get(id)['x-hitld-schema-version']);
  }

  /**
   * Validate against a schema without the schema_version rules (for embedded parts).
   * @param {string} id @param {unknown} data @returns {ValidationError[]}
   */
  validate(id, data) {
    const schema = this.get(id);
    return validate(schema, data, { resolveRef: (ref, from) => this.resolve(ref, from) });
  }

  /**
   * Validate a stand-alone data file: schema_version first (refusing versions newer than this
   * release knows, design part 16.5), then the schema.
   * @param {string} id @param {unknown} data @returns {ValidationError[]}
   */
  validateEntity(id, data) {
    const current = this.currentVersion(id);
    if (current === undefined) throw new Error(`schema "${id}" is not a versioned data file`);
    if (isObject(data)) {
      const v = /** @type {Record<string, unknown>} */ (data).schema_version;
      if (v === undefined) return [{ path: 'schema_version', message: 'is required' }];
      if (Number.isInteger(v) && /** @type {number} */ (v) > current) {
        return [
          {
            path: 'schema_version',
            message: `is ${v}, newer than this release knows (${current}); upgrade hitld (the human-in-the-lead plugin) before reading or writing this file`,
          },
        ];
      }
    }
    return this.validate(id, data);
  }

  /**
   * Validate tracker front matter, choosing the schema by its kind.
   * @param {unknown} data @returns {ValidationError[]}
   */
  validateTrackerEntity(data) {
    const kind = isObject(data) ? /** @type {Record<string, unknown>} */ (data).kind : undefined;
    const id =
      typeof kind === 'string' && Object.hasOwn(TRACKER_KINDS, kind)
        ? TRACKER_KINDS[/** @type {keyof typeof TRACKER_KINDS} */ (kind)]
        : undefined;
    if (!id) {
      return [
        {
          path: 'kind',
          message: `must be one of ${Object.keys(TRACKER_KINDS).join(', ')}; got ${JSON.stringify(kind)}`,
        },
      ];
    }
    return this.validateEntity(id, data);
  }

  /**
   * Paths of the properties typed as untrusted text in a schema (design part 3.1).
   * @param {string} id @returns {string[]}
   */
  untrustedFields(id) {
    /** @type {string[]} */
    const out = [];
    /** @param {Schema} s @param {Schema} root @param {string} path @param {number} depth */
    const visit = (s, root, path, depth) => {
      if (depth > 20) return;
      if (s.$ref) {
        const t = this.resolve(s.$ref, root);
        visit(t.schema, t.root, path, depth + 1);
        return;
      }
      if (s['x-hitld-untrusted']) out.push(path);
      for (const [k, sub] of Object.entries(s.properties ?? {})) {
        visit(sub, root, path ? `${path}.${k}` : k, depth + 1);
      }
      if (s.items) visit(s.items, root, `${path}[]`, depth + 1);
    };
    const root = this.get(id);
    visit(root, root, '', 0);
    return out;
  }
}

/** @type {SchemaRegistry | undefined} */
let shared;

/** The registry for this checkout's schemas/, loaded once. */
export function schemas() {
  shared ??= new SchemaRegistry();
  return shared;
}
