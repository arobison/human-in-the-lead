// Why the private store does not sync here, and what fixes it (HITLD-142).
//
// A remote that cannot be read used to be reported as `remote-unreachable` with git's own words,
// which do not say what to do: in a cloud session, a store repository that is not attached and a
// host with no credentials both read "could not read Username". Each cause here has a stable code,
// one sentence that says what is wrong, and one that says what fixes it. `run start`, `run resume`,
// the hooks and `hitld store status` report the same causes, so a skill can stop on them, and a
// later check (a session that cannot reach the store runs on conservative defaults and says why)
// can reuse the codes and the words.
//
// The words name things by their role: "the store repository", "this device". The store's address
// and the devices' names never go into a cause; git's own message, which may hold the address,
// stays in the report's `error.message`.

/**
 * @typedef {'repository-not-attached' | 'no-credentials' | 'repository-not-found' | 'host-unreachable' | 'remote-failed' | 'no-remote' | 'device-no-key' | 'device-not-enrolled' | 'device-not-pulled'} StoreCause
 *
 * @typedef {object} Cause
 * @property {StoreCause} cause the stable code
 * @property {string} message what is wrong, by role
 * @property {string} fix what fixes it
 */

const ATTACH_FIX =
  'attach the store repository to this session: add_repo with the owner and name from `hitld store remote show`, or start the session with both repositories selected. A session cannot attach a repository to another one: the session that starts this one (the chief of staff) attaches it at start, and when the harness refuses the attach, only the owner can attach it';

/** @type {Readonly<Record<StoreCause, { message: string, fix: string }>>} */
export const STORE_CAUSES = Object.freeze({
  'repository-not-attached': {
    message:
      'the store repository is not attached to this cloud session, so git has no credentials for it',
    fix: ATTACH_FIX,
  },
  'no-credentials': {
    message: "git has no credentials for the store repository's host",
    fix: 'sign in to the host through git (a credential helper or an ssh key) and run it again; hitld takes no token in the address',
  },
  'repository-not-found': {
    message:
      'the host says the store repository does not exist, or the account git signs in with cannot read it',
    fix: 'check the address with `hitld store remote show`, and that the account git signs in with can read the store repository',
  },
  'host-unreachable': {
    message:
      "the store repository's host could not be reached: no network, a proxy refused the host, or its name does not resolve",
    fix: "check the network; in a cloud environment, the host must be on the environment's allowed hosts",
  },
  'remote-failed': {
    message: 'git could not read the store repository; `error.message` gives its words',
    fix: 'fix what `error.message` says and run it again',
  },
  'no-remote': {
    message:
      'no store address is set here, so the run state stays in this container and is lost with it',
    fix: 'set HITLD_STORE_REMOTE in the cloud environment, or run `hitld store remote set <url>` on a machine',
  },
  'device-no-key': {
    message: 'this device has no key, so it can neither open nor push the store',
    fix: 'run `hitld store device init` on a machine, or `hitld store device init --cloud` and set HITLD_STORE_IDENTITY in the cloud environment; then the owner approves it',
  },
  'device-not-enrolled': {
    message:
      "this device's key does not open the store: the owner has not approved it, removed it, or no approved device has pushed since the approval",
    fix: 'ask with `hitld store device init`, have the owner approve it, then push once from an approved device',
  },
  'device-not-pulled': {
    message:
      "this copy of the store holds no approval of this device, and the remote could not be read, so whether it is enrolled is not known until a pull: an enrolled device's approval is on the remote",
    fix: 'fix the remote cause first; the next pull brings the approval in',
  },
});

/** @param {StoreCause} code @returns {Cause} */
export const cause = (code) => ({ cause: code, ...STORE_CAUSES[code] });

/**
 * Whether this is a Claude Code cloud session, where a GitHub repository is reachable only when it
 * is attached to the session.
 * @param {NodeJS.ProcessEnv} env
 */
export function cloudSession(env) {
  const v = env.CLAUDE_CODE_REMOTE;
  return typeof v === 'string' && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
}

// Git's words, in the order they are tested: a proxy or network failure first, since its message
// can hold a status code; then a refused sign-in; then a repository that is not there.
const NETWORK =
  /could not resolve (host|proxy)|failed to connect|couldn't connect|connection (refused|timed out|reset)|timed out|network is unreachable|no route to host|connect tunnel failed|from proxy after connect|ssl|tls|certificate|early eof|unexpected disconnect|rpc failed/i;
const AUTH =
  /could not read (username|password)|terminal prompts disabled|authentication failed|invalid username or password|permission denied \((publickey|keyboard-interactive)|returned error: 40[13]\b|access denied/i;
const NOT_FOUND = /repository not found|does not appear to be a git repository|not found/i;

/**
 * The cause of a remote that could not be read, from git's message.
 * @param {string} message the remote error's message (git's stderr)
 * @param {{ env: NodeJS.ProcessEnv, url?: string | null }} o url: the store's address, so a local
 *   or mounted repository is never taken for one the session has not attached
 * @returns {Cause}
 */
export function remoteCause(message, o) {
  if (NETWORK.test(message)) return cause('host-unreachable');
  const auth = AUTH.test(message);
  const missing = !auth && NOT_FOUND.test(message);
  const local = typeof o.url === 'string' && (o.url.startsWith('file:') || o.url.startsWith('/'));
  // In a cloud session, the session's git access covers the repositories attached to it, and a
  // private repository it does not cover answers as a refused sign-in or as not found.
  if ((auth || missing) && !local && cloudSession(o.env)) return cause('repository-not-attached');
  if (auth) return cause('no-credentials');
  if (missing) return cause('repository-not-found');
  return cause('remote-failed');
}

/** The remote error codes that mean the remote could not be read. */
export const UNREACHABLE_CODES = new Set(['remote-unreachable', 'remote-git-failed']);

/**
 * The causes of a pull or push that failed: the remote's, and this device's when its own copy of
 * the store cannot tell. Empty when the error is not one of the named causes (a merge conflict).
 * @param {{ code: string, message: string }} error
 * @param {{ env: NodeJS.ProcessEnv, url?: string | null, devices?: { identity: string | null, enrolled: boolean } | null }} o
 * @returns {Cause[]}
 */
export function failureCauses(error, o) {
  if (error.code === 'age-no-match' || error.code === 'device-not-enrolled') {
    return [cause('device-not-enrolled')];
  }
  if (!UNREACHABLE_CODES.has(error.code)) return [];
  const out = [remoteCause(error.message, o)];
  if (o.devices?.identity && !o.devices.enrolled) out.push(cause('device-not-pulled'));
  return out;
}

/**
 * Whether the store syncs here, and if not, every cause that applies. `hitld store status` reports
 * it as `sync`; a run does not go past its first-run setup until `ready` is true, or the owner says
 * in their own message to go on without the store.
 * @param {{
 *   address: string | null,
 *   required: boolean,
 *   env: NodeJS.ProcessEnv,
 *   remoteError: { code: string, message: string } | null,
 *   remoteEmpty: boolean,
 *   opens: boolean | null,
 *   devices: { identity: string | null, enrolled: boolean },
 * }} o address: the store's address, null when none is set; remoteEmpty: the remote was read and holds
 *   nothing yet; opens: whether this device's key opens the remote's head (null: not known)
 * @returns {{ ready: boolean, local_only: boolean, causes: Cause[] }} local_only: no remote is
 *   expected here (a machine, no address, not required), so the store is this machine's alone
 */
export function syncCauses(o) {
  if (!o.address) {
    if (!o.required && !cloudSession(o.env)) return { ready: true, local_only: true, causes: [] };
    return { ready: false, local_only: false, causes: [cause('no-remote')] };
  }
  /** @type {Cause[]} */
  const out = [];
  if (o.remoteError) {
    out.push(remoteCause(o.remoteError.message, { env: o.env, url: o.address }));
    if (o.devices.identity && !o.devices.enrolled) out.push(cause('device-not-pulled'));
  }
  if (!o.devices.identity) out.push(cause('device-no-key'));
  else if (o.opens === false || (!o.remoteError && o.remoteEmpty && !o.devices.enrolled)) {
    out.push(cause('device-not-enrolled'));
  }
  return { ready: out.length === 0, local_only: false, causes: out };
}

/**
 * The causes in one line, for a hook or a message: each code with its words, then each fix.
 * @param {Cause[]} causes
 */
export const causesLine = (causes) =>
  causes.map((c) => `${c.cause}: ${c.message}. To fix: ${c.fix}`).join('. ');
