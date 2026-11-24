// The credential unattended Claude Code runs start on (HITLD-880, GitHub issue 547). A detached
// executor (launch.mjs, HITLD-746) is a headless `claude -p` that nobody watches. Started on the
// interactive sign-in, it runs until that sign-in ends, which Claude Code says can happen at any
// time before a fixed date that renewing does not move; overnight, the run would stop with no one
// to see it. The long-lived credential for unattended runs is the token `claude setup-token`
// makes, given to the child as CLAUDE_CODE_OAUTH_TOKEN.
//
// Where the token is kept, looked for in this order, never in the project, a log or an
// environment file the project tracks:
//
//   macOS    the login Keychain, a generic password with service claude-code-oauth-token and
//            the person's account name (keychain.mjs reads it)
//   Windows  Credential Manager, a generic credential with target claude-code-oauth-token
//   Linux    the Secret Service through libsecret, attributes service=claude-code-oauth-token and
//            account=<the person's account name> (keychain.mjs reads it)
//   any      the file credentials/claude-code-oauth-token in this machine's hitld directory (the
//            _machine directory beside the private stores, which is never synced), readable by
//            its owner only
//
// A credential the environment already gives Claude Code (an API key, an OAuth token set by the
// cloud environment, or a cloud provider) is long-lived too, and is used as it is.
//
// Nothing here prints, logs or returns a value: reports carry the kind, the source and the
// length. The value is read only by readToken, for the launcher, which puts it in one child's
// environment. The keychain tools run with no shell, so there is no tracing to turn off, their
// standard error never reaches any output, and a tool that does not answer in KEYCHAIN_TIMEOUT_MS
// counts as finding nothing, so a launch never hangs on a keychain waiting to be unlocked.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { keychain } from '../../lib/env/keychain.mjs';
import { createRedactor } from '../../lib/env/secrets.mjs';

/** The variable Claude Code reads the token from. */
export const TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';
/** The keychain service (macOS, Linux) and Credential Manager target (Windows) it is kept under. */
export const SERVICE = 'claude-code-oauth-token';
/** The file it may be kept in instead, under this machine's hitld directory. */
export const TOKEN_FILE = join('credentials', SERVICE);
/** The prefix of the tokens `claude setup-token` makes. */
const TOKEN_PREFIX = 'sk-ant-oat';
/** The value `--credential` takes on the launcher's command line. */
export const CREDENTIAL_KIND = 'claude-code';
/** How long a keychain tool may take to answer before it counts as finding nothing. */
export const KEYCHAIN_TIMEOUT_MS = 10_000;
const DAY_MS = 86_400_000;

/**
 * Long-lived credentials the environment can already give Claude Code, by variable name. Only the
 * names are ever read for a report.
 * @type {{ variable: string, kind: 'oauth-token' | 'api-key' | 'auth-token' | 'cloud-provider' }[]}
 */
const FROM_ENV = [
  { variable: TOKEN_ENV, kind: 'oauth-token' },
  { variable: 'ANTHROPIC_API_KEY', kind: 'api-key' },
  { variable: 'ANTHROPIC_AUTH_TOKEN', kind: 'auth-token' },
  { variable: 'CLAUDE_CODE_USE_BEDROCK', kind: 'cloud-provider' },
  { variable: 'CLAUDE_CODE_USE_VERTEX', kind: 'cloud-provider' },
  { variable: 'CLAUDE_CODE_USE_FOUNDRY', kind: 'cloud-provider' },
];

/**
 * Variables that would make a shell in the child trace its commands, and so print what they
 * expand. Removed from the child's environment along with nothing else.
 */
const TRACING = ['SHELLOPTS', 'BASH_XTRACEFD', 'PS4'];

/**
 * @typedef {(program: string, args: string[]) => string | null} Runner runs a program with no
 *   shell and returns its standard output, or null when it fails or is not there
 *
 * @typedef {object} CredentialOptions
 * @property {NodeJS.ProcessEnv} env the environment unattended runs start from
 * @property {string | null} machineDir this machine's hitld directory, for the file
 * @property {NodeJS.Platform} [platform]
 * @property {Runner} [run] how Credential Manager is read on Windows (tests give a fake)
 * @property {number} [timeoutMs] how long a keychain tool may take (KEYCHAIN_TIMEOUT_MS)
 *
 * @typedef {'keychain' | 'credential-manager' | 'secret-service' | 'machine-file' | 'environment'} Source
 *
 * @typedef {object} CredentialReport what unattended runs start on, without the value
 * @property {boolean} long_lived
 * @property {'oauth-token' | 'api-key' | 'auth-token' | 'cloud-provider' | 'interactive'} kind
 *   interactive: none was found, so a run starts on the interactive sign-in
 * @property {Source | null} source
 * @property {string} [variable] for a credential from the environment, its name
 * @property {number} [length] for a stored token, its length, so a value cut short shows
 * @property {string[]} problems what is wrong with what was found
 * @property {string[]} looked_in where a stored token was looked for
 */

/**
 * Run a program found on `env`'s PATH, with no shell, its errors discarded and a time limit.
 * @param {string} program @param {string[]} args @param {NodeJS.ProcessEnv} env
 * @param {number} timeoutMs
 */
const defaultRun = (program, args, env, timeoutMs) => {
  try {
    return execFileSync(program, args, {
      env,
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
  } catch {
    return null;
  }
};

/**
 * PowerShell that prints the password of the generic credential `target` (Credential Manager has
 * no command that prints one). It holds no value; the value goes to standard output only.
 * @param {string} target
 */
const windowsReader = (target) => `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HitldCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
    public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr cred);
  public static string Read(string target) {
    IntPtr p;
    if (!CredRead(target, 1, 0, out p)) return null;
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      return Marshal.PtrToStringUni(c.CredentialBlob, c.CredentialBlobSize / 2);
    } finally { CredFree(p); }
  }
}
'@
$v = [HitldCred]::Read('${target}')
if ($v) { [Console]::Out.Write($v) } else { exit 1 }
`;

/** A token as kept: the two lines `setup-token` prints may have been pasted with a break. @param {string} s */
const normalize = (s) => s.replace(/\s+/g, '');

/**
 * Where a stored token is looked for on this platform, in order, each with how to read it.
 * @param {CredentialOptions} o
 * @returns {{ source: Source, where: string, read: () => { value: string | null, problem?: string } }[]}
 */
function places(o) {
  const platform = o.platform ?? process.platform;
  const timeoutMs = o.timeoutMs ?? KEYCHAIN_TIMEOUT_MS;
  /** @type {Runner} */
  const run = o.run ?? ((program, args) => defaultRun(program, args, o.env, timeoutMs));
  /** @param {string | null} out */
  const got = (out) => ({ value: out === null ? null : normalize(out) || null });
  const account = accountName(o.env);
  /** @type {ReturnType<typeof places>} */
  const out = [];
  if (platform !== 'win32') {
    const store = keychain({ service: SERVICE, platform, env: o.env, timeoutMs });
    out.push({
      source: platform === 'darwin' ? 'keychain' : 'secret-service',
      where:
        platform === 'darwin'
          ? `the login Keychain (service ${SERVICE}, account ${account})`
          : `the Secret Service through libsecret (service ${SERVICE}, account ${account})`,
      read: () => got(store.read(account)),
    });
  } else {
    out.push({
      source: 'credential-manager',
      where: `Credential Manager (target ${SERVICE})`,
      read: () =>
        got(
          run('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(windowsReader(SERVICE), 'utf16le').toString('base64'),
          ]),
        ),
    });
  }
  if (o.machineDir) {
    const file = join(o.machineDir, TOKEN_FILE);
    out.push({
      source: 'machine-file',
      where: file,
      read: () => {
        if (!existsSync(file)) return { value: null };
        // The file is the owner's alone: one others can read is refused, not used.
        if (platform !== 'win32' && (statSync(file).mode & 0o077) !== 0) {
          return {
            value: null,
            problem: `${file} can be read by other users: chmod 600 it, or keep the token in the keychain instead`,
          };
        }
        try {
          return { value: normalize(readFileSync(file, 'utf8')) || null };
        } catch {
          return { value: null, problem: `${file} cannot be read` };
        }
      },
    });
  }
  return out;
}

/**
 * The account the token is kept under: the person's account name, as the guide's commands store it
 * ("$USER", %USERNAME%). @param {NodeJS.ProcessEnv} env
 */
function accountName(env) {
  const given = env.USER ?? env.USERNAME ?? env.LOGNAME;
  if (given) return given;
  try {
    return userInfo().username;
  } catch {
    return 'unknown';
  }
}

/**
 * The long-lived credential the environment already gives Claude Code, by name only.
 * @param {NodeJS.ProcessEnv} env
 */
export function credentialInEnv(env) {
  return (
    FROM_ENV.find((c) => typeof env[c.variable] === 'string' && env[c.variable] !== '') ?? null
  );
}

/**
 * The stored token, for the launcher only: the value and where it came from, or why there is none.
 * @param {CredentialOptions} o
 * @returns {{ value: string, source: Source } | { value: null, looked_in: string[], problems: string[] }}
 */
export function readToken(o) {
  /** @type {string[]} */
  const problems = [];
  const all = places(o);
  for (const p of all) {
    const r = p.read();
    if (r.problem) problems.push(r.problem);
    if (r.value) return { value: r.value, source: p.source };
  }
  return { value: null, looked_in: all.map((p) => p.where), problems };
}

/**
 * What unattended runs start on here, without the value: the environment's credential when it
 * gives one, else the stored token, else the interactive sign-in.
 * @param {CredentialOptions} o
 * @returns {CredentialReport}
 */
export function unattendedCredential(o) {
  const all = places(o);
  const lookedIn = all.map((p) => p.where);
  const fromEnv = credentialInEnv(o.env);
  if (fromEnv) {
    return {
      long_lived: true,
      kind: fromEnv.kind,
      source: 'environment',
      variable: fromEnv.variable,
      problems: [],
      looked_in: lookedIn,
    };
  }
  const found = readToken(o);
  if (found.value === null) {
    return {
      long_lived: false,
      kind: 'interactive',
      source: null,
      problems: found.problems,
      looked_in: found.looked_in,
    };
  }
  const length = found.value.length;
  const problems = found.value.startsWith(TOKEN_PREFIX)
    ? []
    : [
        `the stored token does not start with ${TOKEN_PREFIX}, as the tokens claude setup-token makes do: it may be another value, or only the second of the two lines it prints`,
      ];
  return {
    long_lived: true,
    kind: 'oauth-token',
    source: found.source,
    length,
    problems,
    looked_in: lookedIn,
  };
}

/**
 * How to make and store the token, for a report that found none. The owner runs every step
 * themselves, in a terminal outside the agent.
 * @param {NodeJS.Platform} [platform] @param {string | null} [machineDir]
 * @returns {string[]}
 */
export function setupSteps(platform = process.platform, machineDir = null) {
  const store =
    platform === 'darwin'
      ? `security add-generic-password -a "$USER" -s ${SERVICE} -w   (it asks for the value, so it stays out of the shell history)`
      : platform === 'win32'
        ? `cmdkey /generic:${SERVICE} /user:%USERNAME% /pass   (it asks for the value)`
        : `secret-tool store --label='Claude Code OAuth token' service ${SERVICE} account "$USER"   (it asks for the value)`;
  const check =
    platform === 'darwin'
      ? `security find-generic-password -s ${SERVICE} -w | tr -d '\\n' | wc -c`
      : platform === 'win32'
        ? 'hitld env status (credential.length)'
        : `secret-tool lookup service ${SERVICE} | tr -d '\\n' | wc -c`;
  return [
    'run claude setup-token yourself, in a terminal outside any agent session: its output reaches an agent transcript otherwise, and the token prints on two lines of which only one may be masked',
    'join the two lines into one value with no break, then store it: ' + store,
    `check it without printing it: ${check} gives its length, which should match the token's`,
    ...(machineDir
      ? [
          `with no keychain, keep it in ${join(machineDir, TOKEN_FILE)} instead, readable by you only (chmod 600); never in the project, a log or an environment file the project tracks`,
        ]
      : []),
    'hitld env status then shows the credential executors run on',
  ];
}

/**
 * The environment one child starts in: `env` with the token added and the shell-tracing variables
 * taken out. A new object: the caller's environment never holds the token.
 * @param {NodeJS.ProcessEnv} env @param {string} token
 */
export function childEnv(env, token) {
  /** @type {NodeJS.ProcessEnv} */
  const out = { ...env, [TOKEN_ENV]: token };
  for (const k of TRACING) delete out[k];
  return out;
}

/** Words in a run's output that say its credential was refused or has ended. */
const AUTH_FAILURE =
  /(invalid api key|please run \/login|reached its time limit|oauth token (?:has )?expired|token (?:has )?(?:expired|been revoked)|authentication[_ ](?:error|failed)|failed to authenticate|not logged in|invalid bearer token|\b401\b[^\n]*(?:unauthori[sz]ed|authentication))/i;

/** Redacts a credential found by its shape (secrets.mjs TOKEN_PATTERNS) from a line hitld shows. */
const shapes = createRedactor({});

/**
 * Why a headless run stopped for its credential, from its output, or null. Read: an event the
 * harness marks authentication_failed, and the result event or standard error saying the
 * credential was refused or has ended. The line is cut to 200 characters, and a credential in it
 * is redacted by its shape.
 * @param {Record<string, any>[]} events the run's events @param {string} [stderr] its errors file
 * @returns {string | null}
 */
export function credentialFailure(events, stderr = '') {
  const cut = (/** @type {string} */ s) =>
    shapes.redact(s.replace(/\s+/g, ' ').trim()).slice(0, 200);
  for (const e of events) {
    const err = e?.error ?? e?.message?.error;
    if (err === 'authentication_failed') {
      const text = textOf(e);
      return cut(text ? `authentication failed: ${text}` : 'authentication failed');
    }
  }
  const result = events.findLast((e) => e?.type === 'result');
  if (result && typeof result.result === 'string' && AUTH_FAILURE.test(result.result)) {
    return cut(result.result);
  }
  const line = String(stderr)
    .split('\n')
    .find((l) => AUTH_FAILURE.test(l));
  return line ? cut(line) : null;
}

/** The text of an assistant event's content, when it has any. @param {Record<string, any>} e */
function textOf(e) {
  const content = e?.message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) => (c && typeof c.text === 'string' ? c.text : ''))
    .join(' ')
    .trim();
}

const ISO_DAY = '(\\d{4}-\\d{2}-\\d{2})';
/**
 * The ways Claude Code says when the interactive sign-in ends, with its dates as YYYY-MM-DD: the
 * warning a run prints on standard error when it starts on the sign-in, and its status line.
 *   "this sign-in may have ended between A and B"   past its end
 *   "this sign-in can end at any time from now until B"
 *   "this sign-in ends between A and B (in N days at the earliest)"
 *   "Sign-in may have ended: between A and B", "Sign-in ends: any day now, by B",
 *   "Sign-in ends: between A and B"
 * @type {{ re: RegExp, ended: boolean, earliest: boolean }[]}
 */
const SIGN_IN = [
  {
    re: new RegExp(`may have ended:? between ${ISO_DAY} and ${ISO_DAY}`, 'i'),
    ended: true,
    earliest: true,
  },
  {
    re: new RegExp(`can end at any time from now until ${ISO_DAY}`, 'i'),
    ended: false,
    earliest: false,
  },
  { re: new RegExp(`ends:? any day now, by ${ISO_DAY}`, 'i'), ended: false, earliest: false },
  { re: new RegExp(`ends:? between ${ISO_DAY} and ${ISO_DAY}`, 'i'), ended: false, earliest: true },
];

/**
 * @typedef {object} SignInEnd when Claude Code said the interactive sign-in ends
 * @property {string | null} earliest the first day it can end, YYYY-MM-DD; null: it can end now
 * @property {string} latest the day it ends by, YYYY-MM-DD
 * @property {boolean} said_ended Claude Code said it may already have ended
 */

/**
 * When Claude Code says the interactive sign-in ends, from a run's output, or null when no line
 * says it.
 * @param {string} text
 * @returns {SignInEnd | null}
 */
export function signInEndsIn(text) {
  for (const line of String(text).split('\n')) {
    for (const f of SIGN_IN) {
      const m = f.re.exec(line);
      if (!m) continue;
      return f.earliest
        ? { earliest: m[1], latest: m[2], said_ended: f.ended }
        : { earliest: null, latest: m[1], said_ended: false };
    }
  }
  return null;
}

/**
 * Where the sign-in stands now, from what Claude Code said when a run started: ended (its last
 * day has passed), any day now (its first day has come), or the whole days left before its first.
 * @param {SignInEnd} end @param {number} now
 * @returns {{ state: 'ended' | 'any-day-now' | 'ahead', days_left: number }}
 */
export function signInState(end, now) {
  const latest = Date.parse(`${end.latest}T00:00:00Z`) + DAY_MS;
  if (now >= latest) return { state: 'ended', days_left: 0 };
  const earliest = end.earliest === null ? null : Date.parse(`${end.earliest}T00:00:00Z`);
  if (earliest === null || now >= earliest) return { state: 'any-day-now', days_left: 0 };
  return { state: 'ahead', days_left: Math.floor((earliest - now) / DAY_MS) };
}

/**
 * What Claude Code last said about the sign-in's end, read from the error files and the start of
 * the result files of the headless runs in a store's dispatch results (newest first), with the
 * file it came from. Null when none of them says.
 * @param {string} resultsDir the store's dispatch/results directory
 * @returns {(SignInEnd & { from: string }) | null}
 */
export function signInEnds(resultsDir) {
  /** @type {string[]} */
  let names;
  try {
    names = readdirSync(resultsDir).filter((n) => /\.(stderr|json)$/.test(n));
  } catch {
    return null;
  }
  const dated = names
    .map((n) => {
      try {
        return { n, t: statSync(join(resultsDir, n)).mtimeMs };
      } catch {
        return { n, t: 0 };
      }
    })
    .sort((a, b) => b.t - a.t)
    .slice(0, 20);
  for (const { n } of dated) {
    let text = '';
    try {
      // A result file is the run's whole transcript: what the harness says comes at its start.
      text = readFileSync(join(resultsDir, n), 'utf8').slice(0, 64 * 1024);
    } catch {
      continue;
    }
    // In a transcript, only what the harness itself said: the agent's and the brief's words may
    // talk about the sign-in and dates too.
    if (n.endsWith('.json')) text = harnessText(text);
    const end = signInEndsIn(text);
    if (end) return { ...end, from: n };
  }
  return null;
}

/**
 * The text of a transcript's events that are neither the agent's, the user's nor the result, one
 * event to a line: what the harness itself printed. A line cut short is skipped.
 * @param {string} text
 */
function harnessText(text) {
  /** @type {string[]} */
  const out = [];
  for (const line of text.split('\n')) {
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object' && !['assistant', 'user', 'result'].includes(e.type)) {
        out.push(JSON.stringify(e));
      }
    } catch {
      // not an event
    }
  }
  return out.join('\n');
}

/**
 * What a status report says about the credential, as one line: which credential executors run on,
 * and for the interactive sign-in, where its end stands now.
 * @param {CredentialReport} c @param {(SignInEnd & { from: string }) | null} ends
 * @param {number} [now]
 */
export function credentialLine(c, ends, now = Date.now()) {
  if (c.long_lived) {
    const what =
      c.source === 'environment'
        ? `${c.kind} from ${c.variable} in the environment`
        : `the token claude setup-token made, from ${c.source}${c.length ? ` (${c.length} characters)` : ''}`;
    return `executors run on a long-lived credential: ${what}`;
  }
  const fix =
    'an unattended run stops when it ends. Make a long-lived credential with claude setup-token before an overnight run';
  if (!ends) {
    return `executors run on the interactive sign-in, which can end at any time before a date Claude Code gives when a headless run starts on it; ${fix}`;
  }
  const s = signInState(ends, now);
  const window = ends.earliest
    ? `between ${ends.earliest} and ${ends.latest}`
    : `by ${ends.latest}`;
  const where =
    s.state === 'ended'
      ? `which has ended: Claude Code gave its end as ${window}`
      : s.state === 'any-day-now'
        ? `which can end any day now, ${ends.earliest ? `${window}` : `at the latest ${ends.latest}`}`
        : `which can end in ${s.days_left} ${s.days_left === 1 ? 'day' : 'days'} at the earliest, ${window}`;
  return `executors run on the interactive sign-in, ${where} (as Claude Code said in ${ends.from}); ${fix}`;
}
