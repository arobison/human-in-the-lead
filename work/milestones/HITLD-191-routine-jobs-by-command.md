---
id: HITLD-191
title: Routine jobs are done by commands
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-15
outcome: The merges, tracker changes and upkeep of a run need no hand work or approval for the routine cases.
done_when:
  - "c1: Tracker-only pull requests merge through hitld under the stated sign-off, headless executors are not launched where they cannot work."
constraints: [HITLD-150 c1, HITLD-141 c1, HITLD-132 c1]
check: demo a tracker-only pull request merged through hitld with no prompt, run by the owner
---

## Notes

Step 3 of 4. HITLD-150 needs HITLD-133 (done).
