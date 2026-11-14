// The flake quarantine (design part 14.4): a test run that failed and then passed on the same
// commit is not blamed on a branch. It is recorded here, in the private store; the flaky-test
// sweep (the milestone Scheduler) confirms or clears it and files an item.

export const FLAKES_KEY = 'merge/flakes.jsonl';

/**
 * @param {import('../store/store.mjs').PrivateStore} store
 * @param {import('./queue.mjs').Flake[]} flakes
 * @param {() => Date} [now]
 */
export function recordFlakes(store, flakes, now = () => new Date()) {
  for (const f of flakes) {
    store.append(
      FLAKES_KEY,
      JSON.stringify({
        at: now().toISOString(),
        commit: f.commit,
        command: f.command,
        output: f.output.slice(-1000),
      }) + '\n',
    );
  }
}

/** @param {import('../store/store.mjs').PrivateStore} store @returns {Record<string, any>[]} */
export function readFlakes(store) {
  return (store.read(FLAKES_KEY) ?? '')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}
