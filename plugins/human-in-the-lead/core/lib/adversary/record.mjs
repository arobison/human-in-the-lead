// Recording a break (design 6.3, step 3): confirm it, write its regression test, confirm the test
// fails, and commit it with its fix item. Nothing is recorded on an agent's word: the
// counterexample is checked against the invariant again first, so a false break records nothing.
//
// Only the orchestrator creates tracker items, on main (core/lib/tracker/files/ids.mjs). So a
// break is recorded in two halves where needed: wherever the pass runs, the test is committed
// marked todo with its fix item pending; where items may be created, the item is filed in the
// same commit, and otherwise `hitld adversary file` files it later on main and names it in the
// test's todo mark.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CodedError } from '../cli/errors.mjs';
import { attackArea, testPrefix } from './attack.mjs';
import { FORMS } from './forms.mjs';
import {
  filedTodo,
  pendingTodo,
  readRegression,
  regressionFails,
  regressionPath,
  regressionText,
  retodo,
} from './regression.mjs';

/**
 * @typedef {import('./registry.mjs').Registry} Registry
 * @typedef {import('./attack.mjs').Break} Break
 * @typedef {{ get: (id: string) => unknown,
 *   createEntity: (draft: Record<string, unknown>) => { id: string, path: string } }} Tracker
 * @typedef {{ ok: true, invariant: string, test: string, fix: string | null, item_path: string | null,
 *   commit: string | null, args: unknown[], message: string,
 *   pending?: { reason: string, draft: { title: string, body: string } } }
 *   | { ok: false, invariant: string, reason: string }} Recorded
 * @typedef {{ tracker: () => Tracker, commit?: boolean, env?: NodeJS.ProcessEnv, parent?: string }} Io
 *   parent: the project a fix item is filed under (default: the registry's fix_parent)
 */

/** @param {string} root @param {string[]} args */
const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * The fix item's title and body.
 * @param {Registry} reg
 * @param {{ invariant: string, statement: string, form: string, args: unknown[], variant?: unknown[], message: string }} b
 * @param {string} test
 */
export function fixDraft(reg, b, test) {
  return {
    title: `Invariant ${b.invariant} of the ${reg.area} area holds for every input`,
    body: [
      '## Why',
      '',
      `The adversarial pass (design 6.3) broke invariant \`${b.invariant}\` of the ${reg.area} area (\`${reg.path}\`): ${b.statement}`,
      '',
      `Form: ${b.form}. Arguments: \`${JSON.stringify(b.args)}\`${b.variant ? `; reordered: \`${JSON.stringify(b.variant)}\`` : ''}.`,
      '',
      `What broke: ${b.message}`,
      '',
      '## Done when',
      '',
      `- \`${test}\` passes, and its todo mark is removed.`,
      `- \`hitld adversary attack --area ${reg.area}\` reports no break of \`${b.invariant}\`.`,
      '',
    ].join('\n'),
  };
}

/** The commit trailers from a dispatch's environment. @param {NodeJS.ProcessEnv} env */
const dispatchTrailers = (env) => [
  ...(/^D-[1-9][0-9]*$/.test(env.HITLD_DISPATCH ?? '') ? [`Dispatch: ${env.HITLD_DISPATCH}`] : []),
  ...(/^[a-z][a-z0-9-]*$/.test(env.HITLD_ROLE ?? '') ? [`Agent-Role: ${env.HITLD_ROLE}`] : []),
];

/**
 * Commit exactly these paths, or undo and say why not.
 * @param {string} root @param {string[]} paths @param {string} message
 * @returns {{ commit: string } | { error: string }}
 */
function commitPaths(root, paths, message) {
  try {
    git(root, ['add', '--', ...paths]);
    git(root, ['commit', '-q', '-m', message, '--', ...paths]);
    return { commit: git(root, ['rev-parse', 'HEAD']).trim() };
  } catch (e) {
    try {
      git(root, ['reset', '-q', '--', ...paths]);
    } catch {
      // Nothing staged.
    }
    const err = /** @type {{ stderr?: string, message?: string }} */ (e);
    return { error: `not committed: ${(err.stderr || err.message || '').trim()}` };
  }
}

/**
 * File the fix item, or say why it cannot be filed here.
 * @param {Io} io @param {Registry} reg @param {{ title: string, body: string }} draft
 * @returns {{ id: string, path: string } | { pending: string }}
 */
function fileItem(io, reg, draft) {
  try {
    const parent = io.parent ?? reg.data?.fix_parent;
    return io.tracker().createEntity({
      title: draft.title,
      kind: 'work',
      state: 'proposed',
      ...(parent ? { parent } : {}),
      body: draft.body,
    });
  } catch (e) {
    if (e instanceof CodedError && e.code === 'not-permitted') return { pending: e.message };
    throw e;
  }
}

/**
 * Record one break.
 * @param {string} root
 * @param {Registry} reg
 * @param {string} invariant
 * @param {Io & { args?: unknown[], seed?: number, fix?: string }} o
 *   args: the counterexample (default: the pass's own); fix: an item already filed for it;
 *   commit false: leave the files uncommitted, for a commit with the caller's own trailers
 * @returns {Recorded}
 */
export function recordBreak(root, reg, invariant, o) {
  const data = reg.data;
  const inv = data?.invariants.find((i) => i.id === invariant);
  if (!data || !inv) {
    return { ok: false, invariant, reason: reg.errors[0] ?? `no invariant ${invariant}` };
  }
  const result = attackArea(root, reg, {
    invariants: [invariant],
    ...(o.args ? { check: o.args } : {}),
    ...(o.seed !== undefined ? { seed: o.seed } : {}),
  });
  if (result.errors.length) return { ok: false, invariant, reason: result.errors.join('; ') };
  const fresh = result.breaks[0];
  const known = result.known[0];
  if (!fresh && known && !o.args) {
    return {
      ok: false,
      invariant,
      reason: `already recorded: ${known.tests.join(', ')} is open; pass the arguments of another break to record it`,
    };
  }
  const b = fresh ?? known;
  if (!b) {
    return {
      ok: false,
      invariant,
      reason: o.args
        ? 'not a break: the invariant holds for these arguments'
        : 'no break found with this seed',
    };
  }
  const c = { args: b.args, ...(b.variant ? { variant: b.variant } : {}) };
  const test = regressionPath(data, inv, c);
  if (existsSync(join(root, test))) {
    return { ok: false, invariant, reason: `${test} exists: this break is recorded` };
  }
  const draft = fixDraft(reg, b, test);
  const filed = o.fix ? { id: o.fix, path: null } : fileItem(o, reg, draft);
  const fix = 'id' in filed ? filed : null;
  const todo = fix ? filedTodo(fix.id, inv.statement) : pendingTodo(inv.statement);
  const undo = () => {
    rmSync(join(root, test), { force: true });
    if (fix?.path) rmSync(join(root, fix.path), { force: true });
  };
  mkdirSync(dirname(join(root, test)), { recursive: true });
  writeFileSync(
    join(root, test),
    regressionText({ area: reg.area, registry: reg.path, data, inv, c, todo, message: b.message }),
  );
  const run = regressionFails(root, test);
  if (!run.fails) {
    undo();
    return {
      ok: false,
      invariant,
      reason: `the regression test did not fail as a todo test: ${run.output.trim().split('\n').slice(-5).join(' ')}`,
    };
  }
  /** @type {string | null} */
  let commit = null;
  if (o.commit !== false) {
    const subject = fix
      ? `${fix.id}: regression test for a break of invariant ${inv.id}`
      : `Regression test for a break of invariant ${inv.id}, its fix item pending`;
    const made = commitPaths(
      root,
      [test, ...(fix?.path ? [fix.path] : [])],
      [
        subject,
        '',
        `The adversarial pass broke invariant ${inv.id} of the ${reg.area} area. The test is marked todo until the fix lands.`,
        '',
        ...(fix ? [`Work-Item: ${fix.id}`] : []),
        ...dispatchTrailers(o.env ?? {}),
      ]
        .join('\n')
        .trim(),
    );
    if ('error' in made) {
      undo();
      return { ok: false, invariant, reason: made.error };
    }
    commit = made.commit;
  }
  return {
    ok: true,
    invariant,
    test,
    fix: fix?.id ?? null,
    item_path: fix?.path ?? null,
    commit,
    args: b.args,
    message: b.message,
    ...('pending' in filed ? { pending: { reason: filed.pending, draft } } : {}),
  };
}

/**
 * File the fix items of regression tests whose item is pending (the orchestrator, on main): for
 * each, file the item, name it in the test's todo mark, and commit the two together. A test that
 * no longer fails is left for the person who fixed it to clear, and reported.
 * @param {string} root @param {Registry[]} regs @param {Io} io
 */
export function filePending(root, regs, io) {
  /** @type {{ test: string, fix: string, item_path: string, commit: string | null }[]} */
  const filed = [];
  /** @type {{ test: string, reason: string }[]} */
  const skipped = [];
  for (const reg of regs) {
    const data = reg.data;
    if (!data) continue;
    const dir = join(root, data.tests_dir);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!name.startsWith('adversary-') || !/\.test\.m?js$/.test(name)) continue;
      const test = `${data.tests_dir.replace(/\/$/, '')}/${name}`;
      const text = readFileSync(join(root, test), 'utf8');
      const r = readRegression(text);
      const inv = r && data.invariants.find((i) => i.id === r.invariant);
      if (!r || !inv || !name.startsWith(testPrefix(inv.id))) continue;
      if (r.todo !== pendingTodo(inv.statement)) continue;
      if (!regressionFails(root, test).fails) {
        skipped.push({ test, reason: 'it passes now: remove its todo mark instead' });
        continue;
      }
      const draft = fixDraft(
        reg,
        { ...r, statement: inv.statement, form: `${inv.form}: ${FORMS[inv.form]}` },
        test,
      );
      const item = fileItem(io, reg, draft);
      if ('pending' in item) throw new CodedError('not-permitted', item.pending);
      writeFileSync(
        join(root, test),
        retodo(text, pendingTodo(inv.statement), filedTodo(item.id, inv.statement)),
      );
      /** @type {string | null} */
      let commit = null;
      if (io.commit !== false) {
        const made = commitPaths(
          root,
          [test, item.path],
          [
            `${item.id}: fix item for the break of invariant ${inv.id}`,
            '',
            `Filed from ${test}, which now names it in its todo mark.`,
            '',
            `Work-Item: ${item.id}`,
            ...dispatchTrailers(io.env ?? {}),
          ].join('\n'),
        );
        if ('error' in made) {
          writeFileSync(join(root, test), text);
          rmSync(join(root, item.path), { force: true });
          skipped.push({ test, reason: made.error });
          continue;
        }
        commit = made.commit;
      }
      filed.push({ test, fix: item.id, item_path: item.path, commit });
    }
  }
  return { filed, skipped };
}
