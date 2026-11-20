// Recording a break (design 6.3, step 3): confirm it, write its regression test, confirm the test
// fails, and only then file its fix item and commit the two together. Nothing is recorded on an
// agent's word: the counterexample is checked against the invariant again first, so a false break
// records nothing.
//
// Only the orchestrator creates tracker items, on main (core/lib/tracker/files/ids.mjs). So a
// break is recorded in two halves where needed: wherever the pass runs, the test is committed
// marked todo with its fix item pending; where items may be created, the item is filed in the
// same commit, and otherwise `hitld adversary file` files it later on main and names it in the
// test's todo mark.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { CodedError } from '../cli/errors.mjs';
import { attackArea, openRegressions } from './attack.mjs';
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

/** A tracker ID, such as W-214: what --fix must be, so it cannot carry anything else. */
export const ITEM_ID = /^[A-Z][A-Z0-9]*-[1-9][0-9]*$/;

/** @param {string} root @param {string[]} args */
const git = (root, args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * An existing item named as a break's fix, or why it cannot be.
 * @param {Io} io @param {string} id
 * @returns {string | null} what is wrong
 */
function checkFix(io, id) {
  if (!ITEM_ID.test(id)) return `--fix must be an item ID such as W-214, not ${JSON.stringify(id)}`;
  try {
    io.tracker().get(id);
    return null;
  } catch (e) {
    return `--fix ${id}: ${e instanceof Error ? e.message : e}`;
  }
}

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
 * Commit exactly these paths, or undo the staging and say why not.
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
 * Make the tests directory, and check it is a real directory inside the repository, through no
 * link out.
 * @param {string} root @param {string} testsDir
 * @returns {string | null} what is wrong
 */
function testsDirInside(root, testsDir) {
  const dir = join(root, testsDir);
  mkdirSync(dir, { recursive: true });
  const real = realpathSync(dir);
  const top = realpathSync(root);
  return real === top || real.startsWith(top + sep)
    ? null
    : `tests_dir ${testsDir} leads outside the repository`;
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
  if (o.fix !== undefined) {
    const bad = checkFix(o, o.fix);
    if (bad) return { ok: false, invariant, reason: bad };
  }
  const result = attackArea(root, reg, {
    invariants: [invariant],
    ...(o.args ? { check: o.args } : {}),
    ...(o.seed !== undefined ? { seed: o.seed } : {}),
  });
  if (result.errors.length) return { ok: false, invariant, reason: result.errors.join('; ') };
  const b = result.breaks[0];
  if (!b) {
    const known = result.known.find((k) => k.found_at > 0);
    return {
      ok: false,
      invariant,
      reason: known
        ? `already recorded: ${known.tests.join(', ')} holds this counterexample`
        : o.args
          ? 'not a break: the invariant holds for these arguments'
          : 'no new break found with this seed',
    };
  }
  const c = { args: b.args, ...(b.variant ? { variant: b.variant } : {}) };
  const test = regressionPath(data, inv, c);
  if (existsSync(join(root, test))) {
    return { ok: false, invariant, reason: `${test} exists: this break is recorded` };
  }
  const outside = testsDirInside(root, data.tests_dir);
  if (outside) return { ok: false, invariant, reason: outside };
  const pending = pendingTodo(inv.statement);
  const text = regressionText({
    area: reg.area,
    registry: reg.path,
    data,
    inv,
    c,
    todo: pending,
    message: b.message,
  });
  writeFileSync(join(root, test), text);
  // The test must fail before any item is filed: a filed item's ID is used for good.
  const run = regressionFails(root, test);
  if (!run.fails) {
    rmSync(join(root, test), { force: true });
    return {
      ok: false,
      invariant,
      reason: `the regression test did not fail as a todo test: ${run.output.trim().split('\n').slice(-5).join(' ')}`,
    };
  }
  const draft = fixDraft(reg, b, test);
  /** @type {{ id: string, path: string | null } | { pending: string }} */
  let filed;
  try {
    filed = o.fix ? { id: o.fix, path: null } : fileItem(o, reg, draft);
  } catch (e) {
    rmSync(join(root, test), { force: true });
    throw e;
  }
  const fix = 'id' in filed ? filed : null;
  if (fix) writeFileSync(join(root, test), retodo(text, pending, filedTodo(fix.id, inv.statement)));
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
      rmSync(join(root, test), { force: true });
      if (fix?.path) rmSync(join(root, fix.path), { force: true });
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
 * The fix item's draft for every pending break of one invariant: one item, whatever the number of
 * counterexamples.
 * @param {Registry} reg @param {import('./registry.mjs').Invariant} inv
 * @param {(import('./regression.mjs').Regression & { test: string })[]} tests
 */
function groupDraft(reg, inv, tests) {
  const lines = tests.map(
    (t) =>
      `- \`${JSON.stringify(t.args)}\`${t.variant ? ` reordered \`${JSON.stringify(t.variant)}\`` : ''}: ${t.message} (\`${t.test}\`)`,
  );
  return {
    title: `Invariant ${inv.id} of the ${reg.area} area holds for every input`,
    body: [
      '## Why',
      '',
      `The adversarial pass (design 6.3) broke invariant \`${inv.id}\` of the ${reg.area} area (\`${reg.path}\`): ${inv.statement}`,
      '',
      `Form: ${inv.form}: ${FORMS[inv.form]}. The counterexamples, each with its regression test:`,
      '',
      ...lines,
      '',
      '## Done when',
      '',
      ...tests.map((t) => `- \`${t.test}\` passes, and its todo mark is removed.`),
      `- \`hitld adversary attack --area ${reg.area}\` reports no break of \`${inv.id}\`.`,
      '',
    ].join('\n'),
  };
}

/**
 * The regression tests whose fix item is pending, one group per invariant, with the draft of the
 * group's one fix item.
 * @param {string} root @param {Registry[]} regs
 */
export function pendingRegressions(root, regs) {
  /** @type {{ reg: Registry, invariant: string, statement: string, tests: { test: string, text: string }[], draft: { title: string, body: string } }[]} */
  const out = [];
  for (const reg of regs) {
    const data = reg.data;
    if (!data) continue;
    const open = openRegressions(root, data.tests_dir);
    for (const inv of data.invariants) {
      const tests = open.filter(
        (r) => r.invariant === inv.id && r.todo === pendingTodo(inv.statement),
      );
      if (!tests.length) continue;
      out.push({
        reg,
        invariant: inv.id,
        statement: inv.statement,
        tests: tests.map((t) => ({ test: t.test, text: readFileSync(join(root, t.test), 'utf8') })),
        draft: groupDraft(reg, inv, tests),
      });
    }
  }
  return out;
}

/**
 * Name an item already filed in one regression test's todo mark, in place of its pending one.
 * For where `hitld adversary file` cannot file (merge through pull requests): the item is filed
 * and published on main, and this renames the mark on a branch.
 * @param {string} root @param {Registry[]} regs @param {string} test @param {string} id @param {Io} io
 */
export function nameFix(root, regs, test, id, io) {
  const bad = checkFix(io, id);
  if (bad) throw new CodedError('usage', bad);
  const group = pendingRegressions(root, regs).find((p) => p.tests.some((t) => t.test === test));
  const found = group?.tests.find((t) => t.test === test);
  if (!group || !found) {
    throw new CodedError('usage', `${test} is not a regression test with its fix item pending`);
  }
  writeFileSync(
    join(root, test),
    retodo(found.text, pendingTodo(group.statement), filedTodo(id, group.statement)),
  );
  if (io.commit === false) return { test, fix: id, commit: null };
  const made = commitPaths(
    root,
    [test],
    [
      `${id}: name the fix item in ${test}`,
      '',
      `Work-Item: ${id}`,
      ...dispatchTrailers(io.env ?? {}),
    ].join('\n'),
  );
  if ('error' in made) {
    writeFileSync(join(root, test), found.text);
    throw new CodedError('failed', made.error);
  }
  return { test, fix: id, commit: made.commit };
}

/**
 * File the fix items of regression tests whose item is pending (the orchestrator, on main): one
 * item per invariant, named in the todo mark of each of its pending tests, and committed with
 * them. A test that no longer fails is left for the person who fixed it to clear, and reported.
 * @param {string} root @param {Registry[]} regs @param {Io} io
 */
export function filePending(root, regs, io) {
  /** @type {{ invariant: string, tests: string[], fix: string, item_path: string, commit: string | null }[]} */
  const filed = [];
  /** @type {{ test: string, reason: string }[]} */
  const skipped = [];
  for (const g of pendingRegressions(root, regs)) {
    const failing = g.tests.filter((t) => {
      if (regressionFails(root, t.test).fails) return true;
      skipped.push({ test: t.test, reason: 'it passes now: remove its todo mark instead' });
      return false;
    });
    if (!failing.length) continue;
    const item = fileItem(io, g.reg, g.draft);
    if ('pending' in item) throw new CodedError('not-permitted', item.pending);
    for (const t of failing) {
      writeFileSync(
        join(root, t.test),
        retodo(t.text, pendingTodo(g.statement), filedTodo(item.id, g.statement)),
      );
    }
    const paths = failing.map((t) => t.test);
    /** @type {string | null} */
    let commit = null;
    if (io.commit !== false) {
      const made = commitPaths(
        root,
        [...paths, item.path],
        [
          `${item.id}: fix item for the breaks of invariant ${g.invariant}`,
          '',
          `Filed from ${paths.join(', ')}, which now name it in their todo marks.`,
          '',
          `Work-Item: ${item.id}`,
          ...dispatchTrailers(io.env ?? {}),
        ].join('\n'),
      );
      if ('error' in made) {
        for (const t of failing) writeFileSync(join(root, t.test), t.text);
        rmSync(join(root, item.path), { force: true });
        for (const t of failing) skipped.push({ test: t.test, reason: made.error });
        continue;
      }
      commit = made.commit;
    }
    filed.push({
      invariant: g.invariant,
      tests: paths,
      fix: item.id,
      item_path: item.path,
      commit,
    });
  }
  return { filed, skipped };
}
