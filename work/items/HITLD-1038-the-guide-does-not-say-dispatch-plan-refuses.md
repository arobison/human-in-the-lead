---
id: HITLD-1038
title: The guide does not say `dispatch plan` refuses without a session at rc.1, and the `--session` flag is not described as going to `work claim` and `work close`
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The guide sentence on `dispatch plan` states the rc.1 behaviour as it is built; a test or a text check pins it if the repository has one for guide claims.
- The bullet on `--session` names the commands that take it and says `work claim` and `work close` do not.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The independent review of PR 631 (HITLD-937) on 2026-11-24 found two guide statements that overstate or misdirect; the CoS approved the pull request under the delegation rule and listed the points for filing. [Certain: from the reviewer's report.]

## Notes

rc.3 (a proposal for the owner to move). Documentation only, ordinary code.
