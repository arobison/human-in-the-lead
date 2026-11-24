---
id: HITLD-1004
title: "Merge PR 602: this repository's policy lets up to 8 executors run at once (HITLD-1002)"
kind: decision
state: done
created: 2026-11-24
project: HITLD-15
decider: owner
answer: "A. Merge: Record the yes; orch-11 applies it and starts the new run at cap 8 when nothing is in flight."
answered_at: 2026-11-24T04:49:20.478Z
answered_via: question-tool
answered_by: owner
---

## Question

PR 602 (HITLD-1002, head efe9d3e2): merge it? Policy max_executors value 8 and max 8, one test, item done; all 12 checks green.

The owner asked on 2026-11-24 to raise the executor cap to 8. Changing a bound is a rule change and needs the owner's own yes. The run cap stays 4 until a new run starts with max_executors 8.

## Options and recommendation

- A. Merge: Record the yes; orch-11 applies it and starts the new run at cap 8 when nothing is in flight.
- B. Merge, keep this run at cap 4: Policy says 8 but no new run is started now.
- C. Do not merge: Leave the cap at 5 in policy.

Recommended: Merge. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
