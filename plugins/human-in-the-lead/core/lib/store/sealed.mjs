// The store export file (design part 3.2): one file, encrypted, because the store holds
// confidential material. Node's built-in crypto only.
//
// Layout, format 1:
//   header   one line of JSON and a newline: what to read the rest with (below)
//   body     AES-256-GCM ciphertext of the payload
//   tag      the 16-byte GCM authentication tag
//
// The header is authenticated as associated data, so changing any byte of the file (header, body
// or tag) makes it fail to open. The key comes from the passphrase through scrypt, with the
// parameters and a random salt recorded in the header; the nonce is random too.
//
// The payload is the manifest as one line of JSON, a newline, then the git bundle's bytes.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

export const FILE_KIND = 'hitld-store-export';
export const FORMAT = 1;
const CIPHER = 'aes-256-gcm';
const TAG_BYTES = 16;
const HEADER_MAX = 4096;

/** scrypt cost: the default, and the bounds a file's header may name. */
export const SCRYPT_DEFAULT = Object.freeze({ N: 2 ** 17, r: 8, p: 1 });
// The upper bounds keep a damaged or hostile header from asking for more than 256 MiB before the
// file is authenticated.
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
 * Seal a manifest and a bundle into the export file's bytes.
 * @param {Manifest} manifest @param {Buffer} bundle @param {string} passphrase
 * @param {{ scrypt?: { N: number, r: number, p: number } }} [options] scrypt is for tests
 * @returns {Buffer}
 */
export function seal(manifest, bundle, passphrase, options = {}) {
  if (!passphrase) throw new SealedError('no-passphrase', 'the passphrase is empty');
  const s = options.scrypt ?? SCRYPT_DEFAULT;
  checkScrypt(s);
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const header = Buffer.from(
    JSON.stringify({
      file: FILE_KIND,
      format: FORMAT,
      cipher: CIPHER,
      kdf: 'scrypt',
      scrypt: { N: s.N, r: s.r, p: s.p },
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64'),
    }) + '\n',
  );
  const cipher = createCipheriv(CIPHER, deriveKey(passphrase, salt, s), nonce, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(header);
  const payload = Buffer.concat([Buffer.from(JSON.stringify(manifest) + '\n'), bundle]);
  const body = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([header, body, cipher.getAuthTag()]);
}

/**
 * Read the header without the passphrase. Refuses a file that is not an export, or a format this
 * version does not read.
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
  if (h.format !== FORMAT) {
    throw new SealedError(
      'unknown-format',
      `the file is export format ${JSON.stringify(h.format)}; this version reads format ${FORMAT} only`,
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
 * Open an export file: check the header, derive the key, decrypt and authenticate.
 * @param {Buffer} file @param {string} passphrase
 * @returns {{ manifest: Manifest, bundle: Buffer }}
 */
export function open(file, passphrase) {
  if (!passphrase) throw new SealedError('no-passphrase', 'the passphrase is empty');
  const h = readHeader(file);
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
  /** @type {Buffer} */
  let payload;
  try {
    payload = Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    throw new SealedError(
      'cannot-open',
      'the file does not open: the passphrase is wrong, or the file was changed or damaged',
    );
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
  return { manifest, bundle: payload.subarray(nl + 1) };
}
