// The dashboard page's safety rules (HITLD-308 and HITLD-729, design part 12.4), as one check every
// page test uses. A page with the work views has three script elements: the page script, the
// contract data in a JSON element the browser never runs, and the shared React app's committed
// bundle; a page without them has none. The two scripts that run are allowed by a
// Content-Security-Policy tag by their hashes alone. There is no other script, no event handler
// attribute, and nothing that makes a network request.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** The committed bundle of the shared React app (core/lib/ui/dist/app.js). */
export const APP_BUNDLE = readFileSync(
  new URL('../../lib/ui/dist/app.js', import.meta.url),
  'utf8',
);

/** The attributes of the element that carries the contract data. */
const DATA_ATTRS = ' type="application/json" id="hitld-contract"';

/**
 * Every script element in the page, found by plain search rather than a pattern: its attributes and
 * its code. Fails on one that is never closed.
 * @param {string} html @returns {{ attrs: string, code: string }[]}
 */
export function scriptElements(html) {
  const lower = html.toLowerCase();
  /** @type {{ attrs: string, code: string }[]} */
  const out = [];
  for (let at = lower.indexOf('<script'); at !== -1; at = lower.indexOf('<script', at + 1)) {
    const open = lower.indexOf('>', at);
    const close = open === -1 ? -1 : lower.indexOf('</script', open);
    assert.ok(open !== -1 && close !== -1, 'every script element is closed');
    out.push({ attrs: html.slice(at + '<script'.length, open), code: html.slice(open + 1, close) });
    at = close;
  }
  return out;
}

/** The page's contract data, parsed from its JSON element, or null. @param {string} html */
export function inlinedData(html) {
  const el = scriptElements(html).find((s) => s.attrs === DATA_ATTRS);
  return el ? JSON.parse(el.code) : null;
}

/** @param {string} code */
const sha = (code) => `sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}`;

/**
 * Fails unless the page holds no script but those its policy allows by hash, and no network
 * request. `scripted` says whether the page should have the work views' scripts.
 * @param {string} html @param {{ scripted?: boolean }} [options]
 */
export function assertPageSafe(html, { scripted = true } = {}) {
  const scripts = scriptElements(html);
  assert.equal(scripts.length, scripted ? 3 : 0, 'the page script, the data and the app, or none');
  /** The page with the data and the bundle taken out: what the checks below read. */
  let rest = html;
  if (scripted) {
    const [page, data, app] = scripts;
    // The data: JSON the browser never runs, that cannot end its element or open a comment.
    assert.equal(data.attrs, DATA_ATTRS, 'the data element is JSON, by id');
    assert.doesNotMatch(data.code, /<|>|\u2028|\u2029/, 'the data cannot end its element');
    const payload = JSON.parse(data.code);
    assert.equal(typeof payload.contract?.api_version, 'number', 'it carries the contract');
    // The app: the committed bundle as it is, so nothing from data is in it.
    assert.equal(app.attrs, '', 'the app script has no attributes: no src, no type');
    assert.ok(app.code === APP_BUNDLE, 'the app script is the committed bundle, byte for byte');
    assert.doesNotMatch(app.code, /<\/script|<!--/i, 'the bundle cannot end its element');
    rest = html.replace(data.code, '').replace(app.code, '');
    scripts.splice(1, 2);
    assert.equal(page.attrs.trim(), '', 'the page script has no attributes: no src, no type');
  }
  // Nothing that loads or sends: no element with a source, no style import, no handler attribute.
  assert.doesNotMatch(
    rest,
    /\ssrc\s*=|<link\b|<img\b|<iframe\b|<object\b|<embed\b|<base\b|<form\b|<video\b|<audio\b|@import|url\(|\son[a-z]+\s*=|srcset|javascript:/i,
  );
  assert.doesNotMatch(rest, /<meta[^>]+http-equiv="refresh"/i);
  // Every web address is a plain link the reader follows, never one the page fetches.
  for (const m of rest.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
    const before = rest.slice(Math.max(0, (m.index ?? 0) - 7), m.index);
    assert.equal(before, ' href="', `a web address outside a link: ${m[0]}`);
  }
  const policies = [
    ...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g),
  ];
  if (!scripted) {
    assert.equal(policies.length, 0);
    return;
  }
  assert.equal(policies.length, 1, 'one Content-Security-Policy tag');
  const { code } = scripts[0];
  const policy = policies[0][1];
  assert.match(policy, /^default-src 'none'; /, 'nothing from elsewhere by default');
  assert.equal(
    /script-src ([^;]+)/.exec(policy)?.[1],
    `'${sha(code)}' '${sha(APP_BUNDLE)}'`,
    'the policy allows the page script and the app alone, by their hashes',
  );
  assert.doesNotMatch(policy, /unsafe-eval|https?:|\*|connect-src|img-src|font-src/);
  assert.ok(
    html.indexOf('Content-Security-Policy') < html.indexOf('<style>') &&
      html.indexOf('Content-Security-Policy') < html.indexOf('<script>'),
    'the policy comes before any style or script',
  );
  // The page script never parses HTML, runs text as code or reaches the network. (The app is
  // React's code and the kit's: the kit's source is checked for the same in ui.test.mjs.)
  assert.doesNotMatch(
    code,
    /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|Function\(|setTimeout\(\s*['"`]|fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import\(|\.src\b|location\.|window\.open/,
  );
  // Its data cannot end the script or open a comment.
  assert.doesNotMatch(code, /<\/|<!--|\u2028|\u2029/);
}
