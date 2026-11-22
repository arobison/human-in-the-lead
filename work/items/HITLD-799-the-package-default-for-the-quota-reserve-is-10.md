---
id: HITLD-799
title: The package default for the quota reserve is 10 percent, not 25
kind: work
state: done
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
claimed_by: D-01M814Y8CYT53BGM
release_note: The package default for `quota.reserve` is 0.10 (10 percent of each limit kept for the owner's own use), not 0.25. A person file, project or limit that sets its own reserve is unchanged; set `quota.reserve` to 0.25 to keep the old behavior.
---

## Why

The owner decided (2026-11-22) that the default reserve, the share of each limit kept for their own interactive use, is too large at 25 percent and should be 10 percent. At 25 percent the economize gate held this repository's run at one executor while 58 percent of the week was used. The owner's own person file now says 0.10; this item makes it the package default for everyone else.

## Done when

- `schemas/policy/quota.schema.json` defaults `reserve` to 0.10, and every place that states the old default agrees: `skills/orchestrate/SKILL.md` step 6 and its tests.
- The design text that states 25 percent (part 12.5 and Q11 in the open questions) changes only through the curator job and a design PR; HITLD-800 is that curator item; this item does not edit `docs/`.
- A schema change reaches main only with the owner's own yes. `npm run check` and `hitld work check` pass.
