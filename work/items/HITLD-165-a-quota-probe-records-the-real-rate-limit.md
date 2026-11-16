---
id: HITLD-165
title: A quota probe records the real rate-limit reading the claude command prints, locally and in the cloud
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
---

## Why

The quota gate needs a real reading of the owner's plan usage. In a cloud session there is no status line, the documentation names no source in a container, and the only figure so far was one the owner declared by hand, which goes stale as work runs. On 2026-11-16 the chief of staff found that the `claude` command, run in a cloud container in print mode with `--output-format stream-json --verbose`, prints a `rate_limit_event` after a request. In the one sample taken it held the account's weekly `utilization` (0.5, which matched the owner's own figure of 50%), the reset time (`resetsAt`, as epoch seconds), `rateLimitType: seven_day`, a `status` (`allowed_warning`), and `unifiedWindows`, which listed only `seven_day`. The same event is what the session-management data shows as `rate_limit_info`. It is not in the documentation pages that were checked, so the format may change, and each reading costs one small request. `claude -p "/usage"` runs locally in print mode and prints only the session's own cost and tokens.

The owner decided (HITLD-166) to build a probe, with the declared figure of HITLD-164 kept as the fallback.

## Done when

- The owner and the chief of staff review the design in a walk-through (HITLD-135), one question at a time, and the answers are recorded as decisions before anything is built. The questions:
  - How often a probe runs, and what triggers it (session start, a quota check, near the reserve, a fresh figure requested by the owner).
  - Which model the probe uses, and how its own cost is counted against the quota it measures.
  - What a reading is stored as (the usage snapshot schema has `five_hour` and `seven_day` fields from the status line; the event carries `unifiedWindows`), its confidence, and how a probe reading and a declared figure are combined.
  - What happens when the probe is denied by a session's permission system, fails, or the output format changes.
  - Where it may run: the orchestrator's container, the chief of staff's session, the owner's own machine.
  - Whether the owner's local status-line capture feeds the same snapshots.
- Then the build items follow, one per piece: the probe command, the snapshot change, the gate's use of it, and the tests against a recorded event.

## Notes

State is `proposed` on the owner's instruction, so the design is reviewed with them first. Related: HITLD-149 (a declared figure, settled by HITLD-164), HITLD-56 (the status-line readout), HITLD-151 (removing the five-hour limit, for which this sample is one more piece of evidence: the event listed no five-hour window). The granularity of `utilization` is not known: the one sample was a round 0.5.

