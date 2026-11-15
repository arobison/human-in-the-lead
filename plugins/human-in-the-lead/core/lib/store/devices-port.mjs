// The one place the push and pull commands ask who the store is encrypted to and which key this
// device opens it with (design 0003, sections 5, 6 and 9).
//
// This is a port. The body below is a placeholder: the recipients are the `--recipient` flags the
// command was given, the identity is `HITLD_STORE_IDENTITY`, and every device counts as enrolled.
// The devices piece replaces the body with the device list in `.human-in-the-lead/store-devices.json`
// and the enrolment check, and keeps this shape. The push and pull code calls `resolveDevices`
// and reads no key anywhere else.

/** The environment variable that may carry this device's age private key. */
export const IDENTITY_ENV = 'HITLD_STORE_IDENTITY';

/**
 * Who a push encrypts to and how this device opens what it pulls.
 *
 * @typedef {object} Devices
 * @property {string[]} recipients age public keys (age1...) the next push is encrypted to
 * @property {string | null} identity this device's age private key text (AGE-SECRET-KEY-1..., as
 *   age-keygen writes it), or null when none is available. Never printed or logged
 * @property {boolean} enrolled whether this device is on the project's device list, which a push
 *   needs
 * @property {string | null} device this device's name on the list, or null when it has none
 */

/**
 * @typedef {object} ResolveInput
 * @property {string} root the project's repository root (where `store-devices.json` is read from)
 * @property {string} store the private store's directory
 * @property {NodeJS.ProcessEnv} env the process environment
 * @property {string[]} [recipients] `--recipient` flags given on the command line
 */

/**
 * @param {ResolveInput} input
 * @returns {Devices}
 */
export function resolveDevices({ env, recipients }) {
  const identity = env[IDENTITY_ENV]?.trim() ? /** @type {string} */ (env[IDENTITY_ENV]) : null;
  return { recipients: [...(recipients ?? [])], identity, enrolled: true, device: null };
}
