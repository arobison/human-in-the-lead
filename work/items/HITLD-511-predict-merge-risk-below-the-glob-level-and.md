---
id: HITLD-511
title: Predict merge risk below the glob level, and propose reshaping work so it can run in parallel
kind: work
state: proposed
created: 2026-11-19
project: HITLD-15
---

## Why

Overlap between two items is judged by glob today, which is too coarse to decide parallel work well. A consumer ran ten UI items one at a time because all ten listed the same three files in `touches`, one of them over 5,000 lines. By glob every pair overlapped completely, so serializing looked like the only safe choice. A person then spotted that two of them could run in parallel after reshaping: each built its view in new files mounted through one toggle in the shared file, each left edits to existing shared code until after rebasing, and each dropped a `needs` that existed only to read a design brief. Nothing in hitld suggested it.

Reported as GitHub issue #307 (kind feature), filed by the owner through `hitld feedback` from a consumer project on v0.1.0-rc.1 (design `05-execution.md`, the overlap rule; `14-integration.md`, merge order). The issue stays open on GitHub until this item is done.

The design already lets overlapping items run in parallel at the cost of a rebase, and holds a later one back only when the overlap share passes `dispatch.serialize_overlap_share` (HITLD-82).

## What it should do

- A merge-risk estimate per pair of items from more than glob overlap: the regions each item will likely change (from its plan, its Done when and the diffs of similar past items), each shared file's size and recent churn, additive work (new files, exports, a mount point) against edits to shared regions, and shared generated files.
- Reshaping suggestions when the risk is high but the work separates: build in new files behind one mount point, do edits to shared code last after rebasing, drop a `needs` that only carries a brief or document and point the brief at its source. They go to the orchestrator, or to the owner when they change scope.
- Calibration as a standing eval: each rebase's actual conflicts are recorded against the estimate, so the classifier earns trust before it decides anything unattended (the same trust engine as HITLD-507, not a separate one).

## Done when

- The missing information is obtained first (a feature, not a defect: acceptance comes from shaping, and the evidence from the consumer's three reshaped items and their rebases), then a failing test that reproduces the gap (design part 14.7).
- A pair of items gets a merge-risk estimate with its inputs shown, and a reshaping suggestion when the risk is high and the work separates.
- Each merge records the actual conflicts beside the estimate, and an eval reports how well they agree.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Design-heavy: stays proposed and is walked through with the owner before any build. Placed under HITLD-189 c2 (the planner offers what can start) by the chief of staff, a proposal for the owner to move. Related: HITLD-82, HITLD-507 (one trust engine), HITLD-509.
