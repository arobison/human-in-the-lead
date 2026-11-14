import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, checkSchema, isCodeRunningKey, formatErrors } from '../lib/schema/validate.mjs';

const closed = {
  type: 'object',
  properties: { title: { type: 'string' }, state: { enum: ['open', 'done'] } },
  required: ['title'],
  additionalProperties: false,
};

test('unknown keys are rejected, with a suggestion for a near miss', () => {
  const errors = validate(closed, { title: 'x', stat: 'open' });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'stat');
  assert.match(errors[0].message, /not a known key \(did you mean "state"\?\)/);
});

test('code-running keys are refused in every spelling, at any depth', () => {
  const free = { type: 'object' };
  for (const key of [
    'on_status_change',
    'onStatusChange',
    'on-close',
    'post_merge',
    'preCommit',
    'before_claim',
    'after_done',
    'command',
    'cmd',
    'shell',
    'exec',
    'script',
    'git_hooks',
    'status_hook',
    'cleanup_command',
    'build_script',
  ]) {
    const errors = validate(free, { nested: { deeper: [{ [key]: 'rm -rf /' }] } });
    assert.equal(errors.length, 1, key);
    assert.match(errors[0].message, /names code to run/, key);
    assert.equal(errors[0].path, `nested.deeper[0].${key}`);
  }
});

test('ordinary keys are not mistaken for code-running keys', () => {
  for (const key of [
    'run',
    'runs',
    'eval',
    'commit',
    'prev_hash',
    'check_after',
    'context',
    'owner',
    'once',
    'post',
    'preview',
    'notes',
    'hookup',
    'hooks',
  ]) {
    assert.equal(isCodeRunningKey(key), false, key);
  }
});

test('a property marked x-hitld-executes may hold a command', () => {
  const schema = {
    type: 'object',
    properties: { setup_commands: { type: 'array', 'x-hitld-executes': 'owner-declared setup' } },
    additionalProperties: false,
  };
  assert.deepEqual(validate(schema, { setup_commands: ['npm ci'] }), []);
});

test('prototype-polluting keys are refused', () => {
  const data = JSON.parse('{"title":"x","__proto__":{"admin":true}}');
  const errors = validate({ type: 'object' }, data);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /reserved key/);
  assert.equal(/** @type {any} */ ({}).admin, undefined);
});

test('values that are not JSON data are refused', () => {
  assert.match(validate({}, { f: () => 1 })[0].message, /not JSON data \(a function\)/);
  assert.match(validate({}, { d: new Date() })[0].message, /not JSON data \(a Date\)/);
  assert.match(validate({}, { n: NaN })[0].message, /not a finite number/);
});

test('errors are readable: path, what was expected, what was found', () => {
  const errors = validate(closed, { state: 'closed' });
  const text = formatErrors(errors, 'W-1.md');
  assert.match(text, /W-1\.md: state must be one of "open", "done"; got "closed"/);
  assert.match(text, /W-1\.md: title is required/);
});

test('types, bounds, patterns, formats and arrays', () => {
  const schema = {
    type: 'object',
    properties: {
      n: { type: 'integer', minimum: 1, maximum: 3 },
      id: { type: 'string', pattern: '^W-[0-9]+$' },
      at: { type: 'string', format: 'timestamp' },
      tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    },
    additionalProperties: false,
  };
  assert.deepEqual(
    validate(schema, { n: 2, id: 'W-1', at: '2026-11-14T02:25:00+01:00', tags: ['a'] }),
    [],
  );
  assert.deepEqual(validate(schema, { at: '2026-11-14' }), []);
  const errors = validate(schema, { n: 2.5, id: 'X-1', at: '2026-11-14T02:25', tags: ['a', 'a'] });
  assert.deepEqual(
    errors.map((e) => e.path),
    ['n', 'id', 'at', 'tags'],
  );
});

test('a bounded setting must keep its value within min and max', () => {
  const schema = { type: 'object', 'x-hitld-bounded': true };
  assert.deepEqual(validate(schema, { value: 3, min: 1, max: 6 }), []);
  assert.match(validate(schema, { value: 9, min: 1, max: 6 })[0].message, /above its bound max 6/);
  assert.match(validate(schema, { value: 3, min: 5, max: 4 })[0].message, /min 5 above max 4/);
});

test('checkSchema refuses keywords the validator would ignore, and open objects', () => {
  assert.deepEqual(checkSchema(closed, 't'), []);
  assert.match(checkSchema({ oneOf: [] }, 't')[0], /unsupported keyword "oneOf"/);
  assert.match(
    checkSchema({ type: 'object', properties: {} }, 't')[0],
    /does not set additionalProperties/,
  );
  assert.match(checkSchema({ $ref: 'x', pattern: '^a' }, 't')[0], /ignores its siblings pattern/);
  assert.match(checkSchema({ 'x-hitld-executes': 'x' }, 't')[0], /only in owner configuration/);
  assert.deepEqual(checkSchema({ 'x-hitld-executes': 'x' }, 't', { allowExecutes: true }), []);
});
