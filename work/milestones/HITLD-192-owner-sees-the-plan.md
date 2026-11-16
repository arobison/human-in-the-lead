---
id: HITLD-192
title: The owner sees the plan in one page
kind: milestone
state: proposed
created: 2026-11-16
project: HITLD-15
outcome: The owner sees the plan, milestones, what is running, and quota and spend in dashboard.html.
done_when:
  - "c1: Every open item shows on the board under a milestone, and no label says long outcome."
  - "c2: Every link in the page opens in a browser, or says where it cannot."
constraints: [HITLD-343 c1, HITLD-342 c1, HITLD-267 c1, HITLD-268 c1, HITLD-378 c1, HITLD-320 c2, HITLD-339 c2]
check: demo opening dashboard.html, finding every open item under a milestone and following each kind of link, run by the owner
---

## Notes

Step 4 of 4. This is c4 of Consumer live (HITLD-67) in its own right; amend or drop the duplicate there.

Re-scoped as a v0.1.0-rc.3 milestone (HITLD-400) by the planning pass HITLD-343, on the owner's decision HITLD-359: the met clause was dropped. It was c1 "hitld dashboard generates one file with the four views from live records" (HITLD-62 and 152, both done). HITLD-147 was removed: it is executor reporting, under HITLD-67 c1, not the page. The new c1 and c2 are the proposal's c2 and c3. The check changed with the clauses.

The planning pass HITLD-343 also placed HITLD-378 (whether milestone contributions stay in the design) under c1; it was filed after the proposal was written. HITLD-267, 268 and 339 were proposed as contributions and are constraints instead (the owner's decision HITLD-377).
