---
id: HITLD-623
title: "Benchmark storage: dyno owns it first; a HITLD data area is revisited only if needed"
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: "Both, in stages: start with dyno-owned storage and revisit a HITLD data area only if sharing across machines through dyno proves insufficient"
answered_at: 2026-11-20T03:17:35.058Z
answered_via: question-tool
answered_by: owner
---

## Question

For the first outside consumer's benchmark results, should HITLD offer a data area in its private store, or should dyno own storage in a private S3-compatible bucket and expose access only through its own commands?

GitHub issue 363 (HITLD-622) asks for a data area in the private store; a private bucket owned by dyno avoids the store's size and large-file problems (HITLD-609, HITLD-619).

## Options and recommendation

- A. Dyno owns it, HITLD goes through dyno: The private store is unchanged; HITLD keeps references and pins what a study cites
- B. HITLD offers the data area: Build the project-owned data area in the private store
- C. Both, in stages: Start with dyno-owned storage and revisit a HITLD data area only if sharing through dyno proves insufficient

Recommended: Dyno owns it, HITLD goes through dyno. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
