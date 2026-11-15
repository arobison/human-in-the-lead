// The age file format, version 1, with X25519 recipients (https://age-encryption.org/v1, the
// C2SP age specification). Node's built-in crypto only: X25519, HKDF-SHA-256, HMAC-SHA-256 and
// ChaCha20-Poly1305. Nothing here is a new primitive; this file is the specification's composition
// of them, checked against age's published test vectors and the `age` program.
//
// A file:
//   age-encryption.org/v1
//   -> X25519 <ephemeral share, base64>        one stanza per recipient
//   <wrapped file key, base64, 64 columns>
//   --- <header MAC, base64>
//   <16-byte nonce><payload: STREAM, ChaCha20-Poly1305 in 64 KiB chunks>
//
// Base64 is the standard alphabet without padding, and must be canonical. Stanzas of a type this
// file does not know are skipped. Plain text is released only once it is authenticated: decrypt()
// returns all of it or throws, and decryptChunks() yields a chunk only after its tag checks.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import * as bech32 from './bech32.mjs';

const VERSION_LINE = 'age-encryption.org/v1';
const X25519_TYPE = 'X25519';
const X25519_INFO = 'age-encryption.org/v1/X25519';
const RECIPIENT_HRP = 'age';
const IDENTITY_HRP = 'age-secret-key-';
const AEAD = 'chacha20-poly1305';
const TAG = 16;
const FILE_KEY = 16;
const PAYLOAD_NONCE = 16;
const CHUNK = 64 * 1024;
const COLUMNS = 64;

// The DER forms of a raw X25519 key (RFC 8410), so a 32-byte key becomes a Node KeyObject.
const PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

/**
 * A refusal, with a code that names the kind:
 *   age-header-invalid    the header does not parse, or breaks a rule of the format
 *   age-no-match          the header parses, but no identity opens any stanza
 *   age-mac-mismatch      a stanza opens, but the header MAC is wrong: the header was changed
 *   age-payload-invalid   the payload does not decrypt and authenticate to its end
 *   age-bad-recipient     a public key (age1...) does not parse, or cannot be used
 *   age-bad-identity      a private key (AGE-SECRET-KEY-1...) does not parse
 *   age-no-recipients     nothing to encrypt to
 *   age-no-identities     nothing to decrypt with
 * A message never carries key material or plain text.
 */
export class AgeError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'AgeError';
    this.code = code;
  }
}

const headerError = (/** @type {string} */ why) =>
  new AgeError('age-header-invalid', `the age header is not valid: ${why}`);
const payloadError = (/** @type {string} */ why) =>
  new AgeError('age-payload-invalid', `the age payload does not open: ${why}`);

// ---- Base64, strict ---------------------------------------------------------------------------

const B64_CHARS = /^[A-Za-z0-9+/]*$/;

/** @param {Uint8Array} bytes */
const b64encode = (bytes) => Buffer.from(bytes).toString('base64').replace(/=+$/, '');

/**
 * Decode unpadded standard base64, refusing anything but the one canonical encoding.
 * @param {string} text @param {string} what
 */
function b64decode(text, what) {
  if (!B64_CHARS.test(text) || text.length % 4 === 1) throw headerError(`${what} is not base64`);
  const bytes = Buffer.from(text, 'base64');
  if (b64encode(bytes) !== text) throw headerError(`${what} is not canonical base64`);
  return bytes;
}

// ---- Keys -------------------------------------------------------------------------------------

/** @param {Uint8Array} raw */
const privateKeyObject = (raw) =>
  createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, raw]),
    format: 'der',
    type: 'pkcs8',
  });

/** @param {Uint8Array} raw */
const publicKeyObject = (raw) =>
  createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });

/**
 * The raw 32 bytes of a DER key, checking that the DER is the form expected.
 * @param {Buffer} der @param {Buffer} prefix
 */
function raw(der, prefix) {
  if (der.length !== prefix.length + 32 || !der.subarray(0, prefix.length).equals(prefix)) {
    throw new Error('unexpected X25519 key encoding from node:crypto');
  }
  return der.subarray(prefix.length);
}

/** @param {import('node:crypto').KeyObject} key */
const rawPublic = (key) => raw(key.export({ format: 'der', type: 'spki' }), SPKI_PREFIX);

/** @param {import('node:crypto').KeyObject} key */
const rawPrivate = (key) => raw(key.export({ format: 'der', type: 'pkcs8' }), PKCS8_PREFIX);

/**
 * X25519, refusing the all-zero shared secret that a low-order point gives. OpenSSL refuses it
 * too; the explicit check does not depend on that.
 * @param {import('node:crypto').KeyObject} privateKey @param {Uint8Array} publicRaw
 * @returns {Buffer | null} null for a low-order point
 */
function x25519(privateKey, publicRaw) {
  /** @type {Buffer} */
  let shared;
  try {
    shared = diffieHellman({ privateKey, publicKey: publicKeyObject(publicRaw) });
  } catch {
    return null;
  }
  return shared.length === 32 && !shared.every((b) => b === 0) ? shared : null;
}

/**
 * @typedef {object} Identity a private key, parsed
 * @property {import('node:crypto').KeyObject} privateKey
 * @property {Buffer} publicKey the raw 32-byte public key
 */

/**
 * Parse a public key, `age1...`.
 * @param {string} text
 * @returns {Buffer} the raw 32-byte key
 */
export function parseRecipient(text) {
  /** @type {{ hrp: string, bytes: Buffer }} */
  let d;
  try {
    d = bech32.decode(String(text).trim());
  } catch (e) {
    throw new AgeError(
      'age-bad-recipient',
      `not an age public key (age1...): ${/** @type {Error} */ (e).message}`,
    );
  }
  if (d.hrp !== RECIPIENT_HRP || d.bytes.length !== 32) {
    throw new AgeError('age-bad-recipient', 'not an age X25519 public key (age1...)');
  }
  return d.bytes;
}

/**
 * Parse a private key, `AGE-SECRET-KEY-1...`. The message on failure never repeats the key.
 * @param {string} text
 * @returns {Identity}
 */
export function parseIdentity(text) {
  /** @type {{ hrp: string, bytes: Buffer }} */
  let d;
  try {
    d = bech32.decode(String(text).trim());
  } catch {
    throw new AgeError('age-bad-identity', 'not an age private key (AGE-SECRET-KEY-1...)');
  }
  if (d.hrp !== IDENTITY_HRP || d.bytes.length !== 32) {
    throw new AgeError('age-bad-identity', 'not an age X25519 private key (AGE-SECRET-KEY-1...)');
  }
  const privateKey = privateKeyObject(d.bytes);
  return { privateKey, publicKey: rawPublic(createPublicKey(privateKey)) };
}

/**
 * Parse an identity file as age-keygen writes it: one private key per line; blank lines and lines
 * starting with # are skipped.
 * @param {string} text
 * @returns {Identity[]}
 */
export function parseIdentities(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!lines.length) throw new AgeError('age-no-identities', 'no age private key was given');
  return lines.map(parseIdentity);
}

/** @param {Uint8Array} raw */
const encodeRecipient = (raw) => bech32.encode(RECIPIENT_HRP, raw);

/**
 * The public key that goes with a private key.
 * @param {string} identity
 */
export const recipientOf = (identity) => encodeRecipient(parseIdentity(identity).publicKey);

/** A new key pair, in age's text forms. */
export function generateIdentity() {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  return {
    identity: bech32.encode(IDENTITY_HRP, rawPrivate(privateKey), { upper: true }),
    recipient: encodeRecipient(rawPublic(publicKey)),
  };
}

// ---- Primitives as the specification composes them -------------------------------------------

/** @param {Uint8Array} ikm @param {Uint8Array} salt @param {string} info */
const hkdf = (ikm, salt, info) => Buffer.from(hkdfSync('sha256', ikm, salt, info, 32));

/** @param {Uint8Array} key @param {Uint8Array} nonce @param {Uint8Array} plaintext */
function aeadSeal(key, nonce, plaintext) {
  const c = createCipheriv(AEAD, key, nonce, { authTagLength: TAG });
  return Buffer.concat([c.update(plaintext), c.final(), c.getAuthTag()]);
}

/**
 * @param {Uint8Array} key @param {Uint8Array} nonce @param {Buffer} sealed
 * @returns {Buffer | null} null when the tag does not check
 */
function aeadOpen(key, nonce, sealed) {
  if (sealed.length < TAG) return null;
  const d = createDecipheriv(AEAD, key, nonce, { authTagLength: TAG });
  d.setAuthTag(sealed.subarray(sealed.length - TAG));
  try {
    const out = d.update(sealed.subarray(0, sealed.length - TAG));
    d.final();
    return out;
  } catch {
    return null;
  }
}

/**
 * The header MAC: HMAC-SHA-256 under HKDF(file key, no salt, "header"), over the header up to and
 * including the "---" of its last line.
 * @param {Uint8Array} fileKey @param {Uint8Array} headerWithoutMac
 */
export const headerMac = (fileKey, headerWithoutMac) =>
  createHmac('sha256', hkdf(fileKey, Buffer.alloc(0), 'header'))
    .update(headerWithoutMac)
    .digest();

/**
 * The STREAM nonce: an 11-byte big-endian chunk counter, then 1 for the last chunk, else 0.
 * @param {number} counter @param {boolean} last
 */
function streamNonce(counter, last) {
  const n = Buffer.alloc(12);
  n.writeUIntBE(counter, 5, 6);
  n[11] = last ? 1 : 0;
  return n;
}

// ---- The header -------------------------------------------------------------------------------

/**
 * @typedef {{ type: string, args: string[], body: Buffer }} Stanza
 * @typedef {{ stanzas: Stanza[], mac: Buffer, withoutMac: Buffer, payloadAt: number }} Header
 *   payloadAt is where the payload's nonce starts
 */

/** @param {string} b64 @returns {string[]} the lines of a stanza body */
function wrapBody(b64) {
  const lines = [];
  for (let i = 0; i < b64.length; i += COLUMNS) lines.push(b64.slice(i, i + COLUMNS));
  // The last line is shorter than 64 columns: empty when the body fills the line before it.
  if (!lines.length || lines[lines.length - 1].length === COLUMNS) lines.push('');
  return lines;
}

const ARGUMENT = /^[\x21-\x7e]+$/;

/**
 * Parse an age header. Refuses anything the format does not allow, before any key is used.
 * @param {Buffer} file
 * @returns {Header}
 */
export function parseHeader(file) {
  let at = 0;
  const line = () => {
    const end = file.indexOf(0x0a, at);
    if (end < 0) throw headerError('it ends before the MAC line');
    const text = file.subarray(at, end).toString('latin1');
    const start = at;
    at = end + 1;
    return { text, start };
  };

  const version = line().text;
  if (version !== VERSION_LINE) {
    throw headerError(
      version.startsWith('age-encryption.org/')
        ? 'it names an age version other than v1'
        : 'it is not an age file',
    );
  }
  /** @type {Stanza[]} */
  const stanzas = [];
  for (;;) {
    const { text, start } = line();
    if (text.startsWith('---')) {
      const m = /^--- ([A-Za-z0-9+/]{43})$/.exec(text);
      if (!m) throw headerError('the MAC line is malformed');
      if (!stanzas.length) throw headerError('it has no recipient stanza');
      // age counts the payload nonce as part of the header.
      if (file.length - at < PAYLOAD_NONCE) throw headerError('the payload nonce is missing');
      return {
        stanzas,
        mac: b64decode(m[1], 'the MAC'),
        withoutMac: file.subarray(0, start + 3),
        payloadAt: at,
      };
    }
    if (!text.startsWith('-> ')) throw headerError('a line is neither a stanza nor the MAC');
    const args = text.slice(3).split(' ');
    if (!args.every((a) => ARGUMENT.test(a))) {
      throw headerError('a stanza has an empty argument or a character outside ASCII 33..126');
    }
    /** @type {Buffer[]} */
    const body = [];
    for (;;) {
      const b = line().text;
      if (b.length > COLUMNS) throw headerError('a stanza body line is longer than 64 columns');
      body.push(b64decode(b, 'a stanza body'));
      if (b.length < COLUMNS) break;
    }
    stanzas.push({ type: args[0], args: args.slice(1), body: Buffer.concat(body) });
  }
}

/**
 * Find the file key: the first X25519 stanza an identity opens. Every X25519 stanza must be well
 * formed; other types are skipped. An scrypt stanza must be the only one (age's rule).
 * @param {Stanza[]} stanzas @param {Identity[]} identities
 * @returns {Buffer} the 16-byte file key
 */
export function unwrapFileKey(stanzas, identities) {
  if (stanzas.length > 1 && stanzas.some((s) => s.type === 'scrypt')) {
    throw headerError('an scrypt stanza must be the only one');
  }
  /** @type {{ share: Buffer, body: Buffer }[]} */
  const x = [];
  for (const s of stanzas) {
    if (s.type !== X25519_TYPE) continue;
    if (s.args.length !== 1) throw headerError('an X25519 stanza must have exactly one argument');
    const share = b64decode(s.args[0], 'an X25519 share');
    if (share.length !== 32) throw headerError('an X25519 share is not 32 bytes');
    if (s.body.length !== FILE_KEY + TAG) {
      throw headerError('an X25519 stanza body is not a wrapped 16-byte file key');
    }
    x.push({ share, body: s.body });
  }
  for (const id of identities) {
    for (const { share, body } of x) {
      const shared = x25519(id.privateKey, share);
      if (!shared) throw headerError('an X25519 share is a low-order point');
      const wrapKey = hkdf(shared, Buffer.concat([share, id.publicKey]), X25519_INFO);
      const fileKey = aeadOpen(wrapKey, Buffer.alloc(12), body);
      if (fileKey) return fileKey;
    }
  }
  throw new AgeError(
    'age-no-match',
    'no key given opens this file: it was not encrypted to any of them',
  );
}

// ---- Encrypt and decrypt ----------------------------------------------------------------------

/**
 * Encrypt to one or more X25519 recipients.
 * @param {Uint8Array} plaintext @param {string[]} recipients `age1...` public keys
 * @returns {Buffer}
 */
export function encrypt(plaintext, recipients) {
  if (!Array.isArray(recipients) || !recipients.length) {
    throw new AgeError('age-no-recipients', 'no age public key to encrypt to');
  }
  const keys = recipients.map(parseRecipient);
  const fileKey = randomBytes(FILE_KEY);
  const lines = [VERSION_LINE];
  for (const publicKey of keys) {
    const eph = generateKeyPairSync('x25519');
    const share = rawPublic(eph.publicKey);
    const shared = x25519(eph.privateKey, publicKey);
    if (!shared) throw new AgeError('age-bad-recipient', 'an age public key is a low-order point');
    const wrapKey = hkdf(shared, Buffer.concat([share, publicKey]), X25519_INFO);
    lines.push(`-> ${X25519_TYPE} ${b64encode(share)}`);
    lines.push(...wrapBody(b64encode(aeadSeal(wrapKey, Buffer.alloc(12), fileKey))));
  }
  const withoutMac = Buffer.from(lines.join('\n') + '\n---', 'latin1');
  const header = Buffer.concat([
    withoutMac,
    Buffer.from(` ${b64encode(headerMac(fileKey, withoutMac))}\n`, 'latin1'),
  ]);

  const nonce = randomBytes(PAYLOAD_NONCE);
  const payloadKey = hkdf(fileKey, nonce, 'payload');
  const data = Buffer.from(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
  const out = [header, nonce];
  // One chunk per 64 KiB; the last is marked, may be full, and is empty only for an empty payload.
  const count = Math.max(1, Math.ceil(data.length / CHUNK));
  for (let i = 0; i < count; i++) {
    const chunk = data.subarray(i * CHUNK, (i + 1) * CHUNK);
    out.push(aeadSeal(payloadKey, streamNonce(i, i === count - 1), chunk));
  }
  return Buffer.concat(out);
}

/** @param {Array<string | Identity>} identities */
function identityList(identities) {
  if (!Array.isArray(identities) || !identities.length) {
    throw new AgeError('age-no-identities', 'no age private key to decrypt with');
  }
  return identities.map((i) => (typeof i === 'string' ? parseIdentity(i) : i));
}

/**
 * Decrypt chunk by chunk. Each chunk is yielded only once its tag checks, so a consumer that stops
 * at an error has seen only authenticated plain text. A failure throws an AgeError.
 * @param {Buffer} file @param {Array<string | Identity>} identities
 * @returns {Generator<Buffer, void, void>}
 */
export function* decryptChunks(file, identities) {
  const header = parseHeader(file);
  const ids = identityList(identities);
  const fileKey = unwrapFileKey(header.stanzas, ids);
  const expected = headerMac(fileKey, header.withoutMac);
  if (!timingSafeEqual(expected, header.mac)) {
    throw new AgeError(
      'age-mac-mismatch',
      'the age header MAC does not match: the header was changed or damaged',
    );
  }
  const payload = file.subarray(header.payloadAt);
  const key = hkdf(fileKey, payload.subarray(0, PAYLOAD_NONCE), 'payload');
  const body = payload.subarray(PAYLOAD_NONCE);
  const full = CHUNK + TAG;
  let at = 0;
  for (let counter = 0; ; counter++) {
    const left = body.length - at;
    if (left === 0) throw payloadError('it ends without a final chunk (truncated)');
    if (left < full) {
      // A short chunk is the last one. It is empty only when it is the only one.
      if (counter > 0 && left === TAG) throw payloadError('the final chunk is empty');
      const out = aeadOpen(key, streamNonce(counter, true), body.subarray(at));
      if (!out) throw payloadError(`chunk ${counter} does not authenticate`);
      yield out;
      return;
    }
    const sealed = body.subarray(at, at + full);
    at += full;
    // A full chunk is the last one only if it was sealed as last.
    let last = false;
    let out = aeadOpen(key, streamNonce(counter, false), sealed);
    if (!out) {
      last = true;
      out = aeadOpen(key, streamNonce(counter, true), sealed);
    }
    if (!out) throw payloadError(`chunk ${counter} does not authenticate`);
    yield out;
    if (last) {
      if (at !== body.length) throw payloadError('there is data after the final chunk');
      return;
    }
  }
}

/**
 * Decrypt a whole file. Returns all of the plain text, or throws an AgeError and returns none.
 * @param {Buffer} file @param {Array<string | Identity>} identities
 * @returns {Buffer}
 */
export function decrypt(file, identities) {
  /** @type {Buffer[]} */
  const chunks = [];
  for (const c of decryptChunks(file, identities)) chunks.push(c);
  return Buffer.concat(chunks);
}

/** Whether bytes look like an age file (its first line names age). @param {Buffer} file */
export const isAgeFile = (file) =>
  file.subarray(0, 19).toString('latin1') === 'age-encryption.org/';
