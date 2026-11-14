---
id: HITLD-66
title: First release
kind: capability
status: Planned
created: 2026-11-14
project: HITLD-15
needs: [HITLD-18 c?, HITLD-24 c?, HITLD-45 c?, HITLD-58 c?, HITLD-59 c?, HITLD-63 c?]
---

## Notes

Made by `hitld work migrate` (milestone-entities) from the milestone "first-release" of HITLD-15. Shaping gives it an outcome, done-when clauses and a check, and links each constraint marked `c?` to a clause.

From HITLD-15:

- **first-release** (capability). Outcome: a consuming project can pin a released version that already has the milestone and release format. Done when: v0.1.0 is tagged with a release record, and a fresh clone of a fixture consumer installs it pinned (check 10 of One signal end to end). Check: that install test. Constraints: HITLD-18, HITLD-45, HITLD-58, HITLD-59, HITLD-63, HITLD-24 (and the commit guard, HITLD-51).
