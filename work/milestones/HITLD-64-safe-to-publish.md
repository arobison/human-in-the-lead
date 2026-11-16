---
id: HITLD-64
title: Safe to publish
kind: milestone
state: planned
created: 2026-11-14
project: HITLD-15
outcome: Anyone can read the public repository, its history and its issues, and nothing in them should not be there.
done_when:
  - "c1: The confidentiality pass and the guided design review are finished."
  - "c2: Confidential decisions and feedback drafts never reach the public tracker or an issue unseen."
  - "c3: The public-text checks fail closed when the private term list cannot be read."
constraints: [HITLD-22 c1, HITLD-23 c1]
check: demo an independent scan of the repository and its history, and a run with no private store showing the commit hook refuses or warns, run by someone other than the authors
---

## Notes

Made by `hitld work migrate` (milestone-entities) from the milestone "safe-to-publish" of HITLD-15. Shaping gives it an outcome, done-when clauses and a check, and links each constraint marked `c?` to a clause.

From HITLD-15:

- **safe-to-publish** (capability). Outcome: anyone can read the public repository, and nothing in it or its history should not be there. Done when: the confidentiality pass finds nothing open, and the owner has finished the guided design review. Check: an independent scan of the repository and its history. Constraints: HITLD-22, HITLD-23.

Shaped by the planning pass HITLD-343 (2026-11-16). c1 is met (HITLD-22 and 23 are done). Stage: v0.1.0 (HITLD-24 needs it); the scan runs just before the tag.
