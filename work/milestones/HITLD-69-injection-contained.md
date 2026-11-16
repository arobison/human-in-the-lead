---
id: HITLD-69
title: Injection contained
kind: milestone
state: planned
created: 2026-11-14
project: HITLD-28
outcome: No agent acts on instructions in untrusted text, and each agent can do only what its role allows.
done_when:
  - "c1: Every injection scenario passes, and attempts are flagged."
  - "c2: Each role has a least-privilege definition that the guard enforces, and a worktree where the commit guard would not run is reported."
constraints: [HITLD-34 c1, HITLD-34 c2]
check: integration-test the injection scenarios at 100%, and a seeded write outside a role's paths refused
---

## Notes

Made by `hitld work migrate` (milestone-entities) from the milestone "injection-contained" of HITLD-28. Shaping gives it an outcome, done-when clauses and a check, and links each constraint marked `c?` to a clause.

From HITLD-28:

- **injection-contained** (capability). Outcome: no agent acts on instructions in untrusted text. Done when: check 4 passes. Check: the injection scenarios in the eval suite. Constraints: HITLD-34 (and HITLD-29).

Shaped by the planning pass HITLD-343 (2026-11-16). Kept narrow, mostly HITLD-34; merging it into end to end (HITLD-68) is the alternative, since intake is the main source of untrusted text. Stage: after v0.1.0.
