// The eval results page (design part 17.5, 17.9): one static HTML file for a stored run, so the
// owner can review it and decide whether it becomes the baseline. Same approach as `hitld report`
// (core/lib/quota/report.mjs): self-contained, inline CSS, no script, no external asset, light
// and dark by the reader's setting.
//
// Everything in a run (scenario IDs, grader messages, reasons) is data: it is HTML-escaped as
// text, and nothing from it becomes markup, a URL or an attribute other than quoted text.
// Accepting a baseline stays a command line act: the page only shows the command.

import { acceptRefusal, committedBaselinePath, fromLegacyResult } from './results.mjs';

/**
 * @typedef {Record<string, any>} EvalResult
 * @typedef {{ id: string, key: string, result: string, was: string | null, note?: string }} Change
 */

/** The label shown for each status. Not applicable is never called a pass. */
export const STATUS_LABEL = Object.freeze({
  pass: 'Pass',
  fail: 'Fail',
  error: 'Error',
  'not-applicable': 'Not applicable',
});

/** Failures first, then passes, then what did not apply. */
const ORDER = { error: 0, fail: 1, pass: 2, 'not-applicable': 3 };

/** @param {unknown} v @returns {string} */
export const esc = (v) =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      /** @type {Record<string, string>} */ ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c],
  );

/** @param {{ id: string, profile: string }} s */
const keyOf = (s) => `${s.id}@${s.profile}`;

/** @param {number} n */
const pct = (n) => `${Math.round(n * 1000) / 10}%`;

/**
 * What changed against the baseline, or null when there is none to compare with.
 * @param {EvalResult} run @param {EvalResult | null} baseline
 */
export function changesAgainst(run, baseline) {
  if (!baseline) return null;
  const partial = run.settings.scenario_filter != null;
  const now = new Map(run.scenarios.map((/** @type {any} */ s) => [keyOf(s), s]));
  const before = new Map(baseline.scenarios.map((/** @type {any} */ s) => [keyOf(s), s]));
  /** @type {Change[]} */
  const newFailures = [];
  /** @type {Change[]} */
  const fixed = [];
  /** @type {Change[]} */
  const removed = [];
  /** @type {Change[]} */
  const added = [];
  /** @type {Change[]} */
  const notApplicable = [];
  for (const [key, s] of now) {
    const was = before.get(key);
    const base = { id: s.id, key, result: s.result, was: was ? was.result : null };
    const bad = s.result === 'fail' || s.result === 'error';
    if (!was) {
      if (bad) newFailures.push(base);
      else if (s.result === 'pass') added.push(base);
    } else if (bad && was.result !== s.result) {
      if (was.result === 'pass' || was.result === 'not-applicable') newFailures.push(base);
    } else if (s.result === 'pass' && (was.result === 'fail' || was.result === 'error')) {
      fixed.push(base);
    } else if (s.result === 'not-applicable' && was.result !== 'not-applicable') {
      notApplicable.push(base);
    }
  }
  for (const [key, was] of before) {
    if (now.has(key)) continue;
    removed.push({
      id: was.id,
      key,
      result: was.result,
      was: was.result,
      ...(partial ? { note: 'not run: this run covered only part of the scenarios' } : {}),
    });
  }
  /** @type {{ category: string, was: number | null, now: number | null }[]} */
  const scores = [];
  const names = new Set([
    ...Object.keys(baseline.summary.categories),
    ...Object.keys(run.summary.categories),
  ]);
  for (const category of [...names].sort()) {
    const was = baseline.summary.categories[category]?.score ?? null;
    const is = run.summary.categories[category]?.score ?? null;
    if (was !== is) scores.push({ category, was, now: is });
  }
  return { newFailures, fixed, removed, added, notApplicable, scores, partial };
}

/**
 * The command that makes this stored run the baseline, or why one cannot be given. The rule is
 * the one `hitld eval accept` enforces (acceptRefusal in results.mjs).
 * @param {EvalResult} run @param {EvalResult | null} baseline
 * @returns {{ command: string | null, reason: string | null }}
 */
export function acceptCommand(run, baseline) {
  const reason = acceptRefusal(run, baseline);
  return reason
    ? { command: null, reason }
    : { command: `hitld eval accept --result ${run.id}`, reason: null };
}

/** @param {string} status */
const badge = (status) =>
  `<span class="badge ${esc(status)}">${esc(STATUS_LABEL[/** @type {keyof typeof STATUS_LABEL} */ (status)] ?? status)}</span>`;

/** @param {EvalResult} run @param {EvalResult | null} baseline */
function verdict(run, baseline) {
  const gate = run.gate;
  const stale = baseline && gate?.baseline && baseline.id !== gate.baseline ? baseline.id : null;
  const bad = run.summary.failed + run.summary.errors;
  if (!gate) {
    return {
      tone: 'warn',
      head: 'No gate verdict was recorded for this run',
      body: 'The run was stored without comparing it with a baseline.',
      stale: null,
    };
  }
  const from =
    gate.baseline_source === 'committed'
      ? ' (committed in evals/baselines/)'
      : gate.baseline_source === 'private-store'
        ? " (from this machine's private store; none is committed)"
        : '';
  const against = gate.baseline
    ? `Compared with baseline ${gate.baseline}${from}.`
    : 'No baseline yet: nothing to compare with. Floors and scenario results still applied.';
  if (gate.ok && bad === 0) {
    return { tone: 'ok', head: 'Gate passed', body: against, stale };
  }
  const n = gate.failures.length;
  const parts = [];
  if (!gate.ok) parts.push(`${n} gate failure${n === 1 ? '' : 's'}`);
  if (bad) parts.push(`${bad} scenario${bad === 1 ? '' : 's'} failing or erroring`);
  return {
    tone: 'bad',
    head: gate.ok ? 'Gate passed, but scenarios fail' : 'Gate failed',
    body: `${against} ${parts.join('; ')}.`,
    stale,
  };
}

/** @param {Change[]} list @param {string} title @param {string} empty */
function changeList(list, title, empty) {
  const items = list
    .map(
      (c) =>
        `<li><code>${esc(c.key)}</code> <span class="muted">${c.was ? `${esc(STATUS_LABEL[/** @type {keyof typeof STATUS_LABEL} */ (c.was)] ?? c.was)} then, ` : 'new, '}${esc(STATUS_LABEL[/** @type {keyof typeof STATUS_LABEL} */ (c.result)] ?? c.result)} now</span>${c.note ? ` <small>${esc(c.note)}</small>` : ''}</li>`,
    )
    .join('');
  return `<div class="change"><h3>${esc(title)} <span class="count">${list.length}</span></h3>${list.length ? `<ul>${items}</ul>` : `<p class="muted">${esc(empty)}</p>`}</div>`;
}

/** @param {EvalResult['scenarios'][number]} s */
function scenarioRow(s) {
  const open = s.result === 'fail' || s.result === 'error';
  const graders = (s.graders ?? [])
    .map(
      (/** @type {any} */ g) =>
        `<li class="grader ${g.passed ? 'pass' : 'fail'}"><span class="gid"><strong>${esc(g.id)}</strong> <small>${esc(g.grader)}</small></span> ${g.passed ? '<span class="badge pass">Pass</span>' : '<span class="badge fail">Fail</span>'}${[
          ['Path', g.path],
          ['Expected', g.expected],
          ['Actual', g.actual],
        ]
          .filter(([, v]) => v !== undefined)
          .map(
            ([k, v]) =>
              `<span class="kv"><small>${k}</small> <code>${esc(typeof v === 'string' ? v : JSON.stringify(v))}</code>${g[`${String(k).toLowerCase()}_truncated`] ? ' <small>(cut: too long to keep whole)</small>' : ''}</span>`,
          )
          .join('')}<span class="msg">${esc(g.message)}</span></li>`,
    )
    .join('');
  const detail = [
    s.reason
      ? `<p class="reason"><strong>${s.result === 'not-applicable' ? 'Why not applicable' : 'Reason'}:</strong> ${esc(s.reason)}</p>`
      : '',
    graders
      ? `<h4>Graders</h4><ul class="graders">${graders}</ul>`
      : s.result === 'not-applicable'
        ? ''
        : '<p class="muted">No graders ran.</p>',
    `<p class="muted meta">Profile ${esc(s.profile)}. ${esc(s.wall_ms)} ms${s.tokens == null ? '' : `, ${esc(s.tokens)} tokens`}${s.transcript ? `. Transcript kept in the private store at <code>${esc(s.transcript)}</code>` : ''}.</p>`,
  ].join('');
  return `<details class="scenario ${esc(s.result)}"${open ? ' open' : ''}><summary><span class="sid">${esc(s.id)}</span> <span class="cat">${esc(s.category)}</span> ${badge(s.result)}</summary><div class="body">${detail}</div></details>`;
}

const CSS = `
:root{--bg:#fbfbfa;--fg:#1c1d20;--muted:#60646c;--line:#d9dbe0;--card:#fff;--ok:#1d6b3a;--ok-bg:#e4f4ea;--bad:#b3261e;--bad-bg:#fbe9e7;--warn:#8a5a00;--warn-bg:#fff4dc;--na:#4a4f58;--na-bg:#e9eaee;--track:#e9eaee;--bar:#2f6fb3;--code:#f1f2f4}
@media (prefers-color-scheme:dark){:root{--bg:#141517;--fg:#e8e9ec;--muted:#9a9fa8;--line:#34373d;--card:#1b1c1f;--ok:#7bd69a;--ok-bg:#16301f;--bad:#ff8a80;--bad-bg:#3a1f1c;--warn:#e5b64a;--warn-bg:#3a3018;--na:#b4b8c0;--na-bg:#2a2c31;--track:#2a2c31;--bar:#6aa5e6;--code:#25272b}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}
main{max-width:60rem;margin:0 auto;padding:1.5rem 1rem 4rem}
h1{font-size:1.5rem;line-height:1.25;margin:0 0 .25rem}
h2{font-size:1.15rem;margin:2.25rem 0 .75rem;padding-top:.5rem;border-top:1px solid var(--line)}
h3{font-size:1rem;margin:0 0 .4rem}h4{font-size:.85rem;margin:.9rem 0 .3rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.muted,small{color:var(--muted)}small{font-size:.82rem}
code,pre{font:.88rem/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--code);border-radius:4px}
code{padding:.05rem .3rem}
pre{padding:.8rem 1rem;margin:.5rem 0;white-space:pre-wrap;overflow-wrap:anywhere;user-select:all;border:1px solid var(--line)}
a{color:inherit}
:focus-visible{outline:3px solid var(--bar);outline-offset:2px}
.verdict{border:1px solid var(--line);border-left:8px solid var(--na);border-radius:8px;background:var(--card);padding:1rem 1.25rem;margin:1.25rem 0}
.verdict strong{display:block;font-size:1.4rem;line-height:1.25}
.verdict.ok{border-left-color:var(--ok);background:var(--ok-bg)}.verdict.bad{border-left-color:var(--bad);background:var(--bad-bg)}.verdict.warn{border-left-color:var(--warn);background:var(--warn-bg)}
.verdict ul{margin:.5rem 0 0;padding-left:1.2rem}
dl.id{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:.75rem 1.5rem;margin:0}
dl.id div{min-width:0}dl.id dt{font-size:.8rem;color:var(--muted)}dl.id dd{margin:0}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(8rem,1fr));gap:.75rem}
.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.75rem 1rem}
.tile b{display:block;font-size:1.8rem;line-height:1.1;font-variant-numeric:tabular-nums}.tile span{font-size:.85rem;color:var(--muted)}
.tile.fail b,.tile.error b{color:var(--bad)}.tile.zero b{color:var(--muted)}
.cats{list-style:none;margin:0;padding:0;display:grid;gap:.6rem}
.cats li{display:grid;grid-template-columns:minmax(7rem,12rem) 1fr;gap:.25rem 1rem;align-items:center}
.cats .name{font-weight:600}.cats .figs{grid-column:1/-1;font-size:.82rem;color:var(--muted)}
.meter{height:.7rem;background:var(--track);border-radius:99px;overflow:hidden}.meter i{display:block;height:100%;background:var(--bar)}
@media (min-width:36rem){.cats li{grid-template-columns:minmax(7rem,12rem) 1fr 14rem}.cats .figs{grid-column:auto}}
.changes{display:grid;grid-template-columns:repeat(auto-fit,minmax(18rem,1fr));gap:1rem}
.change{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.75rem 1rem}
.change ul{margin:0;padding-left:1.1rem}.change li{margin:.2rem 0}
.count{display:inline-block;min-width:1.5rem;text-align:center;font-size:.8rem;background:var(--na-bg);color:var(--na);border-radius:99px;padding:0 .4rem}
.badge{display:inline-block;font-size:.78rem;font-weight:700;border-radius:4px;padding:.05rem .5rem;white-space:nowrap}
.badge.pass{background:var(--ok-bg);color:var(--ok)}.badge.fail,.badge.error{background:var(--bad-bg);color:var(--bad)}.badge.not-applicable{background:var(--na-bg);color:var(--na)}
.scenarios{display:grid;gap:.5rem}
details.scenario{background:var(--card);border:1px solid var(--line);border-left-width:6px;border-radius:8px}
details.scenario.fail,details.scenario.error{border-left-color:var(--bad)}details.scenario.pass{border-left-color:var(--ok)}details.scenario.not-applicable{border-left-color:var(--na)}
details.scenario>summary{cursor:pointer;padding:.65rem 1rem;display:flex;flex-wrap:wrap;gap:.25rem .75rem;align-items:center;list-style-position:inside}
.sid{font-weight:600}.cat{color:var(--muted);font-size:.9rem}
.body{padding:0 1rem 1rem}
.graders{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
.grader{border:1px solid var(--line);border-radius:6px;padding:.5rem .75rem;display:grid;gap:.25rem}
.grader.fail{border-color:var(--bad)}.kv{display:block}.msg{display:block}
.meta{font-size:.85rem;margin:.75rem 0 0}.reason{margin:.25rem 0}
.accept{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:1rem 1.25rem}
@media print{details.scenario>.body{display:block}}
`;

/**
 * Render the page for a stored run.
 * @param {EvalResult} given @param {EvalResult | null} givenBaseline the baseline now stored for the run's settings
 * @returns {string}
 */
export function renderEvalReport(given, givenBaseline) {
  // A run stored before HITLD-82 says status and not_applicable: read it in the new names.
  const run = fromLegacyResult(given);
  const baseline = givenBaseline && fromLegacyResult(givenBaseline);
  const s = run.summary;
  const v = verdict(run, baseline);
  const changes = changesAgainst(run, baseline);
  const accept = acceptCommand(run, baseline);
  const scenarios = [...run.scenarios].sort(
    (a, b) =>
      ORDER[/** @type {keyof typeof ORDER} */ (a.result)] -
        ORDER[/** @type {keyof typeof ORDER} */ (b.result)] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : a.profile < b.profile ? -1 : 1),
  );
  const tile = (/** @type {string} */ cls, /** @type {number} */ n, /** @type {string} */ label) =>
    `<div class="tile ${n === 0 ? 'zero' : cls}"><b>${n}</b><span>${esc(label)}</span></div>`;
  const cats = Object.entries(s.categories)
    .map(([name, c]) => {
      const was = baseline?.summary.categories[name]?.score;
      const delta =
        was === undefined || was === null
          ? ''
          : was === c.score
            ? ', same as baseline'
            : `, baseline ${pct(was)}`;
      return `<li><span class="name">${esc(name)}</span><div class="meter" role="img" aria-label="${esc(name)} ${pct(c.score)}"><i style="width:${Math.max(0, Math.min(100, c.score * 100))}%"></i></div><span class="figs">${pct(c.score)} over ${c.scenarios} applicable scenario${c.scenarios === 1 ? '' : 's'}${esc(delta)}</span></li>`;
    })
    .join('');
  /** @param {number | null} n */
  const sc = (n) => (n === null ? 'none' : pct(n));
  const changesHtml = changes
    ? `${changes.partial ? '<p class="muted">This run covered only some scenarios, so missing ones are listed as not run.</p>' : ''}<div class="changes">${changeList(changes.newFailures, 'New failures', 'None.')}${changeList(changes.fixed, 'Fixed', 'None.')}${changeList(changes.removed, 'Removed scenarios', 'None.')}${changeList(changes.added, 'New scenarios', 'None.')}${changeList(changes.notApplicable, 'Now not applicable', 'None.')}<div class="change"><h3>Score changes <span class="count">${changes.scores.length}</span></h3>${changes.scores.length ? `<ul>${changes.scores.map((c) => `<li>${esc(c.category)}: <span class="muted">${sc(c.was)} then, ${sc(c.now)} now</span></li>`).join('')}</ul>` : '<p class="muted">None.</p>'}</div></div>`
    : `<p>Nothing to compare with: there is no baseline for these settings (mode ${esc(run.mode)}, settings hash <code>${esc(run.settings.settings_hash)}</code>).</p>`;
  const gateLines = run.gate
    ? [
        ...run.gate.failures.map(
          (/** @type {any} */ f) => `<li><strong>${esc(f.kind)}</strong>: ${esc(f.message)}</li>`,
        ),
        ...run.gate.notes
          .filter((/** @type {string} */ n) => !n.startsWith('no baseline for these settings'))
          .map((/** @type {string} */ n) => `<li class="muted">${esc(n)}</li>`),
      ].join('')
    : '';
  const identity = [
    ['Run', run.id],
    ['When', run.at],
    ['Mode', run.mode],
    ['Seed', run.settings.seed],
    ['Settings hash', run.settings.settings_hash],
    ['Scenario filter', run.settings.scenario_filter ?? 'none (full run)'],
    ['Plugin', `${run.plugin.name} ${run.plugin.version}`],
    ['Checkout commit', run.plugin.commit ?? 'not a git checkout'],
    ['Profiles', run.harness.profiles.join(', ')],
    ['Scenario set', `${run.scenario_set.version} (${run.scenario_set.count} scenarios)`],
    ['Policy', `${run.policy_hash ?? 'none'} (${run.policy_source})`],
  ]
    .map(
      ([k, val]) =>
        `<div><dt>${esc(k)}</dt><dd>${typeof val === 'string' && /^[0-9a-f]{7,}$/.test(val) ? `<code>${esc(val)}</code>` : esc(val)}</dd></div>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Eval run ${esc(run.id)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>Eval run ${esc(run.id)}</h1>
<div class="muted">Review this run, then decide whether it becomes the baseline. Local data only.</div>
<section class="verdict ${v.tone}" aria-labelledby="verdict"><strong id="verdict">${esc(v.head)}</strong><span>${esc(v.body)}</span>${v.stale ? `<br><small>The baseline stored now (${esc(v.stale)}) is not the one this run was gated against.</small>` : ''}${gateLines ? `<ul>${gateLines}</ul>` : ''}</section>
<h2>Run</h2>
<dl class="id">${identity}</dl>
<h2>Counts</h2>
<div class="tiles">${tile('pass', s.passed, 'Pass')}${tile('fail', s.failed, 'Fail')}${tile('error', s.errors, 'Error')}${tile('na', s.not_applicable, 'Not applicable')}</div>
<p class="muted">${s.total} case${s.total === 1 ? '' : 's'} in all. Not applicable cases are left out of every score.</p>
<h2>Scores by category</h2>
${cats ? `<ul class="cats">${cats}</ul>` : '<p class="muted">No category had an applicable scenario.</p>'}
<h2>What changed against the baseline</h2>
${changesHtml}
<h2>Scenarios</h2>
<p class="muted">Failures first. Open a row for its graders.</p>
<div class="scenarios">${scenarios.map(scenarioRow).join('\n')}</div>
<h2>Accept as the baseline</h2>
<section class="accept">
${
  accept.command
    ? `<p>Accepting is the owner's decision, made on the command line. To record exactly this run as the baseline, run:</p><pre tabindex="0">${esc(accept.command)}</pre><p class="muted">This accepts the stored run you are reading, without running the suite again; it replaces the baseline for these settings. It writes <code>${esc(committedBaselinePath(run.mode, run.settings.settings_hash))}</code> in the primary checkout and keeps a copy in the private store. Committing that file is a separate step, so CI and every machine gate on it.</p>`
    : `<p><strong>No accept command for this run.</strong> ${esc(accept.reason)}.</p>`
}
</section>
</main>
</body>
</html>
`;
}
