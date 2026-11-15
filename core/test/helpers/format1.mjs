// A format-1 writer, for tests only: hitld no longer writes format 1, but still reads it
// (core/lib/store/sealed.mjs). This is the writer earlier versions shipped, unchanged, so tests can
// make format-1 files with any manifest. core/test/fixtures/store/format-1.hitld is a file the
// shipped writer made.

import { createCipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * @param {import('../../lib/store/sealed.mjs').Manifest} manifest @param {Buffer} bundle
 * @param {string} passphrase @param {{ N: number, r: number, p: number }} scrypt
 * @returns {Buffer}
 */
export function sealFormat1(manifest, bundle, passphrase, scrypt) {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const header = Buffer.from(
    JSON.stringify({
      file: 'hitld-store-export',
      format: 1,
      cipher: 'aes-256-gcm',
      kdf: 'scrypt',
      scrypt: { N: scrypt.N, r: scrypt.r, p: scrypt.p },
      salt: salt.toString('base64'),
      nonce: nonce.toString('base64'),
    }) + '\n',
  );
  const key = scryptSync(passphrase.normalize('NFC'), salt, 32, {
    ...scrypt,
    maxmem: 256 * scrypt.N * scrypt.r + 1024 * 1024,
  });
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(header);
  const payload = Buffer.concat([Buffer.from(JSON.stringify(manifest) + '\n'), bundle]);
  const body = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([header, body, cipher.getAuthTag()]);
}
