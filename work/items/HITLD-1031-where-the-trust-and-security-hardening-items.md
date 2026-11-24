---
id: HITLD-1031
title: Where the trust and security hardening items belong, and two cleanups, for rc.2
kind: decision
state: done
created: 2026-11-24
project: HITLD-15
decider: owner
answer: "A. Keep the cheap ones, move the rest: Keep HITLD-872, 871 and 953 in rc.2 and move the other nine (856, 857, 867, 868, 869, 870, 888, 954, 955) out of Consumer live to the later least-privilege milestone."
answered_at: 2026-11-24T21:01:04.751Z
answered_via: question-tool
answered_by: owner
---

## Question

Where do the 12 trust/security hardening items belong (HITLD-856, 857, 867, 868, 869, 870, 871, 872, 888, 953, 954, 955), given the rc.2 freeze did not list them as cut? And do we close HITLD-752 and move HITLD-1030 out of rc.2?

After the rc.2 triage (2026-11-24): 82 items of Consumer live are done, 37 planned and 1 proposed remain. The 12 hardening items were filed on 2026-11-22 under the first clause and were not named in the freeze (HITLD-874). HITLD-752 is a design item still proposed although its build (HITLD-759) and decisions are done. HITLD-1030 is marked rc.2 or later.

## Options and recommendation

- A. Keep the cheap ones, move the rest: Keep HITLD-872, 871 and 953 in rc.2 and move the other nine (856, 857, 867, 868, 869, 870, 888, 954, 955) out of Consumer live to the later least-privilege milestone.
- B. Move all 12 to rc.3: All twelve leave rc.2.
- C. Keep all 12 in rc.2: No change.

Recommended: Move all 12 to rc.3. The chief of staff recommended moving all twelve; the owner chose to keep three.

## Answer

Recorded in the front matter once answered.
