// Completions from Claude Code, as the orchestrator hands them to `hitld dispatch complete`
// (design part 15.4). Session transcript files are never parsed.
//
//   subagent  the background-agent notification: the agent's final message, and the token,
//             tool-use and duration counts the desktop app was observed to include (undocumented,
//             so recorded when present and labeled)
//   headless  the JSON result of claude -p --output-format json: result, session_id, usage,
//             total_cost_usd (documented), and permission_denials, the tool calls the permission
//             mode refused, when present
//
// What a completion's tokens count (HITLD-436): output tokens plus fresh input, which is uncached
// input and input written to the cache. Never cache reads: a long run rereads its cached context on
// every turn, so a cache-read total can be hundreds of times what the run cost, and a ledger that
// recorded it would take one run for the cost of many.

/**
 * @typedef {import('../interface.mjs').Completion} Completion
 * @typedef {Omit<Completion, 'dispatch'> & { sessionId?: string | null, costUsd?: number | null, usageSource: 'documented' | 'observed' | 'none', isError?: boolean, permissionDenials?: unknown[] }} ParsedCompletion
 */

/** @param {unknown} v */
const int = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);

/**
 * Usage counts from a notification's text, where it carries them (`<usage>total_tokens: N
 * tool_uses: N duration_ms: N</usage>`, or the same names on their own lines).
 * @param {string} text
 */
export function usageFromNotification(text) {
  const pick = (/** @type {RegExp} */ re) => {
    const m = re.exec(text);
    return m ? Number(m[1]) : null;
  };
  const tokens = pick(/(?:total_tokens|subagent_tokens|tokens)\s*[:=]\s*(\d+)/i);
  const toolCalls = pick(/tool_uses\s*[:=]\s*(\d+)/i);
  const durationMs = pick(/duration_ms\s*[:=]\s*(\d+)/i);
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
 * A subagent completion.
 * @param {{ text: string, usage?: { tokens?: number | null, toolCalls?: number | null, durationMs?: number | null } | null, commit?: string }} r
 * @returns {ParsedCompletion}
 */
export function subagentCompletion(r) {
  const fromText = usageFromNotification(r.text);
  const given =
    r.usage && (r.usage.tokens != null || r.usage.toolCalls != null || r.usage.durationMs != null)
      ? r.usage
      : null;
  const u = given ?? fromText;
  return {
    report: reportFromNotification(r.text),
    ...(r.commit ? { commit: r.commit } : {}),
    usage: u
      ? { tokens: int(u.tokens), toolCalls: int(u.toolCalls), durationMs: int(u.durationMs) }
      : null,
    usageSource: u ? 'observed' : 'none',
  };
}

/**
 * A headless run's JSON result.
 * @param {string} text the file claude -p wrote
 * @returns {ParsedCompletion}
 */
export function headlessCompletion(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`the headless result is not JSON: ${/** @type {Error} */ (e).message}`);
  }
  if (Array.isArray(data)) data = data.findLast((m) => m && m.type === 'result') ?? {};
  const u = data.usage ?? {};
  // cache_read_input_tokens is left out on purpose (see the head of this file).
  const parts = [u.input_tokens, u.output_tokens, u.cache_creation_input_tokens].map(int);
  const tokens = parts.every((p) => p === null)
    ? null
    : parts.reduce((a, b) => (a ?? 0) + (b ?? 0), 0);
  return {
    report: typeof data.result === 'string' ? data.result : '',
    usage: { tokens, toolCalls: null, durationMs: int(data.duration_ms) },
    usageSource: tokens === null ? 'none' : 'documented',
    sessionId: typeof data.session_id === 'string' ? data.session_id : null,
    costUsd: typeof data.total_cost_usd === 'number' ? data.total_cost_usd : null,
    isError:
      data.is_error === true || (typeof data.subtype === 'string' && data.subtype !== 'success'),
    ...(Array.isArray(data.permission_denials)
      ? { permissionDenials: data.permission_denials }
      : {}),
  };
}
