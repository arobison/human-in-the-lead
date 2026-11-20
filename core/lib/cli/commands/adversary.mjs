// The adversarial loop (design 6.3): `hitld adversary due` says which areas with an invariant
// registry a change touches, `hitld adversary attack` runs the pass on them, and `hitld adversary
// record` turns a break into a failing regression test and a fix item, committed together. The
// work is in core/lib/adversary/.

import { resolve } from 'node:path';
import { attackArea, DEFAULT_SEED } from '../../adversary/attack.mjs';
import { changedFiles, dueRegistries } from '../../adversary/due.mjs';
import { filePending, recordBreak } from '../../adversary/record.mjs';
import { registries } from '../../adversary/registry.mjs';
import { findRepoRoot, loadPolicy } from '../../policy/policy.mjs';
import { formatErrors } from '../../schema/validate.mjs';
import { CodedError } from '../errors.mjs';
import { open, where } from './tracker.mjs';

/** @type {import('../args.mjs').ArgSpec[]} */
const repoArg = where.filter((a) => a.name === 'repo');

/** @type {import('../args.mjs').ArgSpec} */
const seedArg = {
  name: 'seed',
  type: 'integer',
  description: `The seed the inputs are drawn from (default ${DEFAULT_SEED}); the same seed finds the same breaks`,
};

/** @type {import('../args.mjs').ArgSpec} */
const parentArg = {
  name: 'parent',
  type: 'string',
  description: "The project a fix item is filed under (default: the registry's fix_parent)",
};

/** @type {import('../args.mjs').ArgSpec} */
const baseArg = {
  name: 'base',
  type: 'string',
  description:
    'The ref the change left from (default main): the change is its commits since then, with uncommitted and untracked files',
};

/**
 * The repository root and its registries.
 * @param {Record<string, unknown>} input @param {import('../table.mjs').CommandContext} ctx
 */
function load(input, ctx) {
  const dir = input.repo ? resolve(ctx.cwd, String(input.repo)) : ctx.cwd;
  const root = findRepoRoot(dir) ?? dir;
  const loaded = loadPolicy({ cwd: root });
  if (!loaded.policy) {
    throw new CodedError(
      'policy',
      `policy.json: ${formatErrors(loaded.errors).split('\n').join('; ')}`,
    );
  }
  return { root, regs: registries(root, /** @type {any} */ (loaded.policy)) };
}

/**
 * The registries a command works on: one area, the areas a change touches, or all.
 * @param {ReturnType<typeof registries>} regs @param {string} root
 * @param {Record<string, unknown>} input
 */
function chosen(regs, root, input) {
  if (typeof input.area === 'string') {
    const r = regs.find((x) => x.area === input.area);
    if (!r) {
      throw new CodedError(
        'usage',
        `the ${input.area} area has no invariant registry (known: ${regs.map((x) => x.area).join(', ') || 'none'})`,
      );
    }
    return { regs: [r], changed: null };
  }
  if (typeof input.base === 'string') {
    const changed = changedFiles(root, input.base);
    return { regs: dueRegistries(regs, changed).map((d) => d.registry), changed };
  }
  return { regs, changed: null };
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'adversary due',
    summary:
      'Which areas with an invariant registry a change touches: the adversarial pass is due for each, with the invariants it attacks and the changed files',
    built_by: 'signal',
    output: ['ok', 'base', 'changed', 'due'],
    args: [baseArg, ...repoArg],
    run(input, ctx) {
      const { root, regs } = load(input, ctx);
      const base = typeof input.base === 'string' ? input.base : 'main';
      const changed = changedFiles(root, base);
      const due = dueRegistries(regs, changed).map(({ registry, changed: files }) => ({
        area: registry.area,
        registry: registry.path,
        tests_dir: registry.data?.tests_dir ?? null,
        invariants: (registry.data?.invariants ?? []).map((i) => ({
          id: i.id,
          statement: i.statement,
          form: i.form,
          module: i.module,
        })),
        changed: files,
        errors: registry.errors,
      }));
      return { ok: due.every((d) => d.errors.length === 0), base, changed: changed.length, due };
    },
  },
  {
    name: 'adversary attack',
    summary:
      'Run the adversarial pass: attack each invariant of an area (or of the areas a change touches) with generated inputs, and report every break with its smallest counterexample',
    built_by: 'signal',
    output: ['ok', 'seed', 'areas', 'breaks', 'known', 'recorded', 'errors'],
    args: [
      { name: 'area', type: 'string', description: 'One area (default: every registry)' },
      {
        ...baseArg,
        description:
          'Only the areas the change since this ref touches (default: every registry, or --area)',
      },
      seedArg,
      {
        name: 'record',
        type: 'boolean',
        description:
          'Record each new break: a failing regression test marked todo, committed with its fix item (or with it pending, where only the orchestrator files items)',
      },
      parentArg,
      ...repoArg,
    ],
    run(input, ctx) {
      const { root, regs } = load(input, ctx);
      const seed = typeof input.seed === 'number' ? input.seed : DEFAULT_SEED;
      const pick = chosen(regs, root, input);
      const areas = pick.regs.map((r) => attackArea(root, r, { seed }));
      const breaks = areas.flatMap((a) => a.breaks);
      /** @type {import('../../adversary/record.mjs').Recorded[]} */
      const recorded = [];
      if (input.record) {
        for (const b of breaks) {
          const reg = /** @type {(typeof pick.regs)[number]} */ (
            pick.regs.find((r) => r.area === b.area)
          );
          recorded.push(
            recordBreak(root, reg, b.invariant, {
              args: b.args,
              seed,
              ...(typeof input.parent === 'string' ? { parent: input.parent } : {}),
              tracker: () => open({ repo: root }, ctx),
              env: ctx.env,
            }),
          );
        }
      }
      const errors = areas.flatMap((a) => a.errors.map((e) => `${a.area}: ${e}`));
      const unrecorded = input.record ? recorded.filter((r) => !r.ok).length : breaks.length;
      return {
        ok: errors.length === 0 && unrecorded === 0,
        seed,
        ...(pick.changed ? { changed: pick.changed.length } : {}),
        areas: areas.map((a) => ({
          area: a.area,
          registry: a.registry,
          invariants: a.invariants,
          checked: a.checked,
          breaks: a.breaks.length,
          known: a.known.length,
        })),
        breaks,
        known: areas.flatMap((a) => a.known),
        ...(input.record ? { recorded } : {}),
        errors,
      };
    },
  },
  {
    name: 'adversary record',
    summary:
      'Record one break of an invariant: check the counterexample breaks it, write the regression test marked todo, check it fails, and commit it with its fix item (pending where only the orchestrator may file items: hitld adversary file files it on main)',
    built_by: 'signal',
    output: [
      'ok',
      'invariant',
      'test',
      'fix',
      'item_path',
      'commit',
      'args',
      'message',
      'pending',
      'reason',
    ],
    args: [
      { name: 'area', type: 'string', description: 'The area', required: true },
      { name: 'invariant', type: 'string', description: 'The invariant broken', required: true },
      {
        name: 'input',
        type: 'string',
        description:
          "The counterexample: the target's arguments as a JSON list (default: the break the pass finds with --seed)",
      },
      seedArg,
      {
        name: 'fix',
        type: 'string',
        description: 'An existing item that fixes the break, instead of filing a new one',
      },
      parentArg,
      {
        name: 'no-commit',
        type: 'boolean',
        description: 'Leave the test and the item uncommitted, for a commit with your own trailers',
      },
      ...repoArg,
    ],
    run(input, ctx) {
      const { root, regs } = load(input, ctx);
      const {
        regs: [reg],
      } = chosen(regs, root, { area: input.area });
      /** @type {unknown[] | undefined} */
      let args;
      if (typeof input.input === 'string') {
        try {
          args = JSON.parse(input.input);
        } catch (e) {
          throw new CodedError(
            'usage',
            `--input is not JSON: ${e instanceof Error ? e.message : e}`,
          );
        }
        if (!Array.isArray(args)) throw new CodedError('usage', '--input must be a JSON list');
      }
      const r = recordBreak(root, reg, String(input.invariant), {
        ...(args ? { args } : {}),
        ...(typeof input.seed === 'number' ? { seed: input.seed } : {}),
        ...(typeof input.fix === 'string' ? { fix: input.fix } : {}),
        ...(typeof input.parent === 'string' ? { parent: input.parent } : {}),
        commit: !input['no-commit'],
        tracker: () => open({ repo: root }, ctx),
        env: ctx.env,
      });
      return { ...r };
    },
  },
  {
    name: 'adversary file',
    summary:
      "File the fix items of regression tests whose item is pending (the orchestrator, on main): each is filed, named in its test's todo mark, and committed with it",
    built_by: 'signal',
    output: ['ok', 'filed', 'skipped'],
    args: [
      { name: 'area', type: 'string', description: 'One area (default: every registry)' },
      {
        name: 'no-commit',
        type: 'boolean',
        description: 'Leave the tests and items uncommitted',
      },
      parentArg,
      ...repoArg,
    ],
    run(input, ctx) {
      const { root, regs } = load(input, ctx);
      const pick = chosen(regs, root, { area: input.area });
      const r = filePending(root, pick.regs, {
        tracker: () => open({ repo: root }, ctx),
        commit: !input['no-commit'],
        env: ctx.env,
        ...(typeof input.parent === 'string' ? { parent: input.parent } : {}),
      });
      return { ok: r.skipped.length === 0, ...r };
    },
  },
];
