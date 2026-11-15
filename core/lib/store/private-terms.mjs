// The private term list (design part 10.3, rule 7): the names that never reach the project's
// repository or anything published from it. It lives in the private store, at TERMS_KEY, so it
// syncs with the store, encrypted, to every device the owner approved; it is never in the
// project's repository, and no command prints a term unless the owner asks (`hitld private list
// --show`).
//
//   the list     an append-only file: each line adds a term or removes one, so copies on two
//                devices merge line by line (git.mjs). `hitld store remote set` adds the store's
//                address and its repository's name, `hitld store device init` the device's name,
//                and `hitld private add | remove` the owner's own terms
//   implied      the store address in use on this machine (HITLD_STORE_REMOTE, the person file or
//                this machine's override) and the device names in the owner's device answers
//                count too, though no command added them: a cloud environment's address arrives in
//                a variable, and another device's name arrives in its request
//
// A line that does not read is not skipped: the list fails closed, and every check refuses until
// the file is fixed, because a skipped line would let its term through.

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { openStore, privateStorePath } from './store.mjs';
import { readApprovals } from './devices.mjs';
import { chooseRemote } from './address.mjs';
import {
  KINDS,
  addressTerms,
  compileTerms,
  guessKind,
  termKey,
  termProblem,
} from '../guard/private-terms.mjs';

/** Where the list lives in the private store. */
export const TERMS_KEY = 'private/terms.jsonl';

/**
 * A refusal about the list. Lowercase kebab-case:
 *   private-term-invalid   a term or kind the list does not take
 *   private-term-unknown   no term on the list is that one
 *   private-list-invalid   a line of the list does not read
 */
export class PrivateTermsError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'PrivateTermsError';
    this.code = code;
  }
}

/**
 * @typedef {'owner' | 'store-remote' | 'store-device' | 'git-email'} AddedBy which command added it
 * @typedef {{ schema_version: 1, id: string, at: string, event: 'added', term: string, kind: string, by: AddedBy }} Added
 * @typedef {{ schema_version: 1, id: string, at: string, event: 'removed', term_id: string }} Removed
 * @typedef {Added | Removed} TermRecord
 * @typedef {{ id: string, term: string, kind: string, by: AddedBy, added: string, also: string[] }} ListedTerm
 *   also: the IDs of the same term added again, on another device
 * @typedef {import('../guard/private-terms.mjs').Term} Term
 */

/** @param {import('./store.mjs').PrivateStore} store */
const fileOf = (store) => join(store.root, ...TERMS_KEY.split('/'));

/**
 * Every line of the list, oldest first.
 * @param {import('./store.mjs').PrivateStore} store
 * @returns {TermRecord[]}
 */
export function readTermRecords(store) {
  const text = store.read(TERMS_KEY) ?? '';
  /** @type {TermRecord[]} */
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    /** @type {any} */
    let r = null;
    try {
      r = JSON.parse(lines[i]);
    } catch {
      r = null;
    }
    const ok =
      r &&
      r.schema_version === 1 &&
      typeof r.id === 'string' &&
      typeof r.at === 'string' &&
      !Number.isNaN(Date.parse(r.at)) &&
      ((r.event === 'added' && typeof r.term === 'string' && KINDS.includes(r.kind)) ||
        (r.event === 'removed' && typeof r.term_id === 'string'));
    if (!ok) {
      throw new PrivateTermsError(
        'private-list-invalid',
        `line ${i + 1} of the private term list (${fileOf(store)}) does not read; nothing is checked against a list with a line missing, so fix or remove that line`,
      );
    }
    out.push(r);
  }
  // Lines from two devices merge in either order; the time orders them.
  return out
    .map((r, i) => ({ r, i }))
    .sort((a, b) => Date.parse(a.r.at) - Date.parse(b.r.at) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * The terms on the list now: every one added and not removed since.
 * @param {TermRecord[]} records
 * @returns {ListedTerm[]}
 */
export function activeTerms(records) {
  /** @type {Map<string, Added>} */
  const on = new Map();
  for (const r of records) {
    if (r.event === 'added') on.set(r.id, r);
    else on.delete(r.term_id);
  }
  // Two devices that add the same term each write a line: the list shows it once, under the ID
  // added first, and removing it removes every line.
  /** @type {Map<string, ListedTerm>} */
  const byKey = new Map();
  for (const r of on.values()) {
    const key = termKey(r.term);
    const there = byKey.get(key);
    if (there) there.also.push(r.id);
    else byKey.set(key, { id: r.id, term: r.term, kind: r.kind, by: r.by, added: r.at, also: [] });
  }
  return [...byKey.values()];
}

/** @param {() => Date} [now] */
const stamp = (now) => (now ?? (() => new Date()))().toISOString();
const newId = () => `PT-${randomBytes(6).toString('hex')}`;

/**
 * Add a term. A term already on the list (in any spelling that matches the same) is left as it is.
 * @param {import('./store.mjs').PrivateStore} store
 * @param {{ term: string, kind?: string, by?: AddedBy, now?: () => Date }} o
 * @returns {{ id: string, kind: string, added: boolean }}
 */
export function addTerm(store, o) {
  const term = typeof o.term === 'string' ? o.term.trim() : o.term;
  const problem = termProblem(term, o.kind);
  if (problem) throw new PrivateTermsError('private-term-invalid', problem);
  const t = /** @type {string} */ (term);
  const kind = o.kind ?? guessKind(t);
  const key = termKey(t);
  const there = activeTerms(readTermRecords(store)).find((x) => termKey(x.term) === key);
  if (there) return { id: there.id, kind: there.kind, added: false };
  /** @type {Added} */
  const record = {
    schema_version: 1,
    id: newId(),
    at: stamp(o.now),
    event: 'added',
    term: t,
    kind,
    by: o.by ?? 'owner',
  };
  store.append(TERMS_KEY, `${JSON.stringify(record)}\n`);
  return { id: record.id, kind, added: true };
}

/**
 * Remove a term, named by its ID or by the term itself (any spelling that matches the same).
 * @param {import('./store.mjs').PrivateStore} store
 * @param {{ which: string, now?: () => Date }} o
 * @returns {{ id: string, kind: string }}
 */
export function removeTerm(store, o) {
  const which = String(o.which ?? '').trim();
  const on = activeTerms(readTermRecords(store));
  const found =
    on.find((x) => x.id === which || x.also.includes(which)) ??
    (termProblem(which) === null ? on.find((x) => termKey(x.term) === termKey(which)) : undefined);
  if (!found) {
    throw new PrivateTermsError(
      'private-term-unknown',
      'no term on the private term list is that one; hitld private list shows each term with its ID',
    );
  }
  const at = stamp(o.now);
  /** @type {Removed[]} */
  const records = [found.id, ...found.also].map((id) => ({
    schema_version: 1,
    id: newId(),
    at,
    event: 'removed',
    term_id: id,
  }));
  store.append(TERMS_KEY, records.map((r) => `${JSON.stringify(r)}\n`).join(''));
  return { id: found.id, kind: found.kind };
}

/**
 * Add the terms a store address gives: the address, the repository's owner/name and its name.
 * @param {import('./store.mjs').PrivateStore} store @param {string} url @param {() => Date} [now]
 * @returns {{ kind: string, id: string, added: boolean }[]}
 */
export const recordAddress = (store, url, now) =>
  addressTerms(url).map((t) => addTerm(store, { ...t, by: 'store-remote', now }));

/**
 * Add a device's name.
 * @param {import('./store.mjs').PrivateStore} store @param {string} name @param {() => Date} [now]
 * @returns {{ kind: string, id: string, added: boolean }[]}
 */
export const recordDevice = (store, name, now) =>
  termProblem(name) === null
    ? [addTerm(store, { term: name, kind: 'device', by: 'store-device', now })]
    : [];

/**
 * The terms that count without being on the list: the store address in use here (with its
 * repository's owner/name), and the device names in the owner's device answers. One that cannot be
 * read gives a warning, not a refusal: the list itself is what the owner keeps.
 * @param {{ store: import('./store.mjs').PrivateStore, projectId: string, env: NodeJS.ProcessEnv }} o
 * @returns {{ terms: Term[], warnings: string[] }}
 */
export function impliedTerms(o) {
  /** @type {Term[]} */
  const terms = [];
  /** @type {string[]} */
  const warnings = [];
  try {
    const address = chooseRemote({ store: o.store.root, projectId: o.projectId, env: o.env });
    if (address) {
      for (const t of addressTerms(address.url, { pathOnly: true })) {
        terms.push({ ...t, source: 'address' });
      }
    }
  } catch (e) {
    warnings.push(
      `the store address could not be read, so it is not checked for: ${/** @type {Error} */ (e).message}`,
    );
  }
  const names = new Set(readApprovals(o.store).map((r) => r.name));
  for (const name of names) {
    if (termProblem(name) === null) terms.push({ term: name, kind: 'device', source: 'device' });
  }
  return { terms, warnings };
}

/**
 * Every term to check text against: the list, and what is implied. Throws PrivateTermsError when
 * the list does not read.
 * @param {{ store: import('./store.mjs').PrivateStore, projectId: string, env: NodeJS.ProcessEnv }} o
 */
export function loadTerms(o) {
  const listed = activeTerms(readTermRecords(o.store));
  const implied = impliedTerms(o);
  /** @type {Term[]} */
  const terms = [
    ...listed.map((t) => ({
      term: t.term,
      kind: t.kind,
      id: t.id,
      source: /** @type {const} */ ('list'),
    })),
    ...implied.terms,
  ];
  return {
    terms,
    matchers: compileTerms(terms),
    listed: listed.length,
    implied: implied.terms.length,
    warnings: implied.warnings,
  };
}

/**
 * The terms for a project, from its policy's project ID: the store at its default place, or at
 * `storeRoot` when given. No project ID, no store and so no terms, with a warning.
 * @param {{ policy: Record<string, any> | null, env: NodeJS.ProcessEnv, repoRoot?: string, storeRoot?: string }} o
 */
export function termsForProject(o) {
  const projectId = o.policy?.project?.id;
  if (typeof projectId !== 'string' && !o.storeRoot) {
    return {
      terms: [],
      matchers: [],
      listed: 0,
      implied: 0,
      warnings: ['no project ID, so no private store and no private term list to check against'],
    };
  }
  const root =
    o.storeRoot ??
    privateStorePath(String(projectId), { env: o.env, repoRoot: o.repoRoot ?? undefined });
  return loadTerms({ store: openStore(root), projectId: String(projectId ?? ''), env: o.env });
}
