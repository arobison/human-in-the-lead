// The flaky-test part of the digest (design 14.7): the tests in quarantine with their expiry and
// fix item, the ones whose quarantine has expired (each is a question for the owner, which
// `hitld quarantine list` carries as `decisions`), and the flake measures. It reads what
// `hitld quarantine list` reads: the quarantine file in the owner's checkout and the flake record
// in the private store, through core/lib/merge/quarantine.mjs.
//
// What is new is a test quarantined or removed since the read cursor, and a quarantine that
// expired since it. The list itself is state: it is shown when there is room, and never makes a
// digest on its own.

import {
  environmentLabels,
  expiredEntries,
  expiredQuestion,
  expiryInstant,
  flakeDigest,
  readFlakes,
  readQuarantine,
} from '../merge/quarantine.mjs';
import { clip } from './render.mjs';

/** @type {import('./parts.mjs').Part} */
export const flakesPart = {
  id: 'flakes',
  rank: 7,
  collect: ({ deps, since, now, root }) => {
    if (!root) return { section: null };
    const q = readQuarantine(root);
    if (!q.file) {
      return {
        section: {
          id: 'flakes',
          rank: 7,
          entries: [[clip('Quarantine file refused: run hitld check quarantine.')]],
          noun: 'lines',
          news: true,
        },
        json: { flakes: { problems: q.problems } },
      };
    }
    const records = readFlakes(deps.store);
    const at = new Date(now);
    const digest = flakeDigest({
      file: q.file,
      records,
      now: at,
      labels: environmentLabels(deps.policy.flake),
      quarantineDays: deps.policy.flake.quarantine_days,
    });
    const expired = expiredEntries(q.file, at);
    const decisions = expired.map((e) => ({
      test: e.id,
      expired: e.expires,
      fix_item: e.fix_item,
      question: expiredQuestion(e),
    }));
    const m = digest.measures;
    if (digest.size === 0 && m.failures === 0) {
      return { section: null, json: { flakes: { ...digest, decisions } } };
    }
    const after = (/** @type {string} */ time) => !since || time > since;
    const changed = records.some(
      (r) => (r.kind === 'quarantined' || r.kind === 'removed') && after(String(r.at)),
    );
    const newlyExpired = expired.some((e) =>
      after(new Date(expiryInstant(e.expires)).toISOString()),
    );

    const first = [
      clip(
        `Flaky tests: ${digest.size} quarantined${digest.size ? `, oldest ${digest.oldest_days} days` : ''}${expired.length ? `, ${expired.length} expired` : ''}.`,
      ),
    ];
    /** @type {string[][]} */
    const entries = [first];
    if (m.failures > 0) {
      const rate = m.flake_rate === null ? '' : ` (${Math.round(m.flake_rate * 100)}%)`;
      entries.push([
        clip(`Failures ${m.failures}, flake candidates ${m.flake_candidates}${rate}.`),
      ]);
    }
    const byExpiry = [...digest.quarantined].sort(
      (a, b) => Number(b.expired) - Number(a.expired) || a.expires.localeCompare(b.expires),
    );
    for (const e of byExpiry) {
      entries.push([
        clip(`${e.expired ? 'Expired: ' : ''}${e.test}, until ${e.expires}, fix ${e.fix_item}`),
      ]);
    }
    return {
      section: {
        id: 'flakes',
        rank: 7,
        entries,
        noun: 'lines',
        news: changed || newlyExpired,
      },
      json: { flakes: { ...digest, decisions } },
    };
  },
};
