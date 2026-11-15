// Owner merge mode (design parts 14.2 and 6.6): finished branches wait for the owner, but only
// after the queue has checked them. The steps:
//
//   1. route     a branch that changes nothing under merge.owner_paths or merge.owner_areas goes
//                through the queue as in queue mode; the rest wait for the owner (all of them
//                when both settings are empty)
//   2. check     the queue rebases the owner's branches, runs the commit guard, the fast checks,
//                the scanners and the full suite, and holds the tested commit (queue.mjs, hold);
//                a branch that fails is sent back and never shown
//   3. present   the green branches, each with evidence the executor did not write: the checks
//                passed, the files changed against touches, sensitive paths hit, the
//                public-surface delta and the deviations found; a directed read only where a
//                trigger of design 6.6 fires; and one question for the batch
//   4. approve   the owner's answer: all, or a list. All, with main unmoved, moves main to the
//                tested commit; a list is checked again on its own, since its stack differs
//   5. record    each approval is a trust event (latency, approved as presented or not), and a
//                later revert another; after a run of clean merges in an area, the queue is
//                proposed there, and the owner decides

import { spawnSync } from 'node:child_process';
import { globsOverlap } from '../dispatch/item.mjs';
import { matchesAny } from '../precedent/glob.mjs';
import { diffSurface, emptySurface } from '../release/delta.mjs';
import { schemaFields } from '../release/surface.mjs';
import { UNASSIGNED } from '../rights/trust.mjs';
import { advanceTo, runMergeQueue } from './queue.mjs';

/**
 * @typedef {{ item: string, branch: string | null }} Waiting
 * @typedef {{ item: string, branch: string | null, result: string | null, fast_check: string, waiting_since: string | null, waited_ms: number | null }} OwnerWaiting
 * @typedef {import('./queue.mjs').Entry} Entry
 * @typedef {import('./queue.mjs').Settings} Settings
 * @typedef {import('./queue.mjs').Tested} Tested
 * @typedef {import('./queue.mjs').Exec} Exec
 * @typedef {Awaited<ReturnType<typeof runMergeQueue>>} QueueResult
 * @typedef {import('./security.mjs').SecurityGate} SecurityGate
 * @typedef {import('../tracker/files/releases.mjs').DeltaEntry} DeltaEntry
 * @typedef {Record<string, any>} Policy
 *
 * @typedef {{ trigger: string, read: string, files: string[], diff: string, question: string }} DirectedRead
 *
 * @typedef {object} Evidence what the owner is shown for one green branch
 * @property {string} item
 * @property {string} branch
 * @property {string} branch_sha the branch tip that was checked
 * @property {string} commit the branch rebased, as tested
 * @property {string} parent what it was rebased onto
 * @property {string[]} areas the areas of the files it changes
 * @property {{ classification: 'passed', fast_checks: string[], scanners: string[], suite: string[] }} checks
 *   what passed, by command or scanner name
 * @property {string[]} changed the files the rebased branch changes
 * @property {string[] | null} outside_touches changed files no `touches` glob covers (tracker
 *   edits and generated files aside); null when the item has no touches
 * @property {string[]} sensitive changed files under dispatch.sensitive_globs
 * @property {{ files: string[], schema_changes: DeltaEntry[] }} public_surface
 * @property {string[]} deviations what the system found that the brief did not ask for
 * @property {DirectedRead[]} reads
 * @property {string} [dispatch]
 *
 * @typedef {object} Presentation the batch put to the owner, kept at PRESENTED_KEY
 * @property {1} schema_version
 * @property {string} at
 * @property {string} base main when the batch was checked
 * @property {string} commit the held, tested commit holding every branch below
 * @property {string} question
 * @property {Evidence[]} branches
 *
 * @typedef {{ area: string, clean_run: number, approvals: number, change: Record<string, unknown>, question: string }} Proposal
 * @typedef {{ approvals: number, as_presented: number, reverted: number, median_latency_ms: number | null, clean_run: number }} AreaApprovals
 */

/** The private store key of the batch last put to the owner. */
export const PRESENTED_KEY = 'merge/presented.json';
/** The private store key of the queue proposals made, by area: the approvals count at the time. */
export const PROPOSED_KEY = 'merge/proposed.json';

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
  const r = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() };
}

/** The commit a branch points at, or null. @param {string} repoRoot @param {string} branch */
export function branchTip(repoRoot, branch) {
  const r = git(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
  return r.ok ? r.out : null;
}

/**
 * The files a branch changes since it left main (a three-dot diff).
 * @param {string} repoRoot @param {string} main @param {string} branch @returns {string[]}
 */
export function changedOnBranch(repoRoot, main, branch) {
  return git(repoRoot, ['diff', '--name-only', `refs/heads/${main}...refs/heads/${branch}`])
    .out.split('\n')
    .filter(Boolean);
}

/**
 * The areas files fall in, from policy.rights.areas; a file in none counts as "unassigned".
 * @param {string[]} files @param {Policy} policy @returns {string[]}
 */
export function areasOf(files, policy) {
  /** @type {Set<string>} */
  const out = new Set();
  const areas = /** @type {{ name: string, paths?: string[] }[]} */ (policy.rights?.areas ?? []);
  for (const f of files) {
    const hit = areas.filter((a) => matchesAny(a.paths ?? [], f));
    if (!hit.length) out.add(UNASSIGNED);
    for (const a of hit) out.add(a.name);
  }
  return [...out].sort();
}

/** @param {Policy} policy @returns {string[]} */
const ownerPaths = (policy) => policy.merge?.owner_paths ?? [];
/** @param {Policy} policy @returns {string[]} */
const ownerAreas = (policy) => policy.merge?.owner_areas ?? [];

/**
 * Whether owner mode covers every path: merge.owner_paths and merge.owner_areas both empty.
 * @param {Policy} policy
 */
const everywhere = (policy) => !ownerPaths(policy).length && !ownerAreas(policy).length;

/**
 * Whether a branch that changes these files waits for the owner (step 1). Every branch does when
 * merge.owner_paths and merge.owner_areas are both empty; otherwise one that changes a file under
 * owner_paths, or in an area named in owner_areas ("unassigned" for files in no area).
 * @param {string[]} files @param {Policy} policy
 */
export function waitsForOwner(files, policy) {
  if (everywhere(policy)) return true;
  if (files.some((f) => matchesAny(ownerPaths(policy), f))) return true;
  const named = ownerAreas(policy);
  return areasOf(files, policy).some((a) => named.includes(a));
}

/** Dependency manifests: a change to one is the new-dependency trigger of design 6.6. */
const MANIFESTS = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'requirements.txt',
  'pyproject.toml',
  'poetry.lock',
  'Pipfile',
  'Pipfile.lock',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Cargo.lock',
  'Gemfile',
  'Gemfile.lock',
  'pom.xml',
  'build.gradle',
  'composer.json',
]);

/** @param {string} repoRoot @param {string} commit @param {string} path @returns {any} */
function jsonAt(repoRoot, commit, path) {
  const r = git(repoRoot, ['show', `${commit}:${path}`]);
  if (!r.ok) return null;
  try {
    const s = JSON.parse(r.out);
    return s && typeof s === 'object' && !Array.isArray(s) ? s : null;
  } catch {
    return null;
  }
}

/**
 * The public-surface delta of one tested branch: the changed files under merge.public_globs, and,
 * for the JSON schemas among them, the fields added, removed or changed (release/delta.mjs). Read
 * from git as data: nothing on the branch runs.
 * @param {string} repoRoot @param {Tested} t @param {string[]} globs
 */
function publicSurface(repoRoot, t, globs) {
  const files = t.changed.filter((f) => matchesAny(globs, f));
  /** @type {DeltaEntry[]} */
  const schemaChanges = [];
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    const before = emptySurface();
    const after = emptySurface();
    const a = jsonAt(repoRoot, t.parent, f);
    const b = jsonAt(repoRoot, t.commit, f);
    if (a) before.schemas[f] = { version: null, fields: schemaFields(a) };
    if (b) after.schemas[f] = { version: null, fields: schemaFields(b) };
    schemaChanges.push(...diffSurface(before, after));
  }
  return { files, schema_changes: schemaChanges };
}

/**
 * The evidence for one green branch (step 3), from the queue's own record of it and from git:
 * none of it comes from the executor's report.
 * @param {{ repoRoot: string, tested: Tested, branchSha: string, touches?: string[],
 *   reportedCommit?: string | null, settings: Settings, scanners?: string[], policy: Policy }} o
 * @returns {Evidence}
 */
export function evidenceFor(o) {
  const t = o.tested;
  const p = o.policy;
  // Tracker edits and generated files are expected on any branch.
  const expected = [
    ...(p.dispatch?.inline_globs ?? []),
    ...o.settings.generated.flatMap((g) => g.globs),
  ];
  const touches = o.touches ?? [];
  const outside = touches.length
    ? t.changed.filter((f) => !matchesAny(touches, f) && !matchesAny(expected, f))
    : null;
  const sensitive = t.changed.filter((f) => matchesAny(p.dispatch?.sensitive_globs ?? [], f));
  const surface = publicSurface(o.repoRoot, t, p.merge?.public_globs ?? []);
  const manifests = t.changed.filter((f) => MANIFESTS.has(f.split('/').at(-1) ?? ''));
  const areas = areasOf(t.changed, p);
  /** @type {string[]} */
  const deviations = [];
  if (outside?.length) {
    deviations.push(`changes files outside its touches: ${outside.join(', ')}`);
  }
  if (!touches.length) deviations.push('the item declares no touches to compare with');
  if (o.reportedCommit && !o.branchSha.startsWith(o.reportedCommit)) {
    deviations.push(
      `the branch tip ${o.branchSha.slice(0, 12)} is not the commit the report named (${o.reportedCommit.slice(0, 12)})`,
    );
  }
  /** @param {string[]} files */
  const diff = (files) =>
    `git diff ${t.parent.slice(0, 12)} ${t.commit.slice(0, 12)} -- ${files.join(' ')}`;
  /** @type {DirectedRead[]} */
  const reads = [];
  /** @param {string} trigger @param {string} read @param {string[]} files @param {string} question */
  const read = (trigger, read, files, question) =>
    reads.push({ trigger, read, files, diff: diff(files), question });
  if (sensitive.length) {
    read(
      'security-sensitive paths',
      'the changed region',
      sensitive,
      'Does this widen what anything can access?',
    );
  }
  if (surface.files.length) {
    read(
      'public surface change',
      'the public signatures and docs, not the implementation',
      surface.files,
      'Is this the commitment we want?',
    );
  }
  if (manifests.length) {
    read(
      'new dependency',
      "the manifest change and the package's provenance",
      manifests,
      'Do we accept this dependency?',
    );
  }
  const ui = areas.filter((a) => (p.dispatch?.owner_review_areas ?? []).includes(a));
  if (ui.length) {
    read(
      'owner-reviewed UI work',
      'the running UI, not the code',
      t.changed.filter((f) => areasOf([f], p).some((a) => ui.includes(a))),
      'Is this what you want people to see?',
    );
  }
  return {
    item: t.item,
    branch: t.branch,
    branch_sha: o.branchSha,
    commit: t.commit,
    parent: t.parent,
    areas,
    checks: {
      classification: 'passed',
      fast_checks: [...o.settings.fastChecks],
      scanners: [...(o.scanners ?? [])],
      suite: [...o.settings.fullSuite],
    },
    changed: t.changed,
    outside_touches: outside,
    sensitive,
    public_surface: surface,
    deviations,
    reads,
    ...(t.dispatch ? { dispatch: t.dispatch } : {}),
  };
}

/** The one question for a batch (step 3). @param {number} n */
export const batchQuestion = (n) =>
  n === 1 ? 'Merge it? yes, or no' : `Merge all ${n}? yes, or list the ones to merge`;

/**
 * Steps 1 to 3: route the waiting branches, merge those outside the owner's paths through the
 * queue, and check the rest without moving main. Only the branches that pass are presented.
 * @param {{ repoRoot: string, entries: Entry[], settings: Settings, policy: Policy,
 *   exec?: Exec, security?: SecurityGate, scanners?: string[],
 *   regenerateViews?: (dir: string) => void, events?: Record<string, any>[], now?: () => Date }} o
 * @returns {Promise<{ queued: QueueResult | null, checked: QueueResult | null, presentation: Presentation | null }>}
 */
export async function presentToOwner(o) {
  const main = o.settings.mainBranch;
  const now = o.now ?? (() => new Date());
  const toOwner = o.entries.filter((e) =>
    waitsForOwner(changedOnBranch(o.repoRoot, main, e.branch), o.policy),
  );
  const toQueue = o.entries.filter((e) => !toOwner.includes(e));
  const common = {
    repoRoot: o.repoRoot,
    settings: o.settings,
    exec: o.exec,
    security: o.security,
    regenerateViews: o.regenerateViews,
  };
  const queued = toQueue.length ? await runMergeQueue({ ...common, entries: toQueue }) : null;
  if (queued && (queued.incident || queued.held)) {
    return { queued, checked: null, presentation: null };
  }
  const checked = toOwner.length
    ? await runMergeQueue({ ...common, entries: toOwner, hold: true })
    : null;
  const ready = checked && !checked.incident && !checked.held ? checked.ready : null;
  if (!ready) return { queued, checked, presentation: null };
  const byItem = new Map(o.entries.map((e) => [e.item, e]));
  const events = o.events ?? [];
  const branches = ready.branches.map((t) =>
    evidenceFor({
      repoRoot: o.repoRoot,
      tested: t,
      branchSha: branchTip(o.repoRoot, t.branch) ?? '',
      touches: byItem.get(t.item)?.touches,
      reportedCommit:
        events.filter((e) => e.event === 'reported' && e.item === t.item).at(-1)?.commit ?? null,
      settings: o.settings,
      scanners: o.scanners,
      policy: o.policy,
    }),
  );
  return {
    queued,
    checked,
    presentation: {
      schema_version: 1,
      at: now().toISOString(),
      base: ready.base,
      commit: ready.commit,
      question: batchQuestion(branches.length),
      branches,
    },
  };
}

/**
 * Whether a stored presentation still describes what would be checked now: main has not moved,
 * the same branches wait, and none of them has moved since it was checked.
 * @param {Presentation | null} p @param {Entry[]} entries @param {string} repoRoot @param {string} main
 * @returns {p is Presentation}
 */
export function presentationCurrent(p, entries, repoRoot, main) {
  if (!p || branchTip(repoRoot, main) !== p.base) return false;
  if (entries.length !== p.branches.length) return false;
  return entries.every((e) =>
    p.branches.some(
      (b) =>
        b.item === e.item &&
        b.branch === e.branch &&
        branchTip(repoRoot, e.branch) === b.branch_sha,
    ),
  );
}

/**
 * The stored presentation; null when there is none or it cannot be read.
 * @param {import('../store/store.mjs').PrivateStore} store @returns {Presentation | null}
 */
export function readPresentation(store) {
  try {
    const p = JSON.parse(store.read(PRESENTED_KEY) ?? 'null');
    return p && p.schema_version === 1 && Array.isArray(p.branches) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Step 4: merge what the owner approved. `all` is the whole batch as presented; otherwise each
 * name must pick out one presented branch. A branch that moved since it was checked is refused:
 * the owner was shown other code. All, with main unmoved, moves main to the held, tested commit
 * and runs no check again. A list, or a moved main, runs the queue again on just the approved
 * branches, so main still moves only to a tested commit.
 * @param {{ repoRoot: string, presentation: Presentation, all?: boolean, names?: string[],
 *   entries: Entry[], settings: Settings, exec?: Exec, security?: SecurityGate,
 *   regenerateViews?: (dir: string) => void, events?: Record<string, any>[] }} o
 * @returns {Promise<{ refused: { unknown: string[], ambiguous: string[], mismatched: string[], moved: string[] } | null,
 *   result: QueueResult | null, as_presented: boolean, rechecked: boolean }>}
 */
export async function approvePresented(o) {
  const p = o.presentation;
  const main = o.settings.mainBranch;
  const names = o.names ?? [];
  const pick = o.all
    ? { chosen: p.branches, unknown: [], ambiguous: [], mismatched: [] }
    : chooseNamed(p.branches, names, o.events ?? []);
  const unknown = !o.all && !names.length ? ['(none named)'] : pick.unknown;
  const moved = pick.chosen
    .filter((b) => branchTip(o.repoRoot, b.branch) !== b.branch_sha)
    .map((b) => b.branch);
  if (unknown.length || pick.ambiguous.length || pick.mismatched.length || moved.length) {
    return {
      refused: { unknown, ambiguous: pick.ambiguous, mismatched: pick.mismatched, moved },
      result: null,
      as_presented: false,
      rechecked: false,
    };
  }
  const asPresented = pick.chosen.length === p.branches.length;
  if (asPresented && branchTip(o.repoRoot, main) === p.base) {
    const advanced = advanceTo({
      repoRoot: o.repoRoot,
      mainBranch: main,
      base: p.base,
      commit: p.commit,
      lastBranchCommit: p.branches.at(-1)?.commit ?? p.commit,
      security: o.security,
    });
    if (advanced.ok) {
      return {
        refused: null,
        as_presented: true,
        rechecked: false,
        result: {
          merged: p.branches.map((b) => ({
            item: b.item,
            branch: b.branch,
            commit: b.commit,
            ...(b.dispatch ? { dispatch: b.dispatch } : {}),
          })),
          rejected: [],
          flakes: [],
          suite_runs: 0,
          bisection_runs: 0,
          batches: 0,
          main: { before: p.base, after: p.commit },
          incident: null,
          held: null,
          ready: null,
        },
      };
    }
  }
  const chosen = new Set(pick.chosen.map((b) => b.item));
  const result = await runMergeQueue({
    repoRoot: o.repoRoot,
    entries: o.entries.filter((e) => chosen.has(e.item)),
    settings: o.settings,
    exec: o.exec,
    security: o.security,
    regenerateViews: o.regenerateViews,
  });
  return { refused: null, as_presented: asPresented, rechecked: true, result };
}

/**
 * Step 5: one trust event per approved branch that merged, per area it changes. latency_ms runs
 * from the presentation to the approval; as_presented says whether the owner took the batch as
 * shown or named a list.
 * @param {Presentation} p @param {{ item: string, commit: string }[]} merged
 * @param {boolean} asPresented @param {Date} at
 * @returns {Record<string, any>[]} events for recordTrustEvent, without schema_version and at
 */
export function approvalEvents(p, merged, asPresented, at) {
  const latency = Math.max(0, at.getTime() - Date.parse(p.at));
  return merged.flatMap((m) => {
    const b = p.branches.find((x) => x.item === m.item);
    return (b?.areas.length ? b.areas : [UNASSIGNED]).map((area) => ({
      kind: 'merge-approval',
      area,
      subject: m.item,
      decider: 'owner',
      commit: m.commit,
      ...(Number.isFinite(latency) ? { latency_ms: latency } : {}),
      as_presented: asPresented,
    }));
  });
}

/**
 * The trust events for a revert of an item the owner approved: one per area its approval counted
 * in, not yet marked reverted. None when no approval of the item is recorded.
 * @param {Record<string, any>[]} trust the trust events so far @param {string} item
 * @returns {Record<string, any>[]}
 */
export function revertEvents(trust, item) {
  const areas = new Set(
    trust.filter((e) => e.kind === 'merge-approval' && e.subject === item).map((e) => e.area),
  );
  const done = new Set(
    trust.filter((e) => e.kind === 'merge-reverted' && e.subject === item).map((e) => e.area),
  );
  return [...areas]
    .filter((a) => !done.has(a))
    .map((area) => ({ kind: 'merge-reverted', area, subject: item }));
}

/**
 * The owner's merge approvals per area: how many, how many as presented, how many reverted since,
 * the median latency, and the clean run: the latest approvals in a row that were taken as
 * presented and not reverted.
 * @param {Record<string, any>[]} trust
 * @returns {Record<string, AreaApprovals>}
 */
export function approvalSummary(trust) {
  const reverted = new Set(
    trust.filter((e) => e.kind === 'merge-reverted').map((e) => `${e.area}\0${e.subject}`),
  );
  /** @type {Record<string, AreaApprovals & { latencies: number[] }>} */
  const out = {};
  for (const e of trust) {
    if (e.kind !== 'merge-approval') continue;
    const a = (out[e.area] ??= {
      approvals: 0,
      as_presented: 0,
      reverted: 0,
      median_latency_ms: null,
      clean_run: 0,
      latencies: [],
    });
    const back = reverted.has(`${e.area}\0${e.subject}`);
    a.approvals++;
    if (e.as_presented) a.as_presented++;
    if (back) a.reverted++;
    if (typeof e.latency_ms === 'number') a.latencies.push(e.latency_ms);
    a.clean_run = e.as_presented && !back ? a.clean_run + 1 : 0;
  }
  return Object.fromEntries(
    Object.entries(out).map(([area, { latencies, ...a }]) => {
      const sorted = [...latencies].sort((x, y) => x - y);
      const mid = Math.floor(sorted.length / 2);
      const median = !sorted.length
        ? null
        : sorted.length % 2
          ? sorted[mid]
          : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
      return [area, { ...a, median_latency_ms: median }];
    }),
  );
}

/**
 * The owner_paths globs that reach into an area; for "unassigned", those no area's paths overlap.
 * @param {string} area @param {Policy} policy @returns {string[]}
 */
function ownerPathsIn(area, policy) {
  const areas = /** @type {{ name: string, paths?: string[] }[]} */ (policy.rights?.areas ?? []);
  const paths = ownerPaths(policy);
  if (area === UNASSIGNED) {
    return paths.filter((g) => !areas.some((a) => (a.paths ?? []).some((x) => globsOverlap(g, x))));
  }
  const own = areas.find((a) => a.name === area)?.paths ?? [];
  return paths.filter((g) => own.some((x) => globsOverlap(g, x)));
}

/**
 * Proposals to let the queue merge an area without asking (step 5): one for each area owner mode
 * covers whose clean run has reached merge.propose_queue_after, unless one was made for it within
 * that many approvals. Each carries the policy change a yes would make. The system never makes
 * it: the owner decides (design part 4.6).
 * @param {Record<string, AreaApprovals>} summary @param {Policy} policy
 * @param {Record<string, number>} [proposed] per area, the approvals count when last proposed
 * @returns {Proposal[]}
 */
export function queueProposals(summary, policy, proposed = {}) {
  const after = policy.merge?.propose_queue_after ?? 20;
  const areas = /** @type {{ name: string }[]} */ (policy.rights?.areas ?? []);
  /** @type {Proposal[]} */
  const out = [];
  for (const [area, s] of Object.entries(summary)) {
    if (s.clean_run < after) continue;
    if (proposed[area] !== undefined && s.approvals - proposed[area] < after) continue;
    const covered = everywhere(policy)
      ? [...areas.map((a) => a.name), UNASSIGNED]
      : ownerAreas(policy);
    const reaching = ownerPathsIn(area, policy);
    if (!covered.includes(area) && !reaching.length) continue;
    const nextAreas = covered.filter((a) => a !== area);
    const nextPaths = ownerPaths(policy).filter((g) => !reaching.includes(g));
    /** @type {Record<string, unknown>} */
    const change =
      !nextAreas.length && !nextPaths.length
        ? { 'merge.mode': 'queue' }
        : { 'merge.owner_areas': nextAreas, 'merge.owner_paths': nextPaths };
    const edits = Object.entries(change)
      .map(([k, v]) => `${k} to ${JSON.stringify(v)}`)
      .join(' and ');
    out.push({
      area,
      clean_run: s.clean_run,
      approvals: s.approvals,
      change,
      question: `The last ${s.clean_run} merges in ${area} were approved as presented and none was reverted. Let the merge queue merge ${area} without asking you? It still checks every branch first. Yes sets ${edits} in policy.json.`,
    });
  }
  return out;
}

/**
 * Branches waiting for the owner: the item, the report's result, the check result so far and how
 * long each has waited (since its verification passed). A branch in the current presentation
 * passed the queue's checks; any other has not been checked yet.
 * @param {Waiting[]} waiting @param {Record<string, any>[]} events @param {number} [now]
 * @param {Presentation | null} [presented]
 * @returns {OwnerWaiting[]}
 */
export function waitingForOwner(waiting, events, now = Date.now(), presented = null) {
  return waiting.map((w) => {
    const verified = events.filter((e) => e.item === w.item && e.event === 'verified').at(-1);
    const reported = events.filter((e) => e.item === w.item && e.event === 'reported').at(-1);
    const since = typeof verified?.at === 'string' ? verified.at : null;
    const t = since ? Date.parse(since) : NaN;
    return {
      item: w.item,
      branch: w.branch,
      result: reported?.result ?? null,
      fast_check: presented?.branches.some((b) => b.item === w.item && b.branch === w.branch)
        ? 'passed'
        : 'not run',
      waiting_since: since,
      waited_ms: Number.isNaN(t) ? null : Math.max(0, now - t),
    };
  });
}

/**
 * The waiting entries the owner named, by branch or item. A name must pick out exactly one
 * entry: one that matches none is unknown, one that matches several (an entry's branch equal to
 * another's item, say) is ambiguous, and an entry whose branch is not the branch its item was
 * dispatched on is refused. The caller merges nothing when any of the three lists is not empty.
 * @template {Waiting} T
 * @param {T[]} waiting @param {string[]} names
 * @param {Record<string, any>[]} [events] the ledger, for the branch each item was dispatched on
 * @returns {{ chosen: T[], unknown: string[], ambiguous: string[], mismatched: string[] }}
 */
export function chooseNamed(waiting, names, events = []) {
  const chosen = new Set();
  /** @type {string[]} */
  const unknown = [];
  /** @type {string[]} */
  const ambiguous = [];
  /** @type {string[]} */
  const mismatched = [];
  for (const n of names) {
    const hits = waiting.filter((x) => x.branch === n || x.item === n);
    if (hits.length === 0) unknown.push(n);
    else if (hits.length > 1) ambiguous.push(n);
    else {
      const w = hits[0];
      const dispatched = events
        .filter(
          (e) => e.event === 'dispatched' && e.item === w.item && typeof e.branch === 'string',
        )
        .at(-1);
      if (dispatched && dispatched.branch !== w.branch) mismatched.push(n);
      else chosen.add(w);
    }
  }
  return { chosen: waiting.filter((w) => chosen.has(w)), unknown, ambiguous, mismatched };
}

/** @param {number | null} ms @returns {string} */
export function waited(ms) {
  if (ms == null) return 'unknown time';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'under a minute';
  if (m < 120) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`;
}
