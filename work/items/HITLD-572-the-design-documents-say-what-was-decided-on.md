---
id: HITLD-572
title: The design documents say what was decided on 2026-11-19, in one change the owner approves
kind: work
state: done
created: 2026-11-19
project: HITLD-15
needs: [HITLD-565]
constraint_of: [HITLD-405 c1]
---

## Why

The decisions of 2026-11-19 (HITLD-512 to 571) are in the tracker, but `docs/design` still describes the old design: a run object with a lease and hand-over, trust as counts of approvals per area, answers valid only through the chief of staff's session, a fixed executor cap, and calendar cadences. The decided design items (HITLD-472, 507, 291, 441, 470, 493, 509) each say the design parts are updated in one change the owner approves. The owner decided (HITLD-571) to do that as one consolidated update and then close those design items.

## What it should do

- Rewrite the affected design parts from the decision records, citing each decision: no run object and the ledger (HITLD-484 to 490, 549); the trust engine, merging and commitment (HITLD-472, 291, 507 and the decisions HITLD-473 to 482, 503 to 506, 518 to 529, 545 to 548); answers and proof (HITLD-515 to 517); the pace controller and the burn rate (HITLD-530, 531's replacement HITLD-549, 550); executor count, stuck detection, tiering, cadence, enforced rules and the attention limit (HITLD-532 to 538); emergent escalations (HITLD-544 to 546); pending decisions and stay-in-the-harness (HITLD-540, 542); the preference record (HITLD-569); the release stages (HITLD-551).
- Mark what is decided but not yet built, so the docs do not claim code that does not exist.
- One pull request for the owner's own yes; when it merges, close the decided design items.

## Done when

- The listed design parts say what was decided, with no contradiction left between them and the decision records.
- Each decided design item (HITLD-472, 291, 441, 470, 493, and the finished parts of 507 and 509) is closed with a pointer to the build items.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Needs the reconciliation of the open items (HITLD-565), so the docs describe the plan that survives it. Design: the owner's own yes to merge. Placed under HITLD-405 c1 (a claim about HITLd cites the design) by the chief of staff, a proposal for the owner to move.

## Glossary (HITLD-577)

The design glossary defines appetite, budget and pace as decided: appetite is estimated size (HITLD-412), budget is what the owner allows a commitment to spend (HITLD-522), pace is the rate the plan allows per hour (HITLD-530).

## Tiers (HITLD-581)

The design part on sizing tiers (part 5.1) is rewritten for the decision that discrete tiers go: an execution mode picked from capability needs, a cost-ordered model-and-effort cascade, and a token budget measured from history, with `tier_override` becoming a profile override. Every other part that says "tier" follows.

## Promoted on 2026-11-20 (HITLD-588)

The owner decided (HITLD-588) that this is drafted now by a curator-style job: an agent briefed with the decision IDs rewrites the affected design parts as one pull request, the chief of staff verifies each part against the decision records, and the owner approves it. The release-stage part (part 21) follows once the roadmap audit's moves are settled.

## Closed on 2026-11-20 (HITLD-603)

The design-docs update merged on 2026-11-20 on the owner's own yes (the pull request titled "Design: update the design parts to the decisions of 2026-11-19 and 2026-11-20"). This item is done.
