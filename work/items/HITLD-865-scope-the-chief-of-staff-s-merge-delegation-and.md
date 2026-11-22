---
id: HITLD-865
title: Scope the chief of staff's merge delegation and add an independent reviewer (HITLD-855)
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Scope it and add a reviewer: Named areas, an end date, never guard/policy/rights/skill/design-rule changes; an independent read-only reviewer verdict before each delegated code merge; approvals recorded as delegated."
answered_at: 2026-11-22T18:41:43.510Z
answered_via: question-tool
answered_by: owner
---

## Question

The review says approvals no longer bind. How should the chief of staff's standing permission to approve merge-queue PRs change?

HITLD-855 grants the permission through rc.2. Delegated approvals currently carry the owner's sign-off, and no independent reader looks at a delegated code merge.

## Options and recommendation

- A. Scope it and add a reviewer: Named areas, an end date, never guard/policy/rights/skill/design-rule changes; an independent read-only reviewer verdict before each delegated code merge; approvals recorded as delegated.
- B. Keep it as it is: The chief of staff's own checks stay the only gate.
- C. Revoke it: The owner approves every code PR.

Recommended: Scope it and add a reviewer. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
