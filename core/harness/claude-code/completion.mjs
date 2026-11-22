// Completions from Claude Code, as the orchestrator hands them to `hitld dispatch complete`
// (design part 15.4). Session transcript files are never parsed here; the executor's budget hook
// reads their token counts only, the one written exception (core/lib/dispatch/budget.mjs).
//
//   subagent  the background-agent notification: the agent's final message, and the token,
//             tool-use and duration counts the desktop app was observed to include (undocumented,
//             so recorded when present and labeled)
//   headless  the JSON result of claude -p --output-format json: result, session_id, usage,
//             total_cost_usd (documented), and permission_denials, the tool calls the permission
//             mode refused, when present
//   session   the harness's own record of an interactive session (HITLD-438): the result messages
//             it keeps, one per turn, as a cloud session's event list returns them or as
//             claude -p --output-format stream-json writes them. Each carries the turn's usage and
//             total_cost_usd, the fields of the documented result message; the per-turn breakdown
//             by model (model_usage_since_last_result) is read when present
//
// What a completion's tokens count (HITLD-436): output tokens plus fresh input, which is uncached
// input and input written to the cache. Never cache reads: a long run rereads its cached context on
// every turn, so a cache-read total can be hundreds of times what the run cost, and a ledger that
// recorded it would take one run for the cost of many. The parts are kept apart beside it (HITLD-438),
// cache reads included, with the cost the harness reports.
//
// Where the figure came from (tokens_source on the ledger's reported event):
//   session-record  measured: the harness's record of the executor's session
//   result-file     measured: a headless run's result
//   notification    measured by the harness, from the usage block of its completion notification
//                   (undocumented)
//   typed           typed by hand (--tokens), when the harness record was not available
// What the executor says its own cost was is never any of these: it is kept apart as a
// self-reported guess (selfReportedTokens).

/**
 * @typedef {import('../interface.mjs').Completion} Completion
 * @typedef {'session-record' | 'result-file' | 'notification' | 'typed'} TokensSource
 * @typedef {{ input_tokens: number | null, output_tokens: number | null, cache_write_tokens: number | null, cache_read_tokens: number | null, cost_usd: number | null }} UsageParts
 *   the harness's counts, kept apart: uncached input, output, input written to the cache, input
 *   read from the cache, and the cost it reports in US dollars
 * @typedef {Omit<Completion, 'dispatch'> & { sessionId?: string | null, costUsd?: number | null, usageSource: 'documented' | 'observed' | 'none', tokensSource?: TokensSource | null, parts?: UsageParts | null, turns?: number, isError?: boolean, permissionDenials?: unknown[] }} ParsedCompletion
 */

/** @param {unknown} v */
const int = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/**
 * Usage counts from a notification's text, where the harness put them: its `<usage>` block
 * (`<usage>total_tokens: N tool_uses: N duration_ms: N</usage>`), or the same names on lines of
 * their own outside it. A bare `tokens:` counts only inside the block: outside it, the line is the
 * executor's own words, and what an executor says it cost is a guess, never a count (HITLD-438).
 * @param {string} text
 */
export function usageFromNotification(text) {
  const block = /<usage>([\s\S]*?)<\/usage>/i.exec(text);
  const where = block ? block[1] : String(text);
  const pick = (/** @type {RegExp} */ re) => {
    const m = re.exec(where);
    return m ? Number(m[1]) : null;
  };
  const tokens = block
    ? pick(/(?:total_tokens|subagent_tokens|tokens)\s*[:=]\s*(\d+)/i)
    : pick(/^[ \t]*(?:total_tokens|subagent_tokens)[ \t]*[:=][ \t]*(\d+)[ \t]*$/im);
  const toolCalls = block
    ? pick(/tool_uses\s*[:=]\s*(\d+)/i)
    : pick(/^[ \t]*tool_uses[ \t]*[:=][ \t]*(\d+)[ \t]*$/im);
  const durationMs = block
    ? pick(/duration_ms\s*[:=]\s*(\d+)/i)
    : pick(/^[ \t]*duration_ms[ \t]*[:=][ \t]*(\d+)[ \t]*$/im);
  return tokens === null && toolCalls === null && durationMs === null
    ? null
    : { tokens, toolCalls, durationMs };
}

/**
 * Strip a notification's usage block and wrapper so the report remains.
 * @param {string} text
 */
export function reportFromNotification(text) {
  return String(text)
    .replace(/<usage>[\s\S]*?<\/usage>/gi, '')
    .replace(/^\s*agentId:.*$/gim, '')
    .trim();
}

/**
 * A subagent completion. Each count is the one typed by hand (`--tokens`, `--tool-calls`,
 * `--duration-ms`) when given, else the notification's usage block's.
 * @param {{ text: string, usage?: { tokens?: number | null, toolCalls?: number | null, durationMs?: number | null } | null, commit?: string }} r
 * @returns {ParsedCompletion}
 */
export function subagentCompletion(r) {
  const fromText = usageFromNotification(r.text);
  const given = r.usage ?? {};
  /** @param {'tokens' | 'toolCalls' | 'durationMs'} k */
  const pick = (k) => int(given[k] ?? fromText?.[k] ?? null);
  const tokens = pick('tokens');
  const toolCalls = pick('toolCalls');
  const durationMs = pick('durationMs');
  const any = tokens !== null || toolCalls !== null || durationMs !== null;
  const typed = int(given.tokens ?? null) !== null;
  return {
    report: reportFromNotification(r.text),
    ...(r.commit ? { commit: r.commit } : {}),
    usage: any ? { tokens, toolCalls, durationMs } : null,
    usageSource: any ? 'observed' : 'none',
    tokensSource: tokens === null ? null : typed ? 'typed' : 'notification',
    parts: null,
  };
}

/**
 * The counts of one documented usage object, kept apart (null where it does not give one).
 * @param {Record<string, unknown>} u
 */
const partsOfUsage = (u) => ({
  input_tokens: int(u.input_tokens),
  output_tokens: int(u.output_tokens),
  cache_write_tokens: int(u.cache_creation_input_tokens),
  cache_read_tokens: int(u.cache_read_input_tokens),
});

/**
 * The counts of a per-model breakdown (modelUsage, model_usage_since_last_result), summed over the
 * models, with their cost. It counts the executor's subagents and side calls, which a turn's usage
 * may leave out. Null when it holds no model.
 * @param {unknown} byModel
 */
function partsOfModels(byModel) {
  if (!byModel || typeof byModel !== 'object' || Array.isArray(byModel)) return null;
  const models = Object.values(byModel).filter((m) => m && typeof m === 'object');
  if (!models.length) return null;
  /** @param {string} k */
  const sum = (k) => add(models.map((m) => int(/** @type {any} */ (m)[k])));
  const cost = models.map((m) => /** @type {any} */ (m).costUSD);
  return {
    input_tokens: sum('inputTokens'),
    output_tokens: sum('outputTokens'),
    cache_write_tokens: sum('cacheCreationInputTokens'),
    cache_read_tokens: sum('cacheReadInputTokens'),
    cost_usd: cost.every((c) => typeof c === 'number' && Number.isFinite(c))
      ? round(cost.reduce((a, b) => a + b, 0))
      : null,
  };
}

/** A sum that is null only when every part is. @param {(number | null)[]} xs */
const add = (xs) =>
  xs.every((x) => x === null) ? null : xs.reduce((/** @type {number} */ a, b) => a + (b ?? 0), 0);

/** Dollars to the hundredth of a cent, so sums do not carry float noise. @param {number} x */
const round = (x) => Math.round(x * 10000) / 10000;

/** @param {unknown} v */
const usd = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? round(v) : null);

/**
 * A completion's tokens from its parts: output plus fresh input, never cache reads.
 * @param {{ input_tokens: number | null, output_tokens: number | null, cache_write_tokens: number | null }} p
 */
export const tokensOfParts = (p) => add([p.input_tokens, p.output_tokens, p.cache_write_tokens]);

/**
 * The events of a headless run's output: one JSON document (`--output-format json`), an array of
 * events, or JSON lines (`--output-format stream-json`, how a durable run writes it, HITLD-746).
 * A line that is not JSON, such as one cut short when the process was stopped, is skipped.
 * @param {string} text @returns {Record<string, any>[] | null} null when nothing in it is JSON
 */
export function headlessEvents(text) {
  try {
    const one = JSON.parse(text);
    return (Array.isArray(one) ? one : [one]).filter((x) => x && typeof x === 'object');
  } catch {
    // JSON lines
  }
  /** @type {Record<string, any>[]} */
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v);
    } catch {
      // not an event
    }
  }
  return out.length ? out : null;
}

/**
 * A headless run's result: its result event. Output with no result event (a run that has not
 * ended, or was stopped) gives an empty report and no tokens; the transcript's other events are
 * never read for usage, only for the session ID a follow-up resumes.
 * @param {string} text the file claude -p wrote
 * @returns {ParsedCompletion}
 */
export function headlessCompletion(text) {
  const events = headlessEvents(text);
  if (!events) {
    let why = 'no JSON in it';
    try {
      JSON.parse(text);
    } catch (e) {
      why = /** @type {Error} */ (e).message;
    }
    throw new Error(`the headless result is not JSON: ${why}`);
  }
  // One document is the result itself (`--output-format json`); among events, the result event.
  /** @type {unknown} */
  let whole = null;
  try {
    whole = JSON.parse(text);
  } catch {
    whole = null;
  }
  /** @type {Record<string, any>} */
  let data =
    whole && typeof whole === 'object' && !Array.isArray(whole)
      ? /** @type {Record<string, any>} */ (whole)
      : (events.findLast((m) => m.type === 'result') ?? {});
  if (typeof data.session_id !== 'string') {
    const sid = events.find((m) => typeof m.session_id === 'string')?.session_id;
    if (sid) data = { ...data, session_id: sid };
  }
  const counts = partsOfUsage(data.usage ?? {});
  // cache_read_input_tokens is kept apart, never counted in the tokens (see the head of this file).
  const tokens = tokensOfParts(counts);
  const costUsd = usd(data.total_cost_usd);
  return {
    report: typeof data.result === 'string' ? data.result : '',
    usage: { tokens, toolCalls: null, durationMs: int(data.duration_ms) },
    usageSource: tokens === null ? 'none' : 'documented',
    tokensSource: tokens === null ? null : 'result-file',
    parts: tokens === null && costUsd === null ? null : { ...counts, cost_usd: costUsd },
    sessionId: typeof data.session_id === 'string' ? data.session_id : null,
    costUsd,
    isError:
      data.is_error === true || (typeof data.subtype === 'string' && data.subtype !== 'success'),
    ...(Array.isArray(data.permission_denials)
      ? { permissionDenials: data.permission_denials }
      : {}),
  };
}

/**
 * The JSON values in a text: one document, JSON lines, or several documents one after another (the
 * pages of an event list saved to one file). Text around them, such as a wrapper a tool put round
 * its output, is skipped.
 * @param {string} text
 * @returns {unknown[]}
 */
export function jsonValues(text) {
  const t = String(text);
  try {
    return [JSON.parse(t)];
  } catch {
    // several values, or text around them
  }
  /** @type {unknown[]} */
  const out = [];
  let i = 0;
  while (i < t.length) {
    const open = t.slice(i).search(/[{[]/);
    if (open < 0) break;
    const from = i + open;
    const end = closingOf(t, from);
    if (end < 0) break;
    try {
      out.push(JSON.parse(t.slice(from, end + 1)));
      i = end + 1;
    } catch {
      i = from + 1;
    }
  }
  return out;
}

/**
 * Where the JSON value that opens at `from` closes, by its brackets outside strings; -1 when it
 * does not.
 * @param {string} t @param {number} from
 */
function closingOf(t, from) {
  let depth = 0;
  let inString = false;
  for (let i = from; i < t.length; i++) {
    const ch = t[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Whether a value is a result message: the documented shape of claude's final message for a turn,
 * which carries the turn's usage and the cost.
 * @param {any} v
 */
const isResult = (v) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  v.usage &&
  typeof v.usage === 'object' &&
  (v.type === 'result' || typeof v.total_cost_usd === 'number' || 'modelUsage' in v);

/**
 * Every result message in a session record, with the time the record gives it, oldest first.
 * The record's own wrapping (an event list's pages, its events and their envelopes) is walked, not
 * relied on: a result is found wherever it sits, and one seen twice (pages that overlap) counts once.
 * @param {unknown[]} values
 * @returns {{ result: Record<string, any>, at: string | null }[]}
 */
function resultsIn(values) {
  /** @type {{ result: Record<string, any>, at: string | null }[]} */
  const out = [];
  /** @type {Set<string>} */
  const seen = new Set();
  /** @param {unknown} v @param {string | null} at @param {number} depth */
  const walk = (v, at, depth) => {
    if (depth > 12 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, at, depth + 1);
      return;
    }
    const o = /** @type {Record<string, any>} */ (v);
    const when = typeof o.created_at === 'string' ? o.created_at : at;
    if (isResult(o)) {
      const key =
        typeof o.uuid === 'string'
          ? o.uuid
          : JSON.stringify([o.session_id, o.duration_ms, o.usage, o.total_cost_usd]);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ result: o, at: when });
      }
      return;
    }
    for (const x of Object.values(o)) walk(x, when, depth + 1);
  };
  for (const v of values) walk(v, null, 0);
  return out
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => (a.at && b.at && a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.i - b.i))
    .map(({ result, at }) => ({ result, at }));
}

/**
 * An interactive dispatch's completion, from the harness's own record of the executor's session:
 * the result messages of the turns since the dispatch started, summed. The tokens are output plus
 * fresh input; cache reads and the cost the harness reports are kept apart beside them. The report
 * is the last turn's final message.
 *
 * Per turn, the breakdown by model since the last result is read where the record has it (it
 * counts subagents and side calls); else the turn's usage and total_cost_usd. A record of several
 * turns without that breakdown gives no cost: total_cost_usd may add up the turns before it, so
 * summing it could count a turn twice.
 * @param {string} text the record, as saved
 * @param {{ since?: string | null }} [o] leave out the turns that ended before this time (the
 *   dispatch's start): a follow-up continues the session the earlier dispatch spent
 * @returns {ParsedCompletion}
 */
export function sessionRecordCompletion(text, o = {}) {
  const all = resultsIn(jsonValues(text));
  if (!all.length) {
    throw new Error(
      'the session record holds no result message (a turn ending, with its usage and total_cost_usd)',
    );
  }
  const since = o.since ? Date.parse(o.since) : NaN;
  const turns = all.filter((r) => !(r.at && !Number.isNaN(since) && Date.parse(r.at) < since));
  if (!turns.length) {
    throw new Error(
      `the session record has no turn that ended after the dispatch started (${o.since}); the ${all.length} it holds are earlier`,
    );
  }
  const per = turns.map(({ result: r }) => {
    const byModel = partsOfModels(r.model_usage_since_last_result);
    return byModel ?? { ...partsOfUsage(r.usage), cost_usd: null, total: usd(r.total_cost_usd) };
  });
  /** @param {'input_tokens' | 'output_tokens' | 'cache_write_tokens' | 'cache_read_tokens'} k */
  const sum = (k) => add(per.map((p) => p[k]));
  const counts = {
    input_tokens: sum('input_tokens'),
    output_tokens: sum('output_tokens'),
    cache_write_tokens: sum('cache_write_tokens'),
    cache_read_tokens: sum('cache_read_tokens'),
  };
  const costs = per.map((p) =>
    p.cost_usd !== null ? p.cost_usd : turns.length === 1 && 'total' in p ? p.total : null,
  );
  const cost = costs.every((c) => typeof c === 'number') ? round(add(costs) ?? 0) : null;
  const tokens = tokensOfParts(counts);
  const last = turns[turns.length - 1].result;
  const durations = turns.map(({ result: r }) => int(r.duration_ms));
  return {
    report: typeof last.result === 'string' ? last.result : '',
    usage: { tokens, toolCalls: null, durationMs: add(durations) },
    usageSource: tokens === null ? 'none' : 'documented',
    tokensSource: tokens === null ? null : 'session-record',
    parts: { ...counts, cost_usd: cost },
    turns: turns.length,
    sessionId: typeof last.session_id === 'string' ? last.session_id : null,
    costUsd: cost,
    isError: turns.some(
      ({ result: r }) =>
        r.is_error === true || (typeof r.subtype === 'string' && r.subtype !== 'success'),
    ),
    permissionDenials: turns.flatMap(({ result: r }) =>
      Array.isArray(r.permission_denials) ? r.permission_denials : [],
    ),
  };
}

/** A figure such as 270k, 270,000, 1.2M or 1.2 million, as a number of tokens; null if none. */
const FIGURE = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k|thousand|m|million)?\b`;

/** @param {string} n @param {string | undefined} unit */
const figure = (n, unit) => {
  const x = Number(n.replace(/,/g, ''));
  const u = (unit ?? '').toLowerCase();
  const scaled =
    u === 'k' || u === 'thousand' ? x * 1e3 : u === 'm' || u === 'million' ? x * 1e6 : x;
  return Number.isFinite(scaled) ? Math.round(scaled) : null;
};

/**
 * What an executor says its own run cost, from its report: the first token figure after words that
 * call it the executor's own or a guess ("self-reported, a guess: about 270k tokens", "I used
 * roughly 1.2M tokens"). It is a guess, kept apart and never the recorded cost (HITLD-438): an
 * executor has no meter for its own usage. Null when the report states none.
 * @param {string} report
 * @returns {number | null}
 */
export function selfReportedTokens(report) {
  const own =
    /self[- ]reported|\bguess|\bmy own\b|\bI (?:used|spent|consumed|burned)\b|\bown (?:token|cost|usage|figure)/i;
  const tokenFigure = new RegExp(String.raw`${FIGURE}\s*tokens\b`, 'i');
  const tokensFirst = new RegExp(String.raw`\btokens?\b[^\d\n]{0,40}?${FIGURE}`, 'i');
  for (const line of String(report ?? '').split(/\r?\n/)) {
    const marker = own.exec(line);
    if (!marker) continue;
    const rest = line.slice(marker.index);
    const m =
      tokenFigure.exec(rest) ??
      tokensFirst.exec(rest) ??
      tokenFigure.exec(line) ??
      tokensFirst.exec(line);
    // A figure that is the budget or the estimate given, not what the run cost.
    if (!m || /^\s*(?:tokens?\s*)?(?:budget|estimate)/i.test(line.slice(m.index + m[0].length)))
      continue;
    const n = figure(m[1], m[2]);
    if (n !== null && n > 0) return n;
  }
  return null;
}
