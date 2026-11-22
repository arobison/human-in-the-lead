---
id: HITLD-580
title: An item is not done until the docs it affects are updated, and a check enforces it
kind: work
state: proposed
created: 2026-11-20
project: HITLD-15
constraint_of: [HITLD-405 c1]
---

## Why

On 2026-11-20 the design documents were found to be behind the tracker: the decisions of the self-hosted run's design walk-throughs sit in the tracker while `docs/design` still describes runs, leases and approval counts (HITLD-571, 572). The owner decided (HITLD-579) that updating the relevant docs is part of an item being done from now on, so the docs stay up to date. A rule an executor could break by accident is enforced by structure, not brief text (HITLD-537).

## What it should do

- Every item's standard "Done when" gains a line: the docs and design parts the change affects are updated in the same pull request (the `hitld work new` template, the executor brief and the report shape).
- A check, run by a command and not scored by the author, maps changed paths to the design parts they affect (a maintained table, for example the quota code to its design part) and fails a pull request that changes an affected area without touching a docs path, unless the change carries a `Docs:` trailer saying why none is needed.
- A change whose docs check is red is not eligible to self-merge (the verifiability gate, HITLD-518, build HITLD-553).
- The executor's report lists the docs it touched, taken from the diff and not from the executor's own claim (HITLD-537).
- A periodic drift check compares the docs' claims about behavior against the code and the commands (the curator sweep, HITLD-132; the chief of staff cites its source, HITLD-146).

## Done when

- The missing information is obtained first (the shape is settled in HITLD-579; the path-to-part table and the trailer form are shaped), then a failing test that reproduces the gap: a behavior change that leaves its design part stale passes today (design part 14.7).
- The check, the template change and the report line exist, with tests, and this item's own pull request updates the design parts it affects.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Code, skill and design: the owner's own yes to merge. Placed under HITLD-405 c1 (a claim about HITLd cites the design, the code or a command) beside HITLD-572 by the chief of staff, a proposal for the owner to move. Related: HITLD-572 (the one-time catch-up), HITLD-537 and HITLD-562 (enforce a rule, measure a fact), HITLD-553 (the self-merge gate).
