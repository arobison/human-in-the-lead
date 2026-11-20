---
id: HITLD-254
title: "Design: the owner's answer in the chief of staff session reaches the orchestrator's permission prompts, so the owner never has to open its session"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
needs: [HITLD-135]
---

## Why

The owner talks only to the chief of staff. In the first self-hosted run, they chose in the chief of staff's question box to start HITLD-243 by hand, and the orchestrator's `dispatch start --by-hand` was still denied by the permission classifier in the orchestrator's own session ("Undermining Oversight"), because that session cannot see the owner's answer. The only way through was for the owner to open the orchestrator's session in their app and approve the call there. The owner called this annoying and asked for a way to need less of their attention. The same shape appeared before: `--by-hand` was denied twice, and `install --statusline` once. The owner's own decision is recorded (a decision item through `hitld rights record`), but the classifier does not read it.

## Done when

- The owner decides, in a design walk-through (HITLD-135), one question at a time, and the answers are recorded as decisions before anything is built. The options to think through:
  - **A standing permission rule** written at run start from the owner's settings: a short list of orchestrator commands the owner has authorized in advance (for example `dispatch start --by-hand`, `install --statusline`) that only run when a matching owner decision exists in the ledger or the private store.
  - **A decision the orchestrator can show**: the chief of staff's answer is written to the private store as an attested record (the owner's answer, the question, the time), and the command checks it before it runs, so the call is not the model's own act; the classifier's rule is satisfied by a record only the owner's turn can create (HITLD-36, signed answers).
  - **The chief of staff makes the call itself** for the commands that are the owner's own overrides, through a narrow command in its own session, and the orchestrator only records the handle.
  - **Leave it as an approval in the orchestrator's session**, but surface the prompt to the chief of staff (a typed fault, HITLD-186) so the owner can answer it in one place.
- The decision says which overrides are in the pre-authorized set, how the owner revokes one, and what is logged (every use is a `rights log` entry, reversible).
- Design parts 4 (decision rights) and 13 say the chosen answer; build items follow, one per piece.

## Notes

`proposed`: a choice about where authority sits, which the classifier exists to protect, so the owner decides it. Raised by the owner in the chief of staff session, 2026-11-16 (their own words: "needing to reach into the orchestrator to manually approve that is annoying, too"). Related: HITLD-186 (permission denials as typed faults that escalate), HITLD-154 (a wait that eats the owner's attention is named as friction), HITLD-153 (an item the owner names first cannot jump the planner), HITLD-179 (what the owner's sign-off is and who may use it), HITLD-36 (signed decision answers). Filed under HITLD-181.
