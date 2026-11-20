// Actions for the tracker scenarios: build the fixture tracker the stale-item sweep reads (design
// part 13.3), and the steps of closing by trailer at merge (design part 3.4, HITLD-49): a person's
// branch merged through the queue, its revert, and a direct push to main. The hitld commands
// themselves go through orchestrator.cli, which runs in consumer/ with the sandbox's data home,
// where the fixture's ledger is. Every repository is built inside the sandbox.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePolicy } from '../../policy/policy.mjs';
import { runMergeQueue } from '../../merge/queue.mjs';
import { approvePresented, presentToOwner } from '../../merge/owner.mjs';
import { closeByTrailer } from '../../tracker/files/closing.mjs';
import { openTracker } from '../../tracker/files/tracker.mjs';
import {
  buildConsumer,
  buildSweepConsumer,
  fixtureGit,
  itemFile,
} from '../orchestrator-fixtures.mjs';

/** Where the close-by-trailer steps keep main as it was before the merge, for the revert. */
const BEFORE_REF = 'refs/eval/before-merge';

/** The fixture consumer's items, by ID. */
const ITEM_FILES = {
  'W-1': 'work/items/W-1-add-numbers.md',
  'W-2': 'work/items/W-2-another-thing.md',
  'W-3': 'work/items/W-3-after-one.md',
};

/** Each fixture item's state on main. @param {string} root */
const statesOnMain = (root) =>
  Object.fromEntries(
    Object.entries(ITEM_FILES).map(([id, path]) => [
      id,
      /^state: (.*)$/m.exec(fixtureGit(root, 'show', `main:${path}`))?.[1] ?? null,
    ]),
  );

/** @param {import('./builtin.mjs').ActionContext} ctx */
const consumerOf = (ctx) => join(ctx.sandbox, 'consumer');

/** @type {Record<string, import('./builtin.mjs').Action>} */
export const actions = {
  'tracker.sweep-fixture': {
    description:
      'Build the stale-item sweep fixture at consumer/ in the sandbox, committed on main, with its ledger in the private store under data/: one case of each finding kind and one beside it that is not a finding (core/lib/eval/orchestrator-fixtures.mjs, buildSweepConsumer). Returns { root, project, now }: now is the time to judge it at.',
    input: { type: 'object', properties: {}, additionalProperties: false },
    run: (_input, ctx) => {
      const made = buildSweepConsumer(join(ctx.sandbox, 'consumer'), join(ctx.sandbox, 'data'));
      return { root: 'consumer', project: made.project, now: made.now };
    },
  },

  'tracker.close-by-trailer-merge': {
    description:
      "Build the fixture consumer at consumer/ (W-1, W-2 and W-3 planned) and a person's branch made by hand, with no claim: one commit whose message says \"closes W-2\" in prose and carries the trailers Closes: W-1 and Refs: W-3. Merge it through the queue as hitld merge wires it, or with owner, present it to the owner and apply their yes. Returns { merged, closed, presented_closed, rejected, states, last_subject, last_files, commits_merged }: states is each item's state on main; last_subject and last_files are those of main's last commit.",
    input: {
      type: 'object',
      properties: { owner: { type: 'boolean' } },
      additionalProperties: false,
    },
    run: async (input, ctx) => {
      // The consumer's items, each under a project, so that hitld work check has nothing else to say.
      /** @type {Record<string, string>} */
      const files = {
        'work/projects/W-9-the-project.md': itemFile({
          id: 'W-9',
          title: 'The project',
          kind: 'project',
          state: 'planned',
          owner: 'owner',
        }),
      };
      for (const [id, path] of Object.entries(ITEM_FILES)) {
        const fields = {
          id,
          title: { 'W-1': 'Add numbers', 'W-2': 'Another thing', 'W-3': 'After one' }[id] ?? id,
          kind: 'work',
          state: 'planned',
          project: 'W-9',
          ...(id === 'W-3' ? { needs: ['W-1'] } : {}),
        };
        files[path] = itemFile(fields);
      }
      const root = buildConsumer(consumerOf(ctx), { files });
      const before = fixtureGit(root, 'rev-parse', 'main');
      fixtureGit(root, 'update-ref', BEFORE_REF, before);
      fixtureGit(root, 'switch', '-q', '-c', 'fix/by-hand');
      const calc = join(root, 'src/calc.js');
      writeFileSync(calc, `${readFileSync(calc, 'utf8')}export const sub = (a, b) => a - b;\n`);
      fixtureGit(root, 'add', '-A');
      fixtureGit(
        root,
        'commit',
        '-q',
        '-m',
        'Add subtraction by hand',
        '-m',
        'This also closes W-2, in prose, which never counts.',
        '-m',
        'Closes: W-1\nRefs: W-3',
      );
      fixtureGit(root, 'switch', '-q', 'main');
      const { policy } = resolvePolicy({
        schema_version: 1,
        project: { id: 'orch-fixture', key: 'W' },
        merge: { mode: input.owner ? 'owner' : 'queue' },
      });
      if (!policy) throw new Error('the scenario policy is invalid');
      const layout = openTracker({ repoRoot: root, policy, env: {} }).layout();
      /** @type {import('../../merge/queue.mjs').Settings} */
      const settings = {
        mainBranch: 'main',
        batchMax: 4,
        fastChecks: [],
        fullSuite: ['node --test "test/*.test.js"'],
        generated: [],
        flakeReruns: 0,
        closeByTrailer: (dir, from, to, own) => closeByTrailer(dir, layout, from, to, { own }),
      };
      const entries = [{ item: 'W-1', branch: 'fix/by-hand' }];
      /** @type {string[] | null} */
      let presented = null;
      let result;
      if (input.owner) {
        const shown = await presentToOwner({ repoRoot: root, entries, settings, policy });
        const p = shown.presentation;
        if (!p) throw new Error('nothing was presented to the owner');
        presented = p.branches.flatMap((b) => b.closed ?? []);
        const approved = await approvePresented({
          repoRoot: root,
          presentation: p,
          all: true,
          names: [],
          entries,
          settings,
        });
        result = approved.result;
      } else {
        result = await runMergeQueue({ repoRoot: root, entries, settings });
      }
      ctx.recordTokens(0);
      return {
        merged: (result?.merged ?? []).map((m) => m.item),
        closed: (result?.merged ?? []).flatMap((m) => m.closed ?? []),
        presented_closed: presented,
        rejected: (result?.rejected ?? []).map((x) => ({ item: x.item, reason: x.reason })),
        states: statesOnMain(root),
        last_subject: fixtureGit(root, 'log', '-1', '--format=%s', 'main'),
        last_files: fixtureGit(root, 'show', '--name-only', '--format=', 'main'),
        commits_merged: Number(fixtureGit(root, 'rev-list', '--count', `${before}..main`)),
      };
    },
  },

  'tracker.close-by-trailer-revert': {
    description:
      "In consumer/, after tracker.close-by-trailer-merge: revert everything that merge put on main, as a person reverting the merge would. Returns { states }, each fixture item's state on main.",
    input: { type: 'object', properties: {}, additionalProperties: false },
    run: (_input, ctx) => {
      const root = consumerOf(ctx);
      fixtureGit(root, 'revert', '--no-edit', `${BEFORE_REF}..main`);
      return { states: statesOnMain(root) };
    },
  },

  'tracker.direct-push': {
    description:
      'In consumer/, on main, after tracker.close-by-trailer-merge and its revert: a commit pushed straight to main, outside the merge path, whose trailer is Closes: W-1 and which changes no item; then W-2 (until now only named in prose) marked done by hand in a commit that names no item. Returns { pushed }, the first commit, short.',
    input: { type: 'object', properties: {}, additionalProperties: false },
    run: (_input, ctx) => {
      const root = consumerOf(ctx);
      const other = join(root, 'src/other.js');
      writeFileSync(other, `${readFileSync(other, 'utf8')}export const two = 2;\n`);
      fixtureGit(root, 'add', '-A');
      fixtureGit(root, 'commit', '-q', '-m', 'Pushed straight to main', '-m', 'Closes: W-1');
      const pushed = fixtureGit(root, 'rev-parse', 'HEAD').slice(0, 12);
      const w2 = join(root, ITEM_FILES['W-2']);
      writeFileSync(w2, readFileSync(w2, 'utf8').replace('state: planned', 'state: done'));
      fixtureGit(root, 'add', '-A');
      fixtureGit(root, 'commit', '-q', '-m', 'Tracker: W-2 is done');
      return { pushed };
    },
  },
};
