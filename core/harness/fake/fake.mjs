// A fake harness adapter for core tests and offline evals (design parts 15 and 17.7).
//
// It records every call, and completes dispatches either through a `respond` function or when a
// test calls `complete()`. It enforces its declared capabilities where the core must degrade: with
// parallelSubagents false it refuses a second dispatch while one is in flight, and it refuses an
// item above its maxClassification. So a core change that leans on one harness fails the tests.

/**
 * @typedef {import('../interface.mjs').HarnessAdapter} HarnessAdapter
 * @typedef {import('../interface.mjs').HarnessCapabilities} HarnessCapabilities
 * @typedef {import('../interface.mjs').DispatchRequest} DispatchRequest
 * @typedef {import('../interface.mjs').DispatchHandle} DispatchHandle
 * @typedef {import('../interface.mjs').Completion} Completion
 * @typedef {import('../interface.mjs').Classification} Classification
 *
 * @typedef {object} FakeCall
 * @property {string} method
 * @property {unknown[]} args
 *
 * @typedef {HarnessAdapter & {
 *   calls: FakeCall[],
 *   complete: (dispatch: string, completion: Omit<Completion, 'dispatch'>) => void,
 *   inFlight: () => string[],
 * }} FakeAdapter
 */

/** Capability sets for tests. Profiles for real harnesses belong with their adapters and evals. */
export const FAKE_PROFILES = Object.freeze({
  /** Everything available. */
  full: Object.freeze(
    /** @type {HarnessCapabilities} */ ({
      parallelSubagents: true,
      persistentSessions: true,
      worktrees: true,
      backgroundCompletion: true,
      remoteHumanChannel: true,
      hooks: 'full',
      modelSelection: true,
      effortSelection: true,
      usageReporting: 'tokens',
      maxClassification: 'confidential',
    }),
  ),
  /** Nothing optional: the most degraded harness the core must still work with. */
  minimal: Object.freeze(
    /** @type {HarnessCapabilities} */ ({
      parallelSubagents: false,
      persistentSessions: false,
      worktrees: false,
      backgroundCompletion: false,
      remoteHumanChannel: false,
      hooks: 'none',
      modelSelection: false,
      effortSelection: false,
      usageReporting: 'none',
      maxClassification: 'public',
    }),
  ),
});

const LEVELS = ['public', 'internal', 'confidential', 'secret'];

/**
 * @param {{
 *   id?: string,
 *   capabilities?: HarnessCapabilities,
 *   respond?: (request: DispatchRequest) => Omit<Completion, 'dispatch'> | Promise<Omit<Completion, 'dispatch'>>,
 * }} [options]
 * @returns {FakeAdapter}
 */
export function createFakeAdapter(options = {}) {
  const id = options.id ?? 'fake';
  const caps = { ...(options.capabilities ?? FAKE_PROFILES.full) };
  /** @type {FakeCall[]} */
  const calls = [];
  /** @type {Map<string, { promise: Promise<Completion>, resolve: (c: Completion) => void }>} */
  const pending = new Map();
  let refs = 0;

  /** @param {string} dispatch */
  const slot = (dispatch) => {
    let entry = pending.get(dispatch);
    if (!entry) {
      /** @type {(c: Completion) => void} */
      let resolve = () => {};
      const promise = new Promise((r) => (resolve = /** @type {any} */ (r)));
      entry = { promise, resolve };
      pending.set(dispatch, entry);
    }
    return entry;
  };
  /** @type {Set<string>} */
  const running = new Set();

  /** @param {string} dispatch @param {Omit<Completion, 'dispatch'>} completion */
  const finish = (dispatch, completion) => {
    if (!running.has(dispatch)) throw new Error(`fake adapter: ${dispatch} is not in flight`);
    running.delete(dispatch);
    const usage = caps.usageReporting === 'none' ? null : (completion.usage ?? null);
    slot(dispatch).resolve({ ...completion, usage, dispatch });
  };

  return {
    id,
    calls,
    capabilities: () => ({ ...caps }),
    async dispatch(request) {
      calls.push({ method: 'dispatch', args: [request] });
      if (!request || typeof request.dispatch !== 'string' || typeof request.item !== 'string') {
        throw new Error('fake adapter: a dispatch needs a dispatch ID and an item');
      }
      if (running.has(request.dispatch)) {
        throw new Error(`fake adapter: ${request.dispatch} is already in flight`);
      }
      if (!caps.parallelSubagents && running.size > 0) {
        throw new Error('fake adapter: parallelSubagents is false; one dispatch at a time');
      }
      if (LEVELS.indexOf(request.classification) > LEVELS.indexOf(caps.maxClassification)) {
        throw new Error(
          `fake adapter: ${request.item} is ${request.classification}, above this harness's ${caps.maxClassification}`,
        );
      }
      running.add(request.dispatch);
      slot(request.dispatch);
      const handle = { dispatch: request.dispatch, harness: id, ref: `fake-${++refs}` };
      if (options.respond) {
        const completion = await options.respond(request);
        queueMicrotask(() => finish(request.dispatch, completion));
      }
      return handle;
    },
    async onComplete(handle) {
      calls.push({ method: 'onComplete', args: [handle] });
      return slot(handle.dispatch).promise;
    },
    async followUp(handle, message) {
      calls.push({ method: 'followUp', args: [handle, message] });
    },
    async ask(question) {
      calls.push({ method: 'ask', args: [question] });
      return { channel: id, ref: `ask-${++refs}` };
    },
    async notify(message, urgency) {
      calls.push({ method: 'notify', args: [message, urgency] });
      return { channel: id, ref: `notify-${++refs}` };
    },
    complete: finish,
    inFlight: () => [...running],
  };
}
