// age's published test vectors (C2SP CCTV), the ones that apply to X25519 recipients without
// ASCII armor. Source, license and how they were chosen: fixtures/age/README.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { decrypt, decryptChunks } from '../lib/store/age.mjs';

const DIR = fileURLToPath(new URL('./fixtures/age/testdata/', import.meta.url));

/** What each `expect` value means here: the AgeError code, or success. */
const EXPECT = /** @type {Record<string, string | null>} */ ({
  success: null,
  'header failure': 'age-header-invalid',
  'no match': 'age-no-match',
  'HMAC failure': 'age-mac-mismatch',
  'payload failure': 'age-payload-invalid',
});

/** @param {string} name */
function vector(name) {
  const raw = readFileSync(join(DIR, name));
  const split = raw.indexOf('\n\n');
  /** @type {Record<string, string[]>} */
  const meta = {};
  for (const line of raw.subarray(0, split).toString('utf8').split('\n')) {
    const [k, v] = line.split(/: (.*)/s, 2);
    (meta[k] ??= []).push(v);
  }
  const body = raw.subarray(split + 2);
  return {
    expect: meta.expect[0],
    payload: meta.payload?.[0],
    identities: meta.identity ?? [],
    file: meta.compressed?.[0] === 'zlib' ? inflateSync(body) : body,
  };
}

const names = readdirSync(DIR).sort();

test('the committed vectors are the 68 chosen', () => {
  assert.equal(names.length, 68);
});

for (const name of names) {
  test(`age vector ${name}`, () => {
    const v = vector(name);
    assert.ok(v.expect in EXPECT, `unknown expect ${v.expect}`);
    const code = EXPECT[v.expect];
    // Collect what decryptChunks releases before any error: it must be exactly the authenticated
    // prefix the vector's payload hash names.
    /** @type {Buffer[]} */
    const released = [];
    /** @type {any} */
    let error = null;
    try {
      for (const chunk of decryptChunks(v.file, v.identities)) released.push(chunk);
    } catch (e) {
      error = e;
    }
    if (code === null) {
      assert.equal(error, null, `${name}: ${error?.code} ${error?.message}`);
    } else {
      assert.equal(error?.name, 'AgeError', `${name}: expected ${code}, got ${error}`);
      assert.equal(error.code, code, `${name}: ${error.message}`);
      // The whole-file call returns nothing on failure.
      assert.throws(() => decrypt(v.file, v.identities), { code });
    }
    if (v.payload) {
      const hash = createHash('sha256').update(Buffer.concat(released)).digest('hex');
      assert.equal(hash, v.payload, `${name}: the released plain text`);
    }
    if (code === null) {
      const whole = decrypt(v.file, v.identities);
      assert.equal(createHash('sha256').update(whole).digest('hex'), v.payload);
    }
  });
}
