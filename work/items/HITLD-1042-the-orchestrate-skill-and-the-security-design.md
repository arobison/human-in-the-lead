---
id: HITLD-1042
title: The orchestrate skill and the security design chapter describe the merge result's list_found field and where it appears
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- skills/orchestrate/SKILL.md says the merge result in pull-request mode carries `list_found` (true when the private term list was read for the run) and what the orchestrator tells the owner when it is false.
- docs/design/0001-human-in-the-lead/10-security.md, in its merge section, says the same, and that a rejection names the kind and line of a term but never the term or a path that holds one.
- `list_found` appears on every merge result shape or the text says it appears only for `merge.via pull-request`; the pull request that builds HITLD-824 decides which and this item makes the texts match.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-824 (the queue's presentation runs the private-term check on a pull request's diff and commit messages) adds `list_found` to the merge result. Its independent review found the field documented nowhere but the `next` text, and the follow-up kept the skill and the design chapter out of that pull request because a skill change needs the owner's own yes. [Certain: from the review.]

## Notes

rc.3 (a proposal for the owner to move). A skill and design-doc change: the owner's own yes at merge. Follows HITLD-824.
