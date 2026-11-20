// The private term list and the publication check (design part 10.3, rule 7).
//
//   hitld private add | list | remove   the owner keeps the list, in the private store; executors
//                                       are refused all three, and list shows each term masked
//                                       (its kind and length) unless --show
//   hitld publish check                 any text before it is posted where others read it: a pull
//                                       request's title and body, an issue comment, release notes.
//                                       Anyone may run it, executors included; it never prints a term
//
// The list's own rules are in core/lib/store/private-terms.mjs, the matching in
// core/lib/guard/private-terms.mjs.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findRepoRoot, loadPolicy } from '../../policy/policy.mjs';
import { openStore, privateStorePath } from '../../store/store.mjs';
import { findTerms, isNoreply, matchMessage } from '../../guard/private-terms.mjs';
import {
  activeTerms,
  addTerm,
  impliedTerms,
  readTermRecords,
  removeTerm,
  termsForProject,
} from '../../store/private-terms.mjs';
import { CodedError } from '../errors.mjs';
import { executorSignal } from '../executor.mjs';

/**
 * @typedef {import('../table.mjs').CommandContext} Ctx
 * @typedef {import('../table.mjs').CommandResult} Result
 */

/** @type {import('../args.mjs').ArgSpec} */
const STORE = {
  name: 'store',
  type: 'string',
  description:
    "The private store directory, where the list lives. Default: the project's, from policy.json (project.id) under $XDG_DATA_HOME/human-in-the-lead, else %LOCALAPPDATA%\\human-in-the-lead on Windows and ~/.local/share/human-in-the-lead elsewhere",
};

/**
 * The project's policy and private store.
 * @param {Record<string, unknown>} input @param {Ctx} ctx
 */
function project(input, ctx) {
  const loaded = loadPolicy({ cwd: ctx.cwd });
  if (!loaded.policy) {
    const why = loaded.errors.map((e) => `${e.path} ${e.message}`).join('; ');
    throw new CodedError(
      'policy',
      `the private term list needs the project's ID from a valid policy.json (${why})`,
    );
  }
  const projectId = String(loaded.policy.project.id);
  const root =
    typeof input.store === 'string'
      ? resolve(ctx.cwd, input.store)
      : privateStorePath(projectId, { env: ctx.env, repoRoot: findRepoRoot(ctx.cwd) ?? undefined });
  return { policy: loaded.policy, projectId, root, store: openStore(root) };
}

/**
 * Refuse executors, then run; a refusal about the list becomes a result with its code.
 * @param {string} name @param {(input: Record<string, unknown>, ctx: Ctx) => Result} fn
 * @returns {(input: Record<string, unknown>, ctx: Ctx) => Result}
 */
const ownerOnly = (name, fn) => (input, ctx) => {
  const why = executorSignal(ctx.env, ctx.cwd);
  if (why) {
    return {
      ok: false,
      error: 'not-permitted',
      message: `hitld ${name} is the owner's, run from the main session in the primary checkout (${why}); executors never read or change the private term list`,
    };
  }
  return coded(fn)(input, ctx);
};

/**
 * A refusal about the list becomes a result with its code.
 * @param {(input: Record<string, unknown>, ctx: Ctx) => Result} fn
 * @returns {(input: Record<string, unknown>, ctx: Ctx) => Result}
 */
const coded = (fn) => (input, ctx) => {
  try {
    return fn(input, ctx);
  } catch (e) {
    const err = /** @type {{ name?: string, code?: unknown, message: string }} */ (e);
    if (err.name === 'PrivateTermsError' && typeof err.code === 'string') {
      return { ok: false, error: err.code, message: err.message };
    }
    throw e;
  }
};

/** @param {string} term */
const masked = (term) => '*'.repeat(term.length);

/**
 * The email git uses here, for --git-email.
 * @param {string} cwd
 */
function gitEmail(cwd) {
  try {
    return execFileSync('git', ['config', '--get', 'user.email'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/** @type {import('../table.mjs').Command[]} */
export const commands = [
  {
    name: 'private add',
    summary:
      'Add a term to the private term list, in the private store: a name, a repository, a device, a host, an email address or a URL that must never reach the project repository or anything published from it. Matched without regard to case, as whole words, and URLs with or without their scheme, .git and trailing slash (owner only)',
    built_by: 'first-release',
    mcp: false,
    args: [
      {
        name: 'term',
        type: 'string',
        positional: true,
        description: 'The term, at least three characters. Quote one with spaces',
      },
      {
        name: 'kind',
        type: 'string',
        description:
          'What it is, which is what a refusal names instead of the term: store-address, repository, device, name, email, host or url. Default: url or email by its shape, else name',
      },
      {
        name: 'git-email',
        type: 'boolean',
        description:
          'Add the email address git commits with here (git config user.email), as kind email. Refused for a noreply address, which is meant to be public',
      },
      STORE,
    ],
    run: ownerOnly('private add', (input, ctx) => {
      const p = project(input, ctx);
      /** @type {string} */
      let term;
      /** @type {string | undefined} */
      let kind = typeof input.kind === 'string' ? input.kind : undefined;
      if (input['git-email'] === true) {
        if (typeof input.term === 'string') {
          return { ok: false, error: 'usage', message: 'give a term or --git-email, not both' };
        }
        term = gitEmail(ctx.cwd);
        if (!term) {
          return {
            ok: false,
            error: 'private-term-invalid',
            message: 'git has no user.email here, so there is no address to add',
          };
        }
        if (isNoreply(term)) {
          return {
            ok: false,
            error: 'private-term-invalid',
            message:
              'the address git commits with is a noreply one, which is meant to be public; nothing was added',
          };
        }
        kind = 'email';
      } else if (typeof input.term === 'string') {
        term = input.term;
      } else {
        return {
          ok: false,
          error: 'usage',
          message: 'give the term, or --git-email. Usage: hitld private add <term> [--kind <k>]',
        };
      }
      const added = addTerm(p.store, {
        term,
        kind,
        by: input['git-email'] === true ? 'git-email' : 'owner',
        now: ctx.now,
      });
      return {
        ok: true,
        id: added.id,
        kind: added.kind,
        length: term.trim().length,
        changed: added.added,
        message: added.added
          ? `added to the private term list as ${added.id}; it syncs with the store, encrypted`
          : `already on the private term list as ${added.id}`,
      };
    }),
  },
  {
    name: 'private list',
    summary:
      "The private term list: each term masked, with its ID, kind and length, and the terms implied by the store address in use here and the device names in the owner's device answers. --show shows the terms themselves (owner only)",
    built_by: 'first-release',
    mcp: false,
    args: [
      {
        name: 'show',
        type: 'boolean',
        description: "Show each term as it is, not masked. Only on the owner's own screen",
      },
      STORE,
    ],
    run: ownerOnly('private list', (input, ctx) => {
      const p = project(input, ctx);
      const show = input.show === true;
      const listed = activeTerms(readTermRecords(p.store));
      const implied = impliedTerms({ store: p.store, projectId: p.projectId, env: ctx.env });
      return {
        ok: true,
        count: listed.length,
        terms: listed.map((t) => ({
          id: t.id,
          kind: t.kind,
          length: t.term.length,
          term: show ? t.term : masked(t.term),
          added_by: t.by,
          added: t.added,
        })),
        implied: implied.terms.map((t) => ({
          kind: t.kind,
          from:
            t.source === 'address' ? 'the store address in use here' : "the owner's device answers",
          length: t.term.length,
          term: show ? t.term : masked(t.term),
        })),
        ...(implied.warnings.length ? { warnings: implied.warnings } : {}),
      };
    }),
  },
  {
    name: 'private remove',
    summary:
      'Take a term off the private term list, named by its ID (from private list) or by the term itself. A term implied by the store address or a device answer stays checked (owner only)',
    built_by: 'first-release',
    mcp: false,
    args: [
      {
        name: 'term',
        type: 'string',
        positional: true,
        required: true,
        description: "The term's ID (PT-...), or the term itself",
      },
      STORE,
    ],
    run: ownerOnly('private remove', (input, ctx) => {
      const p = project(input, ctx);
      const removed = removeTerm(p.store, { which: String(input.term), now: ctx.now });
      return {
        ok: true,
        id: removed.id,
        kind: removed.kind,
        message: `${removed.id} is off the private term list`,
      };
    }),
  },
  {
    name: 'publish check',
    summary:
      'Check text before it is posted where others read it (a pull request title and body, an issue comment, release notes) against the private term list: refused naming the kind and line of each term found, never the term. Anyone may run it',
    built_by: 'first-release',
    args: [
      {
        name: 'file',
        type: 'string',
        repeatable: true,
        description: 'A file holding the text; once per file',
      },
      {
        name: 'text',
        type: 'string',
        description: 'The text itself, or - to read it from standard input',
      },
      STORE,
    ],
    run: coded((input, ctx) => {
      const files = /** @type {string[]} */ (input.file ?? []);
      if (!files.length && typeof input.text !== 'string') {
        return {
          ok: false,
          error: 'usage',
          message:
            'give the text to check: --file <path> (once per file) or --text - (standard input)',
        };
      }
      const p = project(input, ctx);
      const t = termsForProject({
        policy: p.policy,
        env: ctx.env,
        repoRoot: findRepoRoot(ctx.cwd) ?? undefined,
        storeRoot: p.root,
      });
      /** @type {{ where: string, text: string }[]} */
      const texts = files.map((f) => ({
        where: f,
        text: readFileSync(resolve(ctx.cwd, f), 'utf8'),
      }));
      if (typeof input.text === 'string') {
        texts.push({
          where: 'text',
          text: input.text === '-' ? readFileSync(0, 'utf8') : input.text,
        });
      }
      const refused = texts.flatMap((x) =>
        findTerms(x.text, t.matchers).map((m) => ({
          where: x.where,
          line: m.line,
          column: m.column,
          kind: m.kind,
          term_id: m.id,
        })),
      );
      return {
        ok: refused.length === 0,
        checked: texts.map((x) => ({ where: x.where, lines: x.text.split('\n').length })),
        private_terms: t.matchers.length,
        refused,
        problems: refused.map((r) => matchMessage(r, r.where)),
        ...(refused.length
          ? {
              error: 'private-term',
              message: `refused: the text holds ${refused.length} private term(s) from the private term list (design part 10.3, rule 7). Write it again, referring to each by its role (for example "the store repository"), and check it again before posting`,
            }
          : {
              message: t.matchers.length
                ? 'no private term found: it may be posted'
                : 'no private term to check against: the list is empty and no store address is set here',
            }),
        ...(t.warnings.length ? { warnings: t.warnings } : {}),
      };
    }),
  },
];
