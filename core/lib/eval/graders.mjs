// Graders (design part 17.3): deterministic checks of the end state a scenario's steps produced.
// A scenario passes when every grader passes.
//
// Seams:
//   - A new grader is an entry in GRADERS: an input schema for its `with` and a `run`.
//   - `model_judge` is the place for judged grading (a rubric, a different model, the majority of
//     three votes). It needs a model, so offline runs treat a scenario that uses it as not
//     applicable. The live runner (core/lib/eval/live.mjs) is where it gets an implementation.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { schemas } from '../schema/registry.mjs';
import { formatErrors } from '../schema/validate.mjs';
import { deepEqual, getPath, sandboxPath } from './util.mjs';

/**
 * @typedef {object} GradingState what a grader can look at
 * @property {Record<string, unknown>} steps each step's result, by step ID
 * @property {string} sandbox the sandbox directory
 * @property {{ method: string, args: unknown[] }[]} adapterCalls the calls made to the fake adapter
 *
 * @typedef {object} Verdict
 * @property {boolean} passed
 * @property {string} message
 * @property {string} [path] the value looked at
 * @property {unknown} [expected] what the grader wanted
 * @property {unknown} [actual] what it found
 *
 * @typedef {object} Grader
 * @property {string} description
 * @property {Record<string, any>} input the JSON Schema of `with`
 * @property {boolean} [needsModel] true: cannot run offline
 * @property {(input: Record<string, any>, state: GradingState) => Verdict} run
 */

/** @param {unknown} v */
const show = (v) => {
  const s = JSON.stringify(v);
  return s === undefined ? 'undefined' : s.length > 120 ? `${s.slice(0, 117)}...` : s;
};

/** The most characters of an expected or actual value a stored verdict keeps. */
export const DETAIL_LIMIT = 2000;

/**
 * Bound a verdict's expected and actual values for storage, so a run file cannot balloon: one
 * longer than DETAIL_LIMIT characters (as JSON) becomes its first DETAIL_LIMIT characters, with
 * expected_truncated or actual_truncated set. Shorter ones are kept as they are.
 * @param {Verdict} verdict
 * @returns {Verdict & { expected_truncated?: true, actual_truncated?: true }}
 */
export function boundVerdict(verdict) {
  /** @type {Record<string, unknown>} */
  const out = { ...verdict };
  for (const key of /** @type {const} */ (['expected', 'actual'])) {
    if (!(key in out)) continue;
    const text = out[key] === undefined ? undefined : JSON.stringify(out[key]);
    if (text === undefined) delete out[key];
    else if (text.length > DETAIL_LIMIT) {
      out[key] = text.slice(0, DETAIL_LIMIT);
      out[`${key}_truncated`] = true;
    }
  }
  return /** @type {Verdict} */ (out);
}

/** The comparison bounds a grader was given, without the ones it was not. @param {Record<string, unknown>} o */
const bounds = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * @param {GradingState} state @param {string} path
 * @returns {{ ok: true, value: unknown } | { ok: false, verdict: Verdict }}
 */
function read(state, path) {
  const r = getPath({ steps: state.steps }, path);
  return r.found
    ? { ok: true, value: r.value }
    : {
        ok: false,
        verdict: { passed: false, message: `${path} was not produced by any step`, path },
      };
}

/** Limits on a `matches` pattern: scenarios are data that agents will write, so a pattern is untrusted. */
export const MATCH_LIMITS = Object.freeze({
  /** The longest pattern, in characters. */
  patternLength: 200,
  /** The longest text a pattern is run against, in characters. */
  inputLength: 10000,
  /** The most texts one grader checks. */
  inputs: 500,
  /** How long a match may run before it is killed, in milliseconds. */
  timeoutMs: 1000,
});

/** Run in a child process, so a runaway pattern can be killed: it reads {pattern, values} on stdin. */
const MATCH_CHILD = `
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (data += c));
process.stdin.on('end', () => {
  try {
    const { pattern, values } = JSON.parse(data);
    const re = new RegExp(pattern, 'u');
    process.stdout.write(JSON.stringify({ hits: values.map((v) => typeof v === 'string' && re.test(v)) }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
});
`;

/**
 * Test a pattern against texts with a size cap and a time limit. A regular expression can take
 * time exponential in its input (a catastrophic pattern), and V8 offers no way to interrupt one in
 * this process, so the match runs in a child process that is killed at the limit. Throws, so the
 * runner reports a grader error, when a limit is exceeded or the pattern is invalid.
 * @param {string} pattern @param {unknown[]} values @returns {boolean[]} whether each value matched
 */
export function safeMatches(pattern, values) {
  const L = MATCH_LIMITS;
  if (pattern.length > L.patternLength) {
    throw new Error(`the pattern is ${pattern.length} characters; the limit is ${L.patternLength}`);
  }
  if (values.length > L.inputs) {
    throw new Error(`matching ${values.length} values; the limit is ${L.inputs}`);
  }
  for (const v of values) {
    if (typeof v === 'string' && v.length > L.inputLength) {
      throw new Error(`a value to match is ${v.length} characters; the limit is ${L.inputLength}`);
    }
  }
  const r = spawnSync(process.execPath, ['--input-type=commonjs', '-e', MATCH_CHILD], {
    input: JSON.stringify({ pattern, values }),
    timeout: L.timeoutMs,
    killSignal: 'SIGKILL',
    encoding: 'utf8',
    env: {},
    maxBuffer: 1 << 20,
  });
  if (r.error && /** @type {NodeJS.ErrnoException} */ (r.error).code === 'ETIMEDOUT') {
    throw new Error(
      `the pattern /${pattern}/ took longer than ${L.timeoutMs} ms and was stopped (a catastrophic pattern?)`,
    );
  }
  if (r.error) throw new Error(`the pattern could not be run: ${r.error.message}`);
  /** @type {{ hits?: boolean[], error?: string }} */
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    throw new Error(
      `the pattern /${pattern}/ could not be run (exit ${r.status}, signal ${r.signal})`,
    );
  }
  if (out.error !== undefined) throw new Error(`the pattern is invalid: ${out.error}`);
  return /** @type {boolean[]} */ (out.hits);
}

const PATH = { type: 'string', minLength: 1 };
const COMPARE = {
  equals: { type: 'integer', minimum: 0 },
  min: { type: 'integer', minimum: 0 },
  max: { type: 'integer', minimum: 0 },
};

/** @type {Readonly<Record<string, Grader>>} */
export const GRADERS = Object.freeze({
  equals: {
    description: 'The value at a path equals a value (deep, exact).',
    input: {
      type: 'object',
      properties: { path: PATH, value: {} },
      required: ['path', 'value'],
      additionalProperties: false,
    },
    run: ({ path, value }, state) => {
      const r = read(state, path);
      if (!r.ok) return r.verdict;
      return deepEqual(r.value, value)
        ? {
            passed: true,
            message: `${path} is ${show(value)}`,
            path,
            expected: value,
            actual: r.value,
          }
        : {
            passed: false,
            message: `${path} is ${show(r.value)}, expected ${show(value)}`,
            path,
            expected: value,
            actual: r.value,
          };
    },
  },
  matches: {
    description:
      'The text at a path matches a regular expression. For a list (a path with [*]), `mode` any (default) or all of its entries must match.',
    input: {
      type: 'object',
      properties: {
        path: PATH,
        pattern: { type: 'string', minLength: 1, maxLength: MATCH_LIMITS.patternLength },
        mode: { enum: ['any', 'all'] },
      },
      required: ['path', 'pattern'],
      additionalProperties: false,
    },
    run: ({ path, pattern, mode = 'any' }, state) => {
      const r = read(state, path);
      if (!r.ok) return r.verdict;
      const values = Array.isArray(r.value) ? r.value : [r.value];
      const hits = safeMatches(pattern, values);
      const passed = mode === 'all' ? hits.length > 0 && hits.every(Boolean) : hits.some(Boolean);
      return {
        passed,
        message: passed
          ? `${path} matches /${pattern}/`
          : `${path} has no ${mode === 'all' ? 'full' : ''} match for /${pattern}/: ${show(r.value)}`,
        path,
        expected: `${mode === 'all' ? 'all match' : 'any match'} /${pattern}/`,
        actual: r.value,
      };
    },
  },
  contains: {
    description:
      'The list at a path has an entry equal to a value, or the text at it includes a string.',
    input: {
      type: 'object',
      properties: { path: PATH, value: {} },
      required: ['path', 'value'],
      additionalProperties: false,
    },
    run: ({ path, value }, state) => {
      const r = read(state, path);
      if (!r.ok) return r.verdict;
      const passed = Array.isArray(r.value)
        ? r.value.some((v) => deepEqual(v, value))
        : typeof r.value === 'string' && typeof value === 'string' && r.value.includes(value);
      return {
        passed,
        message: passed
          ? `${path} contains ${show(value)}`
          : `${path} does not contain ${show(value)}: ${show(r.value)}`,
        path,
        expected: value,
        actual: r.value,
      };
    },
  },
  count: {
    description:
      'The list at a path has this many entries: equals, or at least min, or at most max.',
    input: {
      type: 'object',
      properties: { path: PATH, ...COMPARE },
      required: ['path'],
      additionalProperties: false,
    },
    run: ({ path, equals, min, max }, state) => {
      const r = read(state, path);
      if (!r.ok) return r.verdict;
      if (!Array.isArray(r.value)) return { passed: false, message: `${path} is not a list` };
      const n = r.value.length;
      const ok =
        (equals === undefined || n === equals) &&
        (min === undefined || n >= min) &&
        (max === undefined || n <= max);
      return {
        passed: ok,
        message: `${path} has ${n} entries${ok ? '' : ` (wanted ${show({ equals, min, max })})`}`,
        path,
        expected: bounds({ equals, min, max }),
        actual: n,
      };
    },
  },
  schema: {
    description:
      'The value at a path is valid against a schema in schemas/ (entity: true also requires and checks schema_version).',
    input: {
      type: 'object',
      properties: {
        path: PATH,
        schema: { type: 'string', minLength: 1 },
        entity: { type: 'boolean' },
      },
      required: ['path', 'schema'],
      additionalProperties: false,
    },
    run: ({ path, schema, entity }, state) => {
      const r = read(state, path);
      if (!r.ok) return r.verdict;
      const registry = schemas();
      const errors = entity
        ? registry.validateEntity(schema, r.value)
        : registry.validate(schema, r.value);
      return errors.length
        ? {
            passed: false,
            message: `${path} is not a valid ${schema}: ${formatErrors(errors)}`,
            path,
            expected: `a valid ${schema}`,
            actual: formatErrors(errors),
          }
        : {
            passed: true,
            message: `${path} is a valid ${schema}`,
            path,
            expected: `a valid ${schema}`,
          };
    },
  },
  file_exists: {
    description: 'A file exists in the sandbox, or (present: false) does not.',
    input: {
      type: 'object',
      properties: { path: PATH, present: { type: 'boolean' } },
      required: ['path'],
      additionalProperties: false,
    },
    run: ({ path, present = true }, state) => {
      const found = existsSync(sandboxPath(state.sandbox, path));
      return {
        passed: found === present,
        message: `${path} is ${found ? 'present' : 'absent'}${found === present ? '' : `, expected ${present ? 'present' : 'absent'}`}`,
        path,
        expected: present ? 'present' : 'absent',
        actual: found ? 'present' : 'absent',
      };
    },
  },
  adapter_calls: {
    description:
      'How many calls the scenario made to the fake adapter, of one method or of all (equals, min or max). Use equals 0 for "never called".',
    input: {
      type: 'object',
      properties: { method: { type: 'string', minLength: 1 }, ...COMPARE },
      additionalProperties: false,
    },
    run: ({ method, equals, min, max }, state) => {
      const n = state.adapterCalls.filter(
        (c) => method === undefined || c.method === method,
      ).length;
      const ok =
        (equals === undefined || n === equals) &&
        (min === undefined || n >= min) &&
        (max === undefined || n <= max);
      const what = method ? `${method} calls` : 'adapter calls';
      return {
        passed: ok,
        message: `${n} ${what}${ok ? '' : ` (wanted ${show({ equals, min, max })})`}`,
        expected: bounds({ ...(method === undefined ? {} : { method }), equals, min, max }),
        actual: n,
      };
    },
  },
  model_judge: {
    description:
      'SEAM: a model grades the value at a path against a rubric. Needs a model, so it runs only in live mode, which is not built yet.',
    needsModel: true,
    input: {
      type: 'object',
      properties: { path: PATH, rubric: { type: 'string', minLength: 1 } },
      required: ['path', 'rubric'],
      additionalProperties: false,
    },
    run: () => {
      throw new Error('model_judge needs a model; it runs in live mode only');
    },
  },
});
