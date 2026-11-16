// Your move, the dashboard's default view (HITLD-152): the owner's attention is the constraint, so
// each section leads with its number. Decisions waiting on the owner, branches waiting for the
// owner's merge or on checks, work in progress, what is ready to start, and outside waits; most
// waited-on first, counting what waits through other items. This is also what is happening now:
// the dispatches running and what each last did, each with its age.

import { waited } from '../merge/owner.mjs';
import { age, count, cut, esc, fileLink } from './html.mjs';

/**
 * @param {import('./work.mjs').WorkModel['move']} m
 * @param {import("../merge/owner.mjs").OwnerWaiting[]} merges branches waiting for
 *   the owner's merge (owner mode)
 * @param {{ fileBase?: string | null }} [where]
 */
export function renderYourMove(m, merges, { fileBase = null } = {}) {
  const link = (/** @type {string} */ id, /** @type {string | null} */ path) =>
    fileLink(id, path, fileBase);
  const waits = (/** @type {number} */ n) =>
    n
      ? `<span class="pill">${esc(count(n, 'item'))} ${n === 1 ? 'waits' : 'wait'} on it</span>`
      : '';
  const crit = (/** @type {boolean} */ c) =>
    c ? '<span class="pill crit">critical path</span>' : '';
  /** A section that leads with its number. @param {string} id @param {number} n @param {string} title @param {string} body @param {string} none */
  const section = (id, n, title, body, none) =>
    `<section class="move" id="${id}"><h3><span class="num">${n}</span> ${esc(title)}</h3>${n ? body : `<p class="muted">${esc(none)}</p>`}</section>`;
  const row = (/** @type {string} */ id, /** @type {string} */ inner) =>
    `<li data-item="${esc(id)}">${inner}</li>`;

  const decisions = section(
    'move-decisions',
    m.decisions.length,
    'Decisions waiting on you',
    `<ol class="rows">${m.decisions
      .map((d) =>
        row(
          d.id,
          `${link(d.id, d.path)} ${esc(d.title)} <span class="meta">waiting ${esc(age(d.age_days))}${d.first_needs.length ? `; first needs ${d.first_needs.map(esc).join(', ')}` : ''}</span> ${waits(d.waiting_on_it)}${crit(d.critical)}`,
        ),
      )
      .join('')}</ol>`,
    'No decision waits on you.',
  );
  const merging = section(
    'move-merges',
    merges.length + m.checks.length,
    'Branches waiting for your merge or on checks',
    `<ol class="rows">${merges
      .map((w) =>
        row(
          w.item,
          `${esc(w.item)} on <code>${esc(w.branch ?? 'no branch')}</code> <span class="meta">waiting for your merge, ${esc(waited(w.waited_ms))}</span>`,
        ),
      )
      .join('')}${m.checks
      .map((c) =>
        row(
          c.id,
          `${link(c.id, c.path)} ${esc(c.title)}${c.branch ? ` on <code>${esc(c.branch)}</code>` : ''} <span class="meta">reported done, waiting on checks, ${esc(age(c.age_days))}</span>`,
        ),
      )
      .join('')}</ol>`,
    'No branch waits for your merge or on checks.',
  );
  const progress = section(
    'move-progress',
    m.in_progress.length,
    'In progress',
    `<div class="wrap"><table class="stack"><thead><tr><th>Item</th><th>Held by</th><th>Branch</th><th>Claimed</th><th>Last did</th></tr></thead><tbody>${m.in_progress
      .map(
        (p) =>
          `<tr data-item="${esc(p.id)}"><td data-label="Item">${link(p.id, p.path)} ${esc(cut(p.title, 90))}</td><td data-label="Held by">${esc(p.by ?? 'no claim found')}${p.claims > 1 ? ` <span class="pill warn">${p.claims} claims</span>` : ''}</td><td data-label="Branch">${p.branch ? `<code>${esc(p.branch)}</code>` : '—'}</td><td data-label="Claimed">${p.age_days == null ? '—' : esc(age(p.age_days))}</td><td data-label="Last did">${p.doing ? `${esc(p.doing.event)}, ${esc(age(p.doing.age_days))}` : '<span class="muted">nothing in the ledger</span>'}</td></tr>`,
      )
      .join('')}</tbody></table></div>`,
    'Nothing is in progress.',
  );
  const ready = section(
    'move-ready',
    m.ready.length,
    'Ready to start',
    `<ol class="rows">${m.ready
      .map((r) =>
        row(
          r.id,
          `${link(r.id, r.path)} ${esc(r.title)} ${waits(r.waiting_on_it)}${crit(r.critical)}`,
        ),
      )
      .join('')}</ol>`,
    'Nothing is ready: every planned item waits on something.',
  );
  const outside = section(
    'move-outside',
    m.outside.length,
    'Waiting outside',
    `<ol class="rows">${m.outside
      .map((o) =>
        row(
          o.id,
          `${link(o.id, o.path)} ${esc(o.title)} <span class="meta">on ${esc(o.waiting_on ?? 'someone outside')}, ${esc(age(o.age_days))}</span> ${waits(o.waiting_on_it)}`,
        ),
      )
      .join('')}</ol>`,
    'Nothing waits on anyone outside.',
  );
  const tiles = [
    ['move-decisions', m.decisions.length, 'decisions'],
    ['move-merges', merges.length + m.checks.length, 'to merge or checking'],
    ['move-progress', m.in_progress.length, 'in progress'],
    ['move-ready', m.ready.length, 'ready'],
    ['move-outside', m.outside.length, 'waiting outside'],
  ]
    .map(([id, n, label]) => `<a class="tile" href="#${id}"><b>${n}</b>${esc(label)}</a>`)
    .join('');
  return `<h2>Your move</h2>
<p class="muted">Most waited-on first, counting what waits through other items.</p>
<div class="tiles">${tiles}</div>
${decisions}${merging}${progress}${ready}${outside}`;
}
