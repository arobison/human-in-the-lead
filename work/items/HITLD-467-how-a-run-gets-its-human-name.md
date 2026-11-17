---
id: HITLD-467
title: How a run gets its human name
kind: decision
state: done
created: 2026-11-17
project: HITLD-15
decider: owner
answer: "A. Derived focus name, renameable: Default is the release stage and focus, such as rc.3 token fixes, proposed by the chief of staff at run start; renameable with one command."
answered_at: 2026-11-17T01:09:57.027Z
answered_via: question-tool
answered_by: owner
---

## Question

How should a run get its human name? The date-and-number ID stays underneath as the stable key; the name is what is read in reports, the dashboard and messages.

Today a run is told apart only by <date>-<n>. The ID is also the ledger's run field and part of its event IDs, so changing it would need a migration.

## Options and recommendation

- A. Derived focus name, renameable: Default is the release stage and focus, such as rc.3 token fixes, proposed by the chief of staff at run start; renameable with one command.
- B. You name it at run start: No generated default; a run shows only its ID until named.
- C. Release stage plus counter: Automatic, like rc.3 run 2; says nothing about what the run is for.
- D. Random two-word names: Memorable and unique; says nothing about meaning.

Recommended: Derived focus name, renameable. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
