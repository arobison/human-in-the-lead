// A small JSON Schema validator for the subset of keywords this project's schemas use.
//
// No third-party runtime dependencies (design part 16.1), so the core carries its own validator.
// Schemas that use a keyword outside the subset are refused when they are loaded (see
// checkSchema), so a keyword is never silently ignored.
//
// Beyond JSON Schema, every validation also:
// - refuses values that are not plain JSON data (functions, class instances, dates);
// - refuses keys that could pollute prototypes (__proto__, constructor, prototype);
// - refuses keys that name code to run (see isCodeRunningKey), unless the schema marks that
//   property with "x-hitld-executes", which only owner configuration schemas may do.

/**
 * @typedef {{ path: string, message: string }} ValidationError
 * @typedef {Record<string, any>} Schema
 * @typedef {(ref: string, from: Schema) => { schema: Schema, root: Schema }} RefResolver
 */

/** Keywords the validator implements or accepts as annotations. */
export const SUPPORTED_KEYWORDS = new Set([
  // structure
  '$schema',
  '$id',
  '$defs',
  '$ref',
  '$comment',
  // annotations
  'title',
  'description',
  'default',
  'examples',
  // assertions
  'type',
  'enum',
  'const',
  'pattern',
  'format',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'properties',
  'required',
  'additionalProperties',
  'minProperties',
  'maxProperties',
  'anyOf',
  // this project's extensions
  'x-hitld-schema-version', // root of an entity schema: the current schema_version
  'x-hitld-untrusted', // the string holds text from outside the trust boundary (design part 3.1)
  'x-hitld-executes', // the value is run as code; owner configuration only (design part 10)
  'x-hitld-bounded', // a { value, min, max } setting: value must lie within its bounds (part 11.2)
]);

/** Keywords that may sit next to "$ref": annotations only, since "$ref" ignores the rest. */
const REF_SIBLINGS = new Set(['$ref', '$comment', 'title', 'description', 'default', 'examples']);

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const EXEC_NAMES = new Set([
  'exec',
  'execute',
  'command',
  'commands',
  'cmd',
  'shell',
  'sh',
  'bash',
  'script',
  'scripts',
  'spawn',
]);
// Bare "hook" and "hooks" are not listed: the harness capability `hooks` (design part 15.3) is a
// level, not code. Their suffix forms (status_hook) and lifecycle prefixes (on_, post_) are.
const EXEC_PREFIXES = ['on_', 'pre_', 'post_', 'before_', 'after_'];
const EXEC_SUFFIXES = [
  '_exec',
  '_command',
  '_commands',
  '_cmd',
  '_shell',
  '_script',
  '_scripts',
  '_hook',
  '_hooks',
];

/**
 * Whether a key names code to run: a command, a script, a hook, or a lifecycle handler such as
 * `on_status_change` or `post_merge`. Data files never run code (design parts 3.4 and 10), so
 * such keys are refused even where a schema would otherwise allow extra keys.
 * @param {string} key
 */
export function isCodeRunningKey(key) {
  const k = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
  return (
    EXEC_NAMES.has(k) ||
    EXEC_PREFIXES.some((p) => k.startsWith(p) && k.length > p.length) ||
    EXEC_SUFFIXES.some((s) => k.endsWith(s))
  );
}

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** @type {Record<string, (s: string) => boolean>} */
const FORMATS = {
  // ISO 8601: a calendar date, or a date and time with a zone (design part 3.1).
  timestamp: (s) => TIMESTAMP.test(s) && !Number.isNaN(Date.parse(s)),
};

/** @param {unknown} v */
function jsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/** @param {unknown} v */
function isPlainObject(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** @param {unknown} a @param {unknown} b @returns {boolean} */
function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(/** @type {object} */ (a));
    const kb = Object.keys(/** @type {object} */ (b));
    return (
      ka.length === kb.length &&
      ka.every((k) => deepEqual(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k]))
    );
  }
  return false;
}

/** @param {string} path @param {string} key */
function childPath(path, key) {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)
    ? path
      ? `${path}.${key}`
      : key
    : `${path}[${JSON.stringify(key)}]`;
}

/** @param {string} a @param {string} b */
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return d[a.length][b.length];
}

/** @param {string} key @param {string[]} known */
function suggest(key, known) {
  let best = '';
  let bestD = Infinity;
  for (const k of known) {
    const dist = editDistance(key.toLowerCase(), k.toLowerCase());
    if (dist < bestD) [best, bestD] = [k, dist];
  }
  return bestD <= Math.max(1, Math.floor(key.length / 4)) ? best : '';
}

/** @param {unknown} v */
function show(v) {
  const s = JSON.stringify(v);
  return s && s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

/**
 * Validate data against a schema.
 * @param {Schema} schema
 * @param {unknown} data
 * @param {{ resolveRef?: RefResolver, root?: Schema }} [options]
 * @returns {ValidationError[]} empty when valid
 */
export function validate(schema, data, options = {}) {
  /** @type {ValidationError[]} */
  const errors = [];
  const resolveRef =
    options.resolveRef ??
    ((ref) => {
      throw new Error(`cannot resolve ${ref}: no resolver given`);
    });
  walk(schema, options.root ?? schema, data, '', errors, resolveRef);
  return errors;
}

/**
 * @param {Schema} schema
 * @param {Schema} root
 * @param {unknown} data
 * @param {string} path
 * @param {ValidationError[]} errors
 * @param {RefResolver} resolveRef
 */
function walk(schema, root, data, path, errors, resolveRef) {
  const at = path || '(top level)';
  /** @param {string} message */
  const fail = (message) => errors.push({ path: at, message });

  if (schema.$ref) {
    const target = resolveRef(schema.$ref, root);
    walk(target.schema, target.root, data, path, errors, resolveRef);
    return;
  }

  const t = jsonType(data);
  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
    fail(`is not JSON data (a ${t})`);
    return;
  }
  if (t === 'number' && !Number.isFinite(/** @type {number} */ (data))) {
    fail('is not a finite number');
    return;
  }
  if (t === 'object' && !isPlainObject(data)) {
    fail(`is not JSON data (a ${/** @type {object} */ (data).constructor?.name ?? 'object'})`);
    return;
  }

  if (schema.anyOf) {
    /** @type {ValidationError[][]} */
    const attempts = [];
    for (const branch of schema.anyOf) {
      /** @type {ValidationError[]} */
      const e = [];
      walk(branch, root, data, path, e, resolveRef);
      if (e.length === 0) {
        attempts.length = 0;
        break;
      }
      attempts.push(e);
    }
    if (attempts.length) {
      attempts.sort((a, b) => a.length - b.length);
      errors.push(...attempts[0]);
      return;
    }
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some(
      (/** @type {string} */ want) => want === t || (want === 'number' && t === 'integer'),
    );
    if (!ok) {
      fail(`must be ${types.join(' or ')}, not ${t}${t === 'null' ? '' : ` (${show(data)})`}`);
      return;
    }
  }

  if (schema.const !== undefined && !deepEqual(schema.const, data)) {
    fail(`must be ${show(schema.const)}, not ${show(data)}`);
  }
  if (schema.enum && !schema.enum.some((/** @type {unknown} */ e) => deepEqual(e, data))) {
    fail(`must be one of ${schema.enum.map(show).join(', ')}; got ${show(data)}`);
  }

  if (typeof data === 'string') {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      fail(
        schema.minLength === 1
          ? 'must not be empty'
          : `must be at least ${schema.minLength} characters`,
      );
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      fail(`must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(data)) {
      fail(`${show(data)} does not match the expected form ${schema.pattern}`);
    }
    if (schema.format) {
      const check = FORMATS[schema.format];
      if (!check) throw new Error(`schema uses unknown format "${schema.format}"`);
      if (!check(data)) fail(`${show(data)} is not a valid ${schema.format}`);
    }
  }

  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      fail(`is ${data}, below the minimum ${schema.minimum}`);
    }
    if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum) {
      fail(`is ${data}; must be above ${schema.exclusiveMinimum}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      fail(`is ${data}, above the maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      fail(`must have at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`);
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      fail(`must have at most ${schema.maxItems} items`);
    }
    if (schema.uniqueItems) {
      data.forEach((x, i) => {
        if (data.findIndex((y) => deepEqual(x, y)) < i) fail(`has a repeated entry ${show(x)}`);
      });
    }
    if (schema.items) {
      data.forEach((x, i) => walk(schema.items, root, x, `${path}[${i}]`, errors, resolveRef));
    }
  }

  if (isPlainObject(data)) {
    const obj = /** @type {Record<string, unknown>} */ (data);
    const props = schema.properties ?? {};
    const keys = Object.keys(obj);
    for (const key of keys) {
      const p = childPath(path, key);
      if (FORBIDDEN_KEYS.has(key)) {
        errors.push({ path: p, message: 'is a reserved key and is never allowed' });
        continue;
      }
      const propSchema = Object.hasOwn(props, key) ? props[key] : undefined;
      if (isCodeRunningKey(key) && !(propSchema && propSchema['x-hitld-executes'])) {
        errors.push({
          path: p,
          message:
            'refused: the key names code to run, and data files never run code (design part 10)',
        });
        continue;
      }
      if (propSchema) {
        walk(propSchema, root, obj[key], p, errors, resolveRef);
      } else if (schema.additionalProperties === false) {
        const hint = suggest(key, Object.keys(props));
        errors.push({
          path: p,
          message: `is not a known key${hint ? ` (did you mean "${hint}"?)` : ''}`,
        });
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        walk(schema.additionalProperties, root, obj[key], p, errors, resolveRef);
      } else {
        // Free-form value: still check that it is JSON data with no forbidden keys.
        walk({}, root, obj[key], p, errors, resolveRef);
      }
    }
    for (const req of schema.required ?? []) {
      if (!Object.hasOwn(obj, req)) {
        errors.push({ path: childPath(path, req), message: 'is required' });
      }
    }
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      fail(
        `must have at least ${schema.minProperties} key${schema.minProperties === 1 ? '' : 's'}`,
      );
    }
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
      fail(`must have at most ${schema.maxProperties} key${schema.maxProperties === 1 ? '' : 's'}`);
    }
    if (schema['x-hitld-bounded']) {
      const { value, min, max } = /** @type {Record<string, any>} */ (obj);
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        fail(`has min ${min} above max ${max}`);
      } else if (typeof value === 'number' && typeof min === 'number' && value < min) {
        fail(`value ${value} is below its bound min ${min}`);
      } else if (typeof value === 'number' && typeof max === 'number' && value > max) {
        fail(`value ${value} is above its bound max ${max}`);
      }
    }
  } else if (Array.isArray(data) && !schema.items) {
    data.forEach((x, i) => walk({}, root, x, `${path}[${i}]`, errors, resolveRef));
  }
}

/**
 * Check a schema itself: only supported keywords, and every object schema that lists
 * properties also says what happens to other keys (so unknown keys are rejected by default).
 * @param {Schema} schema
 * @param {string} name for messages
 * @param {{ allowExecutes?: boolean }} [options]
 * @returns {string[]} problems; empty when the schema is usable
 */
export function checkSchema(schema, name, options = {}) {
  /** @type {string[]} */
  const problems = [];
  /** @param {any} s @param {string} at */
  const visit = (s, at) => {
    if (typeof s !== 'object' || s === null || Array.isArray(s)) {
      problems.push(`${name}${at}: a schema must be an object`);
      return;
    }
    for (const kw of Object.keys(s)) {
      if (!SUPPORTED_KEYWORDS.has(kw)) problems.push(`${name}${at}: unsupported keyword "${kw}"`);
    }
    if (s.$ref) {
      const extra = Object.keys(s).filter((k) => !REF_SIBLINGS.has(k));
      if (extra.length) {
        problems.push(`${name}${at}: "$ref" ignores its siblings ${extra.join(', ')}`);
      }
    }
    if (s['x-hitld-executes'] && !options.allowExecutes) {
      problems.push(`${name}${at}: "x-hitld-executes" is allowed only in owner configuration`);
    }
    if (s.properties && s.additionalProperties === undefined) {
      problems.push(`${name}${at}: lists properties but does not set additionalProperties`);
    }
    for (const [k, sub] of Object.entries(s.properties ?? {})) visit(sub, `${at}.properties.${k}`);
    for (const [k, sub] of Object.entries(s.$defs ?? {})) visit(sub, `${at}.$defs.${k}`);
    if (s.items) visit(s.items, `${at}.items`);
    if (s.additionalProperties && typeof s.additionalProperties === 'object') {
      visit(s.additionalProperties, `${at}.additionalProperties`);
    }
    (s.anyOf ?? []).forEach((/** @type {any} */ sub, /** @type {number} */ i) =>
      visit(sub, `${at}.anyOf[${i}]`),
    );
  };
  visit(schema, '');
  return problems;
}

/**
 * One line per error, for people.
 * @param {ValidationError[]} errors
 * @param {string} [prefix] for example a file name
 */
export function formatErrors(errors, prefix = '') {
  return errors.map((e) => `${prefix ? `${prefix}: ` : ''}${e.path} ${e.message}`).join('\n');
}
