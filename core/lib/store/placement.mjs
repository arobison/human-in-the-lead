// Where the store remote's address lives (design 0003, section 8): never in the project's
// repository, which may be public. Naming the private store's repository tells anyone where the
// store is.
//
//   the address  HITLD_STORE_REMOTE (a cloud environment), else the person file, keyed by project
//                ID (a local machine), else this machine's override in the store
//
// This module holds the names and the messages that say where each goes, for the policy check, the
// commit guard and the commands. It imports nothing of hitld's, so any of them may use it.

/** The environment variable a cloud environment gives the store's address in. */
export const REMOTE_ENV = 'HITLD_STORE_REMOTE';

/** Why store.remote.url is refused in policy.json, and where the address goes. */
export const ADDRESS_MOVED = `the store's address does not go in policy.json, which is committed and may be public: set ${REMOTE_ENV} in the cloud environment, or run hitld store remote set <url> on a machine (it writes the person file), then take store.remote.url out of policy.json. store.remote.required (true or false) is the only store setting policy.json keeps`;
