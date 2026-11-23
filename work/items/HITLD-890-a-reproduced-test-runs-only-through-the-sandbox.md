---
id: HITLD-890
title: A reproduced test runs only through the sandbox, never loose in an executor's or the queue's run
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-69 c?]
---

## Why

A reproduced test leaves the reproducer's sandbox as the item's trusted 'Done when': the executor is told to `git checkout <ref> -- <test>` and make it pass (`core/lib/cli/commands/reproduce.mjs`), and the sandbox applies only to `reproduce run` and `reproduce check`. A test that branches on the sandbox's presence passes inside and misbehaves outside, where the executor and later the merge queue run it with network and credentials.

## Done when

- Executors and the queue run a reproduced test only through `hitld reproduce run`, never loose.
- The owner is shown the test text when the item is promoted.
- A test shows a sandbox-detecting test is caught or contained.
- A guard, rights, store or workflow change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Finding S4 (medium, likely) of the second Fable security pass (2026-11-22), decision HITLD-885. 

Moved from rc.2 to rc.3 by the owner's cut-line decision HITLD-974 (2026-11-23).
