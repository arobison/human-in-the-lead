---
id: HITLD-493
title: Audit every numeric default and rule against what it stands in for, and decide keep, replace or drop for each
kind: work
state: proposed
created: 2026-11-18
project: HITLD-15
---

## Done when

- The owner decides, in a walk-through one question at a time, a keep, replace or drop for each numeric default and each rule that stands in for something else, starting with the groups below, and the answers are written into the design and the settings schemas and the items that build them are filed from the walk-through, each placed under a milestone.
- `hitld work check` passes.

## Why

The owner asked on 2026-11-18 whether other parts of the design are too simplistic or guard with the wrong idea for an agentic system, after dropping the 20-merge count as a trust signal (HITLD-472). The chief of staff's read of the policy defaults and the design found these groups to put to the walk-through. [Likely] unless noted.

- **A count or timer standing in for the real thing:** `orchestrator.handover_after_completions` (20) (already dropped by HITLD-488); wall-clock limits on executors (`dispatch.stall_after` 1800, `deadline` 14400, `orchestrator.silent_after_seconds` 900) against progress signals; routing by file count (`dispatch.tier1_max_touches` 3, `familiar_min_yield` 0.9 over `familiar_min_samples` 5) as a size proxy the owner rejected for merging; calendar and count cadences for digests and reports (HITLD-89 is the unstarted fix). [Certain] that the hourly check-in found no change for over thirty hours running.
- **Prose rules where structure is needed:** briefs that tell executors what not to print or merge (HITLD-464 is the first fix); executor-written evidence such as "tests pass" lines, where CI is the independent check; the move already made for tokens (measure, do not ask) applies to every other self-reported fact.
- **Human-organization metaphors:** runs, leases and hand-overs (decided in HITLD-470); a fixed executor cap (`max_executors`) where the real throttles are the owner's review capacity, merge conflicts and quota burn.
- **Trust inferred from human behavior:** `trust.rubber_stamp_seconds` (60) reads a fast yes as inattention; small-sample thresholds (`precedent.review_min_applications` 3, `review.first_after_outcomes` 5).
- **Escalation to the owner as the default:** the design already has `attention.interrupts_per_day_max` (6) and `decisions_per_digest_max` (10); whether the chief of staff counts against them is unchecked [Guessing]. Related: HITLD-441.

## Notes

Design-heavy: stays proposed and is walked through with the owner. Related: HITLD-472 (the trust signal), HITLD-470 (the run), HITLD-441 (emergent escalations and deferral), HITLD-408 (learned parameters).
