---
id: HITLD-74
title: Ledger event and dispatch IDs are unique by construction, and each writer appends to its own ledger file, so store sync never conflicts
kind: work
state: done
created: 2026-11-14
project: HITLD-15
constraint_of: [HITLD-67 c1, HITLD-190 c1]
claimed_by: D-40
release_note: Ledger event and dispatch IDs are unique by construction (`D-` or `E-` and 16 characters of Crockford base32, time then random), and each writer appends to its own `ledger/<writer>.jsonl` in the private store, so two stores that both appended sync with no conflict. The single `ledger.jsonl` of before is still read, first, and never appended to; numbered IDs such as `D-1` to `D-38` keep their meaning. Ledger lines are schema version 3 and the ledger index layout version 2; `hitld ledger tail` reads through the index and adds `dispatch_numbers`, this machine's display numbers. Eval scenarios can pass on what an earlier step returned as `{{steps.<id>.<path>}}`. Until every machine runs this release, an older one can still append version-2 lines to `ledger.jsonl`, which sort first in the ledger.
---

## Done when

- Ledger event and dispatch IDs are time-ordered random IDs that cannot collide across containers, and no writer (an orchestrator or the chief of staff) shares a ledger file with another: each appends to its own file under the store. The global ledger is the union of those files, read through the local index, and two writers appending between syncs merge with no conflict.
- Display numbers for people are assigned when the index ingests events; trailers on main carry the unique short ID. Tracker IDs (HITLD-n) are unchanged: one counter in the store, compare-and-swap.
- Existing ledgers keep their IDs and stay readable: `D-1` to `D-38` keep their meaning in trailers on main, the old ledgers are not reconciled with the new ones, and the format change is versioned.
- A test syncs two stores that both appended events and dispatches; the import succeeds with no conflict and the index shows the union.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Replaced on 2026-11-18 by the owner's decision HITLD-489. The first design here was ID blocks reserved per machine, the way tracker IDs were. In the cloud a machine is a new container every time, so a per-machine block has no stable owner, and orchestrator-numbered IDs depend on a disposable chief of staff session. IDs unique by construction need no coordination. Two containers cannot share one store without this (HITLD-178).

## Notes

Related: HITLD-490 (the ledger is per project, with a person-level layer: HITLD-491), HITLD-323 (the store enrollment so the files reach the store), HITLD-492 (removing the run object), HITLD-470 and HITLD-484 to HITLD-490. Code, schema and design: the owner's own yes to merge.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (HITLD-74): part of the ledger design: unique IDs, per-writer ledger files. The decisions since then are the ledger and no-run decisions (HITLD-484 to 490). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.

## Plan audit on 2026-11-20 (still valid as written)

Checked against the ledger and no-run decisions (HITLD-484 to HITLD-490). This item already builds them: IDs unique by construction and one append-only file per writer (HITLD-489, which replaced HITLD-485), and the ledger kept per project in that project's own private store (HITLD-490). The trust-engine, pace, probe and answer-proof decisions do not change what it builds. No rewording.
