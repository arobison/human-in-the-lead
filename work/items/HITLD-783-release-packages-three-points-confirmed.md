---
id: HITLD-783
title: "Release packages: three points confirmed"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Every repository declares at least one package: No implicit unnamed package, no legacy code path; --package defaults only when there is exactly one."
rationale: depends_on with a version range and records pin versions, Cycles between packages are refused
answered_at: 2026-11-22T03:49:21.194Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-752: which of the three proposed points should the design include?

Proposed by the chief of staff in the release packages walk-through; not yet decided.

## Options and recommendation

- A. Every repository declares at least one package: No implicit unnamed package, no legacy code path; --package defaults only when there is exactly one.
- B. depends_on with a version range, and records pin versions: A package declares dependencies with a range; a release record pins the exact versions.
- C. Cycles between packages are refused: hitld work check refuses a dependency cycle among packages.

Recommended: Every repository declares at least one package. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
