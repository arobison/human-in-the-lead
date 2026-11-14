// The files tracker backend: `openTracker` returns a TrackerAdapter (core/lib/tracker/interface.mjs)
// over one file per entity in the repository, in the reference format (design part 3.4).
//
// It also carries what the `hitld work` commands need beyond the interface: claims read from
// branches, close on merge, release, the batch check and the views. Milestones are entities in the
// same number space; release records are read from their own folder and found by their tag. Every
// derived field (a milestone's error, check_due, scope, tokens_spent, cost_of_delay_rate and
// to_shape; an item's constraint_of, contributes_to and released_in) is computed on each read.

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
  releaseClaim,
} from './claims.mjs';
import { checkItems, findCollisions } from './check.mjs';
import { checkTree, problemLines } from '../../guard/classification.mjs';
import { writeStored } from './edit.mjs';
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
import {
  checkReleases,
  isPrerelease,
  loadReleases,
  releaseEntity,
  releasedIn,
} from './releases.mjs';
import { allocate, assertOrchestrator } from './ids.mjs';
import { parseItem, renderItem, slugify } from './frontmatter.mjs';
import { listPlaces, loadPlaces, loadWorkTree, git, repoRootOf } from './tree.mjs';
import {
  LIST_BEGIN,
  mermaidItems,
  mermaidProjects,
  renderLists,
  replaceBetweenMarkers,
  viewBlocked,
  viewCriticalPath,
  viewDecisions,
  viewInitiatives,
  viewMilestones,
  viewProjects,
  viewReady,
  viewUnreleased,
} from './views.mjs';

/**
 * @typedef {import('../interface.mjs').TrackerAdapter} TrackerAdapter
 * @typedef {import('../interface.mjs').Entity} Entity
 * @typedef {import('./config.mjs').Layout} Layout
 * @typedef {import('./tree.mjs').Entry} Entry
 * @typedef {import('./claims.mjs').ClaimedItem} ClaimedItem
 *
 * @typedef {object} FilesExtras what the `hitld work` commands need beyond the interface
 * @property {() => Layout} layout
 * @property {() => string} root
 * @property {(draft: Record<string, any>) => { id: string, path: string, block: string }} createEntity
 *   allocate an ID and write the file; orchestrator only
 * @property {() => ClaimedItem[]} claims claims read from branches
 * @property {(id: string, reason: string, branch?: string) => ReturnType<typeof releaseClaim>} release
 * @property {(id: string, options?: { commit?: boolean }) => ReturnType<typeof closeItem>} close
 * @property {(options?: { branches?: boolean, inflight?: string[] }) => { problems: string[], files: number }} check
 * @property {(options?: { who?: string }) => Record<string, string>} renderViewTexts
 * @property {(options?: { outDir?: string, who?: string }) => { dir: string, written: string[], unchanged: string[] }} writeViews
 * @property {(options?: { only?: string, dryRun?: boolean, commit?: boolean, migrations?: readonly import('./migrate.mjs').Migration[] }) => ReturnType<typeof migrateTracker>} migrate
 *   apply the registered format migrations to every file (idempotent; dryRun shows the diff)
 * @property {() => Entry[]} releases the release records
 * @property {(ids: string[]) => Set<string>} authorRoles the roles that wrote the named items
 * @typedef {TrackerAdapter & FilesExtras} FilesTracker
 */

/** Which state changes the lifecycle allows (design part 3.2). Done and Dropped are final. */
export const TRANSITIONS = Object.freeze({
  Proposed: ['Planned', 'Dropped'],
  Planned: ['In progress', 'Done', 'Dropped'],
  'In progress': ['Done', 'Planned', 'Dropped'],
  Done: [],
  Dropped: [],
});

/** The body skeleton per kind, as the reference creator writes it. */
const BODY = /** @type {Record<string, string>} */ ({
  work: '\n## Done when\n\n\n',
  decision: '\n## Question\n\n\n## Options and recommendation\n\n\n## Answer\n\nOpen.\n',
  external: '\n## Waiting on\n\n\n',
  project: '\n## Summary\n\n\n',
  initiative: '\n## Goal\n\n\n',
  capability: '\n## Notes\n\n\n',
  learning: '\n## Notes\n\n\n',
});

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
 */
export function openTracker({ repoRoot, policy, configDir, env = process.env, block }) {
  const root = repoRootOf(repoRoot);
  const loaded = loadTrackerConfig({ repoRoot: root, configDir });
  if (!loaded.config) {
    throw new Error(
      `tracker.json: ${loaded.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
    );
  }
  const layout = resolveLayout(loaded.config, policy);
  // The paths from settings must stay inside the repository, through no symbolic link.
  for (const rel of [
    layout.workDir,
    `${layout.workDir}/${layout.viewsDir}`,
    ...(layout.listsReadme ? [`${layout.workDir}/${layout.listsReadme}`] : []),
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
   */
  const derivedOf = (ctx, it) => {
    const d = /** @type {Record<string, unknown>} */ (it.data ?? {});
    const m = readMilestone(d);
    return milestoneDerived(d, {
      get: (id) => ctx.g.get(id)?.data,
      authorRoles: authorRoles([
        ...ctx.g.needs(/** @type {any} */ (it)),
        ...m.contributions.map((c) => c.id),
      ]),
    });
  };

  /**
   * An entry's entity: the model's field names plus the stored keys that have none, the derived
   * fields, the body, the path and the version.
   * @param {Entry} it @param {ReturnType<typeof contextOf>} [ctx] @returns {Entity}
   */
  function entityOf(it, ctx = contextOf()) {
    const d = /** @type {Record<string, unknown>} */ (it.data ?? {});
    const { schema_version: _, ...entity } = toEntity(d, layout);
    for (const k of NATIVE_EXTRAS) if (d[k] !== undefined) entity[k] = d[k];
    const id = String(d.id);
    if (MILESTONE_KINDS.includes(String(d.kind))) Object.assign(entity, derivedOf(ctx, it));
    else if (ITEM_KINDS.includes(String(d.kind))) {
      entity.constraint_of = ctx.g.constraintOf(id).map((m) => m.data.id);
      entity.contributes_to = ctx.g.contributesTo(id).map((m) => m.data.id);
      entity.released_in = ctx.released.get(id) ?? null;
    }
    return { ...entity, body: it.body, path: it.path, version: it.version };
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
    if (!it?.data) throw new Error(`${id} is not in the tracker`);
    return it;
  }

  /**
   * Claim state from branches, optionally limited to an item.
   * @returns {import('./claims.mjs').ClaimedItem[]}
   */
  const claims = () => findClaims(root, layout);

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
      const from = String(it.data?.status);
      const kind = String(it.data?.kind);
      const allowed = /** @type {Record<string, string[]>} */ (TRANSITIONS)[from] ?? [];
      if (!allowed.includes(to)) {
        throw new Error(
          `${id} is ${from}; the lifecycle allows ${allowed.join(', ') || 'no change'}, not ${to}`,
        );
      }
      if (to === 'Dropped' && !String(reason ?? '').trim())
        throw new Error('Dropped needs a reason');
      if (to === 'In progress' && kind === 'work' && !it.data?.claimed) {
        throw new Error(`claim ${id} to move it to In progress (hitld work claim)`);
      }
      if (MILESTONE_KINDS.includes(kind)) {
        if (to === 'In progress') {
          throw new Error(`${id} is a milestone; items are claimed, milestones are not`);
        }
        const m = readMilestone(/** @type {Record<string, unknown>} */ (it.data));
        const g = buildGraph(read());
        const roles = authorRoles([
          ...g.needs(/** @type {any} */ (it)),
          ...m.contributions.map((c) => c.id),
        ]);
        if (to === 'Done' && !passingCheck(kind, m.results, roles)) {
          throw new Error(
            `${id} becomes Done only from a recorded passing check by a role other than its items' authors (${[...roles].join(', ')}); record the run in check_results`,
          );
        }
      }
      /** @type {Record<string, unknown>} */
      const changes = { status: to };
      if (to === 'Dropped') changes.reason = String(reason).trim();
      else changes.reason = null;
      if (to === 'Planned') changes.claimed = null;
      void via; // the file records the state; the commit that carries it is the caller's
      return rewrite(it, changes);
    },

    link(from, relation, to) {
      const it = mustFind(from);
      const target = mustFind(to);
      if (relation === 'needs') {
        if (MILESTONE_KINDS.includes(String(it.data?.kind))) {
          throw new Error(
            `${from} is a milestone; a constraint names a clause ("<ID> c<n>"), so update its needs`,
          );
        }
        const kind = String(target.data?.kind);
        if (!ITEM_KINDS.includes(kind) && !MILESTONE_KINDS.includes(kind)) {
          throw new Error(`${to} is a ${target.data?.kind}; needs name items and milestones only`);
        }
        const needs = list(it.data?.needs);
        if (!needs.includes(to)) rewrite(it, { needs: [...needs, to] });
      } else if (relation === 'parent') {
        const kind = String(it.data?.kind);
        if (MILESTONE_KINDS.includes(kind)) {
          const key = target.data?.kind === 'initiative' ? 'initiative' : 'project';
          rewrite(it, { [key]: to, [key === 'project' ? 'initiative' : 'project']: null });
        } else rewrite(it, { [ITEM_KINDS.includes(kind) ? 'project' : 'initiative']: to });
      } else if (relation === 'opened_from' && layout.optionalKeys.includes('opened_from')) {
        const ids = list(it.data?.opened_from);
        if (!ids.includes(to)) rewrite(it, { opened_from: [...ids, to] });
      } else {
        throw new Error(
          `this tracker's file format has no "${relation}" link${relation === 'opened_from' ? ' (turn on opened_from in tracker.json optional_keys)' : ''}`,
        );
      }
    },

    claim: (id, claimant, branch) => claimItem(root, layout, id, claimant, { branch }),

    history(id) {
      const it = mustFind(id);
      const log = git(root, ['log', '--reverse', '--format=%H %cI', '--', it.path], {
        allowFail: true,
      });
      /** @type {import('../interface.mjs').Change[]} */
      const changes = [];
      /** @type {string | null} */
      let prev = null;
      for (const line of log.split('\n').filter(Boolean)) {
        const [commit, at] = line.split(' ');
        const text = git(root, ['show', `${commit}:${it.path}`], { allowFail: true });
        const status = parseItem(text).data?.status;
        if (typeof status !== 'string' || status === prev) continue;
        changes.push({
          at,
          from: /** @type {any} */ (prev),
          to: /** @type {any} */ (status),
          ref: { commit },
        });
        prev = status;
      }
      return changes;
    },

    renderViews: () => void tracker.writeViews(),

    // --- Beyond the interface -------------------------------------------------

    layout: () => layout,
    root: () => root,

    /** Create an entity: allocate its ID and write its file. Orchestrator only. */
    createEntity(/** @type {Record<string, any>} */ draft) {
      assertOrchestrator(root, layout, env);
      const kind = String(draft.kind ?? 'work');
      if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
      if (!String(draft.title ?? '').trim()) throw new Error('title is required');
      const isItem = ITEM_KINDS.includes(kind);
      const isMilestone = MILESTONE_KINDS.includes(kind);
      // The owner commits a milestone (design part 3.2), so a new one starts Proposed.
      const state = String(draft.state ?? (isMilestone ? 'Proposed' : 'Planned'));
      if (!['Planned', 'Proposed'].includes(state)) {
        throw new Error(
          'a new entity is Planned or Proposed (claim and close by the claim and close commands)',
        );
      }
      if (isItem && !draft.parent) throw new Error('an item needs a parent: the project ID');
      if (isMilestone && !draft.parent) {
        throw new Error('a milestone needs a parent: a project or an initiative ID');
      }
      if (kind === 'project' && !draft.parent)
        throw new Error('a project needs a parent: the initiative ID');
      if (kind === 'initiative' && draft.parent) throw new Error('an initiative has no parent');
      if (kind === 'external' && !draft.party)
        throw new Error('an external item needs party (who we wait on)');
      /** @type {Record<string, unknown>} */
      const fields = {
        title: String(draft.title).trim(),
        kind,
        state,
        parent: draft.parent,
        needs: list(draft.needs),
        parent_kind: isMilestone
          ? read().find((e) => e.data?.id === draft.parent)?.data?.kind
          : undefined,
        outcome: isMilestone ? draft.outcome : undefined,
        party: kind === 'external' ? draft.party : undefined,
        decider: kind === 'decision' ? (draft.decider ?? 'owner') : undefined,
        lead: ['project', 'initiative'].includes(kind) ? (draft.lead ?? 'owner') : undefined,
        plan: kind === 'project' ? draft.plan : undefined,
        created: today(),
      };
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
      const body = typeof draft.body === 'string' ? draft.body : BODY[kind];
      const slug = slugify(String(draft.title));
      const folder = layout.folders[FOLDER_GROUP[/** @type {keyof typeof FOLDER_GROUP} */ (kind)]];
      const before = checkItems(read(), layout, { root });
      const made = allocate(root, layout, {
        block: idBlock,
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
      return made;
    },

    /** Claims read from branches. */
    claims,

    /** Release an abandoned claim on the main branch, with the reason. */
    release: (
      /** @type {string} */ id,
      /** @type {string} */ reason,
      /** @type {string | undefined} */ branch,
    ) => releaseClaim(root, layout, id, reason, { branch }),

    /** Set an item to Done in the working tree and commit the file. */
    close: (/** @type {string} */ id, /** @type {{ commit?: boolean } | undefined} */ options) =>
      closeItem(root, layout, id, options),

    /**
     * The batch check. `branches` adds ID collisions across every worktree and branch and
     * double claims; `inflight` (dispatch IDs from the ledger) adds the orphaned-claim check.
     * @param {{ branches?: boolean, inflight?: string[] }} [options]
     */
    check({ branches = false, inflight } = {}) {
      const items = read();
      const onMain = currentBranch(root) === layout.mainBranch;
      const g = buildGraph(items);
      const problems = [
        ...checkItems(items, layout, { root, onMain, authorRoles }),
        ...checkReleases(releases(), layout, (id) => g.get(id)?.data),
        ...pendingMigrationProblems(root, layout),
      ];
      // The commit guard's rule over the whole tree; item files give the same line as above.
      const tree = checkTree(root, {
        ceiling: layout.classificationCeiling,
        defaultClassification: layout.defaultClassification,
        privatePaths: layout.privatePaths,
      });
      for (const line of problemLines(tree.refused)) {
        if (!problems.includes(line)) problems.push(line);
      }
      if (branches) {
        const placed = loadPlaces(root, layout, listPlaces(root, layout, { remotes: true }));
        for (const c of findCollisions(placed, layout)) {
          problems.push(
            `${c.id} is two different items: ${c.files.map((f) => `${f.file} on ${f.where.join(', ')}`).join('; ')}`,
          );
        }
      }
      if (branches || inflight) {
        const found = claims();
        for (const c of found) {
          if (c.double) {
            problems.push(
              `${c.id} is claimed twice: ${c.claims.map((x) => `${x.claimant} on ${x.branch}`).join('; ')}`,
            );
          }
        }
        if (inflight) problems.push(...findOrphans(found, inflight));
      }
      return { problems, files: items.length };
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
        initiatives: viewInitiatives(g),
        'critical-path': viewCriticalPath(g),
        milestones: viewMilestones(g, (m) => derivedOf(ctx, m)),
        unreleased: viewUnreleased(g, ctx.released),
        lists: renderLists(g),
        'items-graph': mermaidItems(g),
        'projects-graph': mermaidProjects(g),
      };
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
        initiatives: { title: 'Initiatives', fence: 'text' },
        'critical-path': { title: 'Critical path', fence: 'text' },
        milestones: { title: 'Milestones', fence: 'text' },
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
      if (!outDir && layout.listsReadme) {
        const readme = insidePath(root, `${layout.workDir}/${layout.listsReadme}`);
        const g = buildGraph(read());
        const text = readNoFollow(readme);
        const next = replaceBetweenMarkers(text, renderLists(g, { linkBase: './' }));
        if (next !== text) {
          writeNoFollow(readme, next);
          written.push(`${layout.listsReadme} (lists between ${LIST_BEGIN.slice(0, 22)} markers)`);
        } else unchanged.push(layout.listsReadme);
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
