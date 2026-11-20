---
id: HITLD-665
title: Is about 39 seconds of extra CI test time for the eval-isolation tests acceptable?
kind: decision
state: planned
created: 2026-11-20
project: HITLD-15
decider: owner
---

## Question

The new tests prove each eval case gets its own store. One runs the offline gate twice (about 17 seconds each). Accept the time, or shrink the second test to a few scenarios?

Pull request 406 (HITLD-201). No runner code changed; the isolated home from HITLD-131 already fixes the problem.

## Options and recommendation

- A. Shrink it: Run the second test over a small fixed set of scenarios.
- B. Accept it: Keep the full gate run twice.

Recommended: Shrink it. The proof does not need the whole gate.

## Answer

Open.
