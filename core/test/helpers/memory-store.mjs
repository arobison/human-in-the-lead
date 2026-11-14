// An in-memory private store for tests, with a kill switch: a Killer counts every effect (a store
// write or append, and whatever else the test ticks) and throws on the chosen one, before the
// effect happens. What was written earlier stays, as it would on disk.

export class Killed extends Error {
  constructor() {
    super('killed');
    this.name = 'Killed';
  }
}

export class Killer {
  /** @param {number} [at] the effect to kill before, counted from 1; none by default */
  constructor(at = Infinity) {
    this.at = at;
    this.count = 0;
  }
  tick() {
    if (++this.count === this.at) throw new Killed();
  }
}

/**
 * @param {Map<string, string>} [files] the disk; share it between sessions to survive a "kill"
 * @param {Killer} [killer]
 * @returns {import('../../lib/store/store.mjs').PrivateStore}
 */
export function memoryStore(files = new Map(), killer = new Killer()) {
  return {
    root: '/memory',
    read: (key) => files.get(key) ?? null,
    write(key, text) {
      killer.tick();
      files.set(key, text);
    },
    append(key, text) {
      killer.tick();
      files.set(key, (files.get(key) ?? '') + text);
    },
    list: (prefix = '') => [...files.keys()].filter((k) => k.startsWith(prefix)).sort(),
  };
}
