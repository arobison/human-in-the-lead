---
id: HITLD-149
title: A usage figure the owner declares reaches the quota gate in a cloud session
kind: work
state: in-progress
created: 2026-11-16
project: HITLD-15
needs: [HITLD-151]
claimed_by: D-43
---

## Why

In a cloud session there is no status line, so the quota gate has no reading for a plan limit and stops all dispatch. A declared limit holds no used figure. The only way through in the first self-hosted run was to append a line to a store file by hand, which the orchestrator did only after the owner said yes, and which goes stale as work runs. There is no sanctioned way to tell the gate what the owner reads on their own account.

## Done when

- `hitld quota declare` records a usage figure for a named limit, with the limit's reset time, as a snapshot marked `owner-declared`. It is taken only from the owner's own turn, refused to executors, and validated against the snapshot schema.
- The gate reads a declared figure and treats it as a reading of low confidence that ages. From the declared figure and the recorded burn since, it estimates the used share, so the figure does not hold still as work runs. A fresh measured reading wins over it: while the latest measured snapshot is younger than the gate's fresh age (30 minutes as built), the gate uses that reading, and the declared estimate is used only when no fresh measured reading exists (HITLD-170). A figure declared after a fresh measured reading does not replace it.
- When the estimate nears the reserve, or the figure is older than a setting, `hitld run status` and the digest ask the owner for a fresh figure, and dispatch waits for it only at the reserve.
- The orchestrate and chief-of-staff skills use this command, and say never to write a store file by hand.
- Tests cover a declared figure opening the gate, its aging toward the reserve, a stale figure asking for a refresh, a fresh measured reading kept over a later declared figure, and a refusal to an executor. `npm run check`, the offline eval gate and `hitld work check` pass.

## Settled by the owner

On 2026-11-16, in the chief of staff session, the owner decided how the gate treats a declared figure (HITLD-164): a low-confidence estimate that ages. `hitld quota declare` records it in the owner's own turn, the gate estimates the used share from the figure plus the burn recorded since, and the owner is asked for a fresh figure when the estimate nears the reserve or the figure is older than a setting.

## Notes

Raised in the chief of staff session. HITLD-56 (the status-line readout, dropped) and the capture in `hitld install --statusline` cover harnesses that expose usage; this covers the ones that do not.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (509): quota gate declared figure. The decisions since then are the pace decisions (HITLD-530, 549, 550). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.

## Reworded on 2026-11-20 (plan audit)

Not superseded. The owner decided to build a quota probe and keep the declared figure as its fallback (HITLD-166): a probe reading is used while it is fresh and the declared estimate only when no fresh reading exists (HITLD-170), and a probe that cannot read falls back to the declared estimate and is escalated (HITLD-171). The pace decisions (HITLD-530, HITLD-549, HITLD-550) do not remove the declared figure: the limits and reporting design, written to them, has each project follow the even line on the account's total read from the probe or a declared figure. The probe itself is a separate item (HITLD-165) outside this milestone, so rc.2 still needs this command. The milestone clause is unaffected.

One line of Done when changed:

- **Which reading wins (HITLD-170).** The second line said how the gate treats a declared figure but not how it combines with a measured reading. As built, the gate takes the latest snapshot whatever its source, so a figure declared after a fresh measured reading would have replaced it, against HITLD-170. The line now says a fresh measured reading wins and the declared estimate is used only without one, and the tests include that case. The measured reading today is the status-line capture, and the probe once HITLD-165 is built.

Checked and unchanged: the status-line capture named in the Notes is retired once the probe is built (HITLD-173), which does not change what this item builds. The third line names `hitld run status`, as built; HITLD-492 removes the run commands and names their replacement in its own build, so what this item fixes is the ask to the owner for a fresh figure, which stays. HITLD-164 (the owner's choice for this item) and the other pace decisions (HITLD-530, HITLD-531 replaced by HITLD-549, HITLD-550) do not change what it builds.
