---
id: HITLD-30
title: "Reproducer: reported bugs to failing tests"
kind: work
state: in-progress
created: 2026-11-14
project: HITLD-28
claimed_by: D-01M80D8A59G1WFY7
---

## Why

Design part 21, One signal end to end.

## Done when

- A reported bug becomes a failing test in a sandbox with no network and no secrets.
- A bug that cannot be reproduced is reported as that, and no test is invented.
- The item's "Done when" is the reproduced test, and it exists before the executor starts.
- A fixture bug is reproduced end to end in an offline scenario.

## Delivered

PR 395 (commit f5730ef, dispatch D-45) delivered `hitld reproduce open`, `run`, `check` and `item`: a reported bug's test runs in a best-effort sandbox with no repository, no secrets and network denied, and is kept at `refs/hitld/reproductions/<SIG>` only when it fails the same way twice; a bug not reproduced keeps nothing; `reproduce item` makes the proposed item whose "Done when" is that test. Five offline eval scenarios under `evals/scenarios/reproduce/` cover the fixture bug end to end, the not-reproduced case, invented and vacuous tests, and network denial. The rest is filed: HITLD-722 calls the reproducer automatically before an executor starts, and HITLD-667 replaces the best-effort sandbox with a real OS-level boundary.
