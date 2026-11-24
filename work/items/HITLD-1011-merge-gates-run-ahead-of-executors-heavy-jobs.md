---
id: HITLD-1011
title: Merge gates run ahead of executors' heavy jobs and hold new ones while a gate run is in progress
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- When a merge gate run is waiting, an executor's new heavy job (a suite, a build, a type check) waits for the gate, not the other way round; a quiet-machine request still outranks both.
- While a gate run is in progress, no new heavy executor job starts; a test with a full set of slots and one finished branch checks that the gate starts within a set time and that executor jobs resume after.
- The queue runs cheap checks per branch and one full suite per batch of branches, bisecting a red batch (see HITLD-814 and 817 for the pull-request path); this item covers the local gate path.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 604 (v0.1.0-rc.1): with every executor slot full, finished branches waited hours to merge. A gate run waited until no executor ran a heavy job, about half of one 41-minute run, and then the suites ran at a load of 2 to 8 per core, so timing-sensitive tests failed and were rerun. The gates took one branch at a time, so eight finished branches queued behind each other.

## Notes

rc.3. Not an issue on the pull-request path this repository uses, where the gates run on the forge. Related: HITLD-559 (heavy steps hold weighted machine capacity), HITLD-42, HITLD-814, HITLD-817. Check how much overlaps HITLD-559 before building.
