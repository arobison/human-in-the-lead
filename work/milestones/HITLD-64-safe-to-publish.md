---
id: HITLD-64
title: Safe to publish
kind: capability
status: Planned
created: 2026-11-14
project: HITLD-15
needs: [HITLD-22 c?, HITLD-23 c?]
---

## Notes

Made by `hitld work migrate` (milestone-entities) from the milestone "safe-to-publish" of HITLD-15. Shaping gives it an outcome, done-when clauses and a check, and links each constraint marked `c?` to a clause.

From HITLD-15:

- **safe-to-publish** (capability). Outcome: anyone can read the public repository, and nothing in it or its history should not be there. Done when: the confidentiality pass finds nothing open, and the owner has finished the guided design review. Check: an independent scan of the repository and its history. Constraints: HITLD-22, HITLD-23.
