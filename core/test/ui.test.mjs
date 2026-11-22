// The shared UI kit (HITLD-729): the typed client, the hooks and the React components for the six
// panel types, drawn from a real contract (`hitld dashboard --json --no-write` over a fixture with
// views.json); a project's declared field shows in a rendered panel; a project registers its own
// panel type and sets theme variables; the committed bundle matches its source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { main } from '../lib/cli/main.mjs';
import {
  ContractError,
  Dashboard,
  HitldRoot,
  Panel,
  PanelsView,
  ReadStamp,
  THEME_CSS,
  THEME_VARIABLES,
  createRegistry,
  fetchContract,
  fieldValue,
  itemOf,
  readContract,
  readInlined,
  readStamp,
  themeStyle,
  useField,
  useItems,
  usePanel,
} from '../lib/ui/index.mjs';
import { git, isolatedEnv, itemText, makeRepo, put } from './tracker-fixture.mjs';
import { inlinedData } from './helpers/page-safety.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HOME = isolatedEnv();
const NOW = '2026-11-16T12:00:00Z';

/** @param {string} id @param {string} title @param {Record<string, string | string[]>} [extra] */
const item = (id, title, extra = {}) => ({
  [`work/items/${id}-${id.toLowerCase()}.md`]: itemText({
    id,
    title,
    kind: 'work',
    state: 'planned',
    project: 'W-2',
    created: '2026-11-10',
    ...extra,
  }),
});

const FIELDS = [
  { name: 'team', type: 'string', values: ['core', 'web'], description: 'The team that does it.' },
  { name: 'points', type: 'integer', description: 'Its size in points.' },
  { name: 'due', type: 'string', description: 'When it is due, YYYY-MM-DD.' },
];

/** The six panel types; the table and the bar show the declared field team. */
const SIX = {
  schema_version: 1,
  title: 'Team board',
  panels: [
    {
      id: 'sized',
      title: 'Sized work',
      type: 'table',
      where: [{ field: 'points', set: true }],
      columns: ['title', 'team', 'points'],
      sort: 'points',
      order: 'descending',
    },
    { id: 'by-stage', title: 'By stage', type: 'board', group_by: 'stage' },
    { id: 'by-team', title: 'By team', type: 'bar', group_by: 'fields.team' },
    { id: 'done', title: 'Done', type: 'line', date: 'reached.done', interval: 'day' },
    { id: 'due', title: 'Due dates', type: 'timeline', date: 'due' },
    { id: 'waits', title: 'What waits on what', type: 'graph' },
  ],
};

/** The contract and the page of a fixture with SIX, read once. */
const fixture = await (async () => {
  const root = makeRepo({ commit: false });
  put(root, {
    '.human-in-the-lead/policy.json': JSON.stringify({
      schema_version: 1,
      project: { id: 'fixture', key: 'W' },
    }),
    '.human-in-the-lead/tracker.json': JSON.stringify({ schema_version: 1, fields: FIELDS }),
    '.human-in-the-lead/views.json': JSON.stringify(SIX),
    ...item('W-7', 'Write the parser', { team: 'core', points: '5', due: '2026-11-20' }),
    ...item('W-8', '<b>Draw</b> the page', { team: 'web', points: '3', needs: ['W-7'] }),
    ...item('W-9', 'Ship it', { needs: ['W-8'], due: '2026-11-30' }),
  });
  git(root, 'add', '-A');
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-11-12T10:00:00Z',
      GIT_COMMITTER_DATE: '2026-11-12T10:00:00Z',
    },
  });
  put(root, item('W-7', 'Write the parser', { team: 'core', points: '5', state: 'done' }));
  git(root, 'add', '-A');
  execFileSync('git', ['commit', '-q', '-m', 'W-7 done'], {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-11-13T10:00:00Z',
      GIT_COMMITTER_DATE: '2026-11-13T10:00:00Z',
    },
  });
  let out = '';
  const code = await main(['dashboard', '--out', 'out', '--json', '--now', NOW], {
    out: (t) => (out += t),
    err: () => {},
    cwd: root,
    env: { ...HOME },
  });
  assert.equal(code, 0, out);
  return {
    contract: JSON.parse(out).report,
    html: readFileSync(join(root, 'out', 'dashboard.html'), 'utf8'),
  };
})();

/** One rendered panel's markup. @param {string} html @param {string} id */
const panelHtml = (html, id) => {
  const m = new RegExp(
    `<section class="pn pn-is-[a-z]+" id="pn-${id}"[^>]*>([\\s\\S]*?)</section>(?=<section class="pn |</div>$)`,
  ).exec(html);
  assert.ok(m, `panel ${id} is drawn`);
  return m[1];
};

test('the client reads a contract, and refuses another version or a non-contract by name', () => {
  const c = readContract(JSON.stringify(fixture.contract));
  assert.equal(c.api_version, 2);
  assert.equal(itemOf(c, 'W-7')?.title, 'Write the parser');
  assert.equal(fieldValue(c, /** @type {any} */ (itemOf(c, 'W-7')), 'team'), 'core');
  assert.equal(fieldValue(c, /** @type {any} */ (itemOf(c, 'W-7')), 'fields.points'), 5);
  assert.equal(fieldValue(c, /** @type {any} */ (itemOf(c, 'W-7')), 'reached.done'), '2026-11-13');
  assert.throws(
    () => fieldValue(c, /** @type {any} */ (itemOf(c, 'W-7')), 'color'),
    (e) => e instanceof ContractError && e.code === 'no-field' && /"color"/.test(e.message),
  );
  assert.throws(
    () => readContract({ ...fixture.contract, api_version: 3 }),
    (e) =>
      e instanceof ContractError && e.code === 'unsupported-version' && /version 3/.test(e.message),
  );
  for (const bad of ['{', '[]', '{}', { api_version: 2 }]) {
    assert.throws(
      () => readContract(bad),
      (e) => e instanceof ContractError && e.code === 'not-a-contract',
    );
  }
  // Fields it does not know are ignored.
  assert.equal(readContract({ ...fixture.contract, later_field: 1 }).project, 'fixture');
  const stamp = readStamp(c);
  assert.equal(stamp.at, c.generated_at);
  assert.deepEqual(Object.keys(stamp.tracker ?? {}), ['commit', 'branch']);
  assert.match(
    stamp.text,
    /^Read 2026-11-16T12:00:00\.000Z from the tracker in this repository at commit \w+/,
  );
  assert.match(stamp.text, /private store on the machine that generated it/);
});

test('the page carries the contract inlined, and the client reads it from there', () => {
  const payload = inlinedData(fixture.html);
  assert.deepEqual(payload.contract, fixture.contract);
  const doc = {
    getElementById: (/** @type {string} */ id) =>
      id === 'hitld-contract' ? { textContent: JSON.stringify(payload) } : null,
  };
  const got = readInlined(doc);
  assert.equal(got.contract.project, 'fixture');
  assert.equal(got.fileBase, null);
  assert.throws(
    () => readInlined({ getElementById: () => null }),
    (e) => e instanceof ContractError && e.code === 'no-inline-data',
  );
  // The page states when and where its data was read, and marks it for the app.
  assert.match(
    fixture.html,
    /<div class="muted" data-hitld-mount="read">Read 2026-11-16T12:00:00\.000Z from the tracker/,
  );
  assert.match(fixture.html, /<div data-hitld-mount="panels">\n<h2>Team board<\/h2>/);
});

test('fetchContract reads a served file: the report, or the whole --json output', async () => {
  /** @param {unknown} body */
  const served = (body) => async () => ({ ok: true, status: 200, json: async () => body });
  assert.equal(
    (await fetchContract('/c.json', { fetch: served(fixture.contract) })).project,
    'fixture',
  );
  assert.equal(
    (await fetchContract('/c.json', { fetch: served({ ok: true, report: fixture.contract }) }))
      .project,
    'fixture',
  );
  await assert.rejects(
    fetchContract('/c.json', {
      fetch: async () => ({ ok: false, status: 404, json: async () => null }),
    }),
    /answered 404/,
  );
});

test('each of the six panel types renders from fixture data, and a declared field shows', () => {
  const html = renderToStaticMarkup(
    h(HitldRoot, { contract: fixture.contract, bare: true }, h(PanelsView)),
  );
  assert.match(html, /^<div class="pn-view"><h2>Team board<\/h2>/);
  for (const p of SIX.panels) {
    const s = panelHtml(html, p.id);
    assert.match(s, new RegExp(`^<h3 id="pn-${p.id}-h">${p.title}</h3>`), `${p.id} has a heading`);
    const text = s.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ');
    assert.match(text, /W-\d|\d item/, `panel ${p.id} has a text fallback`);
  }
  // table: the declared field team as a column, and its values in the rows.
  const t = panelHtml(html, 'sized');
  assert.match(t, /<th scope="col">team<\/th>/);
  assert.match(
    t,
    /<th scope="row"><a class="file" href="work\/items\/W-7-w-7\.md">W-7<\/a><\/th><td>Write the parser<\/td><td>core<\/td><td>5<\/td>/,
  );
  // board: a column per stage, with its count and items.
  assert.match(
    panelHtml(html, 'by-stage'),
    /<h4>done <span class="num">\d+<\/span><\/h4><ul><li><span><a class="file"/,
  );
  // bar: counts by the declared field.
  assert.match(panelHtml(html, 'by-team'), /<th scope="row">core<\/th><td>1<\/td>/);
  assert.match(panelHtml(html, 'by-team'), /<svg class="pn-bar" aria-hidden="true"/);
  // line: the counts by the date W-7 reached done, as a picture and a table.
  assert.match(panelHtml(html, 'done'), /<th scope="row">2026-11-13<\/th><td>1<\/td>/);
  assert.match(panelHtml(html, 'done'), /<polyline class="pn-line"/);
  // timeline: items on the declared date field.
  assert.match(
    panelHtml(html, 'due'),
    /<li><time dateTime="2026-11-30">2026-11-30<\/time>: <span><a class="file"[^>]*>W-9<\/a> Ship it<\/span><\/li>/i,
  );
  // graph: nodes and the needs between them.
  assert.match(panelHtml(html, 'waits'), /W-9<\/a> Ship it<\/span>; needs: W-8<\/li>/);
  // A title is text, never markup.
  assert.match(html, /&lt;b&gt;Draw&lt;\/b&gt; the page/);
  assert.doesNotMatch(html, /<b>Draw/);
});

test('the React panels say what the page with no script says', () => {
  const react = renderToStaticMarkup(
    h(HitldRoot, { contract: fixture.contract, bare: true }, h(PanelsView)),
  );
  /** The words of a panel, without the markup. @param {string} s */
  const words = (s) =>
    s
      .replace(/<svg[\s\S]*?<\/svg>/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .replace(/ ([;,.:])/g, '$1')
      .trim();
  for (const p of SIX.panels) {
    const page =
      new RegExp(
        `<section class="pn pn-is-[a-z]+" id="pn-${p.id}"[^>]*>([\\s\\S]*?)\\n</section>`,
      ).exec(fixture.html)?.[1] ?? '';
    assert.equal(words(panelHtml(react, p.id)), words(page), `panel ${p.id} says the same`);
  }
});

test('the hooks read the contract, and a project registers its own panel type', () => {
  /** A project's own panel: the points of the items its team owns, through the hooks. @param {{ panel: any }} props */
  function Points({ panel }) {
    const team = useField('team');
    const points = useField('points');
    const mine = useItems((it) => team(it) === panel.team);
    const total = mine.reduce((n, it) => n + Number(points(it) ?? 0), 0);
    return h('p', { className: 'points' }, `${panel.team}: ${total} points`);
  }
  function Probe() {
    return h('span', null, usePanel('sized')?.title ?? 'none');
  }
  const registry = createRegistry({ points: Points });
  assert.deepEqual(registry.types(), [
    'table',
    'board',
    'bar',
    'line',
    'timeline',
    'graph',
    'points',
  ]);
  const html = renderToStaticMarkup(
    h(Dashboard, {
      contract: fixture.contract,
      registry,
      extra: [
        {
          id: 'core-points',
          title: 'Core points',
          type: 'points',
          team: 'core',
          description: null,
          where: [],
          matched: 1,
        },
      ],
    }),
  );
  assert.match(
    html,
    /<section class="pn pn-is-points" id="pn-core-points"[^>]*><h3 id="pn-core-points-h">Core points<\/h3>/,
  );
  assert.match(html, /<p class="points">core: 5 points<\/p>/);
  assert.match(html, /<span class="hitld-read">Read 2026-11-16/);
  assert.equal(
    renderToStaticMarkup(h(HitldRoot, { contract: fixture.contract }, h(Probe))),
    '<div class="hitld"><span>Sized work</span></div>',
  );
  // A type nothing registers says so by name; it never draws empty.
  const unknown = renderToStaticMarkup(
    h(
      HitldRoot,
      { contract: fixture.contract, bare: true },
      h(Panel, {
        panel: /** @type {any} */ ({
          id: 'g',
          title: 'Gauge',
          type: 'gauge',
          where: [],
          matched: 0,
          description: null,
        }),
      }),
    ),
  );
  assert.match(
    unknown,
    /role="alert"><strong>Panel &quot;g&quot; is not shown<\/strong>no panel type &quot;gauge&quot; is registered/,
  );
  // A project's type may not take a built-in name or an odd one.
  assert.throws(() => createRegistry({ table: Points }), /"table" is built in/);
  assert.throws(() => createRegistry({ 'Bad Name': Points }), /is not a name/);
  // A hook outside a provider names the fix.
  assert.throws(
    () => renderToStaticMarkup(h(Probe)),
    /wrap the component in ContractProvider or HitldRoot/,
  );
  assert.match(
    renderToStaticMarkup(h(HitldRoot, { contract: fixture.contract, bare: true }, h(ReadStamp))),
    /Data contract version 2/,
  );
});

test('theme variables restyle the panels, and an unsafe value is refused', () => {
  for (const name of Object.keys(THEME_VARIABLES)) {
    const prop = name === 'stopBg' ? '--hitld-stop-bg' : `--hitld-${name}`;
    assert.ok(THEME_CSS.includes(`var(${prop},`), `THEME_CSS reads ${prop}`);
  }
  const html = renderToStaticMarkup(
    h(Dashboard, {
      contract: fixture.contract,
      theme: { accent: '#b00020', stopBg: 'rgb(255, 240, 240)', font: "'Inter', sans-serif" },
    }),
  );
  assert.match(
    html,
    /^<div class="hitld" style="--hitld-accent:#b00020;--hitld-stop-bg:rgb\(255, 240, 240\);--hitld-font:&#x27;Inter&#x27;, sans-serif">/,
  );
  assert.throws(
    () => themeStyle(/** @type {any} */ ({ color: '#000' })),
    /"color" is not a theme variable/,
  );
  for (const bad of ['url(https://x.example/a.png)', 'red;}body{display:none', 'red\\0']) {
    assert.throws(() => themeStyle({ accent: bad }), /takes a color or a font list/);
  }
});

test('the kit sets no HTML and reaches no network but the URL a caller gives fetchContract', () => {
  const dir = join(ROOT, 'core/lib/ui');
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.mjs'))) {
    const text = readFileSync(join(dir, f), 'utf8');
    assert.doesNotMatch(
      text,
      /dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/,
      f,
    );
    if (f !== 'client.mjs') assert.doesNotMatch(text, /\bfetch\(|XMLHttpRequest|WebSocket/, f);
  }
});

test('the committed bundle matches its source, and React and esbuild are development dependencies only', async () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const name of ['react', 'react-dom', 'esbuild']) {
    assert.ok(pkg.devDependencies[name], `${name} is a development dependency`);
    assert.ok(
      !pkg.dependencies?.[name] && !pkg.peerDependencies?.[name],
      `${name} is nothing else`,
    );
  }
  const { build, BUNDLE } = await import('../../scripts/build-ui.mjs');
  assert.ok(
    (await build()) === readFileSync(BUNDLE, 'utf8'),
    'run npm run build:ui and commit core/lib/ui/dist/app.js',
  );
  // Nothing HITLD runs outside the kit's own React files imports React or esbuild.
  for (const f of [
    'core/lib/quota/report.mjs',
    'core/lib/ui/bundle.mjs',
    'core/lib/ui/client.mjs',
    'core/lib/ui/text.mjs',
    'core/lib/ui/theme.mjs',
  ]) {
    assert.doesNotMatch(readFileSync(join(ROOT, f), 'utf8'), /from '(react|react-dom|esbuild)/, f);
  }
});
