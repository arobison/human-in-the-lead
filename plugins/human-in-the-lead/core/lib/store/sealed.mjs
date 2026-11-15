// The store export file (design part 3.2, design 0003 section 10): one file, encrypted, because
// the store holds confidential material. Node's built-in crypto only.
//
// The payload, in every format, is the manifest as one line of JSON, a newline, then the git
// bundle's bytes.
//
// Format 2, the one this version writes, is an age file (age.mjs): the payload encrypted once
// under a fresh file key, and the file key wrapped for each recipient's X25519 public key. Any
// recipient opens it with its own private key, and so does the `age` program.
//
// Format 1 is read only, for files written by earlier versions:
//   header   one line of JSON and a newline: what to read the rest with (below)
//   body     AES-256-GCM ciphertext of the payload
//   tag      the 16-byte GCM authentication tag
// The header is authenticated as associated data. The key comes from a passphrase through scrypt,
// with the parameters and a random salt recorded in the header; the nonce is random too.

import { createDecipheriv, scryptSync } from 'node:crypto';
import { decrypt, encrypt, isAgeFile, parseRecipient } from './age.mjs';

export const FILE_KIND = 'hitld-store-export';
/** The format this version writes. */
export const FORMAT = 2;
const FORMAT_1 = 1;
const CIPHER = 'aes-256-gcm';
const TAG_BYTES = 16;
const HEADER_MAX = 4096;

// The bounds a format-1 header may name. The upper bounds keep a damaged or hostile header from
// asking for more than 256 MiB before the file is authenticated.
const SCRYPT_BOUNDS = Object.freeze({ N: [2 ** 14, 2 ** 18], r: [8, 8], p: [1, 4] });

export class SealedError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'SealedError';
    this.code = code;
  }
}

/**
 * @typedef {object} Manifest
 * @property {string} project policy.json project.id
 * @property {Record<string, number>} schema_versions the schema versions of the exporting release
 * @property {string} head the commit the bundle's branch points at
 * @property {string} branch
 * @property {string} created_at
 * @property {string} hitld_version
 */

/**
 * The keys that may open a file: age private keys for format 2, a passphrase for format 1.
 * @typedef {{ identities?: Array<string | import('./age.mjs').Identity>, passphrase?: string }} Keys
 */

/**
 * Refuse an empty recipient list, or a key that does not parse, before any work is done.
 * @param {string[] | undefined} recipients
 * @returns {string[]}
 */
export function checkRecipients(recipients) {
  if (!Array.isArray(recipients) || !recipients.length) {
    throw new SealedError(
      'no-recipients',
      'no recipient: the export is encrypted to age public keys (age1...); give at least one',
    );
  }
  for (const r of recipients) parseRecipient(r);
  return recipients;
}

/**
 * Seal a manifest and a bundle into the export file's bytes, format 2.
 * @param {Manifest} manifest @param {Buffer} bundle @param {string[]} recipients age public keys
 * @returns {Buffer}
 */
export function seal(manifest, bundle, recipients) {
  checkRecipients(recipients);
  return encrypt(Buffer.concat([Buffer.from(JSON.stringify(manifest) + '\n'), bundle]), recipients);
}

/**
 * Which format a file is, without any key. Refuses a file that is not an export, or a format
 * this version does not read.
 * @param {Buffer} file
 * @returns {1 | 2}
 */
export function formatOf(file) {
  if (isAgeFile(file)) return 2;
  readHeader(file);
  return 1;
}

/** @param {{ N: number, r: number, p: number }} s */
function checkScrypt(s) {
  for (const k of /** @type {const} */ (['N', 'r', 'p'])) {
    const [lo, hi] = SCRYPT_BOUNDS[k];
    if (!Number.isInteger(s[k]) || s[k] < lo || s[k] > hi) {
      throw new SealedError('bad-header', `scrypt ${k} ${s[k]} is outside ${lo}..${hi}`);
    }
  }
  if ((s.N & (s.N - 1)) !== 0)
    throw new SealedError('bad-header', 'scrypt N must be a power of two');
}

/** @param {string} passphrase @param {Buffer} salt @param {{ N: number, r: number, p: number }} s */
const deriveKey = (passphrase, salt, s) =>
  scryptSync(passphrase.normalize('NFC'), salt, 32, {
    N: s.N,
    r: s.r,
    p: s.p,
    maxmem: 256 * s.N * s.r + 1024 * 1024,
  });

/**
 * Read a format-1 header without the passphrase.
 * @param {Buffer} file
 */
export function readHeader(file) {
  const end = file.subarray(0, HEADER_MAX).indexOf(0x0a);
  if (end < 0) throw new SealedError('not-export', 'not a hitld store export (no header line)');
  /** @type {any} */
  let h;
  try {
    h = JSON.parse(file.subarray(0, end).toString('utf8'));
  } catch {
    throw new SealedError('not-export', 'not a hitld store export (the header is not JSON)');
  }
  if (!h || typeof h !== 'object' || h.file !== FILE_KIND) {
    throw new SealedError('not-export', 'not a hitld store export');
  }
  if (h.format !== FORMAT_1) {
    throw new SealedError(
      'unknown-format',
      `the file is export format ${JSON.stringify(h.format)}; this version reads format 1 (a passphrase) and format 2 (age)`,
    );
  }
  const keys = ['file', 'format', 'cipher', 'kdf', 'scrypt', 'salt', 'nonce'];
  const extra = Object.keys(h).filter((k) => !keys.includes(k));
  if (extra.length || h.cipher !== CIPHER || h.kdf !== 'scrypt' || typeof h.scrypt !== 'object') {
    throw new SealedError(
      'bad-header',
      'the header names a cipher or field this version does not use',
    );
  }
  checkScrypt(h.scrypt);
  const salt = Buffer.from(String(h.salt), 'base64');
  const nonce = Buffer.from(String(h.nonce), 'base64');
  if (salt.length !== 16 || nonce.length !== 12) {
    throw new SealedError('bad-header', 'the header salt or nonce has the wrong length');
  }
  return {
    header: file.subarray(0, end + 1),
    scrypt: { N: h.scrypt.N, r: h.scrypt.r, p: h.scrypt.p },
    salt,
    nonce,
  };
}

/**
 * Decrypt and authenticate a format-1 file.
 * @param {Buffer} file @param {string | undefined} passphrase
 */
function openFormat1(file, passphrase) {
  const h = readHeader(file);
  if (!passphrase) {
    throw new SealedError('no-passphrase', 'the file is format 1, which opens with a passphrase');
  }
  if (file.length < h.header.length + TAG_BYTES) {
    throw new SealedError('damaged', 'the file is too short to hold its authentication tag');
  }
  const body = file.subarray(h.header.length, file.length - TAG_BYTES);
  const tag = file.subarray(file.length - TAG_BYTES);
  const decipher = createDecipheriv(CIPHER, deriveKey(passphrase, h.salt, h.scrypt), h.nonce, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(h.header);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new SealedError(
      'cannot-open',
      'the file does not open: the passphrase is wrong, or the file was changed or damaged',
    );
  }
}

/**
 * Open an export file of either format: decrypt and authenticate, then check the manifest.
 * @param {Buffer} file @param {Keys} keys
 * @returns {{ manifest: Manifest, bundle: Buffer, format: 1 | 2 }}
 */
export function open(file, keys) {
  const format = formatOf(file);
  /** @type {Buffer} */
  let payload;
  if (format === 2) {
    if (!keys.identities?.length) {
      throw new SealedError(
        'no-identity',
        'the file is format 2, which opens with an age private key (AGE-SECRET-KEY-1...)',
      );
    }
    payload = decrypt(file, keys.identities);
  } else {
    payload = openFormat1(file, keys.passphrase);
  }
  const nl = payload.indexOf(0x0a);
  /** @type {any} */
  let manifest;
  try {
    manifest = JSON.parse(payload.subarray(0, nl).toString('utf8'));
  } catch {
    manifest = null;
  }
  if (
    nl < 0 ||
    !manifest ||
    typeof manifest.project !== 'string' ||
    typeof manifest.head !== 'string' ||
    !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(manifest.head) ||
    typeof manifest.schema_versions !== 'object' ||
    manifest.schema_versions === null
  ) {
    throw new SealedError('damaged', 'the manifest inside the file is not valid');
  }
  return { manifest, bundle: payload.subarray(nl + 1), format };
}
