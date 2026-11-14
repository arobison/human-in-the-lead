// The front-matter reader and writer for the files backend (design part 3.4, "File format").
//
// The front matter is data only: `key: value` lines, inline lists `[A-1, A-2]` and block lists
// (`- A-1` lines under a key). It is a small subset of YAML read by this module alone, which
// refuses anchors, aliases, tags, block strings and maps. Nothing read from a file is executed,
// evaluated or imported. The format is the reference format, unchanged, so existing files read and
// write without conversion (design part 16.7).

/**
 * @typedef {Record<string, string | string[]>} Data parsed front matter: strings and lists of strings
 * @typedef {{ data: Data | null, body: string, errors: string[] }} Parsed
 */

/**
 * Split an item file into front matter data and body. `data` is null when there is no front
 * matter. Problems are returned in `errors`, never thrown, so a check can report them all.
 * @param {string} text
 * @returns {Parsed}
 */
export function parseItem(text) {
  /** @type {string[]} */
  const errors = [];
  const normalized = text.replace(/\r\n/g, '\n');
  const m = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!m) return { data: null, body: normalized, errors: ['no frontmatter'] };
  /** @type {Data} */
  const data = {};
  /** @type {string | null} */
  let listKey = null;
  for (const [n, line] of m[1].split('\n').entries()) {
    const at = `frontmatter line ${n + 2}`;
    if (line.trim() === '') continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item) {
      if (!listKey) errors.push(`${at}: a list entry with no key above it`);
      else /** @type {string[]} */ (data[listKey]).push(scalar(item[1], at, errors));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
    if (!kv) {
      errors.push(`${at}: not "key: value"`);
      listKey = null;
      continue;
    }
    const [, key, raw = ''] = kv;
    if (Object.hasOwn(data, key)) errors.push(`${at}: "${key}" appears twice`);
    listKey = null;
    const v = raw.trim();
    if (v === '') {
      setOwn(data, key, []);
      listKey = key;
    } else if (v.startsWith('[')) {
      if (!v.endsWith(']')) errors.push(`${at}: an inline list must end on its line`);
      setOwn(
        data,
        key,
        splitList(v.slice(1, -1))
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => scalar(s, at, errors)),
      );
    } else {
      setOwn(data, key, scalar(v, at, errors));
    }
  }
  return { data, body: normalized.slice(m[0].length), errors };
}

/**
 * Set an own data property, even for a key such as "__proto__", so a hostile file cannot
 * touch the prototype; the key is then refused as unknown by the checks.
 * @param {Data} data @param {string} key @param {string | string[]} value
 */
function setOwn(data, key, value) {
  Object.defineProperty(data, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Split an inline list on commas that are not inside double quotes. @param {string} s */
function splitList(s) {
  /** @type {string[]} */
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && quoted) {
      cur += c + (s[++i] ?? '');
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (c === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** @param {string} raw @param {string} at @param {string[]} errors */
function scalar(raw, at, errors) {
  const s = raw.trim();
  if (/^".*"$/.test(s)) {
    try {
      return /** @type {string} */ (JSON.parse(s)); // double quotes: JSON escapes, as renderItem writes
    } catch {
      errors.push(`${at}: a double-quoted value with a bad escape`);
      return s.slice(1, -1);
    }
  }
  const single = s.match(/^'(.*)'$/);
  if (single) return single[1].replace(/''/g, "'");
  if (/^[|>&*!{]/.test(s)) {
    errors.push(
      `${at}: "${s.slice(0, 20)}" uses YAML this format doesn't allow (block strings, anchors, aliases, tags or maps)`,
    );
  }
  return s;
}

/**
 * Write front matter in the given key order (keys not in it follow, in their own order), then
 * the body. Empty values are left out. Quoting follows Prettier's choice, so a formatted file
 * and a written one agree.
 * @param {Record<string, unknown>} data
 * @param {string[]} order
 * @param {string} [body]
 */
export function renderItem(data, order, body = '') {
  const keys = [...new Set([...order, ...Object.keys(data)])];
  const lines = ['---'];
  for (const key of keys) {
    const v = data[key];
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length) lines.push(`${key}: [${v.map(listMember).join(', ')}]`);
    } else {
      const s = String(v);
      lines.push(`${key}: ${needsQuotes(s) ? quote(s) : s}`);
    }
  }
  lines.push('---', '');
  return `${lines.join('\n')}${body.replace(/^\n+/, '\n')}`;
}

/** @param {unknown} m */
function listMember(m) {
  const s = String(m);
  return needsQuotes(s) || s.includes(',') || s.includes(']') ? quote(s) : s;
}

/** @param {string} v */
function quote(v) {
  const doubles = (v.match(/"/g) ?? []).length;
  const singles = (v.match(/'/g) ?? []).length;
  return doubles > singles ? `'${v.replace(/'/g, "''")}'` : JSON.stringify(v);
}

/** @param {string} v */
function needsQuotes(v) {
  return /^[\s|>&*!{["'#]|: |\s#|\s$/.test(v);
}

/**
 * A file-name slug from a title: lower case, ASCII, at most 48 characters.
 * @param {string} title
 */
export function slugify(title) {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = slug.slice(0, 48);
  return (cut.length < slug.length ? cut.replace(/-[^-]*$/, '') : cut) || 'item';
}
