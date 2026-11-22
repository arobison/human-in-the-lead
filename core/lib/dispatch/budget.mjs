// An executor's token budget, enforced inside the executor (HITLD-782, the owner's decision
// HITLD-786): a PostToolUse hook sums the executor's usage since its dispatch started and, at the
// dispatch's cap, tells it to close; a PreToolUse rule then refuses every tool call but the closing
// steps. The reconcile pass is the hard backstop for an overrun the hook missed: it reads the
// harness's usage record and stops the dispatch (`hitld dispatch stop`).
//
// The cap is the figure the brief asks the executor to report at: the dispatch's start estimate as
// the ledger reads it (startEstimate, capped against a poisoned figure) times
// dispatch.report_at_budget_multiple.
//
// The usage comes from the executor's own transcript file. That is a narrow written exception to
// the rule that transcripts are never parsed (design part 12.5): counts only, never content. The
// reader keeps nothing of a line but the numbers of its usage, its time and its message ID (to
// count a message once when the transcript writes it in several lines); nothing it returns is a
// string from the transcript, so nothing the hook prints, records or logs can carry content.

import { startEstimate } from '../ledger/ledger.mjs';

/** What the hook tells the executor at its cap, and the guard's reason past it. */
export const BUDGET_REACHED = 'budget reached: commit, push, report';

/** @param {unknown} v */
const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

/**
 * @typedef {object} TranscriptUsage
 * @property {number} tokens output plus fresh input (uncached input and input written to the
 *   cache), never cache reads: the figure a completion records (completion.mjs, HITLD-436)
 * @property {number} messages the model responses counted
 */

/**
 * Sum the usage of the model's responses in a transcript, since a time. Only the assistant lines'
 * `message.usage` numbers, `timestamp` and `message.id` are read; a line that does not parse, or
 * has no usage, counts nothing. A response written in several lines (one per content block) is
 * counted once, by its last line.
 * @param {string} text the transcript, JSON lines
 * @param {{ since?: string | null }} [o] leave out responses before this time (the dispatch's
 *   start): a follow-up continues a session an earlier dispatch spent
 * @returns {TranscriptUsage}
 */
export function transcriptUsage(text, o = {}) {
  const since = o.since ? Date.parse(o.since) : NaN;
  /** @type {Map<string, number>} */
  const byMessage = new Map();
  let anonymous = 0;
  let unnamed = 0;
  for (const line of String(text).split('\n')) {
    // Cheap first: most lines are tool results and attachments, which carry no usage.
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
    let tokens = 0;
    let id = null;
    try {
      const o = JSON.parse(line);
      if (o?.type !== 'assistant') continue;
      const at = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
      if (!Number.isNaN(since) && (Number.isNaN(at) || at < since)) continue;
      const u = o.message?.usage;
      if (!u || typeof u !== 'object') continue;
      tokens =
        count(u.input_tokens) + count(u.output_tokens) + count(u.cache_creation_input_tokens);
      id = typeof o.message.id === 'string' && o.message.id ? o.message.id : null;
    } catch {
      continue;
    }
    if (id === null) {
      anonymous += tokens;
      unnamed += 1;
    } else byMessage.set(id, tokens);
  }
  let tokens = anonymous;
  for (const t of byMessage.values()) tokens += t;
  return { tokens, messages: byMessage.size + unnamed };
}

/**
 * The dispatch's cap and when it started, from the ledger: its start estimate times
 * dispatch.report_at_budget_multiple, and its `dispatched` event's time. Null when the ledger has
 * no such dispatch or no estimate for it (tier 0, or a line written before estimates): then
 * nothing is enforced here.
 * @param {import('../ledger/ledger.mjs').LedgerEntry[]} events @param {string} dispatch
 * @param {Record<string, any>} [d] policy.dispatch
 * @returns {{ cap: number, since: string, item: string } | null}
 */
export function budgetOf(events, dispatch, d) {
  const started = events.find(
    (e) => e.event === 'dispatched' && e.dispatch === dispatch && e.corrects === undefined,
  );
  if (!started) return null;
  const estimate = startEstimate(events, dispatch, started.item, d);
  if (!(typeof estimate === 'number' && estimate > 0)) return null;
  const multiple =
    typeof d?.report_at_budget_multiple === 'number' && d.report_at_budget_multiple >= 1
      ? d.report_at_budget_multiple
      : 1.5;
  return { cap: Math.round(estimate * multiple), since: started.at, item: started.item };
}

/** The Bash commands that close a dispatch: commit, push, close, and reading what to report. */
const CLOSING_COMMAND =
  /^(?:\w+=\S*\s+)*(?:git\s+(?:-C\s+\S+\s+)?(?:add|commit|push|status|log|diff|show|rev-parse|branch\s+--show-current)\b|(?:node\s+\S*)?hitld(?:\.mjs)?\s+(?:work\s+close|publish\s+check)\b|cd\s+\S+$)/;

/** The tools that send the report: the harness's message tools. */
const REPORT_TOOL = /^(?:SendMessage|mcp__[A-Za-z0-9_-]+__send_message)$/;

/**
 * Whether a tool call is one of the closing steps an executor past its cap may still take: a
 * commit, a push, `hitld work close`, `hitld publish check` on its report text, the git reads it
 * needs for its report, and the message tool that sends the report. A Bash command counts only when
 * every part of it is one of those: quoted text (a commit message) is set aside first, and a
 * command substitution or a backquote anywhere refuses it.
 * @param {Record<string, any>} input the hook input
 */
export function isClosingStep(input) {
  const tool = typeof input.tool_name === 'string' ? input.tool_name : 'Bash';
  if (REPORT_TOOL.test(tool)) return true;
  if (tool !== 'Bash') return false;
  const command = String(input.tool_input?.command ?? '');
  if (/\$\(|`|<\(|>\(/.test(command)) return false;
  // Quoted text is a commit message or a path: set aside, so its words are not read as commands.
  const bare = command.replace(/'[^']*'|"(?:[^"\\$]|\\.)*"/g, "''");
  if (/["'](?!')|[<>]/.test(bare.replace(/''/g, ''))) return false;
  const parts = bare
    .split(/&&|\|\||[;|\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((x) => CLOSING_COMMAND.test(x));
}

/**
 * The refusal past the cap, with the figures. Numbers and the dispatch ID only.
 * @param {{ dispatch: string, tokens: number, cap: number }} b
 */
export const budgetReason = (b) =>
  `${BUDGET_REACHED} (${b.dispatch}: ${b.tokens} of ${b.cap} tokens); only the closing steps are allowed now: git add, git commit, git push of your branch, hitld work close, and the message that sends your report`;
