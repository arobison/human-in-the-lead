---
id: HITLD-450
title: A start estimate recorded on a dispatch is capped, and says where it came from
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
needs: [HITLD-438, HITLD-439]
---

## Done when




- `startEstimate` (the figure the `--tokens-over-estimate` refusal, the watchdog's stall limits and `estimate_vs_actual` read from a dispatch's `dispatched` event) is capped at the planner's maximum multiple of the tier default (`dispatch.estimate_max_multiple`), so a poisoned start estimate cannot raise the refusal threshold or make a ratio read falsely low. A test uses a `dispatched` event carrying 1,882,231.
- A `dispatched` event records where its estimate came from (`estimate_source`) and how many completions it rested on (`estimate_samples`), so a start estimate that came from one record is visible in the ledger itself. Older events without the fields read as "source unknown".
- A `dispatched` event's start estimate can be corrected by a supported command, itself recorded in the ledger, as HITLD-436 did for a completion's tokens; the correction is read in place of the original.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

Found by the executor of D-36 (HITLD-439) and reported by the orchestrator on 2026-11-16: the `dispatched` events of D-29, D-30, D-33 and D-34 in the orchestrator's ledger carry a start estimate of 1,882,231 (it came from one bad completion record). The estimator no longer reads start estimates, so they cannot set a future estimate, but `startEstimate` still reads them: for those dispatches and their follow-ups the `--tokens-over-estimate` refusal threshold is about 5.6M instead of 1.2M, the `estimate_vs_actual` ratios read falsely low, and the watchdog's stall limits rest on them (bounded at 3x by `stall_estimate_max`). Nothing in the ledger says where a start estimate came from.

## Notes

Needs HITLD-438 (it changes the ledger shape) and HITLD-439 (the settings and the estimate's source). Related: HITLD-436, HITLD-408 c1 (placed there). Code: needs the owner's own yes to merge.
