---
id: HITLD-70
title: Evals gate
kind: milestone
state: planned
created: 2026-11-14
project: HITLD-28
outcome: A change that degrades a skill cannot merge unnoticed.
done_when:
  - "c1: Every skill has scenarios under `claude plugin eval`, and the end-to-end runner drives three flows."
  - "c2: Live evals run with a recorded baseline, and a deliberately degraded skill fails the gate."
  - "c3: The Copilot cloud agent profile passes against the fake adapter, through the MCP server."
constraints: [HITLD-57 c1, HITLD-33 c2, HITLD-33 c3, HITLD-52 c2, HITLD-127 c2, HITLD-54 c3]
check: demo a deliberately degraded skill fails the gate in CI, run by someone other than the authors
---

## Notes

Made by `hitld work migrate` (milestone-entities) from the milestone "evals-gate" of HITLD-28. Shaping gives it an outcome, done-when clauses and a check, and links each constraint marked `c?` to a clause.

From HITLD-28:

- **evals-gate** (capability). Outcome: a change that degrades a skill cannot merge unnoticed. Done when: check 6 passes. Check: a deliberately degraded skill fails the gate. Constraints: HITLD-33, HITLD-57.

Shaped by the planning pass HITLD-343 (2026-11-16). Stage: after v0.1.0, except c1: the owner kept v0.1.0 waiting on the end-to-end eval runner (HITLD-361), through HITLD-146's need on HITLD-57, so HITLD-57 lands before v0.1.0. HITLD-52 is held by the usage wait HITLD-351.
