---
id: HITLD-66
title: First release
kind: milestone
state: planned
created: 2026-11-14
project: HITLD-15
outcome: A consuming project can pin a released version that already has the milestone and release format.
done_when:
  - "c1: A fresh clone of a fixture consumer installs the plugin pinned to a release tag, and `hitld check contract` passes (check 10 of design 21.1)."
  - "c2: `hitld release propose` on main reports no missing release notes and no undecided high alert, and the release environment refuses an unsafe configuration."
constraints: [HITLD-18 c1, HITLD-45 c1, HITLD-58 c1, HITLD-59 c1, HITLD-63 c1, HITLD-227 c2, HITLD-300 c2, HITLD-229 c2, HITLD-499 c2]
check: integration-test the check-10 install test against the candidate tag
---

## Notes

Made by `hitld work migrate` (milestone-entities) from the milestone "first-release" of HITLD-15. Shaping gives it an outcome, done-when clauses and a check, and links each constraint marked `c?` to a clause.

From HITLD-15:

- **first-release** (capability). Outcome: a consuming project can pin a released version that already has the milestone and release format. Done when: v0.1.0 is tagged with a release record, and a fresh clone of a fixture consumer installs it pinned (check 10 of One signal end to end). Check: that install test. Constraints: HITLD-18, HITLD-45, HITLD-58, HITLD-59, HITLD-63, HITLD-24 (and the commit guard, HITLD-51).

Shaped by the planning pass HITLD-343 (2026-11-16). On the owner's decision HITLD-360, HITLD-24 (the v0.1.0 release item) is no longer a constraint: it needs this milestone instead, which ends the circular link. Stage: v0.1.0.
