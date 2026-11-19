---
id: HITLD-407
title: "The owner gives each answer once, in one place, and it counts"
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-15
outcome: The owner answers only in the chief of staff's session, the answer reaches any session that needs it as a record only the owner's turn can create, and signatures show who gave each approval.
done_when:
  - "c1: The designs for driving other sessions and for answers reaching the orchestrator's prompts are settled and built."
  - "c2: A permission denial is a typed fault that escalates once."
  - "c3: Commits and sign-offs carry the agreed identity."
  - "c4: Device approvals verify by signature."
constraints: [HITLD-126 c1, HITLD-254 c1, HITLD-240 c1, HITLD-180 c1, HITLD-291 c1, HITLD-186 c2, HITLD-179 c3, HITLD-333 c4]
check: demo the owner answers a held question in the chief-of-staff session, the orchestrator's command runs with no prompt in its own session, and an unsigned approval is refused
---

## Notes

Proposed by the planning pass HITLD-343 on the owner's decision HITLD-363; the owner commits it later. Stage: after v0.1.0, except that v0.1.0 needs HITLD-333 directly (the owner's decision HITLD-365). Signed decision answers (HITLD-36) went to their own milestone under HITLD-53 instead (HITLD-366).

## Decided on 2026-11-19 (HITLD-515)

The clause "the owner answers only in the chief of staff's session" gives way to a channel-neutral rule: an answer counts when it carries a proof the system can check. Today that proof is the harness-attested turn in the owner's session; later it is the person's signature (HITLD-333, HITLD-409). The session, a web page or any other client only carries the proof, and a write from a web page without a proof is data, not an answer. The wording of this milestone's outcome and its check is to be revised to match.
