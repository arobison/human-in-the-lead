// The files tracker backend: `openTracker` returns a TrackerAdapter (core/lib/tracker/interface.mjs)
// over one file per entity in the repository, in the reference format (design part 3.4).
//
// It also carries what the `hitld work` commands need beyond the interface: claims read from
// branches, close on merge, unclaim, the batch check and the views. Milestones are entities in the
// same number space; release records are read from their own folder and found by their tag. Every
// derived field (a milestone's unmet_clauses, check_due, scope, tokens_spent, cost_of_delay_rate and
// to_shape; a project's bet_by; an item's constraint_of, contributes_to and released_in) is
// computed on each read.

import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadTrackerConfig, resolveLayout } from './config.mjs';
import { migrateTracker, pendingMigrationProblems } from './migrate.mjs';
import {
  claimItem,
  closeItem,
  currentBranch,
  findClaims,
  findOrphans,
  unclaimItem,
} from './claims.mjs';
import {
  checkItems,
  findCollisions,
  retiredConstraintLines,
  unnumberedReleaseLinks,
  unplacedWork,
} from './check.mjs';
import { mainMismatches } from './closing.mjs';
import { descriptionWarnings } from './descriptions.mjs';
import { feedbackProblem, feedbackRecordsIn } from '../../feedback/guard.mjs';
import { LEVELS, checkTree, problemLines } from '../../guard/classification.mjs';
import { versionOf, writeStored } from './edit.mjs';
import {
  createExclusive,
  insidePath,
  isRegularFile,
  mkdirInside,
  readNoFollow,
  writeNoFollow,
} from './safe.mjs';
import {
  FOLDER_GROUP,
  KINDS,
  NATIVE_EXTRAS,
  allowedKeys,
  applyPatch,
  keyOrder,
  parseFieldValue,
  toEntity,
  toStored,
} from './format.mjs';
import { ITEM_KINDS, buildGraph, list } from './graph.mjs';
import {
  AUTHOR_ROLE,
  MILESTONE_KINDS,
  milestoneDerived,
  passingCheck,
  readMilestone,
} from './milestones.mjs';
import { SHAPING_KEYS, betBy } from './projects.mjs';
import {
  checkReleases,
  isPrerelease,
  legacyReleaseWarnings,
  loadReleases,
  releaseEntity,
  releasedIn,
} from './releases.mjs';
import { checkPackages } from '../../release/packages.mjs';
import { checkEcosystems } from '../../ecosystems/profiles.mjs';
import { allocate, assertOrchestrator } from './ids.mjs';
import { sharedIds } from './shared-ids.mjs';
import { parseItem, renderItem, slugify } from './frontmatter.mjs';
import { fromLegacy } from './legacy.mjs';
import { entityType } from './api.mjs';
import { listPlaces, loadPlaces, loadWorkTree, git, readNamed, repoRootOf } from './tree.mjs';
import {
  LIST_BEGIN,
  mermaidItems,
  mermaidMilestones,
  mermaidProjects,
  milestoneGraph,
  renderLists,
  renderMilestonesView,
  replaceBetweenMarkers,
  sizingWeight,
  viewBlocked,
  viewCriticalPath,
  viewDecisions,
  viewMilestones,
  viewProjects,
  viewReady,
  viewUnreleased,
} from './views.mjs';
import { CodedError } from '../../cli/errors.mjs';

/**
 * @typedef {import('../interface.mjs').TrackerAdapter} TrackerAdapter
 * @typedef {import('../interface.mjs').Entity} Entity
 * @typedef {import('./config.mjs').Layout} Layout
 * @typedef {import('./tree.mjs').Entry} Entry
 * @typedef {import('./claims.mjs').ClaimedItem} ClaimedItem
 *
 * @typedef {object} Consistency the main branch's commit trailers against its items (closing.mjs)
 * @property {boolean} checked false when the checkout is not on the main branch
 * @property {import('./closing.mjs').Mismatch[]} mismatches
 * @property {{ kind: string, why: string }[]} skipped the kinds not checked, and why
 *
 * @typedef {object} FilesExtras what the `hitld work` commands need beyond the interface
 * @property {() => Layout} layout
 * @property {() => string[]} warnings tracker.json names from before HITLD-82, still read
 * @property {() => string} root
 * @property {(draft: Record<string, any>) => { id: string, path: string, block: string, id_source: string, warnings: string[] }} createEntity
 *   allocate an ID and write the file; orchestrator only. id_source: what the number was checked
 *   against beyond this clone (store-counter, origin or local)
 * @property {() => ClaimedItem[]} claims claims read from branches
 * @property {(id: string, reason: string, branch?: string) => ReturnType<typeof unclaimItem>} unclaim
 * @property {(id: string, options?: { commit?: boolean, report?: string }) => ReturnType<typeof closeItem>} close
 * @property {(id: string, note: string, expectedVersion?: string) => { path: string, version: string }} appendNote append a
 *   note to an entity's body, its front matter untouched (a later sighting of the cause it tracks)
 * @property {(options?: { branches?: boolean, inflight?: string[], terms?: import('../../guard/private-terms.mjs').Matcher[], consistency?: boolean }) => { problems: string[], files: number, warnings: string[], consistency?: Consistency }} check
 * @property {(options?: { who?: string }) => Record<string, string>} renderViewTexts
 * @property {(options?: { outDir?: string, who?: string }) => { dir: string, written: string[], unchanged: string[] }} writeViews
 * @property {(options?: { tokens?: Map<string, number> }) => import('./views.mjs').MilestoneGraph} milestoneGraph
 *   the milestone graph (design part 12.1.2); with tokens spent per item (from the ledger), each
 *   node's tokens_spent, or null when the ledger has no record for any of its items
 * @property {() => Map<string, import('../interface.mjs').Change[]>} histories every entity's
 *   committed state changes, oldest first, from one read of the work directory's history
 * @property {(options?: { only?: string, dryRun?: boolean, commit?: boolean, migrations?: readonly import('./migrate.mjs').Migration[] }) => ReturnType<typeof migrateTracker>} migrate
 *   apply the registered format migrations to every file (idempotent; dryRun shows the diff)
 * @property {() => import('./releases.mjs').Entry[]} releases the release records
 * @property {(ids: string[]) => Set<string>} authorRoles the roles that wrote the named items
 * @typedef {TrackerAdapter & FilesExtras} FilesTracker
 */

/**
 * Which state changes the lifecycle allows (design part 3.2). done and dropped are final. Only a
 * work item is ever in-progress, by its claim.
 */
export const TRANSITIONS = Object.freeze({
  proposed: ['planned', 'dropped'],
  planned: ['in-progress', 'done', 'dropped'],
  'in-progress': ['done', 'planned', 'dropped'],
  done: [],
  dropped: [],
});

/** The body skeleton per kind, as the reference creator writes it. */
const BODY = /** @type {Record<string, string>} */ ({
  work: '\n## Done when\n\n\n',
  decision: '\n## Question\n\n\n## Options and recommendation\n\n\n## Answer\n\nOpen.\n',
  external: '\n## Waiting on\n\n\n',
  project: '\n## Summary\n\n\n',
  milestone: '\n## Notes\n\n\n',
});

/** Views no longer written; a write of the views removes them. */
const RETIRED_VIEWS = ['initiatives.md'];

/** The letter of the option at index i: A, B, ... @param {number} i */
const letter = (i) => String.fromCharCode(65 + i);

/**
 * A decision's body from the model's question fields (design part 3.2, Decision), in the sections
 * of the reference skeleton. The format has no front-matter key for these: the question, the
 * context, the options, the recommendation, the precedent offer, the rule basis and the
 * reversibility are text for the decider to read, so they live in the body. The answer is
 * recorded in the front matter.
 * @param {Record<string, any>} d @returns {string}
 */
function decisionBody(d) {
  const out = ['', '## Question', ''];
  if (d.question) out.push(String(d.question), '');
  if (d.context) out.push(String(d.context), '');
  const facts = [
    ...(d.rights_basis ? [`Rule basis: ${d.rights_basis}.`] : []),
    ...(d.reversibility ? [`Reversibility: ${d.reversibility}.`] : []),
  ];
  if (facts.length) out.push(facts.join(' '), '');
  out.push('## Options and recommendation', '');
  const options = Array.isArray(d.options) ? d.options : [];
  for (const [i, o] of options.entries()) {
    const extra = [
      ...(o.cost ? [`cost: ${o.cost}`] : []),
      ...(o.reversible === false ? ['hard to undo'] : []),
    ];
    out.push(
      `- ${letter(i)}. ${o.label}: ${o.what_happens}${extra.length ? ` (${extra.join('; ')})` : ''}`,
    );
  }
  if (options.length) out.push('');
  if (d.recommendation) {
    out.push(`Recommended: ${d.recommendation.option}. ${d.recommendation.why}`, '');
  }
  if (d.default_if_unanswered) {
    const u = d.default_if_unanswered;
    out.push(`If unanswered by ${u.deadline}: ${u.option}.`, '');
  }
  if (d.precedent_offer) {
    out.push(
      `Future cases like this (${d.precedent_offer.summary}): treat the same way? ${d.precedent_offer.rule}`,
      '',
    );
  }
  out.push('## Answer', '', 'Recorded in the front matter once answered.', '');
  return out.join('\n');
}

/** Today as YYYY-MM-DD in local time. */
const today = () => new Date().toLocaleDateString('sv');

/**
 * Open the files tracker for a repository.
 * @param {object} options
 * @param {string} options.repoRoot the working tree the orchestrator or an executor is in
 * @param {Record<string, any>} options.policy a loaded policy (project.key, project.classification_ceiling, ids.blocks)
 * @param {string} [options.configDir] where tracker.json is looked for; default <repoRoot>/.human-in-the-lead
 * @param {NodeJS.ProcessEnv} [options.env] the environment (HITLD_ROLE, HITLD_ID_BLOCK); default process.env
 * @param {string} [options.block] the reserved ID block this machine allocates from; default HITLD_ID_BLOCK, else the base range
 * @param {false | ((o: { root: string, layout: Layout }) => import('./shared-ids.mjs').SharedIds)} [options.sharedIds]
 *   what a create checks beyond this clone (shared-ids.mjs); default: origin, the store counter
 *   when the private store has a remote, and the store's decisions. false checks this clone only.
 */
export function openTracker({
  repoRoot,
  policy,
  configDir,
  env = process.env,
  block,
  sharedIds: shared,
}) {
  const root = repoRootOf(repoRoot);
  const loaded = loadTrackerConfig({ repoRoot: root, configDir });
  if (!loaded.config) {
    throw new CodedError(
      'tracker',
      `tracker.json: ${loaded.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
    );
  }
  const layout = resolveLayout(loaded.config, policy);
  // Every open item on a path weighs its sizing estimate, as the ready queue weighs it (HITLD-995).
  const weightOf = () => sizingWeight(policy, { workDir: layout.workDir });
  // The paths from settings must stay inside the repository, through no symbolic link.
  for (const rel of [
    layout.workDir,
    `${layout.workDir}/${layout.viewsDir}`,
    ...(layout.listsFile ? [`${layout.workDir}/${layout.listsFile}`] : []),
  ]) {
    insidePath(root, rel);
  }
  const idBlock = block ?? (env.HITLD_ID_BLOCK || undefined);

  const read = () => loadWorkTree(root, layout);
  const releases = () => loadReleases(root, layout);

  /** @type {Map<string, Set<string>> | undefined} item ID to the Agent-Role values on its commits */
  let rolesByItem;
  /**
   * The roles that wrote the named items: the Agent-Role trailers of the commits whose Work-Item
   * trailer names one, and always the executor role, which writes items. Read from git once.
   * @param {string[]} ids @returns {Set<string>}
   */
  function authorRoles(ids) {
    if (!rolesByItem) {
      rolesByItem = new Map();
      const log = git(
        root,
        [
          'log',
          '--format=%(trailers:key=Work-Item,valueonly,separator=%x2C)%x09%(trailers:key=Agent-Role,valueonly,separator=%x2C)',
        ],
        { allowFail: true },
      );
      for (const line of log.split('\n')) {
        const [items = '', roles = ''] = line.split('\t');
        for (const item of items
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean)) {
          const set = rolesByItem.get(item) ?? new Set();
          for (const r of roles
            .split(',')
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean)) {
            set.add(r);
          }
          rolesByItem.set(item, set);
        }
      }
    }
    const out = new Set([AUTHOR_ROLE]);
    for (const id of ids) for (const r of rolesByItem.get(id) ?? []) out.add(r);
    return out;
  }

  /**
   * What derived fields are computed from: the graph and which release shipped each item.
   * @param {Entry[]} [items]
   */
  function contextOf(items = read()) {
    const g = buildGraph(items);
    return { g, released: releasedIn(releases()) };
  }

  /**
   * A milestone's derived fields.
   * @param {ReturnType<typeof contextOf>} ctx @param {Entry} it
   * @param {Map<string, number>} [tokens] tokens spent per item, from the ledger
   */
  const derivedOf = (ctx, it, tokens) => {
    // The constraints are derived from the items (HITLD-767), not read from the file alone.
    const d = ctx.g.milestoneData(/** @type {any} */ (it));
    return milestoneDerived(d, {
      get: (id) => ctx.g.get(id)?.data,
      authorRoles: milestoneRoles(ctx, it),
      tokens,
    });
  };

  /**
   * The roles that wrote a milestone's constraints and contributions.
   * @param {ReturnType<typeof contextOf>} ctx @param {Entry} it
   */
  const milestoneRoles = (ctx, it) =>
    authorRoles([
      ...ctx.g.needs(/** @type {any} */ (it)),
      ...readMilestone(/** @type {Record<string, unknown>} */ (it.data ?? {})).contributions.map(
        (c) => c.id,
      ),
    ]);

  /**
   * The milestone graph over the tracker as it is now.
   * @param {ReturnType<typeof contextOf>} ctx @param {Map<string, number>} [tokens]
   */
  const graphOf = (ctx, tokens) =>
    milestoneGraph(ctx.g, {
      weight: weightOf(),
      checkOf: (m) => {
        const d = /** @type {Record<string, unknown>} */ (m.data);
        if (passingCheck(readMilestone(d), milestoneRoles(ctx, m))) return 'passed';
        return derivedOf(ctx, m).check_due ? 'due' : 'not yet due';
      },
      // Spent only as far as the ledger knows: with no record for any of its items, unknown (a
      // dash), not 0.
      tokensSpent: (m) => {
        if (!tokens) return null;
        const ids = [
          ...ctx.g.needs(m),
          ...readMilestone(/** @type {Record<string, unknown>} */ (m.data)).contributions.map(
            (c) => c.id,
          ),
        ];
        return ids.some((id) => tokens.has(id)) ? derivedOf(ctx, m, tokens).tokens_spent : null;
      },
    });

  /**
   * An entry's entity: the model's field names plus the stored keys that have none, the derived
   * fields, the body, the path and the version.
   * @param {Entry} it @param {ReturnType<typeof contextOf>} [ctx] @returns {Entity}
   */
  function entityOf(it, ctx = contextOf()) {
    const d = /** @type {Record<string, unknown>} */ (it.data ?? {});
    const keys = MILESTONE_KINDS.includes(String(d.kind))
      ? ctx.g.milestoneData(/** @type {any} */ (it))
      : d;
    const { schema_version: _, ...entity } = toEntity(keys, layout);
    for (const k of NATIVE_EXTRAS) if (d[k] !== undefined) entity[k] = d[k];
    const id = String(d.id);
    if (MILESTONE_KINDS.includes(String(d.kind))) Object.assign(entity, derivedOf(ctx, it));
    else if (d.kind === 'project') entity.bet_by = betBy(d, (x) => ctx.g.get(x)?.data);
    else if (ITEM_KINDS.includes(String(d.kind))) {
      entity.constraint_of = ctx.g.constraintOf(id).map((m) => m.data.id);
      entity.contributes_to = ctx.g.contributesTo(id).map((m) => m.data.id);
      entity.released_in = ctx.released.get(id) ?? null;
    }
    return {
      ...entity,
      entity: entityType(d.kind),
      body: it.body,
      path: it.path,
      version: it.version,
    };
  }

  /**
   * A release record's entity, with the derived `prerelease`.
   * @param {Entry} r @returns {Entity}
   */
  function releaseEntityOf(r) {
    const d = /** @type {Record<string, unknown>} */ (r.data ?? {});
    const { schema_version: _, ...entity } = releaseEntity(d, layout);
    return {
      ...entity,
      kind: 'release',
      entity: 'release',
      prerelease: isPrerelease(String(d.version ?? '')),
      body: r.body,
      path: r.path,
    };
  }

  /**
   * Problems a change would add to the file it changes, or a dependency cycle: what the check finds
   * in the files as they would be, less what it finds now. A problem the change causes in another
   * file (dropping an item others need) is the check's to report, not a reason to refuse.
   * @param {Entry[]} after @param {string[]} before @param {string} path
   */
  const addedProblems = (after, before, path) =>
    checkItems(after, layout, { root }).filter(
      (p) => !before.includes(p) && (p.startsWith(`${path}: `) || p.startsWith('cycle: ')),
    );

  /**
   * Whether an entity's declared field value matches a wanted one.
   * @param {unknown} have @param {import('./config.mjs').DeclaredField} def @param {unknown} want
   */
  const holds = (have, def, want) =>
    def.list ? Array.isArray(have) && have.includes(want) : have === want;

  /** @param {string} id @returns {Entry} */
  function mustFind(id) {
    const it = read().find((e) => e.data?.id === id);
    if (!it?.data) throw new CodedError('not-found', `${id} is not in the tracker`);
    return it;
  }

  /**
   * Claim state from branches, optionally limited to an item.
   * @returns {import('./claims.mjs').ClaimedItem[]}
   */
  /** @param {Map<string, import('./tree.mjs').Entry[]>} [cache] refs this command already read */
  const claims = (cache) => findClaims(root, layout, { cache });

  /** @type {FilesTracker} */
  const tracker = {
    capabilities: () => ({
      closesOnMerge: true,
      claimInBranch: true,
      customFields: true,
      decisionKind: true,
      classificationEnforced: false,
      history: /** @type {'full'} */ ('full'),
    }),

    get(id) {
      const record = releases().find((r) => r.data?.id === id);
      return record?.data ? releaseEntityOf(record) : entityOf(mustFind(id));
    },

    query(filter = {}) {
      const items = read();
      const ctx = contextOf(items);
      const g = ctx.g;
      const kinds = filter.kind === undefined ? null : list(filter.kind);
      const states = filter.state === undefined ? null : list(filter.state);
      const claimed =
        filter.ready || filter.claimed !== undefined ? new Set(claims().map((c) => c.id)) : null;
      const text = filter.text?.toLowerCase();
      const wanted = Object.entries(filter.fields ?? {}).map(([name, raw]) => {
        const def = layout.fields.find((f) => f.name === name);
        if (!def) {
          const declared = layout.fields.map((f) => f.name).join(', ') || 'none declared';
          throw new Error(`no declared field "${name}" (fields: ${declared})`);
        }
        const r = parseFieldValue(def, raw);
        if ('error' in r) throw new Error(`field ${name} ${r.error}`);
        return /** @type {const} */ ([def, r.value]);
      });
      // Release records have a kind, a tag and notes, and none of the other fields a filter names.
      const onlyKindAndText = [
        'state',
        'area',
        'parent',
        'needs',
        'fields',
        'ready',
        'blocked',
        'claimed',
      ].every((k) => /** @type {Record<string, unknown>} */ (filter)[k] === undefined);
      const records =
        kinds?.includes('release') && onlyKindAndText
          ? releases()
              .filter((r) => r.data)
              .map(releaseEntityOf)
              .filter((e) => !text || `${e.id}\n${e.body}`.toLowerCase().includes(text))
          : [];
      return g.all
        .filter((it) => {
          const e = entityOf(it, ctx);
          if (kinds && !kinds.includes(String(e.kind))) return false;
          if (states && !states.includes(String(e.state))) return false;
          if (filter.area !== undefined && e.area !== filter.area) return false;
          if (filter.parent !== undefined && e.parent !== filter.parent) return false;
          if (wanted && !wanted.every(([def, value]) => holds(e[def.name], def, value)))
            return false;
          if (filter.needs !== undefined && !list(e.needs).includes(filter.needs)) return false;
          if (text && !`${e.title}\n${e.body}`.toLowerCase().includes(text)) return false;
          const id = String(e.id);
          if (filter.ready !== undefined) {
            const ready = g.isItem(it) && g.isReady(it) && !claimed?.has(id);
            if (ready !== filter.ready) return false;
          }
          if (
            filter.blocked !== undefined &&
            (g.isItem(it) && g.isBlocked(it)) !== filter.blocked
          ) {
            return false;
          }
          if (filter.claimed !== undefined && claimed?.has(id) !== filter.claimed) return false;
          return true;
        })
        .map((it) => entityOf(it, ctx))
        .concat(records);
    },

    create: (draft) => tracker.createEntity(draft).id,

    update(id, patch, expectedVersion) {
      const it = mustFind(id);
      if (expectedVersion !== undefined && it.version !== expectedVersion) {
        throw new Error(
          `${id} changed since it was read (version ${it.version}, expected ${expectedVersion}); read it again`,
        );
      }
      for (const k of ['id', 'kind']) {
        if (k in patch) throw new Error(`${k} cannot be changed; create a new item instead`);
      }
      const kind = String(it.data?.kind);
      const { stored: changes, unsupported } = toStored(patch, kind, layout);
      if (unsupported.length) {
        throw new Error(
          `this tracker's file format has no key for ${unsupported.join(', ')} on a ${kind} (allowed: ${allowedKeys(kind, layout).join(', ')})`,
        );
      }
      return rewrite(it, changes);
    },

    transition(id, to, reason, via) {
      const it = mustFind(id);
      const from = String(it.data?.state);
      const kind = String(it.data?.kind);
      const allowed = /** @type {Record<string, string[]>} */ (TRANSITIONS)[from] ?? [];
      if (!allowed.includes(to)) {
        throw new Error(
          `${id} is ${from}; the lifecycle allows ${allowed.join(', ') || 'no change'}, not ${to}`,
        );
      }
      if (to === 'dropped' && !String(reason ?? '').trim())
        throw new Error('dropped needs a reason');
      if (to === 'in-progress' && kind !== 'work') {
        throw new Error(`${id} is a ${kind}; only work items are claimed (in-progress)`);
      }
      if (to === 'in-progress' && !it.data?.claimed_by) {
        throw new Error(`claim ${id} to move it to in-progress (hitld work claim)`);
      }
      if (MILESTONE_KINDS.includes(kind)) {
        const m = readMilestone(/** @type {Record<string, unknown>} */ (it.data));
        const g = buildGraph(read());
        const roles = authorRoles([
          ...g.needs(/** @type {any} */ (it)),
          ...m.contributions.map((c) => c.id),
        ]);
        if (to === 'done' && !passingCheck(m, roles)) {
          throw new Error(
            `${id} becomes done only from a recorded passing check by a role other than its items' authors (${[...roles].join(', ')}); record the run in check_results`,
          );
        }
      }
      /** @type {Record<string, unknown>} */
      const changes = { state: to };
      if (to === 'dropped') changes.reason = String(reason).trim();
      else changes.reason = null;
      if (to === 'planned' && kind === 'work') changes.claimed_by = null;
      void via; // the file records the state; the commit that carries it is the caller's
      return rewrite(it, changes);
    },

    link(from, relation, to) {
      const it = mustFind(from);
      const target = mustFind(to);
      if (relation === 'needs') {
        if (MILESTONE_KINDS.includes(String(it.data?.kind))) {
          throw new Error(
            `${from} is a milestone; a constraint names a clause ("<ID> c<n>"), so update its constraints`,
          );
        }
        const kind = String(target.data?.kind);
        if (!ITEM_KINDS.includes(kind) && !MILESTONE_KINDS.includes(kind)) {
          throw new Error(`${to} is a ${target.data?.kind}; needs name items and milestones only`);
        }
        const needs = list(it.data?.needs);
        if (!needs.includes(to)) rewrite(it, { needs: [...needs, to] });
      } else if (relation === 'parent') {
        if (it.data?.kind === 'project') {
          throw new Error(
            `${from} is a project, which has no parent; a long outcome across projects is a milestone with no parent, whose constraints are their milestones`,
          );
        }
        rewrite(it, { project: to });
      } else if (relation === 'opened_from' && layout.optionalKeys.includes('opened_from')) {
        const ids = list(it.data?.opened_from);
        if (!ids.includes(to)) rewrite(it, { opened_from: [...ids, to] });
      } else {
        throw new Error(
          `this tracker's file format has no "${relation}" link${relation === 'opened_from' ? ' (turn on opened_from in tracker.json optional_keys)' : ''}`,
        );
      }
    },

    claim: (id, claimant, branch, budgetTokens) =>
      claimItem(root, layout, id, claimant, { branch, budgetTokens }),

    history(id) {
      const it = mustFind(id);
      const log = git(root, ['log', '--reverse', '--format=%H %cI', '--', it.path], {
        allowFail: true,
      });
      /** @type {import('../interface.mjs').Change[]} */
      const changes = [];
      /** @type {string | null} */
      let prev = null;
      const commits = log
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split(' '));
      // Every version of the file in one process, not one per commit.
      const texts = readNamed(
        root,
        commits.map(([commit]) => `${commit}:${it.path}`),
      );
      for (const [i, [commit, at]] of commits.entries()) {
        const text = texts[i] ?? '';
        // A commit from before HITLD-82 holds `status` with the old values: read in the new form.
        const state = fromLegacy(parseItem(text).data)?.state;
        if (typeof state !== 'string' || state === prev) continue;
        changes.push({
          at,
          from: /** @type {any} */ (prev),
          to: /** @type {any} */ (state),
          ref: { commit },
        });
        prev = state;
      }
      return changes;
    },

    renderViews: () => void tracker.writeViews(),

    // --- Beyond the interface -------------------------------------------------

    layout: () => layout,
    warnings: () => loaded.warnings,
    root: () => root,

    /** Create an entity: allocate its ID and write its file. Orchestrator only. */
    createEntity(/** @type {Record<string, any>} */ draft) {
      assertOrchestrator(root, layout, env);
      const kind = String(draft.kind ?? 'work');
      if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
      if (!String(draft.title ?? '').trim()) throw new Error('title is required');
      const isItem = ITEM_KINDS.includes(kind);
      const isMilestone = MILESTONE_KINDS.includes(kind);
      // The owner commits a milestone (design part 3.2), so a new one starts proposed.
      const state = String(draft.state ?? (isMilestone ? 'proposed' : 'planned'));
      if (!['planned', 'proposed'].includes(state)) {
        throw new Error(
          'a new entity is planned or proposed (claim and close by the claim and close commands)',
        );
      }
      if (isItem && !draft.parent) throw new Error('an item needs a parent: the project ID');
      if (kind === 'project' && draft.parent) {
        throw new Error(
          'a project has no parent; a long outcome across projects is a milestone with no parent, whose constraints are their milestones',
        );
      }
      if (kind === 'external' && !draft.waiting_on)
        throw new Error('an external item needs waiting_on (who we wait on)');
      // Without a classification key, every file is the default classification. A draft more
      // restricted than that (or of no known level) would be published below its level, so it is
      // refused, never written.
      if (
        draft.classification !== undefined &&
        !layout.optionalKeys.includes('classification') &&
        !(
          LEVELS.includes(String(draft.classification)) &&
          LEVELS.indexOf(String(draft.classification)) <=
            LEVELS.indexOf(layout.defaultClassification)
        )
      ) {
        throw new Error(
          `this tracker's files are all ${layout.defaultClassification} (tracker.json has no classification in optional_keys), so an item classified ${String(draft.classification)} cannot be written here`,
        );
      }
      // A link the files cannot hold is refused, not dropped: dropped, the item would lose the
      // trace to what it came from without anyone being told (HITLD-160).
      if (list(draft.opened_from).length && !layout.optionalKeys.includes('opened_from')) {
        throw new Error(
          `this tracker's file format has no "opened_from" link (turn on opened_from in tracker.json optional_keys), so an item opened from ${list(draft.opened_from).join(', ')} cannot be written here`,
        );
      }
      /** @type {Record<string, unknown>} */
      const fields = {
        title: String(draft.title).trim(),
        kind,
        state,
        parent: draft.parent,
        needs: isMilestone ? undefined : list(draft.needs),
        constraints: isMilestone ? list(draft.constraints ?? draft.needs) : undefined,
        constraint_of: list(draft.constraint_of),
        outcome: isMilestone ? draft.outcome : undefined,
        appetite_tokens:
          isMilestone || kind === 'project' ? (draft.appetite_tokens ?? undefined) : undefined,
        waiting_on: kind === 'external' ? draft.waiting_on : undefined,
        decider: kind === 'decision' ? (draft.decider ?? 'owner') : undefined,
        // Without an owner key, the owner is accountable: the default is not written.
        owner: draft.owner,
        plan: kind === 'project' ? draft.plan : undefined,
        created: today(),
      };
      if (kind === 'project') {
        for (const k of SHAPING_KEYS) if (draft[k] !== undefined) fields[k] = draft[k];
      }
      for (const k of layout.optionalKeys) if (draft[k] !== undefined) fields[k] = draft[k];
      for (const f of layout.fields)
        if (draft[f.name] !== undefined) fields[f.name] = draft[f.name];
      const { stored: data, unsupported } = toStored(
        Object.fromEntries(
          Object.entries(fields).filter(
            ([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0),
          ),
        ),
        kind,
        layout,
      );
      if (unsupported.length) {
        throw new Error(
          `this tracker's file format has no key for ${unsupported.join(', ')} on a ${kind}`,
        );
      }
      const body =
        typeof draft.body === 'string'
          ? draft.body
          : kind === 'decision' && draft.question
            ? decisionBody(draft)
            : BODY[kind];
      const slug = slugify(String(draft.title));
      const folder = layout.folders[FOLDER_GROUP[/** @type {keyof typeof FOLDER_GROUP} */ (kind)]];
      const before = checkItems(read(), layout, { root });
      const beyond =
        shared === false
          ? null
          : shared
            ? shared({ root, layout })
            : sharedIds({ root, layout, policy, env });
      const { warnings } = beyond ? beyond.prepare() : { warnings: [] };
      const made = allocate(root, layout, {
        block: idBlock,
        shared: beyond ?? undefined,
        write: (n) => {
          const rel = `${layout.workDir}/${folder}/${layout.key}-${n}-${slug}.md`;
          const full = join(
            mkdirInside(root, `${layout.workDir}/${folder}`),
            `${layout.key}-${n}-${slug}.md`,
          );
          // Exclusive create, never through a link: fails if another session wrote this name first.
          createExclusive(
            full,
            renderItem({ ...data, id: `${layout.key}-${n}` }, keyOrder(kind, layout), body),
          );
          return rel;
        },
        remove: (path) => rmSync(insidePath(root, path)),
      });
      const problems = addedProblems(read(), before, made.path);
      if (problems.length) {
        rmSync(insidePath(root, made.path));
        throw new Error(`not created: ${problems.join('; ')}`);
      }
      return { ...made, id_source: beyond?.source ?? 'local', warnings };
    },

    /** Claims read from branches. */
    claims,

    /**
     * Append a note to an entity's body (HITLD-387: a later sighting of the cause it tracks),
     * leaving its front matter and the rest of its text as they are.
     * Like creating one, it is the orchestrator's and the chief of staff's, on the main branch.
     * `expectedVersion` refuses a write over a change not seen (two appends at once); an item an
     * executor has claimed is refused, since its branch owns the file until it closes.
     * @param {string} id @param {string} note Markdown, starting with its own heading
     * @param {string} [expectedVersion] the version the caller read
     * @returns {{ path: string, version: string }}
     */
    appendNote(id, note, expectedVersion) {
      assertOrchestrator(root, layout, env);
      const it = mustFind(id);
      if (expectedVersion !== undefined && it.version !== expectedVersion) {
        throw new CodedError(
          'item-changed',
          `${id} changed since it was read (version ${it.version}, expected ${expectedVersion}); read it again`,
        );
      }
      const claim = it.data?.claimed_by ?? claims().find((c) => c.id === id)?.claims[0]?.claimant;
      if (claim) {
        throw new CodedError(
          'item-claimed',
          `${id} is claimed (${String(claim)}): its branch owns the file until it closes; add the evidence after it closes, or tell the orchestrator`,
        );
      }
      const full = insidePath(root, it.path);
      const text = `${readNoFollow(full).replace(/\s*$/, '')}\n\n${note.replace(/\s*$/, '')}\n`;
      const parsed = parseItem(text);
      if (parsed.data?.id !== id) throw new Error(`not changed: ${id} would not read back`);
      writeNoFollow(full, text);
      return { path: it.path, version: versionOf(text) };
    },

    /** Give up an abandoned claim on the main branch, with the reason. */
    unclaim: (
      /** @type {string} */ id,
      /** @type {string} */ reason,
      /** @type {string | undefined} */ branch,
    ) => unclaimItem(root, layout, id, reason, { branch }),

    /** Set an item to done in the working tree and commit the file. */
    close: (
      /** @type {string} */ id,
      /** @type {{ commit?: boolean, report?: string } | undefined} */ options,
    ) => closeItem(root, layout, id, options),

    /**
     * The batch check. `branches` adds ID collisions across every worktree and branch and
     * double claims; `inflight` (dispatch IDs from the ledger) adds the orphaned-claim check;
     * `terms` (from the private store) adds the private term rule to the classification check.
     * `warnings` names each open work item under no milestone and each milestone that still holds
     * the retired `constraints` line, and release records from before packages while no package
     * is declared (warnings, not problems).
     * `consistency` adds, on the main branch only, the mismatches between main's commit trailers
     * and its items (closing.mjs), as warnings and under `consistency`.
     * @param {{ branches?: boolean, inflight?: string[], terms?: import('../../guard/private-terms.mjs').Matcher[], consistency?: boolean }} [options]
     */
    check({ branches = false, inflight, terms, consistency = false } = {}) {
      const items = read();
      const onMain = currentBranch(root) === layout.mainBranch;
      const g = buildGraph(items);
      const records = releases();
      const problems = [
        ...checkItems(items, layout, { root, onMain, authorRoles }),
        ...checkPackages(layout.packages ?? [], { root }),
        ...checkEcosystems(layout.ecosystems, undefined, { root }),
        ...checkReleases(records, layout, (id) => g.get(id)?.data),
        ...pendingMigrationProblems(root, layout),
      ];
      problems.push(...feedbackRecordsIn(root).map(feedbackProblem));
      // The commit guard's rule over the whole tree; item files give the same line as above.
      const tree = checkTree(root, {
        ceiling: layout.classificationCeiling,
        defaultClassification: layout.defaultClassification,
        privatePaths: layout.privatePaths,
        terms,
      });
      for (const line of problemLines(tree.refused)) {
        if (!problems.includes(line)) problems.push(line);
      }
      // Every place, then the claims, read the same refs: they share one cache, which also takes
      // the main branch and the worktrees' branches the claims read.
      /** @type {Map<string, Entry[]>} */
      const cache = new Map();
      if (branches) {
        const places = listPlaces(root, layout, { remotes: true });
        const preload = [
          `refs/heads/${layout.mainBranch}`,
          ...places.flatMap((p) => (p.branch ? [p.branch] : [])),
        ];
        const placed = loadPlaces(root, layout, places, { cache, preload });
        for (const c of findCollisions(placed, layout)) {
          problems.push(
            `${c.id} is two different items: ${c.files.map((f) => `${f.file} on ${f.where.join(', ')}`).join('; ')}`,
          );
        }
      }
      if (branches || inflight) {
        const found = claims(cache);
        for (const c of found) {
          if (c.double) {
            problems.push(
              `${c.id} is claimed twice: ${c.claims.map((x) => `${x.claimant} on ${x.branch}`).join('; ')}`,
            );
          }
        }
        if (inflight) problems.push(...findOrphans(found, inflight));
      }
      const warnings = [
        ...unplacedWork(items),
        ...unnumberedReleaseLinks(items, weightOf()),
        ...descriptionWarnings(items),
        ...retiredConstraintLines(items),
        ...legacyReleaseWarnings(records, layout),
      ];
      if (!consistency) return { problems, files: items.length, warnings };
      /** @type {Consistency} */
      const found = onMain
        ? {
            checked: true,
            ...mainMismatches(root, layout, `refs/heads/${layout.mainBranch}`, items),
          }
        : {
            checked: false,
            mismatches: [],
            skipped: [
              {
                kind: 'all',
                why: `this checkout is not on ${layout.mainBranch}; the trailers on ${layout.mainBranch} are checked there`,
              },
            ],
          };
      warnings.push(...found.mismatches.map((m) => `${m.path}: ${m.why}`));
      return { problems, files: items.length, warnings, consistency: found };
    },

    releases,
    authorRoles,

    /** Apply the registered format migrations; see migrate.mjs. */
    migrate: ({ only, dryRun, commit, migrations } = {}) =>
      migrateTracker(root, layout, { only, dryRun, commit, env, migrations }),

    /** Every view, as text keyed by view name. */
    renderViewTexts(/** @type {{ who?: string }} */ { who = 'owner' } = {}) {
      const ctx = contextOf();
      const g = ctx.g;
      return {
        ready: viewReady(g),
        blocked: viewBlocked(g),
        decisions: viewDecisions(g, who),
        projects: viewProjects(g),
        'critical-path': viewCriticalPath(g, 5, weightOf()),
        milestones: viewMilestones(g, (m) => derivedOf(ctx, m)),
        unreleased: viewUnreleased(g, ctx.released),
        lists: renderLists(g, { level: 2 }),
        'items-graph': mermaidItems(g),
        'projects-graph': mermaidProjects(g),
        'milestones-graph': mermaidMilestones(graphOf(ctx)),
      };
    },

    /** The milestone graph; see milestoneGraph in views.mjs. */
    milestoneGraph: ({ tokens } = {}) => graphOf(contextOf(), tokens),

    /**
     * Every entity's committed state changes, read in one pass over the history of the work
     * directory: what `history(id)` gives one entity, for all of them, oldest first. A file's
     * state is read from the `state:` line its commit adds (or `status:` from before HITLD-82, in
     * the new form); a rename that keeps the state adds no change.
     */
    histories() {
      const log = git(
        root,
        [
          'log',
          '--reverse',
          '--no-renames',
          '-U0',
          '--format=%x01%H %cI',
          '-p',
          '--',
          layout.workDir,
        ],
        { allowFail: true },
      );
      /** @type {Map<string, import('../interface.mjs').Change[]>} */
      const out = new Map();
      const fileId = new RegExp(
        `^\\+\\+\\+ b/.*/(${layout.key.replace(/[^A-Za-z0-9]/g, '\\$&')}-\\d+)[-.][^/]*$`,
      );
      /** @type {string[]} */
      let commit = ['', ''];
      /** @type {string | null} */
      let id = null;
      for (const line of log.split('\n')) {
        if (line.startsWith('\u0001')) {
          commit = line.slice(1).split(' ');
          id = null;
        } else if (line.startsWith('+++ ')) {
          id = fileId.exec(line)?.[1] ?? null;
        } else if (id && /^\+(state|status):/.test(line)) {
          const raw = line
            .slice(line.indexOf(':') + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
          const state = line.startsWith('+status:')
            ? /** @type {Record<string, unknown>} */ (fromLegacy({ status: raw }))?.state
            : raw;
          if (typeof state !== 'string' || !state) continue;
          const changes = out.get(id) ?? [];
          const prev = changes.at(-1)?.to ?? null;
          if (state === prev) continue;
          changes.push({
            at: commit[1],
            from: /** @type {any} */ (prev),
            to: /** @type {any} */ (state),
            ref: { commit: commit[0] },
          });
          out.set(id, changes);
        }
      }
      return out;
    },

    /**
     * Write the views as files. With `outDir` they go there (and nothing else is touched);
     * without it they go to the tracker's views directory and, when tracker.json names a lists
     * README, the lists are rewritten between its markers. Files whose text did not change are
     * left alone.
     * @param {{ outDir?: string, who?: string }} [options]
     * @returns {{ dir: string, written: string[], unchanged: string[] }}
     */
    writeViews({ outDir, who } = {}) {
      const texts = tracker.renderViewTexts({ who });
      const dir = outDir
        ? resolve(outDir)
        : insidePath(root, `${layout.workDir}/${layout.viewsDir}`); // refuses a link
      mkdirSync(dir, { recursive: true });
      const names = /** @type {Record<string, { title: string, fence: string }>} */ ({
        ready: { title: 'Ready', fence: 'text' },
        blocked: { title: 'Blocked', fence: 'text' },
        decisions: { title: 'Decision backlog', fence: 'text' },
        projects: { title: 'Projects', fence: 'text' },
        'critical-path': { title: 'Critical path', fence: 'text' },
        unreleased: { title: 'Merged, not released', fence: 'text' },
        'items-graph': { title: 'Item dependencies', fence: 'mermaid' },
        'projects-graph': { title: 'Project dependencies', fence: 'mermaid' },
      });
      /** @type {string[]} */
      const written = [];
      /** @type {string[]} */
      const unchanged = [];
      /** @param {string} file @param {string} text */
      const put = (file, text) => {
        const path = join(dir, file);
        if (isRegularFile(path) && readNoFollow(path) === text) unchanged.push(file);
        else {
          writeNoFollow(path, text);
          written.push(file);
        }
      };
      const header = '<!-- Generated by `hitld work views`. Never edit by hand. -->\n';
      for (const [name, { title, fence }] of Object.entries(names)) {
        put(
          `${name}.md`,
          `${header}\n# ${title}\n\n\`\`\`${fence}\n${texts[/** @type {keyof typeof texts} */ (name)]}\`\`\`\n`,
        );
      }
      put('lists.md', `${header}\n# Item lists\n\n${texts.lists}`);
      put(
        'milestones.md',
        `${header}\n# Milestones\n\n${renderMilestonesView(tracker.milestoneGraph(), texts.milestones, `${layout.workDir}/${layout.viewsDir}`)}`,
      );
      for (const file of RETIRED_VIEWS) {
        const path = join(dir, file);
        if (!outDir && isRegularFile(path)) {
          rmSync(path);
          written.push(`${file} (removed: no longer a view)`);
        }
      }
      if (!outDir && layout.listsFile) {
        const readme = insidePath(root, `${layout.workDir}/${layout.listsFile}`);
        const g = buildGraph(read());
        const text = readNoFollow(readme);
        const next = replaceBetweenMarkers(text, renderLists(g, { linkBase: './' }));
        if (next !== text) {
          writeNoFollow(readme, next);
          written.push(`${layout.listsFile} (lists between ${LIST_BEGIN.slice(0, 22)} markers)`);
        } else unchanged.push(layout.listsFile);
      }
      return { dir, written, unchanged };
    },
  };

  /**
   * Rewrite an entry's front matter with stored-key changes, after checking the result.
   * @param {Entry} it @param {Record<string, unknown>} changes @returns {string} the new version
   */
  function rewrite(it, changes) {
    const stored = applyPatch(/** @type {Record<string, unknown>} */ (it.data), changes, layout);
    const text = renderItem(stored, keyOrder(String(stored.kind), layout), it.body);
    const parsed = parseItem(text);
    const items = read().map((e) => (e.path === it.path ? { ...e, ...parsed } : e));
    const added = addedProblems(items, checkItems(read(), layout, { root }), it.path);
    if (added.length) throw new Error(`not changed: ${added.join('; ')}`);
    return writeStored(root, layout, it.path, stored, it.body);
  }

  return tracker;
}
