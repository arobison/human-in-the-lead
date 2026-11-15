// `hitld upgrade plan` (design part 16.5, Upgrades): what moving to a newer release takes, read
// from the release records between the release that last wrote the data and the target, and listed
// in order with who does each step. It changes nothing.
//
// The records come from a directory of release records (`work/releases/` of a checkout at the
// target tag, or --records). By default: the marketplace's own clone under the Claude Code plugins
// directory, which holds the repository at the pinned ref once the marketplace is refreshed, then
// the checkout this hitld runs from.

import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { NAME } from '../version.mjs';
import { parseItem } from '../tracker/files/frontmatter.mjs';
import { compareVersions, coreOf, isPrerelease, parseVersion, TAG } from '../release/semver.mjs';
import { MARKETPLACE, ownCheckout } from './install.mjs';
import { UPDATE_COMMANDS, sameMinor } from './drift.mjs';

/**
 * @typedef {'owner' | 'chief-of-staff' | 'orchestrator' | 'every-machine' | 'executors'} Role
 *
 * @typedef {object} ReleaseRecord
 * @property {string} tag
 * @property {string} version
 * @property {string | null} bump
 * @property {string[]} interface_delta
 * @property {string[]} notes
 * @property {string} file
 *
 * @typedef {object} Step
 * @property {number} step
 * @property {Role} who
 * @property {string} does
 * @property {string[]} [run] commands, in order
 * @property {boolean} [done] already done, from what hitld can see
 */

/** The role names in the order the plan lists them. @type {Role[]} */
export const ROLES = ['owner', 'chief-of-staff', 'orchestrator', 'every-machine', 'executors'];

/** The migration commands, in the order they run (design part 16.5). */
const MIGRATIONS = [
  {
    name: 'work migrate',
    who: /** @type {Role} */ ('orchestrator'),
    run: ['hitld work migrate --dry-run', 'hitld work migrate'],
    does: 'Apply the tracker format migrations to every item file, as tier-0 work through the merge queue; then hitld work check passes',
  },
  {
    name: 'config migrate',
    who: /** @type {Role} */ ('every-machine'),
    run: ['hitld config migrate', 'hitld config migrate --yes'],
    does: "Move or rename settings in policy.json and the person and machine files; it proposes first, and --yes writes, on the owner's word",
  },
  {
    name: 'data migrate',
    who: /** @type {Role} */ ('orchestrator'),
    run: ['hitld data migrate'],
    does: 'Upgrade policy.json, settings and private-store files to the new schema versions (never the ledger)',
  },
];

/**
 * Where Claude Code keeps its plugins: $CLAUDE_PLUGIN_CACHE_DIR, or ~/.claude/plugins.
 * @param {NodeJS.ProcessEnv} [env] @param {string} [home]
 */
export function pluginsRoot(env = process.env, home = homedir()) {
  const set = env.CLAUDE_PLUGIN_CACHE_DIR;
  return set ? set : join(home, '.claude', 'plugins');
}

/**
 * The directories to look in for release records, in order.
 * @param {{ records?: string, env?: NodeJS.ProcessEnv, home?: string }} [options]
 */
export function recordDirs(options = {}) {
  if (options.records) return [options.records];
  const own = ownCheckout();
  return [
    join(pluginsRoot(options.env, options.home), 'marketplaces', MARKETPLACE, 'work', 'releases'),
    ...(own ? [join(own, 'work', 'releases')] : []),
  ];
}

/** @param {string | string[] | undefined} v */
const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/**
 * Read the release records in a directory. A record is data: front matter and its notes. Files that
 * are not regular files, or do not parse as a record, are skipped.
 * @param {string} dir
 * @returns {ReleaseRecord[]}
 */
export function loadRecords(dir) {
  if (!existsSync(dir)) return [];
  /** @type {ReleaseRecord[]} */
  const out = [];
  for (const file of readdirSync(dir).sort()) {
    if (!TAG.test(file.replace(/\.md$/, '')) || !file.endsWith('.md')) continue;
    const path = join(dir, file);
    if (!lstatSync(path).isFile()) continue;
    const { data, body, errors } = parseItem(readFileSync(path, 'utf8'));
    if (!data || errors.length || typeof data.version !== 'string') continue;
    if (`v${data.version}.md` !== file) continue;
    out.push({
      tag: `v${data.version}`,
      version: data.version,
      bump: typeof data.bump === 'string' ? data.bump : null,
      interface_delta: list(data.interface_delta).map(String),
      notes: notesOf(body),
      file: path,
    });
  }
  return out.sort((a, b) => compareVersions(a.version, b.version));
}

/** The bullet lines under a record's `## Notes`. @param {string} body */
function notesOf(body) {
  const m = /(?:^|\n)## Notes\n([\s\S]*?)(?=\n## |$)/.exec(body);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => /^- (.*\S)\s*$/.exec(l)?.[1])
    .filter((l) => l !== undefined);
}

/**
 * The records an upgrade from `from` to `to` crosses: after `from`, up to and including `to`. A
 * pre-release is left out when the full release of the same version is in the span, since that
 * record's notes cover it.
 * @param {ReleaseRecord[]} records @param {string} from @param {string} to
 */
export function span(records, from, to) {
  const inside = records.filter(
    (r) => compareVersions(r.version, from) > 0 && compareVersions(r.version, to) <= 0,
  );
  const full = new Set(inside.filter((r) => !isPrerelease(r.version)).map((r) => r.version));
  return inside.filter((r) => !isPrerelease(r.version) || !full.has(coreOf(r.version)));
}

/**
 * The plan: the steps in order, and what each role does.
 * @param {{ from: string, to: string, records: ReleaseRecord[], pinVersion?: string | null,
 *   inFlight?: { dispatch: string, hitld_version?: string | null }[] }} input
 *   records: the span's records (see span); pinVersion: the release the pin names now
 */
export function buildPlan(input) {
  const { from, to, records } = input;
  const minor = sameMinor(from, to);
  const text = records.flatMap((r) => [...r.notes, ...r.interface_delta]).join('\n');
  const breaking = records.some(
    (r) => r.bump === 'major' || r.interface_delta.some((d) => /^breaking\s/.test(d)),
  );
  const breakingSchemas = records.some((r) =>
    r.interface_delta.some((d) => /^breaking\s+schemas:/.test(d)),
  );
  const migrations = MIGRATIONS.filter((m) => {
    if (text.includes(m.name)) return true;
    return m.name === 'data migrate' ? breakingSchemas : breaking;
  });
  const inFlight = input.inFlight ?? [];

  /** @type {Omit<Step, 'step'>[]} */
  const steps = [
    {
      who: 'owner',
      does: `Merge the pull request that sets "ref": "v${to}" on the ${MARKETPLACE} marketplace in .claude/settings.json. Rolling back later is reverting that commit`,
      done: input.pinVersion === to,
    },
    {
      who: 'chief-of-staff',
      does: `Upgrade at a hand-over: wake the orchestrator with "upgrade to ${to}: hand over", and start no successor until the steps below are done`,
    },
    {
      who: 'orchestrator',
      does: minor
        ? 'Start nothing new, process the completions of the work you started, then hand over'
        : `Start nothing new and let every dispatch in flight finish, on any host and in any session, until hitld ledger in-flight lists none: a report is accepted from an executor of the same minor only, and ${from} and ${to} are different minors. Then hand over`,
      run: minor ? ['hitld handover'] : ['hitld ledger in-flight', 'hitld handover'],
    },
    {
      who: 'every-machine',
      does: `On each machine that runs the project's sessions: fetch the pinned ref and copy the plugin's new release into the plugin cache. A cloud session does not add the marketplaces a repository declares, so update the plugin wherever its environment installs it`,
      run: [...UPDATE_COMMANDS],
    },
    {
      who: 'every-machine',
      does: `Restart every session of the project, the chief of staff's included (the owner restarts that one at a quiet point): a running session keeps the release it loaded, and the hitld on its PATH and its skills and hooks change only when it starts. ${NAME}'s session-start hook says when a session still runs another release than the pin`,
    },
    {
      who: 'chief-of-staff',
      does: `Start the successor (chief-of-staff skill, step 1). Its hitld run resume refuses with version-not-pinned while the machine still runs the old release: then go back to the update`,
    },
    ...migrations.map((m) => ({
      who: m.who,
      does: `${m.does}. Run it with ${to}${m.who === 'orchestrator' ? ', as the successor, before planning' : ''}`,
      run: m.run,
    })),
    {
      who: 'orchestrator',
      does: 'Check the project at the new release, then plan as usual',
      run: ['hitld check contract', 'hitld work check'],
    },
    {
      who: 'executors',
      does: minor
        ? `Executors dispatched on ${from} that are still running finish on it; the successor accepts their reports, since ${from} and ${to} share a minor${inFlight.length ? ` (in flight now: ${inFlight.map((d) => d.dispatch).join(', ')})` : ''}`
        : `None are running when the successor starts (step 3); new executors start on ${to}`,
    },
  ];
  const numbered = steps.map((s, i) => /** @type {Step} */ ({ step: i + 1, ...s }));
  /** @type {Record<Role, string[]>} */
  const roles = /** @type {any} */ (Object.fromEntries(ROLES.map((r) => [r, []])));
  for (const s of numbered) {
    roles[s.who].push(`${s.step}. ${s.does}${s.run ? `: ${s.run.join(', then ')}` : ''}`);
  }
  return {
    same_minor: minor,
    breaking,
    migrations: migrations.map((m) => `hitld ${m.name}`),
    steps: numbered,
    roles,
  };
}

/**
 * The whole plan for the command: find the records, take the span, build the steps.
 * @param {{ from: string, to: string, records?: string, env?: NodeJS.ProcessEnv, home?: string,
 *   pinVersion?: string | null, inFlight?: { dispatch: string, hitld_version?: string | null }[] }} input
 */
export function upgradePlan(input) {
  const { from, to } = input;
  if (!parseVersion(from) || !parseVersion(to)) {
    return {
      ok: false,
      error: 'usage',
      message: `${!parseVersion(from) ? from : to} is not a release version`,
    };
  }
  if (compareVersions(to, from) <= 0) {
    return {
      ok: true,
      from,
      to,
      due: false,
      message: `nothing to upgrade: ${to} is not above ${from}`,
      steps: [],
    };
  }
  const dirs = recordDirs(input);
  const dir = dirs.find((d) => existsSync(join(d, `v${to}.md`)));
  if (!dir) {
    return {
      ok: false,
      error: 'not-found',
      message: `no release record for v${to} in ${dirs.join(' or ')}: refresh the marketplace (${UPDATE_COMMANDS[0]}) after the pin moves, or pass --records <the work/releases directory of a checkout at v${to}>`,
      looked_in: dirs,
    };
  }
  const records = span(loadRecords(dir), from, to);
  const plan = buildPlan({ ...input, records });
  return {
    ok: true,
    from,
    to,
    due: true,
    records_from: dir,
    releases: records.map((r) => ({
      tag: r.tag,
      bump: r.bump,
      interface_delta: r.interface_delta,
      notes: r.notes,
    })),
    ...plan,
    changes: 'none: the plan reads only',
  };
}
