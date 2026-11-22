---
id: HITLD-776
title: A working second executor adapter proves the runtime interface
kind: work
state: proposed
created: 2026-11-22
project: HITLD-15
---

## Why

The owner decided (HITLD-774) that the working second adapter that proves the runtime interface goes in rc.3, not rc.2. It follows the executor profile design (HITLD-775) and HITLD-561's build. Which runtime to build first (another agent CLI, an API loop, or a local-inference runtime) is chosen with the owner when it is shaped.

## Done when

- A second runtime adapter works end to end: an item is dispatched to it, its executor runs under the guard enforcement its capability row declares, and its result is recorded like any other.
- An item whose classification needs a data boundary or guard enforcement the runtime lacks is refused for that runtime, and a test shows it.
- `npm run check`, the offline eval gate and `hitld work check` pass.
