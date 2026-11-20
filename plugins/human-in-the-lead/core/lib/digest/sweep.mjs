// The stale-item sweep's part of the digest (design part 13.3): what `hitld work sweep` finds in
// the tracker now, one line per finding. It reads what the sweep reads: the tracker, its branches
// and the ledger. The findings are state, not news: the section is shown when there is room, and
// never makes a digest on its own. A tracker the sweep cannot read (not the files backend, or no
// checkout) has no section.

import { readLedger } from '../ledger/ledger.mjs';
import { sweepTracker } from '../tracker/files/sweep.mjs';
import { clip } from './render.mjs';

/** @type {import('./parts.mjs').Part} */
export const sweepPart = {
  id: 'sweep',
  rank: 7,
  collect: ({ deps, now }) => {
    const t = /** @type {Partial<import('../tracker/files/tracker.mjs').FilesTracker>} */ (
      deps.tracker
    );
    if (typeof t.root !== 'function' || typeof t.layout !== 'function') return { section: null };
    /** @type {import('../tracker/files/sweep.mjs').Sweep} */
    let swept;
    try {
      swept = sweepTracker(/** @type {import('../tracker/files/tracker.mjs').FilesTracker} */ (t), {
        events: readLedger(deps.store).events,
        policy: deps.policy,
        now: Date.parse(now),
      });
    } catch {
      return { section: null };
    }
    const json = { sweep: { counts: swept.counts, findings: swept.findings } };
    if (swept.findings.length === 0) return { section: null, json };
    const kinds = Object.entries(swept.counts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`);
    /** @type {string[][]} */
    const entries = [
      [clip(`Tracker sweep: ${kinds.join(', ')} (hitld work sweep).`)],
      ...swept.findings.map((f) => [clip(`${f.item} ${f.kind}: ${f.why}`)]),
    ];
    return {
      section: { id: 'sweep', rank: 7, entries, noun: 'findings', news: false },
      json,
    };
  },
};
