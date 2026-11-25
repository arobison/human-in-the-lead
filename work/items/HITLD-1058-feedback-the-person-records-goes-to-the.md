---
id: HITLD-1058
title: "Feedback the person records goes to the publishing path by default: the orchestrator drafts a generalized version right after it is recorded and shows it to approve, edit, write by hand or drop"
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The chief-of-staff and orchestrate skills say that after `hitld feedback` records an entry, the orchestrator drafts the generalized version at once and the chief of staff puts it to the person with the question tool (approve, edit, write by hand, drop); nothing is sent without that answer.
- A record is never left local without the person being asked; a test or skill check covers the instruction.
- No change to the send gate or the private-term check: the person still approves every send.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 674: a feedback record stayed in the project's private store, nothing started the publishing path, and the maintainers would never see it unless someone asked for a draft.

## Notes

rc.3. A skill change: owner-held (the owner's own yes). Related: HITLD-47 (the recognizing and publishing flow), HITLD-891 (re-screen at approval), HITLD-274.
