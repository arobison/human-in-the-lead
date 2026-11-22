---
id: HITLD-553
title: "Merging registers with the trust engine: path-rule kinds, never-unlock kinds, a mechanical verifiability gate"
kind: work
state: planned
created: 2026-11-19
project: HITLD-15
needs: [HITLD-552]
constraint_of: [HITLD-566 c2]
---

## Why

The owner decided how merging earns self-merge standing (HITLD-472, 473 to 482, 518 to 521): risk first, history widens it; never-unlock kinds; evidence against a merged change; a mechanical gate; kinds set by path rules with a classifier that can only tighten.

## What it should do

- Kinds are named path rules in policy; a change touching several takes the most restrictive. `merge.owner_paths` become the never-unlock kinds (data formats, public interface and policy, skills, hooks and agent contracts, security and rights); `merge.owner_areas` fold into path rules; `merge.propose_queue_after` is removed; past approval counts do not count (HITLD-520).
- Eligible only when the change is verifiable by a command: a test that fails on the base and passes on the change, or an eval covering the behavior, every check green including CodeQL, cleanly revertible, no never-unlock path touched; never scored by the author or a model (HITLD-518).
- A classifier reads only the diff and may send a change to the owner, never promote one (HITLD-520).
- Evidence against a merged change: a revert, a fix-forward item citing it, a failing check on main, or the owner's report (HITLD-476). No audit sampling (HITLD-477).

## Done when

- The missing information is obtained first (the design is settled in the decisions cited above, so acceptance comes from shaping the build), then a failing test that reproduces the gap (design part 14.7).
- The behavior in "What it should do" is built and tested, without weakening another test.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Needs the trust engine core. Design is settled in the cited decisions; code, skill, schema and policy changes need the owner's own yes to merge. Placement is the chief of staff's, a proposal for the owner to move.

## Moved into rc.2 on 2026-11-22 (HITLD-809)

The owner asked why they are asked to approve every code pull request, and decided that the merging trust engine is built in rc.2. This item is planned and also joins milestone HITLD-67 (second clause); it stays in milestone HITLD-566 too. No kind unlocks until it meets the bar (15 merges aged 7 days from 8 distinct items); skills, hooks, contracts, schemas, guards, public interface and policy never unlock.

## Moved out of rc.2 on 2026-11-22

Moved from Consumer live (HITLD-67) on the owner's decision HITLD-874, after the plan review found rc.2 could not converge. It keeps its other milestone links.
