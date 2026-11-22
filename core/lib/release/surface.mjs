// The public interface surface of a checkout (design part 16.5), as plain data, so two versions
// can be compared and the release bump proposed from the difference alone (part 3.0, principle
// 10). The surface holds:
//
//   schemas   every schemas/**/*.schema.json: its fields by path, each field's type, whether it
//             is required, and its allowed values
//   cli       every built `hitld` command: its arguments and, where a command declares them, the
//             top-level fields of the JSON it prints (`output` in the command table)
//   report    the keys of the executor's report shape, from the contract template
//   trailers  the commit trailers the contract template names
//   contract  a hash of the rest of the contract template's text
//   read_api  the tracker read API's api_version
//
// A part a checkout does not have is empty, so a repository with none of these files has an empty
// surface, and every change to it is internal.
//
// `node core/bin/surface.mjs` prints or writes the surface file (`npm run surface`).
//
// HITLD's own release package, main, measures its interface from a committed surface file
// (HITLD-755): `npm run surface` writes it from this surface, one line per element
// (surfaceLines), and `release propose` diffs that file between releases.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The version of the surface's own shape. */
export const SURFACE_VERSION = 1;

/**
 * Paths whose changes can change the public interface: a commit that touches one is a candidate
 * for a changelog line (release/propose.mjs).
 */
export const SURFACE_PATHS = [
  'schemas/',
  'templates/AGENTS.contract.md',
  'core/lib/cli/',
  'core/lib/contract/report.mjs',
  'core/lib/tracker/files/api.mjs',
  'core/lib/tracker/interface.mjs',
  'core/harness/interface.mjs',
];

/**
 * @typedef {{ type: string, required: boolean, values?: string[] }} FieldShape
 * @typedef {{ version: number | null, fields: Record<string, FieldShape> }} SchemaShape
 * @typedef {{ type: string, required: boolean, positional: boolean }} ArgShape
 * @typedef {{ args: Record<string, ArgShape>, aliases: string[], output?: string[] }} CommandShape
 * @typedef {object} Surface
 * @property {number} surface_version
 * @property {Record<string, SchemaShape>} schemas
 * @property {Record<string, CommandShape>} cli
 * @property {string[]} report
 * @property {string[]} trailers
 * @property {string | null} contract
 * @property {number | null} read_api
 */

/** @param {any} s @returns {string} */
function typeOf(s) {
  if (!s || typeof s !== 'object') return 'any';
  if (s.$ref) return `ref:${s.$ref}`;
  if (s.const !== undefined) return `const:${JSON.stringify(s.const)}`;
  if (s.enum) return 'enum';
  if (s.anyOf) return `anyOf:${s.anyOf.map(typeOf).join('|')}`;
  if (s.type === 'array') return `array<${typeOf(s.items)}>`;
  return String(s.type ?? 'any');
}

/**
 * Every field of a schema by path: `a`, `a.b`, `a[].b`, and `$defs.x...` for definitions.
 * @param {any} schema @returns {Record<string, FieldShape>}
 */
export function schemaFields(schema) {
  /** @type {Record<string, FieldShape>} */
  const out = {};
  /** @param {any} s @param {string} at @param {number} depth */
  const walk = (s, at, depth) => {
    if (!s || typeof s !== 'object' || depth > 12) return;
    const required = new Set(s.required ?? []);
    for (const [k, sub] of Object.entries(s.properties ?? {})) {
      const path = at ? `${at}.${k}` : k;
      const sh = /** @type {any} */ (sub);
      out[path] = {
        type: typeOf(sh),
        required: required.has(k),
        ...(sh.enum ? { values: sh.enum.map(String) } : {}),
      };
      walk(sh, path, depth + 1);
      if (sh.items) walk(sh.items, `${path}[]`, depth + 1);
    }
    for (const [i, sub] of (s.anyOf ?? []).entries()) walk(sub, `${at}|${i}`, depth + 1);
  };
  walk(schema, '', 0);
  for (const [k, def] of Object.entries(schema.$defs ?? {})) {
    const d = /** @type {any} */ (def);
    out[`$defs.${k}`] = {
      type: typeOf(d),
      required: false,
      ...(d.enum ? { values: d.enum.map(String) } : {}),
    };
    walk(d, `$defs.${k}`, 1);
    if (d.items) walk(d.items, `$defs.${k}[]`, 1);
  }
  return out;
}

/** @param {string} dir */
function schemaFiles(dir) {
  const base = join(dir, 'schemas');
  if (!existsSync(base)) return [];
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const visit = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) visit(p);
      else if (e.isFile() && e.name.endsWith('.schema.json')) out.push(p);
    }
  };
  visit(base);
  return out.sort();
}

/**
 * The contract template's report keys, trailer names and a hash of the rest. The report fence may
 * name a language (`text`, for markdownlint MD040; HITLD-256).
 * @param {string} text
 */
export function contractShape(text) {
  const fence = /```[a-z]*\n([\s\S]*?)\n```/.exec(text);
  const report = fence ? [...fence[1].matchAll(/^([a-z_]+):/gm)].map((m) => m[1]) : [];
  const line = /^Commit trailers:.*$/m.exec(text)?.[0] ?? '';
  const trailers = [...line.matchAll(/`([A-Za-z-]+):`/g)].map((m) => m[1]);
  const rest = text
    .replace(fence?.[0] ?? '', '')
    .replace(line, '')
    .replace(/v\{\{VERSION\}\}/g, '');
  return {
    report,
    trailers,
    contract: createHash('sha256').update(rest, 'utf8').digest('hex'),
  };
}

/**
 * The surface of a checkout.
 * @param {string} dir the checkout's root
 * @returns {Promise<Surface>}
 */
export async function surfaceOf(dir) {
  /** @type {Record<string, SchemaShape>} */
  const schemas = {};
  for (const file of schemaFiles(dir)) {
    /** @type {any} */
    let s;
    try {
      s = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    const id = String(s.$id ?? relative(join(dir, 'schemas'), file));
    schemas[id] = {
      version: typeof s['x-hitld-schema-version'] === 'number' ? s['x-hitld-schema-version'] : null,
      fields: schemaFields(s),
    };
  }
  /** @type {Record<string, CommandShape>} */
  const cli = {};
  const table = join(dir, 'core/lib/cli/table.mjs');
  if (existsSync(table)) {
    // Trust boundary: this runs the command table of the checkout being released (this
    // repository, or a release of it extracted from its own git history), never outside code.
    const mod = await import(pathToFileURL(table).href);
    for (const c of /** @type {any[]} */ (mod.COMMANDS ?? [])) {
      if (!c.run) continue;
      /** @type {Record<string, ArgShape>} */
      const args = {};
      for (const a of c.args ?? []) {
        args[a.name] = {
          type: String(a.type),
          required: a.required === true,
          positional: a.positional === true,
        };
      }
      cli[c.name] = {
        args,
        aliases: [...(c.aliases ?? [])].sort(),
        ...(Array.isArray(c.output) ? { output: [...c.output].sort() } : {}),
      };
    }
  }
  const contractFile = join(dir, 'templates/AGENTS.contract.md');
  const contract = existsSync(contractFile)
    ? contractShape(readFileSync(contractFile, 'utf8'))
    : { report: [], trailers: [], contract: null };
  const apiFile = join(dir, 'core/lib/tracker/files/api.mjs');
  const api = existsSync(apiFile)
    ? /export const API_VERSION = (\d+);/.exec(readFileSync(apiFile, 'utf8'))
    : null;
  return {
    surface_version: SURFACE_VERSION,
    schemas,
    cli,
    ...contract,
    read_api: api ? Number(api[1]) : null,
  };
}

/**
 * The surface as the lines of a committed surface file (HITLD-755): one line per public interface
 * element, sorted, so `release propose` can diff the file between releases. Lines only added
 * propose minor; a removed or changed line proposes major. The contract's wording is left out:
 * its report keys and trailers are the interface, not its prose.
 * @param {Surface} s
 * @returns {string[]}
 */
export function surfaceLines(s) {
  /** @type {string[]} */
  const out = [];
  for (const [id, schema] of Object.entries(s.schemas)) {
    out.push(`schema ${id}`);
    for (const [path, f] of Object.entries(schema.fields)) {
      out.push(
        `schema ${id} ${path}: ${f.type}, ${f.required ? 'required' : 'optional'}${f.values ? `, one of ${f.values.join(' | ')}` : ''}`,
      );
    }
  }
  for (const [name, c] of Object.entries(s.cli)) {
    out.push(`cli hitld ${name}`);
    for (const [arg, a] of Object.entries(c.args)) {
      out.push(
        `cli hitld ${name} ${a.positional ? `<${arg}>` : `--${arg}`}: ${a.type}, ${a.required ? 'required' : 'optional'}`,
      );
    }
    for (const alias of c.aliases) out.push(`cli hitld ${name} alias ${alias}`);
    for (const field of c.output ?? []) out.push(`cli hitld ${name} json ${field}`);
  }
  for (const k of s.report) out.push(`report ${k}`);
  for (const k of s.trailers) out.push(`trailer ${k}`);
  if (s.read_api !== null) out.push(`read-api version ${s.read_api}`);
  return [...new Set(out)].sort();
}

/** The text of the surface file for a checkout. @param {string} dir */
export async function surfaceFileText(dir) {
  return [
    '# The public interface of this checkout, one element per line, written by',
    '# `npm run surface` (core/bin/surface.mjs). Commit it with the change that changes it.',
    ...surfaceLines(await surfaceOf(dir)),
    '',
  ].join('\n');
}
