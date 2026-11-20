---
id: HITLD-191
title: Routine jobs are done by commands
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-15
outcome: The merges, tracker changes and upkeep of a run need no hand work or approval for the routine cases.
done_when:
  - "c1: Reversible tracker edits land without a per-change approval and can be reversed by command."
  - "c2: Merges, publishes, claims and closes follow one written routine and carry the full trailers."
  - "c3: Finished sessions, published refs and stale items are cleaned up by command."
constraints: [HITLD-143 c1, HITLD-288 c1, HITLD-218 c2, HITLD-297 c2, HITLD-202 c2, HITLD-228 c2, HITLD-203 c2, HITLD-49 c2, HITLD-76 c2, HITLD-167 c3, HITLD-252 c3, HITLD-386 c2, HITLD-429 c2, HITLD-472 c2, HITLD-507 c2]
check: demo a run's tracker edits, merges, publishes, claims, closes and clean-up done by hitld commands with no per-change prompt, one edit reversed by command, run by the owner
---

## Notes

Step 3 of 4. HITLD-150 needs HITLD-133 (done).

Re-scoped as a v0.1.0-rc.3 milestone (HITLD-400) by the planning pass HITLD-343, on the owner's decision HITLD-359: the met clause was dropped. It was c1 "Tracker-only pull requests merge through hitld under the stated sign-off, headless executors are not launched where they cannot work" (HITLD-132, 141 and 150, all done). The new c1 to c3 are the proposal's c2 to c4. HITLD-160 went to HITLD-67 c3 instead (the owner's decision HITLD-364). The check changed with the clauses.

HITLD-76 and HITLD-220 were proposed as contributions and are constraints instead (the owner's decision HITLD-377). HITLD-76 returned to proposed (HITLD-578).
