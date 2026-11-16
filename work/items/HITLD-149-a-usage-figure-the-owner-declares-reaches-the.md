---
id: HITLD-149
title: A usage figure the owner declares reaches the quota gate in a cloud session
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

In a cloud session there is no status line, so the quota gate has no reading for a plan limit and stops all dispatch. A declared limit holds no used figure. The only way through in the first self-hosted run was to append a line to a store file by hand, which the orchestrator did only after the owner said yes, and which goes stale as work runs. There is no sanctioned way to tell the gate what the owner reads on their own account.

## Done when

- `hitld quota declare` records a usage figure for a named limit, with the limit's reset time, as a snapshot marked `owner-declared`. It is taken only from the owner's own turn, refused to executors, and validated against the snapshot schema.
- The gate reads a declared figure and treats it as a reading of low confidence that ages. From the declared figure and the recorded burn since, it estimates the used share, so the figure does not hold still as work runs.
- When the estimate nears the reserve, or the figure is older than a setting, `hitld run status` and the digest ask the owner for a fresh figure, and dispatch waits for it only at the reserve.
- The orchestrate and chief-of-staff skills use this command, and say never to write a store file by hand.
- Tests cover a declared figure opening the gate, its aging toward the reserve, a stale figure asking for a refresh, and a refusal to an executor. `npm run check`, the offline eval gate and `hitld work check` pass.

## Settled by the owner

On 2026-11-16, in the chief of staff session, the owner decided how the gate treats a declared figure (HITLD-164): a low-confidence estimate that ages. `hitld quota declare` records it in the owner's own turn, the gate estimates the used share from the figure plus the burn recorded since, and the owner is asked for a fresh figure when the estimate nears the reserve or the figure is older than a setting.

## Notes

Raised in the chief of staff session. HITLD-56 (the status-line readout) and the capture in `hitld install --statusline` cover harnesses that expose usage; this covers the ones that do not.
