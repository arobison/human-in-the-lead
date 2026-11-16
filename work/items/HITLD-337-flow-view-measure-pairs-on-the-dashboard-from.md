---
id: HITLD-337
title: Flow view measure pairs on the dashboard, from HITLD-152
kind: decision
state: done
created: 2026-11-16
project: HITLD-15
decider: owner
answer: "A. Keep these three: The Flow view keeps the three pairs as built."
answered_at: 2026-11-16T17:14:57.443Z
answered_via: question-tool
answered_by: owner
---

## Question

Keep the Flow view's three measure pairs: Throughput with Change failure rate, Lead time with First-pass yield, Work in progress with Blocked?

Each measure sits beside the one that must not get worse, so an improving number cannot hide a worsening one.

## Options and recommendation

- A. Keep these three: The Flow view keeps the three pairs as built.
- B. Change a pair: The owner names the pairing; the HITLD-152 branch changes before the PR.

Recommended: Keep these three. Each speed measure has a quality or stall measure beside it.

## Answer

Recorded in the front matter once answered.
