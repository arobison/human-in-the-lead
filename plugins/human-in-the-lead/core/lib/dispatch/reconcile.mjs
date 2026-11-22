// The reconcile pass (HITLD-779, HITLD-780): completion is a fact the system observes, not a
// notice the orchestrator must be alive to receive. A dispatch is a ledger `dispatched` event and
// a claim branch; any orchestrator turn can look at what exists and record what has finished.
//
// For each in-flight dispatch the pass reads two things:
//
//   the branch head  whether it is the executor's closing commit (`close: <ID>`, with a
//                    `Dispatch: D-...` trailer naming this dispatch) and carries a report in the
//                    fixed shape in its message body
//   the harness      whether the executor has ended: a headless run's process has exited, an
//                    interactive session or a background agent is one the harness shows ended or
//                    idle (passed in, as only the harness knows), or the process a background agent
//                    ran inside has exited
//
// and judges it:
//
//   complete         a closing report for this dispatch, and the executor has ended: record it
//   awaiting_record  the same, for an interactive session whose harness record was not given: the
//                    tokens come from that record, so it waits for it
//   closing          a closing report, and the executor still runs: wait for it to end
//   unreported       the executor ended or went idle with no report for this dispatch
//   dead             its process is gone with no report
//   running          alive, with or without progress lately: shown with its evidence, nothing acts
//   foreign          a headless run on another machine: the pass there judges it
//
// Nothing here stops an executor, and no wall-clock time makes a verdict: a quiet executor is only
// shown with its evidence. Pure but for reading git; the command (cli/commands/reconcile.mjs)
// records what is complete through `dispatch complete`, whose ledger event is keyed by dispatch,
// so a second pass, or a second orchestrator, records nothing twice.

import { git } from '../tracker/files/tree.mjs';

/**
 * @typedef {import('../ledger/inflight.mjs').InFlight} InFlight
 *
 * @typedef {object} Closing what a branch head says, read from its commit message
 * @property {string} ref the ref read, such as refs/heads/exec/w-1
 * @property {string} sha
 * @property {string} subject
 * @property {string | null} item the item its `close: <ID>` subject names; null when it is not a closing commit
 * @property {string | null} dispatch its `Dispatch:` trailer
 * @property {string | null} report the message body before the trailers, when it holds anything
 *
 * @typedef {object} Harness what the harness shows of the executor
 * @property {boolean} ended it has ended (or is idle) by the harness's own account
 * @property {boolean} gone its process is gone: a headless run that exited without its result, or
 *   a background agent whose parent exited
 * @property {Record<string, unknown>} evidence what was seen, for the verdict
 *
 * @typedef {'complete' | 'awaiting_record' | 'closing' | 'unreported' | 'dead' | 'running' | 'foreign'} State
 */

/** Trailer lines: a capitalized key, as git writes them; the report's own fields are lowercase. */
const TRAILER = /^[A-Z][A-Za-z0-9-]*: \S/;
const CLOSE = /^close: (\S+)\s*$/;

/**
 * Read a commit message as a closing commit: its subject, the item it closes, its `Dispatch:`
 * trailer and the report its body carries.
 * @param {string} message @returns {Omit<Closing, 'ref' | 'sha'>}
 */
export function parseClosing(message) {
  const lines = String(message).replace(/\r\n?/g, '\n').trim().split('\n');
  const subject = lines[0] ?? '';
  const paragraphs = lines
    .slice(1)
    .join('\n')
    .split(/\n\s*\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const last = paragraphs.at(-1);
  const trailers =
    last && last.split('\n').every((l) => TRAILER.test(l)) ? /** @type {string} */ (last) : '';
  const body = (trailers ? paragraphs.slice(0, -1) : paragraphs).join('\n\n').trim();
  const dispatch = /^Dispatch: (\S+)\s*$/m.exec(trailers)?.[1] ?? null;
  return {
    subject,
    item: CLOSE.exec(subject)?.[1] ?? null,
    dispatch,
    report: body || null,
  };
}

/**
 * The heads of a dispatch's branch, local first, then the remote's copy: where an executor that
 * pushes its claim branch leaves its closing commit.
 * @param {string} repoRoot @param {string} branch @param {string | null} remote
 * @returns {Closing[]}
 */
export function branchHeads(repoRoot, branch, remote) {
  const refs = [`refs/heads/${branch}`, ...(remote ? [`refs/remotes/${remote}/${branch}`] : [])];
  /** @type {Closing[]} */
  const out = [];
  for (const ref of refs) {
    const sha = git(repoRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      allowFail: true,
    }).trim();
    if (!sha || out.some((x) => x.sha === sha)) continue;
    const message = git(repoRoot, ['log', '-1', '--format=%B', sha], { allowFail: true });
    out.push({ ref, sha, ...parseClosing(message) });
  }
  return out;
}

/**
 * The closing commit for this dispatch among a branch's heads, else null.
 * @param {Closing[]} heads @param {InFlight} entry
 */
export const closingFor = (heads, entry) =>
  heads.find((h) => h.item === entry.item && h.dispatch === entry.dispatch && h.report) ?? null;

/**
 * The report as the pass hands it on: its commit line names the head it was read from, since a
 * commit cannot name its own hash. A report whose commit is `none` keeps it.
 * @param {string} report @param {string} sha @param {string} branch
 */
export function withCommit(report, sha, branch) {
  return report.replace(/^commit:[ \t]*(.*)$/m, (line, value) =>
    /^none$/i.test(String(value).trim()) ? line : `commit: ${sha} (branch ${branch})`,
  );
}

/**
 * Judge one in-flight dispatch from its branch heads and what its harness shows.
 * @param {{ entry: InFlight, heads: Closing[], harness: Harness | null, hasRecord: boolean }} r
 *   harness: null when the dispatch runs on another machine and only that machine can see it;
 *   hasRecord: the harness's record of an interactive session was given
 * @returns {{ state: State, closing: Closing | null, why: string }}
 */
export function judgeDispatch({ entry, heads, harness, hasRecord }) {
  const closing = closingFor(heads, entry);
  const other = heads.find((h) => h.item === entry.item && h.dispatch !== entry.dispatch);
  const head = heads[0] ?? null;
  const noReport = !head
    ? `its branch ${entry.branch ?? '(none recorded)'} is not here`
    : other
      ? `its branch head ${other.sha.slice(0, 12)} closes ${entry.item} for ${other.dispatch ?? 'no dispatch'}, not ${entry.dispatch}`
      : head.item
        ? `its closing commit ${head.sha.slice(0, 12)} carries no report`
        : `its branch head ${head.sha.slice(0, 12)} is not a closing commit ("${head.subject.slice(0, 60)}")`;
  if (!harness) {
    return {
      state: 'foreign',
      closing,
      why: `it runs on ${entry.host}: the pass there sees its process`,
    };
  }
  if (closing) {
    if (!harness.ended && !harness.gone) {
      return {
        state: 'closing',
        closing,
        why: `its closing commit ${closing.sha.slice(0, 12)} carries its report, and the executor has not ended yet: it is recorded once it has`,
      };
    }
    if (entry.mode === 'interactive' && !hasRecord) {
      return {
        state: 'awaiting_record',
        closing,
        why: `its closing commit ${closing.sha.slice(0, 12)} carries its report and its session has ended; its tokens come from the session's record, which was not given`,
      };
    }
    return {
      state: 'complete',
      closing,
      why: `its closing commit ${closing.sha.slice(0, 12)} carries its report, and the executor has ended`,
    };
  }
  if (harness.gone) {
    return { state: 'dead', closing: null, why: `its process is gone, and ${noReport}` };
  }
  if (harness.ended) {
    return {
      state: 'unreported',
      closing: null,
      why: `the harness shows it ended or idle, and ${noReport}`,
    };
  }
  return {
    state: 'running',
    closing: null,
    why: `it has not ended; ${noReport}. Nothing acts on it`,
  };
}
