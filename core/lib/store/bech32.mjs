// Bech32 (BIP 173), the text form of age keys: `age1...` for a public key and
// `AGE-SECRET-KEY-1...` for a private one. The original Bech32 checksum (constant 1), not
// Bech32m. As in age, the 90-character limit of BIP 173 is not applied; a smaller bound keeps a
// hostile string from costing much.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const MAX_LENGTH = 1024;

export class Bech32Error extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'Bech32Error';
    this.code = 'bad-bech32';
  }
}

/** @param {number[]} values */
function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATOR[i];
  }
  return chk >>> 0;
}

/** @param {string} hrp */
function expandHrp(hrp) {
  const out = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/**
 * Regroup bits: 8 to 5 (pad the last group with zeros) or 5 to 8 (the padding must be fewer than
 * 5 zero bits).
 * @param {ArrayLike<number>} data @param {number} from @param {number} to @param {boolean} pad
 */
function convertBits(data, from, to, pad) {
  let acc = 0;
  let bits = 0;
  const out = [];
  const max = (1 << to) - 1;
  for (let i = 0; i < data.length; i++) {
    acc = (acc << from) | data[i];
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
    acc &= (1 << bits) - 1;
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & max);
  } else if (bits >= from || ((acc << (to - bits)) & max) !== 0) {
    throw new Bech32Error('the data has bad padding');
  }
  return out;
}

/**
 * Encode bytes under a human-readable part. Lower case; pass `upper` for an age secret key.
 * @param {string} hrp @param {Uint8Array} bytes @param {{ upper?: boolean }} [options]
 */
export function encode(hrp, bytes, options = {}) {
  if (!/^[\x21-\x7e]+$/.test(hrp) || hrp !== hrp.toLowerCase()) {
    throw new Bech32Error('the human-readable part must be printable lower-case ASCII');
  }
  const data = convertBits(bytes, 8, 5, true);
  const mod = polymod([...expandHrp(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [];
  for (let i = 0; i < 6; i++) checksum.push((mod >>> (5 * (5 - i))) & 31);
  const text = hrp + '1' + [...data, ...checksum].map((d) => CHARSET[d]).join('');
  return options.upper ? text.toUpperCase() : text;
}

/**
 * Decode a Bech32 string. Mixed case is refused. The human-readable part comes back in lower case.
 * @param {string} text
 * @returns {{ hrp: string, bytes: Buffer }}
 */
export function decode(text) {
  if (typeof text !== 'string' || text.length > MAX_LENGTH) {
    throw new Bech32Error('not a Bech32 string');
  }
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) {
    throw new Bech32Error('mixed case');
  }
  const lower = text.toLowerCase();
  if (!/^[\x21-\x7e]+$/.test(lower)) throw new Bech32Error('a character is outside ASCII 33..126');
  const sep = lower.lastIndexOf('1');
  if (sep < 1 || sep + 7 > lower.length) {
    throw new Bech32Error('the separator or the checksum is missing');
  }
  const hrp = lower.slice(0, sep);
  /** @type {number[]} */
  const data = [];
  for (const c of lower.slice(sep + 1)) {
    const d = CHARSET.indexOf(c);
    if (d < 0) throw new Bech32Error('a character is not in the Bech32 alphabet');
    data.push(d);
  }
  if (polymod([...expandHrp(hrp), ...data]) !== 1) throw new Bech32Error('the checksum is wrong');
  return { hrp, bytes: Buffer.from(convertBits(data.slice(0, -6), 5, 8, false)) };
}
