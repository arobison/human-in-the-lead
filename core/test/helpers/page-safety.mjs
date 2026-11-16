// The dashboard page's safety rules (HITLD-308, design part 12.4), as one check every page test
// uses: at most one script, inline, allowed by a Content-Security-Policy tag by its hash alone; no
// other script, no event handler attribute, and nothing that makes a network request.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

/**
 * Fails unless the page holds no script but the one inline script its policy allows by hash, and
 * no network request. `scripted` says whether the page should have the script.
 * @param {string} html @param {{ scripted?: boolean }} [options]
 */
export function assertPageSafe(html, { scripted = true } = {}) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
  const opened = (html.match(/<script\b/gi) ?? []).length;
  assert.equal(opened, scripts.length, 'every script element is closed');
  assert.equal(scripts.length, scripted ? 1 : 0, 'one inline script, or none');
  // Nothing that loads or sends: no element with a source, no style import, no handler attribute.
  assert.doesNotMatch(
    html,
    /\ssrc\s*=|<link\b|<img\b|<iframe\b|<object\b|<embed\b|<base\b|<form\b|<video\b|<audio\b|@import|url\(|\son[a-z]+\s*=|srcset|javascript:/i,
  );
  assert.doesNotMatch(html, /<meta[^>]+http-equiv="refresh"/i);
  // Every web address is a plain link the reader follows, never one the page fetches.
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
    const before = html.slice(Math.max(0, (m.index ?? 0) - 7), m.index);
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
  const [, attrs, code] = scripts[0];
  assert.equal(attrs.trim(), '', 'the script has no attributes: no src, no type');
  const hash = `sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}`;
  const policy = policies[0][1];
  assert.match(policy, /^default-src 'none'; /, 'nothing from elsewhere by default');
  assert.equal(
    /script-src ([^;]+)/.exec(policy)?.[1],
    `'${hash}'`,
    'the policy allows this script alone, by its hash',
  );
  assert.doesNotMatch(policy, /unsafe-eval|https?:|\*|connect-src|img-src|font-src/);
  assert.ok(
    html.indexOf('Content-Security-Policy') < html.indexOf('<style>') &&
      html.indexOf('Content-Security-Policy') < html.indexOf('<script>'),
    'the policy comes before any style or script',
  );
  // The script never parses HTML, runs text as code or reaches the network.
  assert.doesNotMatch(
    code,
    /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|Function\(|setTimeout\(\s*['"`]|fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import\(|\.src\b|location\.|window\.open/,
  );
  // Its data cannot end the script or open a comment.
  assert.doesNotMatch(code, /<\/|<!--|\u2028|\u2029/);
}
