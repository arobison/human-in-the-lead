// Proposals (HITLD-152): one table of every proposed item, the bets to commit or drop. For each:
// the idea, what stands between it and committing (ready to commit; waits on the owner's answer,
// an open owner decision it needs; or waits on other items, named), and how many open items wait on
// it, directly or through other items. Proposed milestones are on the Roadmap: dashed on the board,
// and in a table under it.

import { count, esc, fileLink } from './html.mjs';

/**
 * What stands between a proposed item and committing it.
 * @param {import('./work.mjs').WorkItem} it @param {Map<string, import('./work.mjs').WorkItem>} byId
 * @returns {{ kind: 'ready' | 'owner' | 'others', ids: string[] }}
 */
export function between(it, byId) {
  const owner = it.open_needs.filter((n) => {
    const d = byId.get(n);
    return d?.kind === 'decision' && d.decider === 'owner';
  });
  if (owner.length) return { kind: 'owner', ids: owner };
  return it.open_needs.length ? { kind: 'others', ids: it.open_needs } : { kind: 'ready', ids: [] };
}

/**
 * @param {import('./work.mjs').WorkModel} w
 * @param {{ fileBase?: string | null }} [where]
 */
export function renderProposals(w, { fileBase = null } = {}) {
  const byId = new Map(w.items.map((it) => [it.id, it]));
  const proposed = w.items.filter((it) => it.state === 'proposed');
  const ready = proposed.filter((it) => between(it, byId).kind === 'ready').length;
  const head = `<h2>Proposals</h2>
<p class="muted"><span class="num">${proposed.length}</span> proposed ${proposed.length === 1 ? 'item' : 'items'}, ${ready} ready to commit. Most waited-on first, counting what waits through other items. Proposed milestones are on the Roadmap: dashed on the board, and in a table under it.</p>`;
  if (!proposed.length) return `${head}\n<p class="muted">Nothing is proposed.</p>`;
  const groups = [
    ...w.projects.map((p) => ({
      title: `${p.id} ${p.title}`,
      items: proposed.filter((it) => it.project === p.id),
    })),
    {
      title: 'No project',
      items: proposed.filter((it) => !it.project || !w.projects.some((p) => p.id === it.project)),
    },
  ].filter((g) => g.items.length);
  const text = (/** @type {import('./work.mjs').WorkItem} */ it) => {
    const b = between(it, byId);
    if (b.kind === 'ready') return 'Ready to commit';
    return `${b.kind === 'owner' ? 'Waits on your answer' : 'Waits on other items'}: ${b.ids.map(esc).join(', ')}`;
  };
  const rows = groups
    .map(
      (g) =>
        `<tr class="mg-group"><th colspan="3">${esc(g.title)} (${esc(count(g.items.length, 'proposal'))})</th></tr>${[
          ...g.items,
        ]
          .sort((a, b) => b.waiting_on_it - a.waiting_on_it)
          .map(
            (it) =>
              `<tr data-item="${esc(it.id)}"><td data-label="Idea">${fileLink(it.id, it.path, fileBase)} ${esc(it.title)}${it.kind === 'work' ? '' : ` <span class="pill">${it.kind === 'decision' ? 'decision' : 'outside wait'}</span>`}</td><td data-label="Before committing">${text(it)}</td><td data-label="Waiting on it">${it.waiting_on_it}</td></tr>`,
          )
          .join('')}`,
    )
    .join('');
  return `${head}
<div class="wrap"><table class="mg-props stack"><thead><tr><th>Idea</th><th>What stands between it and committing</th><th>Open items waiting on it</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
