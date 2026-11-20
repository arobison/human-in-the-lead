// Closing by trailer at merge, and the consistency check on the main branch (design part 3.4,
// "Claims and closing", HITLD-49).
//
// - A commit carrying `Closes: <ID>` asks the merge to close the item: the merge queue, in queue
//   and owner mode, commits the item's `state: done` edit on top of the branch's own commits, in
//   the same merge. The edit is part of the merged work, so reverting the merge reopens the item.
// - `Refs: <ID>` links a commit to an item and never changes its state.
// - Only git's trailers are read (`%(trailers:key=...)`), never the commit's prose: "fixes" or
//   "closes" in a sentence does nothing. A value in another key (such as `Closes: #57`, for a
//   forge) is not HITLd's and is left alone; one that starts with this tracker's key but is not an
//   ID (`KEY-49.`, `key-49`, `KEY-049`) is refused, never skipped.
// - A dispatched executor's branch closes only its own item; a branch made by hand (no dispatch)
//   may close any planned or in-progress work item.
// - Through pull requests (merge.via pull-request) none of this runs: GitHub squash-merges the
//   branch, the squash message keeps no Closes: trailer, and the check below does not see one.
// - The check on the main branch lists two mismatches, as warnings: an open work item that a commit
//   on main carries in its `Work-Item:` or `Closes:` trailer, and a done work item that no commit
//   on main names in a `Work-Item:`, `Closes:` or `Refs:` trailer. A commit that reached main
//   outside the merge path (a direct push) is caught there. Nothing is fixed here; the
//   orchestrator offers the fix.

import { insidePath, readNoFollow, writeNoFollow } from './safe.mjs';
import { git, idNumber, loadWorkTree, patterns } from './tree.mjs';

/**
 * @typedef {import('./config.mjs').Layout} Layout
 * @typedef {import('./tree.mjs').Entry} Entry
 *
 * @typedef {object} Mismatch
 * @property {'open-with-commit' | 'done-without-commit'} kind
 * @property {string} item
 * @property {string} path the item file
 * @property {string} state
 * @property {string[]} commits open-with-commit: the commits on main that carry its Work-Item or
 *   Closes trailer, short, newest first; done-without-commit: none
 * @property {string} why in words, with the fix to offer
 */

/** The trailers that name an item. Closes and Work-Item say the work is done; Refs only links. */
const KEYS = ['Work-Item', 'Closes', 'Refs'];

/** @param {string} v @returns {string[]} */
const split = (v) =>
  String(v ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Commits the tracker itself writes to give up a claim: they name an item without closing it. */
const UNCLAIM = /^(unclaim|release): /;

/**
 * A commit that changes more item files than this is a bulk edit of the tracker (a format
 * migration, a reshaping of many items): not a change to any one item.
 */
export const BULK_ITEM_FILES = 5;

/**
 * The IDs a commit's subject names in the forms this project's commits use: a lead such as
 * `KEY-160: ...`, `KEY-650, 651: ...` or `KEY-571 to 573: ...`, or an end such as
 * `... (KEY-12)`, either one before a squash merge's ` (#N)`. The same end form as the touches
 * check reads (dispatch/touches.mjs). Only a reference: it never closes anything.
 * @param {string} subject @param {string} key @returns {string[]}
 */
export function subjectIds(subject, key) {
  const list = `${key}-[1-9]\\d*(?:\\s*(?:,|and|to)\\s*(?:${key}-)?[1-9]\\d*)*`;
  const s = subject.replace(/\s*\(#\d+\)\s*$/, '');
  const lead = new RegExp(`^(${list})(?::|\\s)`).exec(s);
  const end = new RegExp(`\\((${list})\\)\\s*$`).exec(s);
  const found = lead?.[1] ?? end?.[1];
  if (!found) return [];
  /** @type {string[]} */
  const out = [];
  const parts = found.split(/\s*(,|and|to)\s*/);
  let last = 0;
  let range = false;
  for (const part of parts) {
    if (part === ',' || part === 'and') continue;
    if (part === 'to') {
      range = true;
      continue;
    }
    const n = Number(part.replace(`${key}-`, ''));
    if (range && n > last && n - last <= 100) {
      for (let i = last + 1; i <= n; i++) out.push(`${key}-${i}`);
    } else out.push(`${key}-${n}`);
    range = false;
    last = n;
  }
  return out;
}

/**
 * The IDs each commit in a range names in its `Closes:` trailers, oldest commit first. A value in
 * another key is left out; one that starts with this tracker's key, in any case, but is not an ID
 * is listed under `malformed`.
 * @param {string} root @param {Layout} layout @param {string} from @param {string} to
 * @returns {{ sha: string, ids: string[], malformed: string[] }[]}
 */
export function closesIn(root, layout, from, to) {
  const { id: idPattern } = patterns(layout.key);
  const ours = new RegExp(`^${layout.key}-`, 'i');
  const log = git(root, [
    'log',
    '--reverse',
    '--format=%x1e%H%x1f%(trailers:key=Closes,valueonly,separator=%x2C)',
    `${from}..${to}`,
  ]);
  /** @type {{ sha: string, ids: string[], malformed: string[] }[]} */
  const out = [];
  for (const rec of log.split('\x1e')) {
    const [sha, values = ''] = rec.trim().split('\x1f');
    if (!sha) continue;
    const tokens = split(values);
    const ids = tokens.filter((v) => idPattern.test(v));
    const malformed = tokens.filter((v) => !idPattern.test(v) && ours.test(v));
    if (ids.length || malformed.length) out.push({ sha, ids, malformed });
  }
  return out;
}

/**
 * Close the items the branch's commits name in `Closes:` trailers: in the working tree at `root`,
 * checked out at `to` (the merge queue's worktree, on the rebased branch), commit each item's
 * `state: done` edit with the message `close: <ID>` and a `Work-Item:` trailer. An item already
 * done in the tree is left as it is. A trailer that cannot be honored is a problem, and nothing is
 * committed: a value in this tracker's key that is not an ID, an ID that names no item, an item
 * that is not a work item, one that is proposed (not yet committed to) or dropped, or, with `own`,
 * any item but that one.
 * The edit changes the `state:` line of the item file and nothing else, byte for byte.
 * @param {string} root @param {Layout} layout @param {string} from @param {string} to
 * @param {{ own?: string | null }} [options] own: the item a dispatched executor's branch was
 *   dispatched for, the only one it may close; null or absent for a branch made by hand
 * @returns {{ closed: { id: string, path: string, commit: string, by: string[] }[], problems: string[] }}
 */
export function closeByTrailer(root, layout, from, to, { own = null } = {}) {
  const asked = closesIn(root, layout, from, to);
  /** @type {string[]} */
  const problems = [];
  /** @type {Map<string, string[]>} item ID to the commits that ask, short */
  const by = new Map();
  for (const { sha, ids, malformed } of asked) {
    for (const v of malformed) {
      problems.push(
        `Closes: ${v} (${sha.slice(0, 12)}) is not an ID in this tracker (${layout.key}-<n>, no leading zero, nothing after it)`,
      );
    }
    for (const id of ids) by.set(id, [...(by.get(id) ?? []), sha.slice(0, 12)]);
  }
  if (!by.size) return { closed: [], problems };
  const items = loadWorkTree(root, layout);
  /** @type {{ id: string, entry: Entry }[]} */
  const toClose = [];
  for (const [id, commits] of by) {
    const entry = items.find((e) => e.data?.id === id);
    const where = `Closes: ${id} (${commits.join(', ')})`;
    const d = entry?.data;
    if (!entry || !d) {
      problems.push(`${where} names no item in the tracker`);
      continue;
    }
    const state = String(d.state ?? '');
    if (own && id !== own) {
      problems.push(
        `${where} names an item other than ${own}, the one this branch was dispatched for; a dispatched branch closes only its own item (use Refs: to link another)`,
      );
    } else if (d.kind !== 'work') {
      problems.push(
        `${where} names a ${d.kind}; only a work item closes by trailer (a decision is answered, a milestone done by its check)`,
      );
    } else if (state === 'done') {
      continue;
    } else if (state === 'planned' || state === 'in-progress') {
      toClose.push({ id, entry });
    } else {
      problems.push(
        `${where} names an item that is ${state}; only planned or in-progress work closes by trailer`,
      );
    }
  }
  if (problems.length) return { closed: [], problems };
  /** @type {{ id: string, path: string, commit: string, by: string[] }[]} */
  const closed = [];
  /** @type {{ id: string, entry: Entry, text: string }[]} */
  const edits = [];
  for (const { id, entry } of toClose) {
    const file = insidePath(root, entry.path);
    const text = setStateLine(readNoFollow(file), 'done');
    if (text === null) problems.push(`${id}: ${entry.path} has no state: line in its front matter`);
    else edits.push({ id, entry, text });
  }
  if (problems.length) return { closed: [], problems };
  for (const { id, entry, text } of edits) {
    const commits = /** @type {string[]} */ (by.get(id));
    writeNoFollow(insidePath(root, entry.path), text);
    git(root, [
      'commit',
      '--only',
      '--no-verify',
      '--quiet',
      '-m',
      `close: ${id}`,
      '-m',
      `Closed at merge by the Closes: trailer of ${commits.join(', ')}.`,
      '-m',
      `Work-Item: ${id}`,
      '--',
      entry.path,
    ]);
    closed.push({
      id,
      path: entry.path,
      commit: git(root, ['rev-parse', 'HEAD']).trim(),
      by: commits,
    });
  }
  return { closed, problems: [] };
}

/**
 * The text of an item file with its front matter's `state:` value replaced, every other byte as
 * it was; null when the front matter has no `state:` line.
 * @param {string} text @param {string} state @returns {string | null}
 */
export function setStateLine(text, state) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(text);
  if (!m) return null;
  const line = /^state:[ \t]*[^\r\n]*$/m;
  if (!line.test(m[2])) return null;
  const front = m[2].replace(line, `state: ${state}`);
  return `${m[1]}${front}${m[3]}${text.slice(m[0].length)}`;
}

/**
 * The two mismatches between the main branch's history and its tracker files. Read from `ref`
 * (the main branch) with three `git log` runs, whatever the number of items.
 *
 * A `Work-Item:` trailer on a commit that changes only tracker files is the tracker's own
 * bookkeeping (`hitld work publish`, a claim, an executor's close commit), not a reference to
 * work: it is left out of both kinds. `Closes:` and `Refs:` always count.
 *
 * - open-with-commit: an open work item that a commit on main names in its `Work-Item:` or
 *   `Closes:` trailer, unless the item file changed in a later commit (it was reopened, the merge
 *   was reverted, or someone recorded why it stays open). Unclaim commits are left out.
 * - done-without-commit: a done work item that no commit on main names in a `Work-Item:`,
 *   `Closes:` or `Refs:` trailer. Only an item whose file changed since the first commit on main
 *   that carries one of those trailers is checked: before it, the project did not use them (it
 *   had not adopted HITLd), so no commit could name an item. With no such commit, or in a shallow
 *   clone, whose history is incomplete, this kind is skipped, with the reason.
 * @param {string} root @param {Layout} layout @param {string} ref @param {Entry[]} items
 * @returns {{ mismatches: Mismatch[], skipped: { kind: string, why: string }[] }}
 */
export function mainMismatches(root, layout, ref, items) {
  /** @type {Mismatch[]} */
  const mismatches = [];
  /** @type {{ kind: string, why: string }[]} */
  const skipped = [];
  const format = `%x1e%H%x1f%s${KEYS.map((k) => `%x1f%(trailers:key=${k},valueonly,separator=%x2C)`).join('')}`;
  // Graph order (--topo-order), so that "later" below means later in the history, not by date.
  // It stays an approximation, which is why these are warnings: a merge commit's side branch is
  // ordered before or after the other side, not beside it, and a renamed item file counts the
  // rename as a change to it (there is no --follow here).
  const log = git(root, ['log', '--topo-order', ref, `--format=${format}`], { allowFail: true });
  /** The commits that change a file outside the work directory. */
  const beyond = new Set(
    git(root, ['log', ref, '--format=%H', '--', '.', `:(exclude)${layout.workDir}`], {
      allowFail: true,
    })
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean),
  );
  /** @type {Map<string, { sha: string, pos: number }[]>} item ID to its closing commits, newest first */
  const closing = new Map();
  /** @type {Set<string>} */
  const named = new Set();
  /** @type {Map<string, number>} commit to its place in the log, newest first */
  const position = new Map();
  let pos = 0;
  /** The place of the oldest commit that names an item in a trailer: 0 for none. */
  let firstNaming = 0;
  for (const rec of log.split('\x1e')) {
    const [sha, subject = '', workItem = '', closes = '', refs = ''] = rec.trim().split('\x1f');
    if (!sha) continue;
    position.set(sha, ++pos);
    if (UNCLAIM.test(subject)) continue;
    const workIds = beyond.has(sha) ? split(workItem) : [];
    for (const id of [...workIds, ...split(closes)]) {
      closing.set(id, [...(closing.get(id) ?? []), { sha, pos }]);
      named.add(id);
      firstNaming = pos;
    }
    for (const id of split(refs)) {
      named.add(id);
      firstNaming = pos;
    }
    // A subject that names the item, on a commit that carries work, names it too: a squash merge
    // through a pull request often keeps no Work-Item trailer.
    if (beyond.has(sha)) for (const id of subjectIds(subject, layout.key)) named.add(id);
  }
  /** @type {Map<string, number>} item file to the newest commit on main that changed it */
  const touched = new Map();
  /** The same, leaving out bulk edits (BULK_ITEM_FILES): what the cut-off of done items reads. */
  const edited = new Map();
  const itemPaths = new Set(items.map((it) => it.path));
  if (firstNaming) {
    const files = git(root, ['log', ref, '--format=%x1e%H', '--name-only', '--', layout.workDir], {
      allowFail: true,
    });
    for (const rec of files.split('\x1e')) {
      const [sha, ...paths] = rec.trim().split('\n');
      const at = position.get(sha?.trim() ?? '');
      if (at === undefined) continue;
      const changed = paths.map((x) => x.trim()).filter(Boolean);
      const bulk = changed.filter((x) => itemPaths.has(x)).length > BULK_ITEM_FILES;
      for (const path of changed) {
        if (!touched.has(path)) touched.set(path, at);
        if (!bulk && !edited.has(path)) edited.set(path, at);
      }
    }
  }
  const shallow =
    git(root, ['rev-parse', '--is-shallow-repository'], { allowFail: true }).trim() === 'true';
  if (shallow) {
    skipped.push({
      kind: 'done-without-commit',
      why: 'this clone is shallow, so the commits that name each done item may not be here; fetch the full history (git fetch --unshallow) to check it',
    });
  } else if (!firstNaming) {
    skipped.push({
      kind: 'done-without-commit',
      why: `no commit on ${layout.mainBranch} names an item in a Work-Item, Closes or Refs trailer yet, so no done item could have one`,
    });
  }
  const checkDone = !shallow && firstNaming > 0;
  const work = items
    .filter((it) => it.data?.kind === 'work')
    .sort((a, b) => idNumber(String(a.data?.id)) - idNumber(String(b.data?.id)));
  for (const it of work) {
    const d = /** @type {NonNullable<Entry['data']>} */ (it.data);
    const id = String(d.id);
    const state = String(d.state ?? '');
    if (state === 'planned' || state === 'in-progress' || state === 'proposed') {
      const commits = closing.get(id) ?? [];
      if (!commits.length) continue;
      const newest = commits[0].pos;
      const changed = touched.get(it.path);
      // A later commit changed the item file: the item was looked at since, and stays as it says.
      if (changed !== undefined && changed < newest) continue;
      const shas = commits.map((c) => c.sha.slice(0, 12));
      mismatches.push({
        kind: 'open-with-commit',
        item: id,
        path: it.path,
        state,
        commits: shas,
        why: `${id} is ${state}, but ${shas.length === 1 ? `${shas[0]} on ${layout.mainBranch} carries` : `${shas.length} commits on ${layout.mainBranch} (${shas.slice(0, 3).join(', ')}${shas.length > 3 ? ', ...' : ''}) carry`} its Work-Item or Closes trailer: close it if the work is done, or note in the item why it stays open`,
      });
    } else if (state === 'done' && checkDone && !named.has(id) && d.release === undefined) {
      // A release item is done when its release is published: the release check owns it.
      const changed = edited.get(it.path);
      // Unchanged since before the first commit that names an item: from before the trailers.
      if (changed === undefined || changed > firstNaming) continue;
      mismatches.push({
        kind: 'done-without-commit',
        item: id,
        path: it.path,
        state,
        commits: [],
        why: `${id} is done, but no commit on ${layout.mainBranch} names it in a Work-Item, Closes or Refs trailer: confirm the work with a commit carrying Refs: ${id}, or reopen it`,
      });
    }
  }
  return { mismatches, skipped };
}
