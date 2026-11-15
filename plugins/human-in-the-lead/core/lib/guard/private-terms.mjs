// Matching private terms in text (design part 10.3, rule 7): names that never reach a public
// repository or anything published from it, such as the private store's address, its
// repository's name and its devices' names. The list itself lives in the private store
// (core/lib/store/private-terms.mjs); this module only matches, and imports nothing of hitld's.
//
//   a URL      a store address, a link: matched with or without its scheme, user, port, ".git"
//              and trailing slash, so https://host/owner/repo.git, git@host:owner/repo and
//              host/owner/repo/ are the same term
//   a word     anything else (a name, owner/name, a host, an email address): matched without
//              regard to case, as whole words; a run of spaces in the term matches any run
//
// A match is reported by the term's kind and where it was found, never by the term: whatever
// reports it may end up in a log, a pull request or an executor's report.
//
// Beside it, the one check CI can make without the list: email addresses that are not noreply
// ones (findEmails).

/** The kinds a term may have. The kind is what a refusal names instead of the term. */
export const KINDS = Object.freeze([
  'store-address',
  'repository',
  'device',
  'name',
  'email',
  'host',
  'url',
]);

/** How a refusal tells the writer to refer to a term of each kind. */
export const ROLES = Object.freeze({
  'store-address': 'the store repository',
  repository: 'the store repository',
  device: 'a device, by its role (for example "the owner\'s main machine")',
  name: 'its role',
  email: "the person's role, or a noreply address",
  host: 'its role (for example "the store\'s host")',
  url: 'its role, without the link',
});

/** The shortest term the list takes: a shorter one would match nearly everything. */
export const MIN_LENGTH = 3;
export const MAX_LENGTH = 512;

/**
 * @typedef {'list' | 'address' | 'device'} TermSource where a term comes from: the owner's list,
 *   the store address in use here, or the device names in the owner's device answers
 * @typedef {{ term: string, kind: string, id?: string | null, source?: TermSource }} Term
 * @typedef {{ kind: string, id: string | null, source: TermSource, re: RegExp }} Matcher
 * @typedef {{ line: number, column: number, kind: string, id: string | null, source: TermSource }} Match
 */

/** @param {string} s */
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/**
 * Whether a term is matched as a URL: it has a scheme, it is git's user@host:path form, it is an
 * absolute path, or it is a host name followed by a path.
 * @param {string} term
 */
export function isUrlShaped(term) {
  const t = term.trim();
  return (
    /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(t) ||
    /^[^\s/@:]+@[^\s/:]+:\S+$/.test(t) ||
    /^\/\S+$/.test(t) ||
    /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?\/\S+$/i.test(t)
  );
}

/**
 * A URL with its scheme, user, port, query, ".git" and trailing slashes taken off, in lower case:
 * host/path, or an absolute path for a local repository.
 * @param {string} url
 */
export function urlCore(url) {
  let t = url.trim();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(t);
  if (scheme) t = t.slice(scheme[0].length);
  if (!t.startsWith('/')) {
    t = t.replace(/^[^@/\s]*@/, '');
    const scp = /^([^/:]+):(?!\d+(?:\/|$))(.+)$/.exec(t);
    t = scp ? `${scp[1]}/${scp[2].replace(/^\/+/, '')}` : t.replace(/^([^/:]+):\d+(?=\/|$)/, '$1');
  }
  t = t.replace(/[?#].*$/, '');
  t = t
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  return t.toLowerCase();
}

/**
 * The key two spellings of one term share, so the list holds each term once.
 * @param {string} term
 */
export const termKey = (term) =>
  isUrlShaped(term)
    ? `url:${urlCore(term)}`
    : `word:${term.trim().toLowerCase().replace(/\s+/g, ' ')}`;

/**
 * Why a term cannot go on the list, or null.
 * @param {unknown} term @param {unknown} [kind]
 * @returns {string | null}
 */
export function termProblem(term, kind) {
  if (typeof term !== 'string') return 'a term is text';
  const t = term.trim();
  if (/[\u0000-\u001f\u007f]/.test(t)) return 'a term is one line, with no control characters';
  if (t.length < MIN_LENGTH) {
    return `a term has at least ${MIN_LENGTH} characters; a shorter one would match nearly everything`;
  }
  if (t.length > MAX_LENGTH) return `a term has at most ${MAX_LENGTH} characters`;
  if (isUrlShaped(t) && urlCore(t).replace(/^\/+/, '').length < MIN_LENGTH) {
    return 'the address has no host or path to match';
  }
  if (kind !== undefined && !KINDS.includes(String(kind))) {
    return `the kind is one of ${KINDS.join(', ')}`;
  }
  return null;
}

/**
 * The kind a term is given when none is named: url or email by its shape, else name.
 * @param {string} term
 */
export function guessKind(term) {
  const t = term.trim();
  if (isUrlShaped(t)) return 'url';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'email';
  return 'name';
}

/**
 * The regular expression that finds a term.
 * @param {string} term
 */
export function termPattern(term) {
  const t = term.trim();
  if (isUrlShaped(t)) {
    const core = urlCore(t);
    let body;
    if (core.startsWith('/')) {
      body = escape(core);
    } else {
      const slash = core.indexOf('/');
      const host = slash < 0 ? core : core.slice(0, slash);
      const path = slash < 0 ? '' : core.slice(slash + 1);
      body = `${escape(host)}(?::\\d+)?${path ? `[/:]/*${escape(path)}` : ''}`;
    }
    // Not part of a longer host or name before it; ".git" may follow, and then not a longer name.
    return new RegExp(`(?<![\\w.-])${body}(?:\\.git)?(?![\\w-])(?!\\.[a-z0-9])`, 'giu');
  }
  const words = t.split(/\s+/).map(escape).join('\\s+');
  return new RegExp(`(?<![\\p{L}\\p{N}_])${words}(?![\\p{L}\\p{N}_])`, 'giu');
}

/**
 * Matchers for a list of terms. A term that is not valid is left out: the list refuses it on the
 * way in, and an address is checked where it is read.
 * @param {Term[]} terms
 * @returns {Matcher[]}
 */
export function compileTerms(terms) {
  /** @type {Map<string, Matcher>} */
  const out = new Map();
  for (const t of terms) {
    if (termProblem(t.term) !== null) continue;
    const key = termKey(t.term);
    if (out.has(key)) continue;
    out.set(key, {
      kind: KINDS.includes(t.kind) ? t.kind : 'name',
      id: t.id ?? null,
      source: t.source ?? 'list',
      re: termPattern(t.term),
    });
  }
  return [...out.values()];
}

/**
 * The line (from 1) and column (from 1) of an offset in a text.
 * @param {string} text @param {number} index
 */
function position(text, index) {
  let line = 1;
  let start = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < index; i = text.indexOf('\n', i + 1)) {
    line++;
    start = i + 1;
  }
  return { line, column: index - start + 1 };
}

/**
 * Where the terms occur in a text, in order, at most `limit` of them. Nothing about the term but
 * its kind and the list entry's ID comes back.
 * @param {string} text @param {Matcher[]} matchers @param {{ limit?: number }} [o]
 * @returns {Match[]}
 */
export function findTerms(text, matchers, o = {}) {
  const limit = o.limit ?? 20;
  /** @type {{ index: number, end: number, m: Matcher }[]} */
  const hits = [];
  for (const m of matchers) {
    m.re.lastIndex = 0;
    let n = 0;
    for (const found of text.matchAll(m.re)) {
      const index = found.index ?? 0;
      hits.push({ index, end: index + found[0].length, m });
      if (++n > limit) break;
    }
  }
  // One place, one match: where terms overlap (an address and its owner/name), the longest one
  // that starts first is reported.
  hits.sort((a, b) => a.index - b.index || b.end - a.end);
  /** @type {typeof hits} */
  const kept = [];
  for (const h of hits) {
    if (kept.length && h.index < /** @type {(typeof hits)[number]} */ (kept.at(-1)).end) continue;
    kept.push(h);
  }
  return kept.slice(0, limit).map(({ index, m }) => ({
    ...position(text, index),
    kind: m.kind,
    id: m.id,
    source: m.source,
  }));
}

/**
 * What a refusal says about one match: the kind, the place, and how to refer to it instead.
 * @param {Pick<Match, 'kind' | 'line'>} match @param {string} [where] the file or field
 */
export function matchMessage(match, where) {
  const role = /** @type {Record<string, string>} */ (ROLES)[match.kind] ?? 'its role';
  return `${where ? `${where}, ` : ''}line ${match.line}: holds a private ${match.kind} from the private term list; refer to it as ${role}, never by name`;
}

/**
 * The terms a store address gives: the address itself, the repository's path on its host
 * (owner/name) and, unless `pathOnly`, the repository's name alone. A local path gives only itself.
 * @param {string} url @param {{ pathOnly?: boolean }} [o]
 * @returns {Term[]}
 */
export function addressTerms(url, o = {}) {
  /** @type {Term[]} */
  const out = [{ term: url.trim(), kind: 'store-address' }];
  const core = urlCore(url);
  if (core.startsWith('/')) return out;
  const path = core.split('/').slice(1).join('/');
  if (path.includes('/')) out.push({ term: path, kind: 'repository' });
  const name = path.split('/').at(-1);
  if (!o.pathOnly && name && name !== path) out.push({ term: name, kind: 'repository' });
  return out.filter((t) => termProblem(t.term) === null);
}

/**
 * The text of a commit message as it will be recorded: comment lines and, after a scissors line
 * (git commit -v), the diff are taken out.
 * @param {string} raw @param {string} [commentChar] git's core.commentChar; "#" by default
 */
export function commitMessageText(raw, commentChar = '#') {
  const lines = raw.split(/\r?\n/);
  const c = commentChar.length === 1 ? commentChar : '#';
  const scissors = lines.findIndex((l) => /^.\s-+\s>8\s-+$/.test(l) && l.startsWith(c));
  return (scissors >= 0 ? lines.slice(0, scissors) : lines)
    .map((l) => (l.startsWith(c) ? '' : l))
    .join('\n');
}

// Email addresses. CI has no list, but it can tell a person's address from a noreply one.

/** File extensions that look like top-level domains in code ("@AGENTS.md", "a@b.json"). */
const FILE_TLDS = new Set(
  'md json jsonl mjs cjs js ts tsx jsx txt yml yaml html css png svg sh py toml lock log'.split(
    ' ',
  ),
);

const EMAIL =
  /(?<![\w.%+\\:/-])([a-z0-9][a-z0-9._%+-]*)@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.([a-z]{2,24}))(?![\w-])/giu;

/**
 * Whether an address is a noreply one: a no-reply local part, or a noreply domain such as a
 * forge's users.noreply.<host>.
 * @param {string} email
 */
export function isNoreply(email) {
  const [local, domain = ''] = email.toLowerCase().split('@');
  return /(^|[.+_-])no-?reply([.+_-]|$)/.test(local) || /(^|\.)no-?reply(\.|$)/.test(domain.trim());
}

/**
 * Whether an address is on a domain reserved for examples (RFC 2606 and 6761).
 * @param {string} email
 */
export function isPlaceholder(email) {
  const domain = (email.split('@')[1] ?? '').toLowerCase();
  return (
    /(^|\.)example\.(com|org|net)$/.test(domain) ||
    /\.(example|invalid|test|localhost)$/.test(domain) ||
    domain === 'localhost'
  );
}

/**
 * The email addresses in a text that are neither noreply ones nor placeholders, by line. The
 * address itself is in the result for the caller to mask; CI prints only where it is.
 * @param {string} text
 * @returns {{ line: number, column: number, email: string }[]}
 */
export function findEmails(text) {
  const t = text.replace(/\bmailto:/gi, 'mailto ');
  /** @type {{ line: number, column: number, email: string }[]} */
  const out = [];
  for (const m of t.matchAll(EMAIL)) {
    const [email, local, , tld] = m;
    if (local.toLowerCase() === 'git') continue; // the ssh user of a git host
    if (FILE_TLDS.has(tld.toLowerCase())) continue;
    if (isNoreply(email) || isPlaceholder(email)) continue;
    out.push({ ...position(t, m.index ?? 0), email });
  }
  return out;
}
