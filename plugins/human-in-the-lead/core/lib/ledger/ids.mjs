// Ledger event and dispatch IDs, unique by construction (HITLD-489, design part 5.4).
//
// An ID is a prefix, then 16 characters of Crockford base32: 10 for the time in milliseconds and 6
// random (30 bits). IDs made later sort later, and two containers that make one in the same
// millisecond collide only if they also draw the same 30 random bits, so no counter, block or
// coordination is needed. Within one process an ID is always above the one before it, even when
// the clock steps back.
//
// Dispatches written before this change are `D-<n>` (D-1 to D-38 and the few after, on main in
// `Dispatch:` trailers) and events `E-<n>`. Both stay valid forever: the ledger is never
// rewritten.

import { randomBytes } from 'node:crypto';

/** Crockford base32: no I, L, O or U. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHARS = 10;
const RANDOM_CHARS = 6;
const UNIQUE = `[${ALPHABET}]{${TIME_CHARS + RANDOM_CHARS}}`;

/** A dispatch ID: the legacy `D-<n>` or a unique `D-<16>`. */
export const DISPATCH_ID = new RegExp(`^D-(?:[1-9][0-9]*|${UNIQUE})$`);
/** A dispatch ID in the numbered form written before HITLD-74. */
export const LEGACY_DISPATCH_ID = /^D-[1-9][0-9]*$/;
/** The same patterns as JSON Schema strings, for schemas that take a dispatch ID. */
export const DISPATCH_ID_PATTERN = DISPATCH_ID.source;

/** @param {number} n @param {number} chars */
function encode(n, chars) {
  let out = '';
  for (let i = 0; i < chars; i++) {
    out = ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

let lastTime = 0;
let lastRandom = 0;

/**
 * A new unique ID with the prefix, e.g. `D-01KAH2Q7RS4XV9TB`.
 * @param {string} prefix
 * @param {{ now?: () => Date, random?: () => number }} [options] for tests; random gives an
 *   integer below 2^30
 */
export function uniqueId(prefix, options = {}) {
  let time = (options.now ?? (() => new Date()))().getTime();
  let rand = options.random ? options.random() : randomBytes(4).readUInt32BE(0) >>> 2;
  if (time <= lastTime) {
    // Same millisecond, or the clock stepped back: stay above the last ID.
    time = lastTime;
    rand = lastRandom + 1;
    if (rand >= 2 ** 30) [time, rand] = [time + 1, 0];
  }
  [lastTime, lastRandom] = [time, rand];
  return `${prefix}-${encode(time, TIME_CHARS)}${encode(rand, RANDOM_CHARS)}`;
}

/** A new dispatch ID. @param {{ now?: () => Date }} [options] */
export const newDispatchId = (options) => uniqueId('D', options);

/** A new event ID. @param {{ now?: () => Date }} [options] */
export const newEventId = (options) => uniqueId('E', options);

/** Whether a dispatch ID is one of the numbered ones written before HITLD-74. @param {string} id */
export const isLegacyDispatch = (id) => LEGACY_DISPATCH_ID.test(id);
