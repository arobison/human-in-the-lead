---
id: HITLD-165
title: A quota probe records the real rate-limit reading the claude command prints, locally and in the cloud
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
needs: [HITLD-149]
---

## Why

The quota gate needs a real reading of the owner's plan usage. In a cloud session there is no status line, the documentation names no source in a container, and the only figure so far was one the owner declared by hand, which goes stale as work runs. On 2026-11-16 the chief of staff found that the `claude` command, run in a cloud container in print mode with `--output-format stream-json --verbose`, prints a `rate_limit_event` after a request. In the one sample taken it held the account's weekly `utilization` (0.5, which matched the owner's own figure of 50%), the reset time (`resetsAt`, as epoch seconds), `rateLimitType: seven_day`, a `status` (`allowed_warning`), and `unifiedWindows`, which listed only `seven_day`. The same event is what the session-management data shows as `rate_limit_info`. It is not in the documentation pages that were checked, so the format may change, and each reading costs one small request. `claude -p "/usage"` runs locally in print mode and prints only the session's own cost and tokens.

The owner decided (HITLD-166) to build a probe, with the declared figure of HITLD-164 kept as the fallback.

## Settled by the owner

On 2026-11-16, in the chief of staff session, the owner decided these in a design walk-through, recorded as decisions:

- **When it runs (HITLD-168):** when a reading is needed and stale. The gate probes before starting work when the last reading is older than a set age (30 minutes to start), and again as the used share nears the reserve. There is no timer, and the owner can ask for one by hand.
- **Which model, and its cost (HITLD-169):** the smallest model with a one-word prompt, and the cost is recorded in the ledger as probe spend, not counted against any item's budget.
- **How it combines with a declared figure (HITLD-170):** a probe reading is used while it is fresh, and the declared estimate of HITLD-164 only when no fresh reading exists.
- **When it cannot give a reading (HITLD-171):** in the owner's words, "shouldn't it escalate that issue up to the orechestrator and eventually to you and then to me? seems like a good test of the system's overall escalation machinery". Read as: the gate keeps running on the declared estimate, and the failure (denied, failed, or an unrecognized format) is raised up the chain, from the orchestrator to the chief of staff to the owner, who is last.
- **Where it runs (HITLD-172):** wherever the gate needs a reading: the orchestrator's container for its dispatch decisions, and the chief of staff for the digest and status. Each reading is written to the store when it is reachable, so other sessions can use a fresh one.
- **The status-line capture (HITLD-173):** in the owner's words, "i think probably retire the status line...do those even work in the claude code desktop app? the agents can get all of that info from the private store, right? and the status line would really be something for me to glance at in the chief of staff session? not sure that adds value". Read as: retire the status-line usage capture and use the probe everywhere. The documentation describes a status line only for the terminal CLI (desktop, web and IDE are not documented) and cloud sessions do not read `settings.local.json`, where the capture installs.

## Done when

- The probe command runs one minimal print-mode call on the smallest model, parses the `rate_limit_event`, and records the reading as a usage snapshot marked `measured`, with the windows the event lists, and writes it to the store when it is reachable.
- The gate probes when the last reading is older than a setting (30 minutes by default) and as the used share nears the reserve, and uses a fresh reading before the declared estimate.
- The probe's cost is written to the ledger as probe spend and counted against no item.
- A probe that is denied, fails or meets an unrecognized format is recorded with its reason, the gate falls back to the declared estimate, and the failure is raised through the escalation path: in the orchestrator's message, then relayed by the chief of staff to the owner. An eval scenario covers a denied probe, a failed one and a format change, and checks each reaches the owner.
- The status-line usage capture (`hitld install --statusline` and the `hitld-statusline` command) is retired, with its tests, guide text and first-run offer, and the usage snapshot schema no longer has the `five_hour` field (see HITLD-151).
- Tests run against a recorded `rate_limit_event`. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

State stays `proposed` until the owner moves it to `planned`. The status-line readout of HITLD-56 was dropped by the owner (HITLD-175), so only the capture's retirement concerns the status line here. The granularity of `utilization` is not known: the one sample was a round 0.5. Related: HITLD-149 (a declared figure, settled by HITLD-164), HITLD-151.
