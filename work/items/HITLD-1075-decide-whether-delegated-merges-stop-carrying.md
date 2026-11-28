---
id: HITLD-1075
title: Decide whether delegated merges stop carrying the owner's sign-off and agents get their own identity, with requester, accountable owner and acting agent on every ledger event
kind: work
state: proposed
created: 2026-11-28
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when
- A decision, with the owner: whether delegated merges (HITLD-855 and HITLD-865) keep carrying the owner's `Signed-off-by` or agents get their own identity, and whether every ledger event records the requester, the accountable owner and the acting agent.
- Whichever is chosen, the decision names what changes in the merge tooling and the skills, and what stays as history (public commits and the ledger are permanent), and it is filed as items.
- `hitld work check` passes.

## Why

Delegated approvals today are recorded with the owner's sign-off line. Public history and the ledger are permanent, so a line that says the owner signed what an agent approved is a record that cannot be corrected later, and it blurs who was accountable when the trust record is read. Found by the Fable read of the landscape report (`Fable design implications.md`, recommendation 4); the DCO meaning of "signed off" is a question for the owner.

## Notes

rc.3, proposed: needs the owner's choice. Merge-path, policy and rights text is owner-held (the owner's own yes). Decide before the delegation is widened.
