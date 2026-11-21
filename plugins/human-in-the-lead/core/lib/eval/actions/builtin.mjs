// The actions every scenario can use. An action is a step a scenario takes: it gets its `with`
// (checked against `input`) and the run context, and returns plain JSON data that the graders read
// under steps.<id>.
//
// Seam: a piece adds its own actions by adding a file next to this one that exports `actions`;
// the runner loads every file in this directory. An action calls the piece's library (never a
// harness: use ctx.adapter, the fake) and returns data.

import { schemas } from '../../schema/registry.mjs';
import { DISPATCH_ID_PATTERN } from '../../ledger/ids.mjs';
import { checkHarnessAdapter } from '../../../harness/interface.mjs';
import { isObject, readSandboxFile, sandboxPath, writeSandboxFile } from '../util.mjs';

/**
 * @typedef {object} ActionContext
 * @property {string} sandbox the sandbox directory; the fixture is already built in it
 * @property {number} seed the scenario's seed
 * @property {string} profile the adapter profile, or "none"
 * @property {() => import('../../../harness/fake/fake.mjs').FakeAdapter} adapter the fake adapter for this profile, created on first use
 * @property {(tokens: number) => void} recordTokens add to the tokens this scenario is charged
 *
 * @typedef {object} Action
 * @property {string} description
 * @property {Record<string, any>} input the JSON Schema of `with`
 * @property {(input: Record<string, any>, ctx: ActionContext) => unknown | Promise<unknown>} run
 */

/**
 * Set a value at a key path inside plain JSON data, creating objects on the way. A key that is an
 * integer indexes an array that is already there.
 * @param {unknown} root @param {string[]} keys @param {unknown} value
 */
function setAt(root, keys, value) {
  /** @param {any} node @param {string} k */
  const holds = (node, k) =>
    Array.isArray(node) ? /^\d+$/.test(k) && Number(k) < node.length : Object.hasOwn(node, k);
  /** @param {any} node @param {string} k @param {unknown} v */
  const put = (node, k, v) => {
    // defineProperty, not assignment: a key such as "__proto__" stays plain data, and validation
    // refuses it, so a scenario can test that refusal.
    if (Array.isArray(node)) node[Number(k)] = v;
    else
      Object.defineProperty(node, k, {
        value: v,
        enumerable: true,
        writable: true,
        configurable: true,
      });
  };
  if (!isObject(root)) throw new Error('can only set keys inside an object');
  /** @type {any} */
  let node = root;
  for (const k of keys.slice(0, -1)) {
    if (!holds(node, k) || typeof node[k] !== 'object' || node[k] === null) {
      if (Array.isArray(node)) throw new Error(`key ${JSON.stringify(k)} is not in the array`);
      put(node, k, {});
    }
    node = node[k];
  }
  const last = keys[keys.length - 1];
  if (Array.isArray(node) && !holds(node, last)) {
    throw new Error(`key ${JSON.stringify(last)} is not in the array`);
  }
  put(node, last, value);
}

const KEY_PATH = {
  description:
    'Keys from the top of the object down, as strings. A key that names code is given here, as a string, because a scenario file is data and cannot contain such a key itself.',
  type: 'array',
  items: { type: 'string', minLength: 1 },
  minItems: 1,
};

/** @type {Readonly<Record<string, Action>>} */
export const actions = Object.freeze({
  cli: {
    description:
      'Run a hitld command in the sandbox (as the command line would). Returns { exit, result }: the exit code and the parsed JSON the command printed.',
    input: {
      type: 'object',
      properties: {
        argv: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['argv'],
      additionalProperties: false,
    },
    run: async ({ argv }, ctx) => {
      // Imported when used: the command table includes the eval command, which imports the runner.
      const { main } = await import('../../cli/main.mjs');
      let out = '';
      const exit = await main(argv, {
        out: (t) => (out += t),
        err: () => {},
        cwd: ctx.sandbox,
        env: {},
      });
      /** @type {unknown} */
      let result = null;
      try {
        result = JSON.parse(out);
      } catch {
        result = { text: out };
      }
      return { exit, result };
    },
  },

  'file.write': {
    description: 'Write a text file in the sandbox.',
    input: {
      type: 'object',
      properties: { path: { type: 'string', minLength: 1 }, content: { type: 'string' } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    run: ({ path, content }, ctx) => {
      writeSandboxFile(sandboxPath(ctx.sandbox, path), content);
      return { path };
    },
  },

  'file.set-json': {
    description: 'Set one value inside a JSON file in the sandbox, creating the keys on the way.',
    input: {
      type: 'object',
      properties: { path: { type: 'string', minLength: 1 }, key_path: KEY_PATH, value: {} },
      required: ['path', 'key_path', 'value'],
      additionalProperties: false,
    },
    run: ({ path, key_path, value }, ctx) => {
      const file = sandboxPath(ctx.sandbox, path);
      const data = JSON.parse(readSandboxFile(file));
      setAt(data, key_path, value);
      writeSandboxFile(file, `${JSON.stringify(data, null, 2)}\n`);
      return { path, key_path };
    },
  },

  'schema.validate': {
    description:
      'Validate data against a schema in schemas/, after setting values by key path. Returns { valid, errors } with errors as { path, message }.',
    input: {
      type: 'object',
      properties: {
        schema: { type: 'string', minLength: 1 },
        entity: {
          description: 'Validate as a stand-alone data file, schema_version included.',
          type: 'boolean',
        },
        data: { type: 'object' },
        set: {
          type: 'array',
          items: {
            type: 'object',
            properties: { key_path: KEY_PATH, value: {} },
            required: ['key_path', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['schema', 'data'],
      additionalProperties: false,
    },
    run: ({ schema, entity, data, set = [] }) => {
      const copy = structuredClone(data);
      for (const s of set) setAt(copy, s.key_path, s.value);
      const registry = schemas();
      const errors = entity
        ? registry.validateEntity(schema, copy)
        : registry.validate(schema, copy);
      return { valid: errors.length === 0, errors };
    },
  },

  'adapter.dispatch': {
    description:
      "Dispatch to the profile's fake adapter and, if it accepts, complete the dispatch with the given report. Returns { accepted, refusal, completion }. A refusal is data, not an error.",
    input: {
      type: 'object',
      properties: {
        dispatch: { type: 'string', pattern: DISPATCH_ID_PATTERN },
        item: { type: 'string', minLength: 1 },
        tier: { type: 'integer', minimum: 0, maximum: 3 },
        role: { type: 'string', minLength: 1 },
        classification: { enum: ['public', 'internal', 'confidential', 'secret'] },
        brief: { type: 'string', minLength: 1 },
        report: { type: 'string' },
        tokens: { type: 'integer', minimum: 0 },
        complete: {
          description: 'false: leave the dispatch in flight, so a later dispatch meets it.',
          type: 'boolean',
        },
      },
      required: ['dispatch', 'item'],
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      const adapter = ctx.adapter();
      const problems = checkHarnessAdapter(adapter);
      if (problems.length) throw new Error(`the fake adapter is invalid: ${problems.join('; ')}`);
      try {
        const handle = await adapter.dispatch({
          dispatch: input.dispatch,
          item: input.item,
          brief: input.brief ?? `Work on ${input.item}.`,
          tier: input.tier ?? 1,
          role: input.role ?? 'executor',
          isolation: 'worktree',
          classification: input.classification ?? 'public',
        });
        if (input.complete === false) return { accepted: true, refusal: null, completion: null };
        adapter.complete(input.dispatch, {
          report: input.report ?? 'done',
          usage:
            input.tokens === undefined
              ? null
              : { tokens: input.tokens, toolCalls: null, durationMs: null },
        });
        const completion = await adapter.onComplete(handle);
        if (completion.usage?.tokens) ctx.recordTokens(completion.usage.tokens);
        return { accepted: true, refusal: null, completion };
      } catch (e) {
        return {
          accepted: false,
          refusal: e instanceof Error ? e.message : String(e),
          completion: null,
        };
      }
    },
  },

  'adapter.capabilities': {
    description: "The profile's declared capabilities.",
    input: { type: 'object', properties: {}, additionalProperties: false },
    run: (_input, ctx) => ctx.adapter().capabilities(),
  },
});
