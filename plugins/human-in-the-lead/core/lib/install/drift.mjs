// Version drift (design part 16.5, Upgrades): the release this session runs, the release the
// project pins in .claude/settings.json, and the release that last wrote the run's data (the
// ledger's run-started and lease-taken events record it).
//
//   newer data      the private store holds a ledger line or run state at a schema_version this
//                   release does not read: it was written by a newer release. Refused
//                   (newer-schema), because a release never writes ahead of newer data. This is what
//                   keeps a rolled-back pin from touching data the newer release wrote.
//   not pinned      this session runs another release than the pin names. Refused at run start and
//                   resume (version-not-pinned), with the fix: update this machine to the pin, or
//                   move the pin by a pull request the owner merges.
//   upgrade due     the pin is ahead of the release that last wrote the data: the chief of staff
//                   upgrades at the next hand-over, and `hitld upgrade plan` lists the steps.
//
// Reads only. A project without a pin (this repository, a test, a --store run) skips the pin part.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NAME, VERSION } from '../version.mjs';
import { findRepoRoot, loadPolicy } from '../policy/policy.mjs';
import { compareVersions, parseVersion, TAG } from '../release/semver.mjs';
import { schemas } from '../schema/registry.mjs';
import { ledgerKeys } from '../ledger/writer.mjs';
import { STATE_KEY, CHECKPOINT_PREFIX } from '../run/checkpoint.mjs';
import { openStore, privateStorePath } from '../store/store.mjs';
import { declaredPin } from '../settings/pins.mjs';
import { MARKETPLACE, PLUGIN } from './install.mjs';

/**
 * @typedef {import('../store/store.mjs').PrivateStore} PrivateStore
 *
 * @typedef {object} PinInfo
 * @property {'tag' | 'commit' | 'branch' | 'directory'} kind
 * @property {string | null} version the release it names, when known
 * @property {string | null} ref the git ref, for a github or git source
 * @property {string} where where the pin points, for messages
 * @property {boolean | null} auto_update the entry's autoUpdate, when set
 *
 * @typedef {object} Written
 * @property {string | null} version the release that last wrote the run's data
 * @property {string | null} newest the newest release that ever wrote it
 * @property {string | null} event the event that recorded `version`
 * @property {string | null} at when
 *
 * @typedef {object} Drift
 * @property {string} running the release this session runs
 * @property {PinInfo | null} pin
 * @property {Written} data
 * @property {{ file: string, found: number, known: number }[]} newer data this release does not read
 * @property {{ error: 'version-not-pinned' | 'newer-schema', message: string } | null} refusal
 * @property {{ due: boolean, from?: string, to?: string, next?: string }} upgrade
 * @property {string[]} warnings
 */

/** The plugin's install ID. */
export const PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`;
/** The commands that bring this machine's plugin to the pin (design 16.5, Upgrades). */
export const UPDATE_COMMANDS = Object.freeze([
  `claude plugin marketplace update ${MARKETPLACE}`,
  `claude plugin update ${PLUGIN_ID} --scope project`,
]);

/** @param {string} path @returns {any} */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The pin in the project's committed .claude/settings.json, or null when it declares none.
 * @param {string} root
 * @returns {PinInfo | null}
 */
export function readPin(root) {
  const entry = readJson(join(root, '.claude', 'settings.json'))?.extraKnownMarketplaces?.[
    MARKETPLACE
  ];
  const source = entry?.source;
  if (!source || typeof source !== 'object') return null;
  const auto = typeof entry.autoUpdate === 'boolean' ? entry.autoUpdate : null;
  const declared = declaredPin(root, 'project');
  if (source.source === 'directory') {
    return {
      kind: 'directory',
      version: declared?.version ?? null,
      ref: null,
      where: declared?.where ?? 'a checkout',
      auto_update: auto,
    };
  }
  const ref = typeof source.ref === 'string' ? source.ref : null;
  const kind =
    ref === null
      ? 'branch'
      : TAG.test(ref)
        ? 'tag'
        : /^[0-9a-f]{40}$/.test(ref)
          ? 'commit'
          : 'branch';
  return {
    kind,
    version: kind === 'tag' && ref ? ref.slice(1) : null,
    ref,
    where: ref === null ? 'the default branch' : `ref ${ref}`,
    auto_update: auto,
  };
}

/** The release an event records, if it records one. @param {any} e @returns {string | null} */
const versionOf = (e) => {
  const v = e?.skill_versions?.hitld_version ?? e?.skill_versions?.plugin;
  return typeof v === 'string' ? v : null;
};

/**
 * Which release last wrote the run's data, from the ledger's raw lines (a line this release cannot
 * validate still says who wrote it), and which lines and run states are newer than this release
 * reads.
 * @param {PrivateStore | null} store
 * @param {{ ledger?: number, runState?: number }} [known] the newest schema versions this release
 *   reads (default: its own schemas)
 * @returns {{ data: Written, newer: { file: string, found: number, known: number }[] }}
 */
export function writtenBy(store, known = {}) {
  /** @type {Written} */
  const data = { version: null, newest: null, event: null, at: null };
  /** @type {{ file: string, found: number, known: number }[]} */
  const newer = [];
  if (!store) return { data, newer };
  const ledgerKnown = known.ledger ?? schemas().currentVersion('ledger-entry') ?? 1;
  const stateKnown = known.runState ?? schemas().currentVersion('run-state') ?? 1;
  // Every ledger file (ledger/writer.mjs). The run start that counts is the latest by its time;
  // on a tie, the one read last.
  /** @type {Map<string, number>} */
  const newestLine = new Map();
  const lines = ledgerKeys(store).flatMap((key) =>
    (store.read(key) ?? '').split('\n').map((raw) => ({ key, raw })),
  );
  for (const { key, raw } of lines) {
    if (raw.trim() === '') continue;
    let e;
    try {
      e = JSON.parse(raw);
    } catch {
      continue; // a damaged line says nothing
    }
    if (Number.isInteger(e?.schema_version) && e.schema_version > ledgerKnown) {
      newestLine.set(key, Math.max(newestLine.get(key) ?? 0, e.schema_version));
    }
    const v = versionOf(e);
    if (v === null) continue;
    const at = typeof e.at === 'string' ? e.at : '';
    if ((e.event === 'run-started' || e.event === 'lease-taken') && at >= (data.at ?? '')) {
      data.version = v;
      data.event = e.event;
      data.at = typeof e.at === 'string' ? e.at : null;
    }
    if (data.newest === null || compareVersions(v, data.newest) > 0) data.newest = v;
  }
  for (const [file, found] of newestLine) newer.push({ file, found, known: ledgerKnown });
  for (const key of [STATE_KEY, ...store.list(CHECKPOINT_PREFIX)]) {
    const found = readJsonText(store.read(key))?.schema_version;
    if (Number.isInteger(found) && found > stateKnown) {
      newer.push({ file: key, found, known: stateKnown });
    }
  }
  return { data, newer };
}

/** @param {string | null} text @returns {any} */
function readJsonText(text) {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The drift between this session's release, the pin and the data.
 * @param {{ root?: string | null, store?: PrivateStore | null, running?: string,
 *   known?: { ledger?: number, runState?: number } }} [options]
 *   root: the project's repository root (null: no pin to compare); running: this session's release
 *   (default: this code's); known: the newest schema versions this release reads (for tests)
 * @returns {Drift}
 */
export function checkDrift(options = {}) {
  const running = options.running ?? VERSION;
  const pin = options.root ? readPin(options.root) : null;
  const { data, newer } = writtenBy(options.store ?? null, options.known);
  /** @type {string[]} */
  const warnings = [];
  /** @type {Drift['refusal']} */
  let refusal = null;

  if (newer.length) {
    const what = newer.map((n) => `${n.file} at schema_version ${n.found}`).join(', ');
    refusal = {
      error: 'newer-schema',
      message: `the private store holds ${what}, newer than this release of ${NAME} (${running}) reads (${newer[0].known}): a newer release${data.newest ? ` (${data.newest})` : ''} wrote it, and a release never writes ahead of newer data. Run the release that wrote it: move the pin back up by a pull request, run ${UPDATE_COMMANDS.join(' and ')}, and restart the session`,
    };
  } else if (pin && pin.version !== null && pin.version !== running) {
    refusal = { error: 'version-not-pinned', message: notPinnedMessage(running, pin) };
  }

  if (pin?.kind === 'commit') {
    warnings.push(
      `.claude/settings.json pins ${NAME} to a commit (${pin.ref}), not a release tag, so hitld cannot tell which release it holds; this session runs ${running}`,
    );
  } else if (pin?.kind === 'branch') {
    warnings.push(
      `.claude/settings.json pins ${NAME} to ${pin.where}, which moves: an update can change the running release without a pull request. Pin a release tag (hitld install --ref <tag> --repo <owner/name>)`,
    );
  }
  if (pin?.auto_update === true) {
    warnings.push(
      `automatic updates are on for the ${MARKETPLACE} marketplace in .claude/settings.json; set "autoUpdate": false on its entry, so the plugin moves only when the pin does`,
    );
  }
  if (!refusal && data.newest && compareVersions(data.newest, running) > 0) {
    warnings.push(
      `${data.newest}, newer than this release (${running}), has written the run's data; every file is at a schema version this release reads, so it goes on. A rollback runs no migration backwards`,
    );
  }

  /** @type {Drift['upgrade']} */
  let upgrade = { due: false };
  const target = pin?.version ?? (pin ? null : running);
  if (
    !refusal &&
    target &&
    data.version &&
    parseVersion(target) &&
    parseVersion(data.version) &&
    compareVersions(target, data.version) > 0
  ) {
    upgrade = {
      due: true,
      from: data.version,
      to: target,
      next: `the run's data was last written by ${data.version}, and ${pin ? 'the pin' : 'this session'} is at ${target}: hitld upgrade plan lists what to run, in order, and who does what`,
    };
  }
  return { running, pin, data, newer, refusal, upgrade, warnings };
}

/**
 * Why this session's release is not the pinned one, and how to fix it.
 * @param {string} running @param {PinInfo} pin
 */
function notPinnedMessage(running, pin) {
  const pinned = /** @type {string} */ (pin.version);
  const head = `this session runs ${NAME} ${running}, and .claude/settings.json pins ${pinned} (${pin.where})`;
  if (pin.kind === 'directory') {
    return `${head}: another copy of the plugin is loaded (claude --plugin-dir, or an installed copy). Start the session with the copy the pin names, or change the pin`;
  }
  if (compareVersions(running, pinned) < 0) {
    return `${head}. The pin moved and this machine has not caught up: run ${UPDATE_COMMANDS.join(' and ')}, then restart the session (hitld upgrade plan lists the rest)`;
  }
  return `${head}. The plugin moved without the pin (an automatic update, or another copy loaded with claude --plugin-dir). Either move the pin to v${running} by a pull request the owner merges, or turn off automatic updates for this plugin ("autoUpdate": false on the ${MARKETPLACE} entry under extraKnownMarketplaces in .claude/settings.json, or /plugin, Marketplaces, Disable auto-update) and install the pinned release again: claude plugin uninstall ${PLUGIN_ID} --scope project, then claude plugin install ${PLUGIN_ID} --scope project, then restart the session`;
}

/** A refused run: the drift says why. */
export class VersionDriftError extends Error {
  /** @param {Drift} drift */
  constructor(drift) {
    super(drift.refusal?.message ?? 'version drift');
    this.name = 'VersionDriftError';
    this.code = drift.refusal?.error ?? 'version-not-pinned';
    this.drift = drift;
  }
}

/**
 * The check `hitld run start` and `run resume` make before anything is recorded: refuse on newer
 * data or a release that is not the pinned one, and otherwise return the drift (with `upgrade`).
 * @param {PrivateStore} store
 * @param {{ cwd?: string, running?: string }} [options] cwd: where the command runs, for the pin
 * @returns {Drift}
 */
export function runVersionCheck(store, options = {}) {
  const drift = checkDrift({
    root: options.cwd ? findRepoRoot(options.cwd) : null,
    store,
    running: options.running,
  });
  if (drift.refusal) throw new VersionDriftError(drift);
  return drift;
}

/**
 * The drift of the project at `cwd`, for a reader that has no store open: the session-start hook
 * and `hitld upgrade plan`. The store is read only when it exists.
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv, store?: string, running?: string }} options
 * @returns {Drift & { root: string | null, store: PrivateStore | null }}
 */
export function projectDrift(options) {
  const root = findRepoRoot(options.cwd);
  /** @type {PrivateStore | null} */
  let store = null;
  try {
    const dir =
      options.store ??
      (() => {
        const id = loadPolicy({ cwd: options.cwd }).policy?.project?.id;
        return id ? privateStorePath(id, { env: options.env, repoRoot: root ?? undefined }) : null;
      })();
    if (dir && existsSync(dir)) store = openStore(dir);
  } catch {
    store = null;
  }
  return { root, store, ...checkDrift({ root, store, running: options.running }) };
}

/**
 * What the session-start hook says, or '' when there is nothing to say.
 * @param {{ cwd: string, env?: NodeJS.ProcessEnv }} options
 */
export function sessionNotice(options) {
  const d = projectDrift(options);
  /** @type {string[]} */
  const lines = [];
  if (d.refusal) {
    lines.push(
      `${NAME}: ${d.refusal.message}. Until then hitld run start and run resume refuse (${d.refusal.error}).`,
    );
  }
  if (d.upgrade.due) {
    lines.push(
      `${NAME}: an upgrade is due: ${d.upgrade.next}. The chief of staff upgrades at a hand-over.`,
    );
  }
  for (const w of d.warnings) lines.push(`${NAME}: ${w}.`);
  return lines.join('\n');
}

/** Whether two releases share major and minor. @param {string} a @param {string} b */
export function sameMinor(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  return Boolean(x && y && x.major === y.major && x.minor === y.minor);
}

/**
 * How a report from an executor dispatched on another release is read: accepted within the same
 * minor; from another minor it is read with this release's rules, with a warning. Null when the
 * executor ran this release, or the dispatch recorded none.
 * @param {string | null | undefined} dispatchedOn @param {string} [running]
 */
export function reportVersion(dispatchedOn, running = VERSION) {
  if (!dispatchedOn || dispatchedOn === running) return null;
  const same = sameMinor(dispatchedOn, running);
  return {
    dispatched_on: dispatchedOn,
    running,
    same_minor: same,
    ...(same
      ? {}
      : {
          warning: `dispatched on ${dispatchedOn}, a different minor from ${running}: its report was read with ${running}'s rules. Upgrade across minors only once nothing is in flight`,
        }),
  };
}

/**
 * The release a dispatch was started on, from its dispatched event.
 * @param {import('../ledger/ledger.mjs').LedgerEntry[]} events @param {string} dispatch
 */
export const dispatchedOn = (events, dispatch) =>
  versionOf(events.find((e) => e.event === 'dispatched' && e.dispatch === dispatch));
