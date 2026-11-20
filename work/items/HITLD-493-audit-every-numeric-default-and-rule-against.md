---
id: HITLD-493
title: Audit every numeric default and rule against what it stands in for, and decide keep, replace or drop for each
kind: work
state: done
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

## Decided on 2026-11-19 (HITLD-532, 533)

- **When an executor is stuck or over (HITLD-532):** stuck means no progress events for a set time (no tool call, commit or token movement) in the session's event stream; over means its token budget is spent. A wide wall-clock limit stays only as a backstop for sessions that report nothing. A slow executor that is moving is left alone. `dispatch.stall_after` and `dispatch.deadline` change from the real limits to a backstop.
- **How an item is tiered and costed (HITLD-533):** from the measured tokens of similar finished items (HITLD-438, 450), with the item's own plan and required reading as the prior until there are enough completions. File count (`dispatch.tier1_max_touches`) and familiar yield stay only as one weak input.

## Decided on 2026-11-19, continued (HITLD-534 to 538)

- **How many executors run (HITLD-534):** measured resources and the other limits decide, with the number as a ceiling. Heavy steps (tests, builds, benchmarks) hold weighted machine capacity through a wrapper that the executor hook enforces, and a performance run takes the machine exclusively. Where executors share a machine the count follows measured headroom; in the cloud each executor has its own container. The count is also bounded by the pace share (HITLD-531), merge risk (HITLD-511) and the owner's awaiting-merge queue. `max_executors` stays as a hard ceiling the owner sets. This builds the planned HITLD-41, 42 and 145.
- **Behavior signals (HITLD-535):** `trust.rubber_stamp_seconds` and the small-sample thresholds (`precedent.review_min_applications`, `review.first_after_outcomes`) stop being trust inputs. The owner's yes speed is not read as inattention; a measure of review keep-up, if wanted, is a metric (HITLD-408).
- **Cadence (HITLD-536):** the chief of staff looks and reports on events first (a PR's checks finish, an executor goes quiet, a decision is waiting, the pace line is crossed, a usage reading goes stale). A slow timer of every few hours is only a safety net for a lost event, and a digest is sent when something needs the owner, not on the clock. The chief of staff's own check-in is every 4 hours from 2026-11-19, changed from hourly.
- **Rules and facts (HITLD-537):** a rule an executor could break by accident is enforced by a hook or a scrubbed environment (HITLD-464); a fact comes from an independent source (CI for tests, git for what changed, the session record for tokens and what was read). A brief keeps only the purpose and the judgment calls.
- **How much the system asks the owner (HITLD-538):** every ask counts, including the chief of staff's. The system tracks asks per decision settled and per hour, and the trust engine's unlocks (HITLD-507) reduce them over time. Walk-throughs the owner starts do not count against it. A budget the owner sets stays as a ceiling for system-initiated asks.

## What is left

Nothing in the audit's groups is open. Each decision above files its own build items; HITLD-89 (event-driven cadences) and HITLD-464 (the scrubbed environment) are the existing ones.

## Closed on 2026-11-20 (HITLD-614)

The owner asked whether there was any reason not to close this item, and there was none: every decision of the audit has its build item (HITLD-532 in HITLD-560, HITLD-533 in HITLD-561, HITLD-534 in HITLD-559, HITLD-535 in HITLD-557, HITLD-536 in HITLD-89 (done), HITLD-537 in HITLD-464, 562 and 559, HITLD-538 in HITLD-563), and the design-docs update (HITLD-572) merged.
