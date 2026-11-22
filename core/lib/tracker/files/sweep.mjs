// The stale-item sweep (design part 13.3): `hitld work sweep`. It reads the tracker against what
// changed and lists what drifted, as findings. It is deterministic and uses no model: the same
// tracker, branches, ledger, policy and clock always give the same findings. It changes nothing;
// the orchestrator plans from the findings, the digest lists them, and the curator's pass (design
// part 8) reads work items for what a script cannot see.
//
// The kinds, in the order they are listed:
//
//   orphaned-claim         a claim branch whose dispatch is not in flight in the ledger
//   proposed-too-old       a `proposed` item older than `sweep.proposed_max_age` days
//   blockers-resolved      a blocked item whose open needs are all closed (dropped), so nothing it
//                          waits on will ever be done
//   merged-but-open        an item whose branch merged but which is still open on the main branch:
//                          a ledger `merged` event names it, or a commit on the main branch carries
//                          its Work-Item and a Dispatch trailer
//   release-needs-overlap  two release items whose needs include the same item
//   missing-release-note   an item whose commits since a package's last full release changed its
//                          surface file, with no `release_note`
//
// A kind that cannot be checked is listed under `skipped` with the reason, never reported clean.

import { inflight } from '../../ledger/inflight.mjs';
import { DISPATCH_ID } from '../../ledger/ids.mjs';
import { itemFiles, packageTags } from '../../release/propose.mjs';
import { isPrerelease } from '../../release/semver.mjs';
import { findClaims, mainRef, unclaimedClaims } from './claims.mjs';
import { allowedKeys } from './format.mjs';
import { buildGraph } from './graph.mjs';
import { git, idNumber, loadWorkTree } from './tree.mjs';

/**
 * @typedef {import('./tracker.mjs').FilesTracker} FilesTracker
 * @typedef {import('../../ledger/ledger.mjs').LedgerEntry} LedgerEntry
 *
 * @typedef {object} Finding
 * @property {string} kind one of SWEEP_KINDS
 * @property {string} item the item the finding is about
 * @property {string} title
 * @property {string} why in words
 * @property {string} [dispatch] orphaned-claim: the claimant
 * @property {string} [branch] orphaned-claim: where the claim lives
 * @property {number} [age_days] proposed-too-old
 * @property {string[]} [needs] blockers-resolved: the closed needs it still waits on
 * @property {string[]} [evidence] merged-but-open: the commits and ledger events that say it merged
 * @property {string} [other] release-needs-overlap: the other release item
 * @property {string[]} [shared] release-needs-overlap: the needs both hold
 * @property {string[]} [files] missing-release-note: the surface files its commits changed
 *
 * @typedef {object} Sweep
 * @property {Finding[]} findings
 * @property {Record<string, number>} counts findings per kind, every kind listed
 * @property {string[]} checked the kinds that were checked
 * @property {{ kind: string, why: string }[]} skipped the kinds that were not, and why
 */

/** Every finding kind, in the order findings are listed. */
export const SWEEP_KINDS = Object.freeze([
  'orphaned-claim',
  'proposed-too-old',
  'blockers-resolved',
  'merged-but-open',
  'release-needs-overlap',
  'missing-release-note',
]);

const DAY = 86_400_000;
const DISPATCH = DISPATCH_ID;

/** @param {unknown} v @returns {string[]} */
const ids = (v) =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Items the main branch's history says merged: commits with a Work-Item and a Dispatch trailer
 * (an executor's branch, whether merged, rebased or squashed), leaving out unclaim commits and
 * claim commits an unclaim retired.
 * @param {string} root @param {import('./config.mjs').Layout} layout
 * @returns {Map<string, string[]>} item ID to the commits, short
 */
function mergedOnMain(root, layout) {
  /** @type {Map<string, string[]>} */
  const out = new Map();
  const main = mainRef(root, layout);
  if (!main) return out;
  const retired = [...unclaimedClaims(root, layout)];
  const log = git(
    root,
    [
      'log',
      main,
      '--format=%x1e%H%x1f%s%x1f%(trailers:key=Work-Item,valueonly,separator=%x2C)%x1f%(trailers:key=Dispatch,valueonly,separator=%x2C)',
    ],
    { allowFail: true },
  );
  for (const rec of log.split('\x1e')) {
    const [sha, subject, items, dispatches] = rec.trim().split('\x1f');
    if (!sha || !ids(dispatches).some((d) => DISPATCH.test(d))) continue;
    if (/^(unclaim|release): /.test(subject ?? '')) continue;
    if (retired.some((r) => sha.startsWith(r) || r.startsWith(sha))) continue;
    for (const id of ids(items)) out.set(id, [...(out.get(id) ?? []), sha.slice(0, 12)]);
  }
  return out;
}

/**
 * Sweep the tracker.
 * @param {FilesTracker} t
 * @param {{ events: LedgerEntry[], policy: Record<string, any>, now: number }} input
 *   events: the ledger, oldest first; policy: the effective policy; now: the clock, in ms
 * @returns {Sweep}
 */
export function sweepTracker(t, { events, policy, now }) {
  const root = t.root();
  const layout = t.layout();
  const g = buildGraph(loadWorkTree(root, layout));
  /** @type {Finding[]} */
  const findings = [];
  /** @type {string[]} */
  const checked = [];
  /** @type {{ kind: string, why: string }[]} */
  const skipped = [];
  /** @param {string} id */
  const titleOf = (id) => String(g.get(id)?.data.title ?? '');

  // Orphaned claims. Without a dispatch in the ledger there is nothing to match a claim against,
  // and every claim would look orphaned.
  if (!events.some((e) => e.event === 'dispatched')) {
    skipped.push({
      kind: 'orphaned-claim',
      why: 'the ledger records no dispatch, so claims cannot be matched against it',
    });
  } else {
    checked.push('orphaned-claim');
    const running = new Set(inflight(events).map((d) => d.dispatch));
    for (const c of findClaims(root, layout)) {
      for (const cl of c.claims) {
        if (!DISPATCH.test(cl.claimant) || running.has(cl.claimant)) continue;
        findings.push({
          kind: 'orphaned-claim',
          item: c.id,
          title: c.title,
          why: `claimed by ${cl.claimant} on ${cl.branch}, but that dispatch is not in flight`,
          dispatch: cl.claimant,
          branch: cl.branch,
        });
      }
    }
  }

  // Proposed items older than the policy allows. 0 is off.
  const maxAge = Number(policy.sweep?.proposed_max_age ?? 0);
  if (!(maxAge > 0)) {
    skipped.push({ kind: 'proposed-too-old', why: 'sweep.proposed_max_age is 0 (off)' });
  } else {
    checked.push('proposed-too-old');
    for (const it of g.items) {
      if (it.data.state !== 'proposed') continue;
      const created = Date.parse(String(it.data.created ?? ''));
      if (Number.isNaN(created)) continue;
      const age = Math.floor((now - created) / DAY);
      if (age <= maxAge) continue;
      findings.push({
        kind: 'proposed-too-old',
        item: String(it.data.id),
        title: String(it.data.title),
        why: `proposed for ${age} days (sweep.proposed_max_age ${maxAge})`,
        age_days: age,
      });
    }
  }

  // Blocked items whose blockers are resolved: every need still open is closed (dropped).
  checked.push('blockers-resolved');
  for (const it of g.items) {
    if (!g.isBlocked(it)) continue;
    const open = g.openNeeds(it);
    const closed = open.filter((n) => {
      const need = g.get(n);
      return need !== undefined && !g.isOpen(need);
    });
    if (closed.length === 0 || closed.length !== open.length) continue;
    findings.push({
      kind: 'blockers-resolved',
      item: String(it.data.id),
      title: String(it.data.title),
      why: `blocked only on ${closed.join(', ')}, which ${closed.length === 1 ? 'is' : 'are'} dropped`,
      needs: closed,
    });
  }

  // Items whose branch merged but which are still open on the main branch.
  checked.push('merged-but-open');
  /** @type {Map<string, string[]>} */
  const merged = mergedOnMain(root, layout);
  for (const e of events) {
    if (e.event !== 'merged' || e.corrects !== undefined || typeof e.item !== 'string') continue;
    merged.set(e.item, [...(merged.get(e.item) ?? []), `ledger ${e.id}`]);
  }
  for (const [id, evidence] of [...merged].sort(([a], [b]) => idNumber(a) - idNumber(b))) {
    const it = g.get(id);
    if (!it || !g.isItem(it) || !g.isOpen(it)) continue;
    findings.push({
      kind: 'merged-but-open',
      item: id,
      title: String(it.data.title),
      why: `its branch merged (${evidence.slice(0, 3).join(', ')}${evidence.length > 3 ? ', ...' : ''}), but it is ${it.data.state}`,
      evidence,
    });
  }

  // Release items whose needs include items another release item also needs.
  checked.push('release-needs-overlap');
  const releaseItems = g.items.filter((it) => it.data.release !== undefined);
  releaseItems.forEach((a, i) => {
    const mine = new Set(g.needs(a));
    for (const b of releaseItems.slice(i + 1)) {
      const shared = g.needs(b).filter((n) => mine.has(n));
      if (!shared.length) continue;
      findings.push({
        kind: 'release-needs-overlap',
        item: String(a.data.id),
        title: String(a.data.title),
        why: `release ${a.data.release} and release ${b.data.release} (${b.data.id}) both need ${shared.join(', ')}`,
        other: String(b.data.id),
        shared,
      });
    }
  });

  // Items that changed public surface without a release note, since the last full release.
  if (!allowedKeys('work', layout).includes('release_note')) {
    skipped.push({
      kind: 'missing-release-note',
      why: 'release_note is not turned on for this tracker (optional_keys in tracker.json)',
    });
  } else {
    const packages = (layout.packages ?? []).filter((p) => p.surface);
    if (!packages.length) {
      skipped.push({
        kind: 'missing-release-note',
        why: (layout.packages ?? []).length
          ? 'no release package declares a surface file (policy.json release.packages)'
          : 'no release package is declared (policy.json release.packages)',
      });
    } else {
      checked.push('missing-release-note');
      // Per package: the items whose commits since its last full release changed its surface file.
      /** @type {Map<string, { files: Set<string>, since: string[] }>} */
      const found = new Map();
      for (const p of packages) {
        const base =
          [...packageTags(root, p)].reverse().find((x) => !isPrerelease(x.version))?.tag ?? null;
        for (const [id, files] of itemFiles(root, base)) {
          if (!files.has(/** @type {string} */ (p.surface))) continue;
          const f = found.get(id) ?? { files: new Set(), since: [] };
          f.files.add(/** @type {string} */ (p.surface));
          if (base) f.since.push(base);
          found.set(id, f);
        }
      }
      for (const [id, { files, since }] of [...found].sort(
        ([a], [b]) => idNumber(a) - idNumber(b),
      )) {
        const it = g.get(id);
        if (!it || it.data.kind !== 'work' || it.data.release_note) continue;
        const list = [...files].sort();
        findings.push({
          kind: 'missing-release-note',
          item: id,
          title: titleOf(id),
          why: `its commits${since.length ? ` since ${since.join(', ')}` : ''} changed a package's surface file (${list.join(', ')}), and it has no release_note`,
          files: list,
        });
      }
    }
  }

  const rank = (/** @type {string} */ k) => SWEEP_KINDS.indexOf(k);
  findings.sort((a, b) => rank(a.kind) - rank(b.kind) || idNumber(a.item) - idNumber(b.item));
  /** @type {Record<string, number>} */
  const counts = Object.fromEntries(SWEEP_KINDS.map((k) => [k, 0]));
  for (const f of findings) counts[f.kind]++;
  return { findings, counts, checked, skipped };
}
