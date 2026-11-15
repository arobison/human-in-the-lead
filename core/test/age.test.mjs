import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decrypt,
  decryptChunks,
  encrypt,
  generateIdentity,
  headerMac,
  parseHeader,
  parseIdentities,
  parseIdentity,
  parseRecipient,
  recipientOf,
  unwrapFileKey,
} from '../lib/store/age.mjs';
import * as bech32 from '../lib/store/bech32.mjs';

const CHUNK = 64 * 1024;
const alice = generateIdentity();
const bob = generateIdentity();
const carol = generateIdentity();

/** @param {Buffer} file */
const payloadAt = (file) => parseHeader(file).payloadAt;

test('bech32: the BIP 173 valid strings decode; invalid ones are refused', () => {
  for (const s of [
    'A12UEL5L',
    'a12uel5l',
    'an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs',
    'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw',
    `11${'q'.repeat(82)}c8247j`,
    'split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w',
    '?1ezyfcl',
  ]) {
    assert.doesNotThrow(() => bech32.decode(s), s);
  }
  for (const s of [
    '\x201nwldj5', // a character below 33
    'pzry9x0s0muk', // no separator
    '1pzry9x0s0muk', // empty human-readable part
    'x1b4n0q5v', // a character outside the alphabet
    'li1dgmt3', // checksum too short
    'A1G7SGD8', // checksum computed on upper case
    'a12UEL5L', // mixed case
    '10a06t8', // empty human-readable part
  ]) {
    assert.throws(() => bech32.decode(s), { code: 'bad-bech32' }, JSON.stringify(s));
  }
  const bytes = randomBytes(32);
  assert.deepEqual(bech32.decode(bech32.encode('age', bytes)), { hrp: 'age', bytes });
});

test('keys: age1 and AGE-SECRET-KEY-1 forms parse, round-trip, and refuse each other', () => {
  assert.match(alice.recipient, /^age1[02-9ac-hj-np-z]{58}$/);
  assert.match(alice.identity, /^AGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}$/);
  assert.equal(recipientOf(alice.identity), alice.recipient);
  assert.equal(parseRecipient(alice.recipient).length, 32);
  assert.deepEqual(parseIdentity(alice.identity).publicKey, parseRecipient(alice.recipient));
  assert.throws(() => parseRecipient(alice.identity), { code: 'age-bad-recipient' });
  assert.throws(() => parseIdentity(alice.recipient), { code: 'age-bad-identity' });
  // A refused private key is never repeated in the message.
  const broken = alice.identity.slice(0, -1) + (alice.identity.endsWith('Q') ? 'P' : 'Q');
  assert.throws(
    () => parseIdentity(broken),
    (/** @type {any} */ e) => e.code === 'age-bad-identity' && !e.message.includes(broken),
  );
  const file = `# created: 2026-11-15\n# public key: ${alice.recipient}\n${alice.identity}\n\n`;
  assert.equal(parseIdentities(file).length, 1);
  assert.throws(() => parseIdentities('# nothing\n'), { code: 'age-no-identities' });
  // A low-order point cannot be a recipient.
  assert.throws(() => encrypt(Buffer.from('x'), [bech32.encode('age', Buffer.alloc(32))]), {
    code: 'age-bad-recipient',
  });
});

test('round trip to several recipients: each opens it with its own key; others cannot', () => {
  for (const size of [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 2 * CHUNK, 3 * CHUNK + 17]) {
    const plain = randomBytes(size);
    const file = encrypt(plain, [alice.recipient, bob.recipient]);
    assert.ok(file.subarray(0, 22).equals(Buffer.from('age-encryption.org/v1\n')));
    assert.equal(parseHeader(file).stanzas.length, 2);
    assert.deepEqual(decrypt(file, [alice.identity]), plain, `alice, ${size}`);
    assert.deepEqual(decrypt(file, [bob.identity]), plain, `bob, ${size}`);
    assert.deepEqual(decrypt(file, [carol.identity, bob.identity]), plain, `carol then bob`);
    assert.throws(() => decrypt(file, [carol.identity]), { code: 'age-no-match' });
    // Chunks: one per 64 KiB, and one for an empty payload.
    const sealed = file.length - payloadAt(file) - 16;
    assert.equal(sealed, size + 16 * Math.max(1, Math.ceil(size / CHUNK)), `size ${size}`);
  }
  // Each file has a fresh file key and nonce.
  const a = encrypt(Buffer.from('same'), [alice.recipient]);
  const b = encrypt(Buffer.from('same'), [alice.recipient]);
  assert.notDeepEqual(a, b);
  assert.throws(() => encrypt(Buffer.from('x'), []), { code: 'age-no-recipients' });
  assert.throws(() => decrypt(a, []), { code: 'age-no-identities' });
});

/**
 * Decrypt, recording what was released before the error.
 * @param {Buffer} file @param {string[]} ids
 */
function attempt(file, ids) {
  /** @type {Buffer[]} */
  const released = [];
  try {
    for (const c of decryptChunks(file, ids)) released.push(c);
  } catch (e) {
    return { error: /** @type {any} */ (e), released: Buffer.concat(released) };
  }
  return { error: null, released: Buffer.concat(released) };
}

test('refusals: wrong key, a changed header, a changed payload, a cut or extended stream', () => {
  const plain = randomBytes(2 * CHUNK + 100);
  const file = encrypt(plain, [alice.recipient]);
  const ids = [alice.identity];
  const at = payloadAt(file);
  const flip = (/** @type {number} */ i) => {
    const b = Buffer.from(file);
    b[i] ^= 0x01;
    return b;
  };
  // In the header's base64, another letter, so the text stays valid base64.
  const swap = (/** @type {number} */ i) => {
    const b = Buffer.from(file);
    b[i] = b[i] === 0x41 ? 0x42 : 0x41;
    return b;
  };
  const cases = /** @type {[string, Buffer, string, number][]} */ ([
    // name, file, code, plain text bytes that may be released (authenticated chunks only)
    ['wrong key', file, 'age-no-match', 0],
    ['the version line', flip(3), 'age-header-invalid', 0],
    ['the ephemeral share', swap(file.indexOf('-> X25519 ') + 12), 'age-no-match', 0],
    ['the wrapped file key', swap(file.indexOf('\n', 30) + 3), 'age-no-match', 0],
    ['the header MAC', swap(at - 5), 'age-mac-mismatch', 0],
    ['the payload nonce', flip(at + 3), 'age-payload-invalid', 0],
    ['the first chunk', flip(at + 16 + 10), 'age-payload-invalid', 0],
    ['the last chunk', flip(file.length - 1), 'age-payload-invalid', 2 * CHUNK],
    [
      'the last chunk truncated',
      file.subarray(0, file.length - 1),
      'age-payload-invalid',
      2 * CHUNK,
    ],
    [
      'the last chunk dropped',
      file.subarray(0, at + 16 + 2 * (CHUNK + 16)),
      'age-payload-invalid',
      2 * CHUNK,
    ],
    [
      'data after the last chunk',
      Buffer.concat([file, Buffer.from('x')]),
      'age-payload-invalid',
      2 * CHUNK,
    ],
    ['the header only', file.subarray(0, at + 16), 'age-payload-invalid', 0],
  ]);
  for (const [name, bad, code, mayRelease] of cases) {
    const r = attempt(bad, name === 'wrong key' ? [bob.identity] : ids);
    assert.equal(r.error?.code, code, `${name}: ${r.error?.message}`);
    assert.equal(r.error?.name, 'AgeError', name);
    assert.ok(r.released.length <= mayRelease, `${name}: released ${r.released.length}`);
    assert.deepEqual(r.released, plain.subarray(0, r.released.length), name);
    // The whole-file call returns no plain text at all.
    assert.throws(() => decrypt(bad, name === 'wrong key' ? [bob.identity] : ids), { code });
    assert.ok(!String(r.error.message).includes(alice.identity), name);
  }
  // A full final chunk followed by more data: the extra data is refused.
  const exact = encrypt(randomBytes(CHUNK), [alice.recipient]);
  assert.equal(
    attempt(Buffer.concat([exact, randomBytes(40)]), ids).error?.code,
    'age-payload-invalid',
  );
});

test('a stanza of an unknown type is skipped; a malformed X25519 stanza is refused', () => {
  const plain = Buffer.from('hello');
  const file = encrypt(plain, [alice.recipient]);
  const h = parseHeader(file);
  const fileKey = unwrapFileKey(h.stanzas, [parseIdentity(alice.identity)]);
  /** @param {string[]} extra stanza lines placed before the X25519 one */
  const rebuild = (extra) => {
    const lines = h.withoutMac.toString('latin1').split('\n');
    const withoutMac = Buffer.from([lines[0], ...extra, ...lines.slice(1)].join('\n'), 'latin1');
    const mac = headerMac(fileKey, withoutMac).toString('base64').replace(/=+$/, '');
    return Buffer.concat([withoutMac, Buffer.from(` ${mac}\n`), file.subarray(h.payloadAt)]);
  };
  // Rebuilding with nothing extra gives the same file.
  assert.deepEqual(rebuild([]), file);
  assert.deepEqual(
    decrypt(rebuild(['-> unknown-type arg1 arg2', 'AAAA']), [alice.identity]),
    plain,
  );
  assert.deepEqual(decrypt(rebuild(['-> x25519 lowercase', '']), [alice.identity]), plain);
  // An X25519 stanza with two arguments, or a short share, is a header failure.
  const share = h.stanzas[0].args[0];
  const body = h.stanzas[0].body.toString('base64').replace(/=+$/, '');
  assert.throws(() => decrypt(rebuild([`-> X25519 ${share} extra`, body]), [alice.identity]), {
    code: 'age-header-invalid',
  });
  assert.throws(() => decrypt(rebuild(['-> X25519 AAAA', body]), [alice.identity]), {
    code: 'age-header-invalid',
  });
  // A stanza added without the file key fails the MAC.
  const lines = file.toString('latin1').split('\n');
  const forged = Buffer.from([lines[0], '-> other', '', ...lines.slice(1)].join('\n'), 'latin1');
  assert.throws(() => decrypt(forged, [alice.identity]), { code: 'age-mac-mismatch' });
});

// ---- Interoperability with the age program, where it is installed -----------------------------

/** @param {string} cmd */
const has = (cmd) => spawnSync(cmd, ['--version'], { encoding: 'utf8' }).status === 0;
const AGE = has('age') && has('age-keygen');
const skip = AGE ? false : 'the age program (age, age-keygen) is not installed; interop not tested';

/** @param {string[]} args @param {Buffer} [input] */
function age(args, input) {
  const r = spawnSync('age', args, { input, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, `age ${args.join(' ')}: ${r.stderr?.toString()}`);
  return r.stdout;
}

test('interop: a file this code writes opens with the age program', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hitld-age-'));
  const keyFile = join(dir, 'key.txt');
  const kg = spawnSync('age-keygen', ['-o', keyFile], { encoding: 'utf8' });
  assert.equal(kg.status, 0, kg.stderr);
  // age-keygen and this code derive the same public key from the private key.
  const theirs = spawnSync('age-keygen', ['-y', keyFile], { encoding: 'utf8' }).stdout.trim();
  const [id] = readFileSync(keyFile, 'utf8')
    .split('\n')
    .filter((l) => l.startsWith('AGE-SECRET-KEY-1'));
  assert.equal(recipientOf(id), theirs);
  assert.equal(
    spawnSync('age-keygen', ['-y'], {
      input: `${alice.identity}\n`,
      encoding: 'utf8',
    }).stdout.trim(),
    alice.recipient,
  );
  const ourKey = join(dir, 'ours.txt');
  writeFileSync(ourKey, `${alice.identity}\n`, { mode: 0o600 });
  for (const size of [0, 5, CHUNK, CHUNK + 1, 3 * CHUNK]) {
    const plain = randomBytes(size);
    const file = encrypt(plain, [alice.recipient, theirs]);
    const path = join(dir, `ours-${size}.age`);
    writeFileSync(path, file);
    assert.deepEqual(age(['-d', '-i', keyFile, path]), plain, `age-keygen key, ${size}`);
    assert.deepEqual(age(['-d', '-i', ourKey, path]), plain, `our key, ${size}`);
  }
});

test('interop: a file the age program writes opens with this code', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'hitld-age-'));
  const keyFile = join(dir, 'key.txt');
  assert.equal(spawnSync('age-keygen', ['-o', keyFile]).status, 0);
  const ids = parseIdentities(readFileSync(keyFile).toString('utf8'));
  for (const size of [0, 5, CHUNK, CHUNK + 1, 3 * CHUNK]) {
    const plain = randomBytes(size);
    const file = age(['-r', bob.recipient, '-i', keyFile, '-e'], plain);
    assert.deepEqual(decrypt(file, [bob.identity]), plain, `our key, ${size}`);
    assert.deepEqual(decrypt(file, ids), plain, `age-keygen key, ${size}`);
  }
  // Several recipients given to age.
  const many = age(
    ['-r', alice.recipient, '-r', bob.recipient, '-r', carol.recipient],
    randomBytes(9),
  );
  assert.equal(parseHeader(many).stanzas.filter((s) => s.type === 'X25519').length, 3);
  assert.equal(decrypt(many, [carol.identity]).length, 9);
});
