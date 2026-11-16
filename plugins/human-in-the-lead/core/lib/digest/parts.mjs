// The named parts a digest is assembled from (design parts 12.2 and 23.5). Each part reads the
// records for one kind of news since the read cursor and returns a section of lines, with the data
// behind it for the JSON. A part changes nothing, and no part reads the orchestrator's memory: the
// ledger, the tracker, the private store and the quota report are the sources.
//
// To add a part, give it an id, a rank (who keeps its lines when the digest is too long) and a
// `collect`, and put it in PARTS at the place its section is shown. See flakes.mjs for one that
// waits for its data.

import { effectiveEvents } from '../ledger/summary.mjs';
import { readLedger } from '../ledger/ledger.mjs';
import { waited } from '../merge/owner.mjs';
import { revertCommand } from '../merge/pull-request.mjs';
import { MODE_LABEL } from '../quota/report.mjs';
import { listApplications, listLoggedCalls, precedentHealth } from '../rights/flow.mjs';
import { describeOption, optionIndex, optionLetter } from '../rights/format.mjs';
import { askedRecord, listDefaults } from '../rights/pending.mjs';
import { readTrustEvents, rubberStamps } from '../rights/trust.mjs';
import { flakesPart } from './flakes.mjs';
import { sweepPart } from './sweep.mjs';
import { clip, wrap } from './render.mjs';

/**
 * @typedef {import('../rights/flow.mjs').Deps} Deps
 * @typedef {import('./render.mjs').Section} Section
 *
 * @typedef {object} PartContext what every part reads
 * @property {Deps} deps the project's policy, tracker, precedents and private store
 * @property {string | null} since the read cursor: only news after it. null for a first digest
 * @property {string} now ISO 8601
 * @property {'merge-batch' | 'owner-writes'} trigger
 * @property {{ decisions: Record<string, any>[], waiting: Record<string, any>[] }} pending what
 *   `hitld rights pending` says, with quiet hours left out: what the digest would say outside them
 * @property {Record<string, any> | null} report the quota report, when the caller has one
 * @property {import('../machine/disk.mjs').DiskState | null} [disk] free disk against the floor
 * @property {string | null} root the owner's checkout, where the quarantine file is
 * @property {{ through: string | null, quota: { mode: string, thresholds: string[] } | null,
 *   disk?: string | null }} last what the last marked digest recorded
 *
 * @typedef {object} Part
 * @property {string} id
 * @property {number} rank who keeps its lines when the digest is too long: lowest first
 * @property {(c: PartContext) => { section: Section | null, json?: Record<string, unknown> }} collect
 */

/** @param {Deps} deps @param {string} id @returns {string} */
function titleOf(deps, id) {
  try {
    return String(deps.tracker.get(id).title ?? '');
  } catch {
    return '';
  }
}

/** @param {number} n @param {string} one @param {string} many */
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Questions: the decisions to put in front of the owner now, most costly to delay first, each with
// the recommendation inline so it can be answered from the digest alone.

/** @type {Part} */
const questions = {
  id: 'questions',
  rank: 1,
  collect: ({ deps, pending }) => {
    const listed = pending.decisions
      .filter((d) => d.deliver === 'now' || d.deliver === 'digest')
      .sort(
        (a, b) => b.cost_of_delay - a.cost_of_delay || String(a.decision).localeCompare(b.decision),
      );
    /** @type {Record<string, any>[]} */
    const data = [];
    /** @type {string[][]} */
    const entries = [];
    listed.forEach((d, i) => {
      const id = String(d.decision);
      const asked = askedRecord(deps, id);
      /** @type {Record<string, any>} */
      let entity = {};
      try {
        entity = deps.tracker.get(id);
      } catch {
        // The question is still listed, from what the gate knows.
      }
      const options = /** @type {Record<string, any>[]} */ (asked?.options ?? entity.options ?? []);
      const rec = asked?.recommendation ?? entity.recommendation ?? null;
      const at = rec ? optionIndex({ options }, String(rec.option)) : null;
      const letter = at === null ? (rec ? String(rec.option) : null) : optionLetter(at);
      const label = at !== null && options[at].label !== letter ? String(options[at].label) : null;
      data.push({
        decision: id,
        title: d.title,
        deliver: d.deliver,
        reason: d.reason,
        cost_of_delay: d.cost_of_delay,
        critical_path: d.critical_path,
        blocks: d.blocks,
        reversibility: d.reversibility,
        ...(asked?.check ? { check: asked.check } : {}),
        ...(rec
          ? {
              recommendation: {
                option: letter,
                ...(label ? { label } : {}),
                ...(at !== null ? { what: describeOption(options[at], at) } : {}),
                why: rec.why,
              },
            }
          : {}),
      });
      const facts = [
        d.blocks.length ? `blocks ${d.blocks.length}` : null,
        d.critical_path ? 'critical path' : null,
        d.deliver === 'now' ? 'needed now' : null,
        d.reversibility === 'one-way'
          ? 'hard to undo'
          : d.reversibility === 'two-way'
            ? 'easy to undo'
            : null,
        asked?.check ? `check ${asked.check}` : null,
      ].filter(Boolean);
      entries.push([
        clip(`${i + 1}. ${id} ${d.title}`),
        ...(facts.length ? [clip(`   ${facts.join(' · ')}`)] : []),
        ...(rec
          ? wrap(`Recommend ${letter}${label ? ` (${label})` : ''}: ${rec.why}`, '   ', '   ', 2)
          : []),
      ]);
    });
    return {
      section: entries.length
        ? {
            id: 'questions',
            rank: 1,
            title: 'Questions, most costly to delay first',
            entries,
            noun: 'questions',
            notes: ['Reply with an ID and a choice.'],
            news: true,
          }
        : null,
      json: { questions: data },
    };
  },
};

// Decisions already in front of the owner and not answered, and those held back.

/** @type {Part} */
const waiting = {
  id: 'waiting',
  rank: 2,
  collect: ({ pending }) => {
    const data = pending.waiting;
    return {
      section: data.length
        ? {
            id: 'waiting',
            rank: 2,
            title: 'Still waiting on you',
            entries: data.map((w) => [
              clip(`${w.decision} ${w.title}, ${waited(w.waiting_minutes * 60_000)}`),
            ]),
            noun: 'questions',
            news: false,
          }
        : null,
      json: { waiting: data },
    };
  },
};

/** @type {Part} */
const held = {
  id: 'held',
  rank: 9,
  collect: ({ pending }) => {
    const hold = pending.decisions.filter((d) => d.deliver === 'hold');
    const due = pending.decisions.filter((d) => d.deliver === 'default');
    const bits = [
      hold.length ? `${count(hold.length, 'question waits', 'questions wait')} for room` : null,
      due.length
        ? `${count(due.length, 'default is', 'defaults are')} due (hitld rights sweep)`
        : null,
    ].filter(Boolean);
    return {
      section: bits.length
        ? {
            id: 'held',
            rank: 9,
            entries: [wrap(`Held: ${bits.join('; ')}.`, '', '  ', 2)],
            news: false,
          }
        : null,
      json: {
        held: hold.map((d) => d.decision),
        defaults_due: due.map((d) => d.decision),
      },
    };
  },
};

// Items merged since the cursor, from the ledger. One merged without asking under the owner's
// delegation (a merged event naming its decision) says so, with the command that reverses it.

/** @type {Part} */
const merged = {
  id: 'merged',
  rank: 5,
  collect: ({ deps, since }) => {
    const events = effectiveEvents(readLedger(deps.store).events);
    const after = events.filter((e) => !since || e.at > since);
    /** @type {Map<string, Record<string, any>>} */
    const byItem = new Map();
    for (const e of after) {
      if (e.event === 'merged') byItem.set(e.item, e);
      else if (e.event === 'reverted') byItem.delete(e.item);
    }
    const mergedItems = [...byItem.values()].map((e) => ({
      item: e.item,
      title: titleOf(deps, e.item),
      at: e.at,
      ...(e.commit ? { commit: e.commit } : {}),
      ...(e.decision && e.commit
        ? {
            delegated_by: e.decision,
            reverse: revertCommand({ item: e.item, commit: e.commit }),
          }
        : {}),
    }));
    const reverted = after
      .filter((e) => e.event === 'reverted')
      .map((e) => ({ item: e.item, title: titleOf(deps, e.item), at: e.at }));
    const entries = [
      ...mergedItems.map((m) =>
        m.delegated_by
          ? wrap(
              `${m.title}, merged without asking under ${m.delegated_by}. Reverse it: git revert ${String(m.commit).slice(0, 12)}`,
              `${m.item} `,
              '   ',
              3,
            )
          : [clip(`${m.item} ${m.title}`)],
      ),
      ...reverted.map((m) => [clip(`${m.item} reverted ${m.title}`)]),
    ];
    return {
      section: entries.length
        ? {
            id: 'merged',
            rank: 5,
            title: 'Merged',
            entries,
            noun: 'items',
            ...(mergedItems.some((m) => m.delegated_by)
              ? {
                  notes: [
                    `Reverse a merge made without asking: ${revertCommand({ item: '<ID>', commit: '<commit>' })}`,
                  ],
                }
              : {}),
            news: true,
          }
        : null,
      json: { merged: mergedItems, reverted },
    };
  },
};

// Calls made without asking, and defaults applied, each with how to reverse it.

/**
 * Who made a logged call: its session and machine, as far as they are recorded.
 * @param {{ session?: string, host?: string }} c
 */
const madeBy = (c) =>
  c.session || c.host
    ? ` (by ${[c.session ? `session ${c.session}` : null, c.host ? `on ${c.host}` : null].filter(Boolean).join(' ')})`
    : '';

/** @type {Part} */
const calls = {
  id: 'calls',
  rank: 3,
  collect: ({ deps, since }) => {
    const logged = listLoggedCalls(deps, { since });
    const defaults = listDefaults(deps, { since });
    const entries = [
      ...logged.map((c) =>
        wrap(`${c.text}${madeBy(c)}${c.reversed ? ' (reversed)' : ''}`, `${c.id} `, '   ', 2),
      ),
      ...defaults.map((d) =>
        wrap(
          `took its default: ${d.title}${d.reversed ? ' (reversed)' : ''}`,
          `${d.decision} `,
          '   ',
          2,
        ),
      ),
    ];
    return {
      section: entries.length
        ? {
            id: 'calls',
            rank: 3,
            title: 'Calls made without asking',
            entries,
            noun: 'calls',
            notes: ['Reverse one: hitld rights reverse <ID>'],
            news: true,
          }
        : null,
      json: { logged_calls: logged, defaults },
    };
  },
};

// Precedent applied since the cursor, with those the owner overruled, and precedents due for review.

/** @type {Part} */
const precedent = {
  id: 'precedent',
  rank: 4,
  collect: ({ deps, since }) => {
    const applications = listApplications(deps, { since });
    const entries = applications.map((a) =>
      wrap(
        `by ${a.precedent}: ${a.title}${a.overruled ? ' (overruled)' : ''}`,
        `${a.decision} `,
        '   ',
        2,
      ),
    );
    return {
      section: entries.length
        ? {
            id: 'precedent',
            rank: 4,
            title: 'Precedent applied',
            entries,
            noun: 'applications',
            notes: ['Overrule one: hitld rights overrule <ID>'],
            news: true,
          }
        : null,
      json: { applications, overruled: applications.filter((a) => a.overruled).length },
    };
  },
};

/** @type {Part} */
const review = {
  id: 'review',
  rank: 6,
  collect: ({ deps }) => {
    const due = precedentHealth(deps).filter((h) => h.needs_review);
    return {
      section: due.length
        ? {
            id: 'review',
            rank: 6,
            title: 'Precedent due for review',
            entries: due.map((h) => [
              clip(`${h.precedent}: ${h.overrules} of ${h.applications} applications overruled`),
            ]),
            noun: 'precedents',
            news: false,
          }
        : null,
      json: { review: due },
    };
  },
};

// Where the owner took the recommendation quickly most of the time, among the areas answered in
// this digest. A prompt to look at the recommendations there, not a finding about the owner.

/** @type {Part} */
const stamp = {
  id: 'stamp',
  rank: 7,
  collect: ({ deps, since }) => {
    const events = readTrustEvents(deps.store);
    const all = rubberStamps(events, {
      rubberStampSeconds: deps.policy.trust?.rubber_stamp_seconds,
    });
    const fresh = new Set(
      events.filter((e) => e.kind === 'answered' && (!since || e.at > since)).map((e) => e.area),
    );
    const shown = all.filter((r) => fresh.has(r.area) && (r.rubber_stamp_rate ?? 0) > 0.5);
    return {
      section: shown.length
        ? {
            id: 'stamp',
            rank: 7,
            entries: [
              wrap(
                `Recommendation taken within ${shown[0].quick_seconds} s: ${shown
                  .map((r) => `${r.area} ${r.quick_and_agreeing} of ${r.answers}`)
                  .join(', ')}. Worth a look at those recommendations.`,
                '',
                '  ',
                3,
              ),
            ],
            news: false,
          }
        : null,
      json: { rubber_stamp: all },
    };
  },
};

// Quota and merge-queue lines, from the report the quota commands build.

/** @type {Part} */
const merges = {
  id: 'merges',
  rank: 2,
  collect: ({ report }) => {
    const waitingMerge = /** @type {Record<string, any>[]} */ (report?.waiting_for_owner ?? []);
    return {
      section: waitingMerge.length
        ? {
            id: 'merges',
            rank: 2,
            title: 'Waiting for your merge',
            entries: waitingMerge.map((w) => [
              clip(`${w.item} on ${w.branch ?? 'no branch'}, waiting ${waited(w.waited_ms)}`),
            ]),
            noun: 'branches',
            news: false,
          }
        : null,
      json: { waiting_for_merge: waitingMerge },
    };
  },
};

/** @type {Part} */
const quota = {
  id: 'quota',
  rank: 8,
  collect: ({ report, last }) => {
    if (!report || (report.gate.mode === 'normal' && report.quotas.length === 0)) {
      return { section: null };
    }
    const g = report.gate;
    const label = MODE_LABEL[/** @type {keyof typeof MODE_LABEL} */ (g.mode)];
    /** @type {string[][]} */
    const entries = [
      [clip(`Dispatch: ${label}.`), ...(g.mode === 'normal' ? [] : wrap(g.reason, '  ', '  ', 2))],
    ];
    if (g.forecast) entries.push(wrap(g.forecast, '', '  ', 2));
    for (const t of /** @type {string[]} */ (report.thresholds))
      entries.push([clip(`Threshold: ${t}.`)]);
    if (g.ask_owner)
      entries.push(wrap('The owner is asked before this hard limit is passed.', '', '  ', 2));
    // News when it differs from what the last digest showed; a quota that stays as it was is state.
    const thresholds = /** @type {string[]} */ (report.thresholds);
    const changed = last.quota
      ? last.quota.mode !== g.mode || last.quota.thresholds.join('|') !== thresholds.join('|')
      : g.mode !== 'normal' || thresholds.length > 0;
    return {
      section: {
        id: 'quota',
        rank: 8,
        entries,
        noun: 'lines',
        news: changed,
      },
      json: {
        quota: {
          mode: g.mode,
          reason: g.reason,
          forecast: g.forecast,
          thresholds: report.thresholds,
        },
      },
    };
  },
};

// Free disk, when it nears or passes the machine's floor (machine/disk.mjs): below it no new work
// starts. News when its state differs from what the last digest showed.

/** @type {Part} */
const disk = {
  id: 'disk',
  rank: 3,
  collect: ({ disk: d, last }) => {
    if (!d || (d.state !== 'near' && d.state !== 'below')) return { section: null };
    return {
      section: {
        id: 'disk',
        rank: 3,
        title: d.state === 'below' ? 'Disk below the floor' : 'Disk near the floor',
        entries: [wrap(`${d.reason}.`, '', '  ', 3)],
        noun: 'lines',
        news: (last.disk ?? 'ok') !== d.state,
      },
      json: { disk: d },
    };
  },
};

/**
 * The parts, in the order their sections are shown. Questions come first; each part's `rank` says
 * who keeps its lines when the digest is too long.
 * @type {readonly Part[]}
 */
export const PARTS = Object.freeze([
  questions,
  waiting,
  held,
  merges,
  merged,
  calls,
  precedent,
  review,
  stamp,
  flakesPart,
  sweepPart,
  quota,
  disk,
]);
