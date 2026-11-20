---
id: HITLD-659
title: Does the reproducer need an OS-level network boundary before its pull request merges?
kind: decision
state: planned
created: 2026-11-20
project: HITLD-15
decider: owner
---

## Question

The reproducer runs a bug report's test in an in-process sandbox. Reviews found it can be made strong but not a true boundary. Should #395 wait for an OS-level boundary, or merge with honest wording now?

Pull request 395 (HITLD-30). The in-process denial of network calls is best effort: two review rounds closed every path they found, and a namespace layer is used where the machine allows it. Nothing calls the reproducer automatically yet, because intake (HITLD-29) is not built; only the orchestrator runs it, on a signal a person supplied.

## Options and recommendation

- A. Merge now, honest wording: Merge #395 once its last review is clean. The docs say best effort, not a boundary. Build the OS-level layer (network and mount namespace, bwrap or equivalent) before intake can call it.
- B. Wait for the OS layer: Hold #395 until a real OS boundary exists on every machine it runs on.
- C. Hold until intake exists: Do not merge the reproducer until the intake that feeds it is built.

Recommended: Merge now, honest wording. Nothing runs it unattended yet, and the follow-up item builds the real boundary before anything can.

## Answer

Open.
