---
id: HITLD-873
title: "Closing the lower-severity guard gaps: budget cap evasion, check names, the private-term check before a push"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-64 c?]
---

## Why

Lower-severity guard gaps from the trust-boundary review (T7 to T9): the budget cap can be evaded (`GIT_EXTERNAL_DIFF`, `GIT_SSH_COMMAND`, `PATH=.` and `git -C` pass as closing steps, a forged claim with an unknown dispatch makes the budget unreadable and nothing is enforced, the transcript can be truncated); a required check is satisfied by its name alone (no app or source check, `skipped` and `neutral` count as success, one page of 100 results); and the private-term check runs after the push that can already leak.

## Done when

- The closing-step reader strips environment prefixes and pins git options; the dispatch comes from the oldest claim or the session binding; an unreadable budget counts as reached once a cap was ever read.
- A required check counts only from the expected app or workflow, checks are paginated, and `skipped` or `neutral` count as success only for the known skip.
- The private-term check runs on the commits before a claim-branch push is allowed, normalizes text (NFKC, zero-width characters) and checks file names.
- A test per case above.
- A guard change reaches main only with the owner's own yes. `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Findings T7, T8 and T9. Do after HITLD-867 to 870.

Moved from rc.2 to rc.3 by the owner's cut-line decision HITLD-974 (2026-11-23).
