// The machine locks' decisions (HITLD-1051), as one pure function: `decide(state, event)` takes
// what the files and the processes say now and one event (an ask, a timer's renewal, a release,
// a waiter leaving, the check after a weighted grant) and returns the outcome and the changes to
// make. It reads no file, no clock and no process: locks.mjs reads them into the state, takes the
// resource's one critical section, calls this and applies the changes, so a model checker can
// drive the same decisions over every interleaving on a fake clock (core/test/lockcore.test.mjs).
//
// The state is one resource: its single lock file (a resource the caller sees with capacity 1),
// its weighted holders' files, its queue of tickets, the clock, this host, and the liveness of
// every process a record or ticket names. The rules, in the order they are applied to an ask:
//
// 1. The caller's own live hold (its name, written for its process) is renewed at once, before
//    the queue is looked at, so a holder that asks again never waits behind waiters that wait on
//    it. A live hold under its name from another process refuses it (HITLD-1050). A lapsed hold
//    of its own is renewed only at its turn; a caller that must wait gives it up, so no holder
//    ever waits.
// 2. A waiter's ticket is written in the same decision as its first attempt, before it, so a
//    newcomer that comes after can never be let in ahead of it. Tickets are numbered by a counter
//    that never goes backwards: the larger of now and the last ticket plus one, so a clock that
//    jumps back cannot put a later waiter ahead of an earlier one. Dead waiters' tickets go.
// 3. Only the first in line may try. Stale records it meets are reaped (logged as takeovers); a
//    record that cannot be read is stale only once it has been so for a moment, since a copy that
//    creates the lock file and then writes it is seen half-written in between.
// 4. A grant takes the single lock (an exclusive create), or writes a weighted record while the
//    live weights fit; a weighted grant is confirmed against a single lock taken meanwhile by an
//    older copy that does not take this critical section.
//
// A holder is its name and its process: pid, start time and the machine's boot (HITLD-1052). Each
// grant carries a random token, kept while the same process renews it. A holder whose process can
// be seen alive and is the very one it was written for is never taken over when its expiry
// passes: the expiry is the limit only for a holder whose liveness cannot be checked (another
// host, or no start time to compare). A hung but live holder is ended by a forced release (the
// command line's `env unlock --force`, or the watchdog's teardown), which is logged.
//
// A release by a handle removes only the record with its grant's token; by a process (the command
// line), the name's records written for that process, and any that are stale; forced, the name's
// records whoever holds them. Each is idempotent. Tickets carry their waiter's start time and
// boot too, so a dead waiter whose pid was reused never holds the head of the queue.

import { Buffer } from 'node:buffer';

/** A holder that renewed within this long is plainly itself; past it, a reused pid is looked for. */
export const PID_REUSE_CHECK_AFTER_MS = 10_000;
/** How long a record that cannot be read is taken to be still being written. */
export const UNREADABLE_GRACE_MS = 1_000;
/** The slot of the single lock file; a weighted holder's slot is its hex-encoded name. */
export const SINGLE = 'single';
/**
 * The record and ticket format this copy writes. Records and tickets without it were written by
 * an older copy (rc.1, or rc.2 before HITLD-1052): they are still respected, and status flags them.
 */
export const LOCK_FORMAT = 2;

/**
 * @typedef {object} LockRecord
 * @property {string} resource
 * @property {string} holder
 * @property {number} pid the process whose life the lock follows
 * @property {string | null} pid_start in an older copy's record, that process's start time as `ps`
 *   printed it for that caller, which depends on its time zone and locale: compared only there.
 *   This copy writes null
 * @property {string | null} [start] that process's identity, read the same by every caller (on
 *   Linux its start tick, elsewhere its start time in UTC), with its kind as a prefix; null when
 *   it could not be read (HITLD-1052)
 * @property {string} host
 * @property {string} acquired_at
 * @property {string} renewed_at
 * @property {string} expires_at
 * @property {number} [weight] the units it holds of a resource with a capacity above 1
 * @property {string} [token] the grant's random token, kept by renewals (absent in older records)
 * @property {string | null} [boot] the machine's boot the holder's process belongs to
 * @property {number} [v] LOCK_FORMAT; absent in a record an older copy wrote
 *
 * @typedef {object} Slot a record file as it was read
 * @property {string} slot SINGLE, or a weighted holder's hex-encoded name (its file's name)
 * @property {LockRecord | null} record null: the file is there but could not be read whole
 * @property {number} mtime when the file was last written, in ms
 *
 * @typedef {object} Ticket a waiter's place in the queue
 * @property {string} name its file's name: <15-digit number>.<nonce>.<pid>.t
 * @property {number} n
 * @property {number} pid the waiting process
 * @property {string | null} [holder]
 * @property {string | null} [start] the waiting process's identity, as a record's `start`
 * @property {string | null} [boot] the machine's boot it belongs to
 * @property {number} [v] LOCK_FORMAT; absent in a ticket an older copy wrote
 *
 * @typedef {Record<number, { alive: boolean, start?: string | null, legacy?: string | null }>}
 *   Procs the processes the records and tickets name: alive; `start`, its identity as a record's
 *   `start`, and `legacy`, its start time as `ps` prints it for the caller, where staleReason and
 *   ticketGone will ask for them (startsWanted). `start` null: the lookup ran and this process's
 *   identity cannot be read (another user's, or one /proc hides): not verified. `start` absent:
 *   not looked up, or the lookup itself failed (a tool missing or timed out): nothing known this
 *   time. A pid missing from it is taken to be gone
 *
 * @typedef {object} LockState
 * @property {string} resource
 * @property {number} capacity as the caller sees it: 1 takes the single lock, more a weighted hold
 * @property {number} now
 * @property {string} host
 * @property {string | null} [boot] this machine's boot, when it can be read
 * @property {Slot | null} single
 * @property {Slot[]} holders
 * @property {Ticket[]} queue
 * @property {Procs} procs
 *
 * @typedef {{ holder: string, pid: number, pidStart: string | null, start?: string | null }} Who
 *
 * @typedef {{ type: 'ask', holder: string, pid: number, pidStart: string | null,
 *     start?: string | null, self: number, selfStart?: string | null, weight: number,
 *     wait: boolean, ticket: string | null,
 *     ttlMs: number, nonce: string, token: string }
 *   | { type: 'confirm', holder: string, pid: number, pidStart: string | null,
 *     start?: string | null, wait: boolean, ticket: string | null }
 *   | { type: 'renew', holder: string, token: string, ttlMs: number, weight: number | null }
 *   | { type: 'release', holder: string, token?: string, pid?: number,
 *     pidStart?: string | null, start?: string | null, force?: boolean, self?: number }
 *   | { type: 'leave', ticket: string }} LockEvent
 *
 * @typedef {{ op: 'create', slot: string, record: LockRecord }
 *   | { op: 'write', slot: string, record: LockRecord }
 *   | { op: 'remove', slot: string }
 *   | { op: 'enqueue', ticket: Ticket }
 *   | { op: 'dequeue', name: string }
 *   | { op: 'log', kind: string, data: Record<string, unknown> }} Effect
 *
 * @typedef {{ kind: 'granted', record: LockRecord, renewed: boolean, confirm: boolean,
 *     ticket: string | null }
 *   | { kind: 'refused', held_by: LockRecord | null, conflict: boolean }
 *   | { kind: 'queued', ticket: string, held_by: LockRecord | null, turn: boolean }
 *   | { kind: 'renewed', record: LockRecord }
 *   | { kind: 'lost' }
 *   | { kind: 'released' }
 *   | { kind: 'kept', held_by: string | null, by?: LockRecord | null }
 *   | { kind: 'left' }} Outcome
 *
 * @typedef {{ outcome: Outcome, effects: Effect[] }} Decision
 */

/** The slot of a weighted holder's file: names may differ only by case, so they are hex-encoded. */
export const holderSlot = (/** @type {string} */ holder) => Buffer.from(holder).toString('hex');

/** @param {LockRecord | null} r */
export const weightOf = (r) =>
  r && Number.isInteger(r.weight) ? /** @type {number} */ (r.weight) : 1;

/**
 * A ticket's file name: its number, zero-padded so names sort in number order, a nonce, and the
 * waiting process.
 * @param {number} n @param {string} nonce @param {number} pid
 */
export const ticketName = (n, nonce, pid) => `${String(n).padStart(15, '0')}.${nonce}.${pid}.t`;

/** @param {string} name @returns {Ticket} */
export function parseTicket(name) {
  const parts = name.split('.');
  return { name, n: Number(parts[0]) || 0, pid: Number(parts.at(-2)) };
}

/** @param {Ticket} a @param {Ticket} b */
const byNumber = (a, b) => a.n - b.n || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** @param {Slot} a @param {Slot} b */
const byAcquired = (a, b) => at(a.record) - at(b.record);
/** @param {LockRecord | null} r */
const at = (r) => (r ? Date.parse(r.acquired_at) || 0 : 0);

/**
 * Whether a record is plainly its holder's without looking further: renewed lately and not past
 * its expiry. A record that is not has its holder's start time compared.
 * @param {LockRecord} r @param {number} now
 */
const fresh = (r, now) =>
  Date.parse(r.expires_at) >= now && now - Date.parse(r.renewed_at) <= PID_REUSE_CHECK_AFTER_MS;

/**
 * The pids whose identity staleReason and ticketGone will ask for: records on this host that are
 * not fresh, and waiters whose tickets carry one. `stable`: this copy's records and tickets, by
 * their `start`; `legacy`: older copies' records, by `pid_start`. A lookup may cost a process,
 * so only these are looked up (and the shell caches them).
 * @param {(LockRecord | null | undefined)[]} records @param {number} now @param {string} host
 * @param {Ticket[]} [queue] @returns {{ stable: number[], legacy: number[] }}
 */
export function startsWanted(records, now, host, queue = []) {
  /** @type {Set<number>} */
  const stable = new Set();
  /** @type {Set<number>} */
  const legacy = new Set();
  for (const r of records) {
    if (!r || r.host !== host || fresh(r, now)) continue;
    if (r.v !== undefined) {
      if (r.start) stable.add(r.pid);
    } else if (r.pid_start) legacy.add(r.pid);
  }
  for (const t of queue) if (t.v !== undefined && t.start) stable.add(t.pid);
  return { stable: [...stable], legacy: [...legacy] };
}

/**
 * Whether two identities (a record's or ticket's `start`, and the process's) name one process:
 * true or false when both are known and of one kind, null when either is not known or they are
 * of different kinds (one caller could read the start tick and another could not), which tells
 * nothing either way.
 * @param {string | null | undefined} a @param {string | null | undefined} b
 * @returns {boolean | null}
 */
export function sameStart(a, b) {
  if (!a || !b) return null;
  const kind = (/** @type {string} */ x) => x.slice(0, x.indexOf(':') + 1);
  if (kind(a) !== kind(b)) return null;
  return a === b;
}

/**
 * Whether a record can be taken over, and why; null while it is live.
 * @param {Slot} slot @param {{ now: number, host: string, boot?: string | null, procs: Procs }} s
 * @returns {string | null}
 */
export function staleReason(slot, s) {
  const record = slot.record;
  if (!record) {
    // Unreadable: stale once it has stayed so past the grace. A clock that jumped either way by
    // more than the grace makes it stale at once; a half-written file lasts microseconds.
    return Math.abs(s.now - slot.mtime) > UNREADABLE_GRACE_MS ? 'its record is unreadable' : null;
  }
  const expired = Date.parse(record.expires_at) < s.now;
  // On another host its process cannot be looked at: the expiry is all there is.
  if (record.host !== s.host) return expired ? 'it expired (its holder is on another host)' : null;
  if (record.boot && s.boot && record.boot !== s.boot) {
    return 'the machine restarted since it was taken';
  }
  const proc = s.procs[record.pid];
  if (!proc?.alive) return `its holder's process ${record.pid} is gone`;
  if (fresh(record, s.now)) return null;
  // Its process is alive: when it can be told to be the very one, the hold stands, expired or not.
  if (record.v !== undefined) {
    if (record.start) {
      // Verified when it was taken. A lookup that failed this time tells nothing, and a passing
      // fault cannot revoke it. One that names another process ends it. One that ran but cannot
      // read this process's identity, or reads another kind of it, cannot vouch for it: a holder
      // this copy wrote is readable by the same user in the same way, so that is most likely a
      // reused pid, and the expiry is the limit (below), never a hold for good.
      if (proc.start === undefined) return null;
      const same = sameStart(record.start, proc.start);
      if (same === true) return null;
      if (same === false)
        return `process ${record.pid} is no longer the holder's (its ID was reused)`;
    }
  } else if (record.pid_start && proc.legacy && proc.legacy === record.pid_start) {
    // An older copy's record: its start time is `ps`'s for that caller, which another time zone
    // or locale prints differently, so a match keeps it and anything else falls to the expiry.
    return null;
  }
  // No start time to compare: the expiry is the limit.
  return expired
    ? "it expired without being renewed, and its holder's liveness cannot be checked"
    : null;
}

/**
 * Whether a waiter's ticket is dead: its process gone, from another boot, or, when the ticket
 * carries an identity, a process that is not the waiter: one whose identity reads otherwise, or
 * cannot be read (a waiter this copy wrote is readable by the same user), or reads as another
 * kind. A ticket has no expiry to fall back on, so an unverified one would hold the line for
 * good. A lookup that failed this time drops nothing.
 * @param {Ticket} t @param {{ boot?: string | null, procs: Procs }} s
 */
export function ticketGone(t, s) {
  const p = s.procs[t.pid];
  if (!p?.alive) return true;
  if (t.boot && s.boot && t.boot !== s.boot) return true;
  if (t.v === undefined || !t.start || p.start === undefined) return false;
  return sameStart(t.start, p.start) !== true;
}

/**
 * Whether a record was written for the caller's process: the same pid on this host and boot, and
 * the same identity (a pid alone may have been reused). This copy's records must show the same
 * `start` on both sides: a record or a caller whose identity could not be read never claims a
 * pid as its own, so a holder whose identity could not be read cannot renew by asking again (its
 * handle renews by token) and is released by name only once stale or with --force. An older
 * copy's record compares `pid_start`, as that copy does.
 * @param {LockRecord | null | undefined} record
 * @param {{ pid: number, pidStart?: string | null, start?: string | null }} who
 * @param {{ host: string, boot?: string | null }} s
 */
export function sameProcess(record, who, s) {
  if (!record || record.host !== s.host || record.pid !== who.pid) return false;
  if (record.boot && s.boot && record.boot !== s.boot) return false;
  if (record.v !== undefined) return sameStart(record.start, who.start) === true;
  return !record.pid_start || !who.pidStart || who.pidStart === record.pid_start;
}

/**
 * @param {LockState} s @param {Who} who @param {number} ttlMs @param {string} token
 * @param {string} [acquiredAt] @param {number} [weight]
 * @returns {LockRecord}
 */
export function newRecord(s, who, ttlMs, token, acquiredAt, weight) {
  const now = new Date(s.now).toISOString();
  /** @type {LockRecord} */
  const record = {
    resource: s.resource,
    holder: who.holder,
    pid: who.pid,
    // No `ps` text for an older copy to misread (it prints by time zone): the owner's call,
    // 2026-11-25. An older copy then loses its own pid-reuse check on this record, and matches
    // a release for a pid by the pid alone.
    pid_start: null,
    start: who.start ?? null,
    host: s.host,
    acquired_at: acquiredAt ?? now,
    renewed_at: now,
    expires_at: new Date(s.now + ttlMs).toISOString(),
  };
  if (weight !== undefined) record.weight = weight;
  record.token = token;
  record.boot = s.boot ?? null;
  record.v = LOCK_FORMAT;
  return record;
}

/**
 * The next ticket's number: never below a ticket already queued, whatever the clock says.
 * @param {Ticket[]} queue @param {number} now
 */
export const nextTicket = (queue, now) => queue.reduce((n, t) => Math.max(n, t.n + 1), now);

/**
 * Who holds a resource, for a refusal: the single lock's holder, else the oldest weighted one.
 * @param {LockState} s @returns {LockRecord | null}
 */
function currentHolder(s) {
  if (s.single?.record) return s.single.record;
  return [...s.holders].sort(byAcquired).find((h) => h.record)?.record ?? null;
}

/**
 * Make every lock decision for one resource.
 * @param {LockState} s @param {LockEvent} e @returns {Decision}
 */
export function decide(s, e) {
  switch (e.type) {
    case 'ask':
      return ask(s, e);
    case 'confirm':
      return confirm(s, e);
    case 'renew':
      return renew(s, e);
    case 'release':
      return release(s, e);
    case 'leave':
      return {
        outcome: { kind: 'left' },
        effects: s.queue.some((t) => t.name === e.ticket)
          ? [{ op: 'dequeue', name: e.ticket }]
          : [],
      };
  }
}

/**
 * @param {LockState} s @param {Extract<LockEvent, { type: 'ask' }>} e @returns {Decision}
 */
function ask(s, e) {
  /** @type {Who} */
  const who = { holder: e.holder, pid: e.pid, pidStart: e.pidStart, start: e.start ?? null };
  /** @type {Effect[]} */
  const effects = [];
  const mine = (/** @type {Slot | null | undefined} */ sl) =>
    !!sl?.record && sl.record.holder === who.holder && sameProcess(sl.record, who, s);
  const stale = (/** @type {Slot} */ sl) => staleReason(sl, s);

  // The queue as it stands: dead waiters' tickets go, whoever finds them, and so do those of
  // processes that reused a dead waiter's pid.
  const queue = [...s.queue].sort(byNumber);
  const live = queue.filter((t) => !ticketGone(t, s));
  for (const t of queue) if (!live.includes(t)) effects.push({ op: 'dequeue', name: t.name });
  let ticket = e.ticket !== null && live.some((t) => t.name === e.ticket) ? e.ticket : null;
  const drop = () => {
    if (ticket) effects.push({ op: 'dequeue', name: ticket });
    ticket = null;
  };

  // 1. The caller's own live hold, before the queue: renewed at once, keeping its weight. The same
  //    name held live by another process is a conflict, refused at once and never queued.
  const ownWeighted = s.holders.find((h) => h.slot === holderSlot(who.holder));
  for (const sl of [s.single, ownWeighted]) {
    if (!sl?.record || sl.record.holder !== who.holder || stale(sl)) continue;
    if (!mine(sl)) {
      drop();
      return { outcome: { kind: 'refused', held_by: sl.record, conflict: true }, effects };
    }
    const record = newRecord(
      s,
      who,
      e.ttlMs,
      sl.record.token ?? e.token,
      sl.record.acquired_at,
      sl.slot === SINGLE ? undefined : weightOf(sl.record),
    );
    effects.push({ op: 'write', slot: sl.slot, record });
    drop();
    return { outcome: granted(record, true), effects };
  }

  // 2. A waiter's ticket, written before its first attempt (in this same decision).
  if (e.wait && !ticket) {
    const n = nextTicket(queue, s.now);
    /** @type {Ticket} */
    const t = {
      name: ticketName(n, e.nonce, e.self),
      n,
      pid: e.self,
      holder: who.holder,
      start: e.selfStart ?? null,
      boot: s.boot ?? null,
      v: LOCK_FORMAT,
    };
    effects.push({ op: 'enqueue', ticket: t });
    live.push(t);
    ticket = t.name;
  }

  // 3. Only the first in line may try.
  const turn = live.length === 0 || live[0].name === ticket;
  if (!turn) {
    // A caller that waits holds nothing: its own lapsed records go, so a clock that jumps back
    // cannot make one live again while it waits behind waiters that would wait on it. So do
    // stale records under its name it cannot prove its own (written without a readable
    // identity): stale, they hold nothing for anyone, and the name is the caller's.
    for (const sl of [s.single, ownWeighted]) {
      if (!sl?.record || sl.record.holder !== who.holder) continue;
      if (mine(sl) || stale(sl)) effects.push({ op: 'remove', slot: sl.slot });
    }
    if (!e.wait) return { outcome: refused(currentHolder(s)), effects };
    return {
      outcome: {
        kind: 'queued',
        ticket: /** @type {string} */ (ticket),
        held_by: currentHolder(s),
        turn,
      },
      effects,
    };
  }

  const r =
    s.capacity > 1
      ? attemptWeighted(s, e, who, mine, stale)
      : attemptSerial(s, e, who, mine, stale);
  effects.push(...r.effects);
  if (r.outcome.kind === 'granted') {
    // A weighted grant keeps its ticket until it is confirmed.
    if (!r.outcome.confirm) drop();
    return { outcome: { ...r.outcome, ticket }, effects };
  }
  const held = /** @type {Extract<Outcome, { kind: 'refused' }>} */ (r.outcome).held_by;
  if (held?.holder === who.holder) {
    drop();
    return { outcome: { kind: 'refused', held_by: held, conflict: true }, effects };
  }
  if (!e.wait || !ticket) return { outcome: refused(held), effects };
  return { outcome: { kind: 'queued', ticket, held_by: held, turn }, effects };
}

/** @param {LockRecord} record @param {boolean} renewed @param {boolean} [confirm] @returns {Outcome} */
const granted = (record, renewed, confirm = false) => ({
  kind: 'granted',
  record,
  renewed,
  confirm,
  ticket: null,
});

/** @param {LockRecord | null} held_by @returns {Outcome} */
const refused = (held_by) => ({ kind: 'refused', held_by, conflict: false });

/**
 * The first in line's attempt at a resource it sees with capacity 1: the single lock. A live
 * weighted holder (written by a caller that sees a larger capacity) keeps it held.
 * @param {LockState} s @param {Extract<LockEvent, { type: 'ask' }>} e @param {Who} who
 * @param {(sl: Slot | null | undefined) => boolean} mine @param {(sl: Slot) => string | null} stale
 * @returns {Decision}
 */
function attemptSerial(s, e, who, mine, stale) {
  const others = [...s.holders].sort(byAcquired).filter((h) => h.record && !mine(h) && !stale(h));
  if (others.length) return { outcome: refused(others[0].record), effects: [] };
  const cur = s.single;
  if (!cur) {
    const record = newRecord(s, who, e.ttlMs, e.token);
    return { outcome: granted(record, false), effects: [{ op: 'create', slot: SINGLE, record }] };
  }
  if (mine(cur)) {
    // Its own record, lapsed (a live one was renewed before the queue): renewed at its turn.
    const own = /** @type {LockRecord} */ (cur.record);
    const record = newRecord(s, who, e.ttlMs, own.token ?? e.token, own.acquired_at);
    return { outcome: granted(record, true), effects: [{ op: 'write', slot: SINGLE, record }] };
  }
  const reason = stale(cur);
  if (!reason) return { outcome: refused(cur.record), effects: [] };
  const record = newRecord(s, who, e.ttlMs, e.token);
  return {
    outcome: granted(record, false),
    effects: [
      { op: 'remove', slot: SINGLE },
      takeover(s, who, cur, reason),
      { op: 'create', slot: SINGLE, record },
    ],
  };
}

/**
 * The first in line's attempt at `weight` units of a resource it sees with a capacity above 1.
 * Stale holders are reaped, the live weights summed, and the caller recorded if its weight fits.
 * A live single lock (taken by a caller that sees capacity 1) fills the resource.
 * @param {LockState} s @param {Extract<LockEvent, { type: 'ask' }>} e @param {Who} who
 * @param {(sl: Slot | null | undefined) => boolean} mine @param {(sl: Slot) => string | null} stale
 * @returns {Decision}
 */
function attemptWeighted(s, e, who, mine, stale) {
  /** @type {Effect[]} */
  const effects = [];
  /** @type {Slot | null} */
  let own = null;
  /** @type {Slot[]} */
  const live = [];
  for (const h of [...s.holders].sort(byAcquired)) {
    if (mine(h)) {
      own = h;
      continue;
    }
    const reason = stale(h);
    if (reason) {
      effects.push({ op: 'remove', slot: h.slot }, takeover(s, who, h, reason));
      continue;
    }
    live.push(h);
  }
  const singleLive = !!s.single && !stale(s.single);
  const used = singleLive ? s.capacity : live.reduce((n, h) => n + weightOf(h.record), 0);
  // The caller's name, held by another live process: refused, never a second record beside it.
  const namesake = live.find((h) => h.record?.holder === who.holder);
  if (namesake) return { outcome: refused(namesake.record), effects };
  if (own) {
    const prior = /** @type {LockRecord} */ (own.record);
    const record = newRecord(
      s,
      who,
      e.ttlMs,
      prior.token ?? e.token,
      prior.acquired_at,
      weightOf(prior),
    );
    effects.push({ op: 'write', slot: own.slot, record });
    return { outcome: granted(record, true), effects };
  }
  if (used + e.weight > s.capacity) {
    const by = singleLive ? (s.single?.record ?? null) : (live[0]?.record ?? null);
    return { outcome: refused(by), effects };
  }
  const record = newRecord(s, who, e.ttlMs, e.token, undefined, e.weight);
  effects.push({ op: 'write', slot: holderSlot(who.holder), record });
  return { outcome: granted(record, false, true), effects };
}

/**
 * A weighted grant, looked at again once written: a single lock that an older copy (one that takes
 * the single lock without this critical section) created meanwhile wins, and the grant backs out.
 * That copy looks for weighted holders after writing its own, so of two that arrive together at
 * least one backs out: at worst both refuse, never both hold.
 * @param {LockState} s @param {Extract<LockEvent, { type: 'confirm' }>} e @returns {Decision}
 */
function confirm(s, e) {
  const who = { holder: e.holder, pid: e.pid, pidStart: e.pidStart, start: e.start ?? null };
  const slot = s.holders.find((h) => h.slot === holderSlot(e.holder));
  const ticketed = e.ticket !== null && s.queue.some((t) => t.name === e.ticket);
  const single = s.single;
  const foreign =
    !!single &&
    !(single.record?.holder === e.holder && sameProcess(single.record, who, s)) &&
    !staleReason(single, s);
  if (!foreign && slot?.record) {
    return {
      outcome: granted(slot.record, false),
      effects: ticketed ? [{ op: 'dequeue', name: /** @type {string} */ (e.ticket) }] : [],
    };
  }
  /** @type {Effect[]} */
  const effects =
    slot && sameProcess(slot.record, who, s) ? [{ op: 'remove', slot: slot.slot }] : [];
  const held = single?.record ?? null;
  if (e.wait && ticketed) {
    return {
      outcome: {
        kind: 'queued',
        ticket: /** @type {string} */ (e.ticket),
        held_by: held,
        turn: true,
      },
      effects,
    };
  }
  if (ticketed) effects.push({ op: 'dequeue', name: /** @type {string} */ (e.ticket) });
  return { outcome: refused(held), effects };
}

/**
 * A handle's renewal (its timer, or a call): only the record with its grant's token. One another
 * process took over, under the same name or not, carries another token and is left alone.
 * @param {LockState} s @param {Extract<LockEvent, { type: 'renew' }>} e @returns {Decision}
 */
function renew(s, e) {
  const slot =
    e.weight === null ? s.single : s.holders.find((h) => h.slot === holderSlot(e.holder));
  const cur = slot?.record;
  if (!slot || !cur || cur.holder !== e.holder || cur.token !== e.token) {
    return { outcome: { kind: 'lost' }, effects: [] };
  }
  const who = { holder: cur.holder, pid: cur.pid, pidStart: cur.pid_start, start: cur.start };
  const record = newRecord(s, who, e.ttlMs, e.token, cur.acquired_at, e.weight ?? undefined);
  return {
    outcome: { kind: 'renewed', record },
    effects: [{ op: 'write', slot: slot.slot, record }],
  };
}

/**
 * A release, matched inside the critical section and idempotent. By a token (a handle's), only the
 * record with that token goes. By a process (the command line's, without force), the name's
 * records written for that process go, and any that are stale; one a live process of another
 * identity holds stays, and is named (`by`). Forced (the command line's `--force`, the
 * watchdog's teardown), the name's records go whoever holds them, logged as `lock_forced`.
 * @param {LockState} s @param {Extract<LockEvent, { type: 'release' }>} e @returns {Decision}
 */
function release(s, e) {
  const own = s.holders.find((h) => h.slot === holderSlot(e.holder));
  const named = /** @type {Slot[]} */ (
    [own, s.single].filter((sl) => !!sl?.record && sl.record.holder === e.holder)
  );
  /** @type {Slot[]} */
  let gone;
  if (e.token !== undefined) gone = named.filter((sl) => sl.record?.token === e.token);
  else if (e.force) gone = named;
  else {
    const who = {
      pid: /** @type {number} */ (e.pid),
      pidStart: e.pidStart ?? null,
      start: e.start ?? null,
    };
    gone = named.filter(
      (sl) => (e.pid !== undefined && sameProcess(sl.record, who, s)) || !!staleReason(sl, s),
    );
  }
  /** @type {Effect[]} */
  const effects = gone.map((sl) => ({ op: /** @type {const} */ ('remove'), slot: sl.slot }));
  if (gone.length) {
    const live = gone.filter((sl) => !staleReason(sl, s));
    // Who released it, and for which process it asked: the audit of a release by name.
    const asker = {
      ...(e.self !== undefined ? { by_pid: e.self } : {}),
      ...(e.pid !== undefined ? { pid: e.pid } : {}),
    };
    effects.push(
      e.force && live.length
        ? {
            op: 'log',
            kind: 'lock_forced',
            data: {
              resource: s.resource,
              holder: e.holder,
              ...asker,
              holders: live.map((sl) => {
                const r = /** @type {LockRecord} */ (sl.record);
                return {
                  pid: r.pid,
                  pid_start: r.pid_start,
                  start: r.start ?? null,
                  host: r.host,
                  renewed_at: r.renewed_at,
                };
              }),
            },
          }
        : {
            op: 'log',
            kind: 'lock_released',
            data: { resource: s.resource, holder: e.holder, ...asker },
          },
    );
    return { outcome: { kind: 'released' }, effects };
  }
  // Kept: a live hold under the name for another process, named; or nothing under the name at
  // all, which names no one (another name's hold on the resource is not this release's).
  const by = named.find((sl) => !gone.includes(sl))?.record ?? null;
  return { outcome: { kind: 'kept', held_by: by?.holder ?? null, by }, effects };
}

/**
 * @param {LockState} s @param {Who} who @param {Slot} previous @param {string} reason
 * @returns {Effect}
 */
const takeover = (s, who, previous, reason) => ({
  op: 'log',
  kind: 'lock_takeover',
  data: {
    resource: s.resource,
    holder: who.holder,
    previous_holder: previous.record?.holder ?? null,
    reason,
  },
});
