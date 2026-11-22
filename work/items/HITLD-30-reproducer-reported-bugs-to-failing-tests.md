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
