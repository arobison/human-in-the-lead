---
id: HITLD-67
title: Consumer live
kind: milestone
state: planned
created: 2026-11-14
project: HITLD-15
outcome: A real consuming project runs its work through HITLd. The first one is this repository, running its own development on an installed release.
done_when:
  - "c1: The owner directs one item end to end (filed, dispatched, executed, merged and closed) through the chief of staff in the self-hosting cloud environment, on v0.1.0-rc.1 installed in this repository, or a pinned commit on main that carries the first-run fixes (the milestone's own constraints land after rc.1), with no prompt carried between sessions by hand."
  - "c2: The routine jobs of that run (merging through pull requests, tracker changes from the session, tracker upkeep, removing finished worktrees) are done by hitld commands, not by hand."
  - "c3: Every choice the owner makes in that run is recorded as a decision, and the trust and attention records show it."
  - "c4: The owner can see the plan, the milestones, what is happening now, and quota and spend in one generated page, dashboard.html."
constraints: [HITLD-26 c1, HITLD-109 c1, HITLD-46 c1, HITLD-47 c1, HITLD-60 c1, HITLD-142 c1, HITLD-74 c1, HITLD-144 c1, HITLD-147 c1, HITLD-148 c1, HITLD-149 c1, HITLD-124 c2, HITLD-125 c2, HITLD-130 c2, HITLD-131 c2, HITLD-132 c2, HITLD-133 c2, HITLD-136 c2, HITLD-141 c2, HITLD-150 c2, HITLD-151 c2, HITLD-153 c2, HITLD-134 c3, HITLD-135 c3, HITLD-62 c4, HITLD-152 c4, HITLD-160 c3, HITLD-349 c1]
check: demo the owner directing one item end to end through the chief of staff in the self-hosting environment, run by the owner
---

## Notes

Shaped on the owner's decision (2026-11-15): this repository, self-hosting, is the first consuming project, and the release item for v0.1.0-rc.2 (HITLD-137) needs this milestone. Setup through a package script (HITLD-25) is for an outside consumer and moved to v0.1.0 (HITLD-24).

On the owner's decision (2026-11-16, in the chief of staff session), the failures of the first self-hosted run join this milestone: HITLD-142, 144, 147, 148 and 149 under the first clause, because each made a prompt or an answer travel between sessions by hand, and HITLD-141, HITLD-150, HITLD-151 and HITLD-153 under the second (HITLD-153 added the same day, after the first run's dispatch start was refused with nothing running). HITLD-143, 145 and 146 are for v0.1.0.

On the owner's decision (2026-11-16, HITLD-176 and HITLD-177), the dashboard page joins this milestone as a fourth clause, built next: HITLD-152 and HITLD-62 under it. The clause wording is a proposal for the owner to amend.

On the owner's decision (2026-11-16, HITLD-178), HITLD-74 joins the first clause: two containers cannot share one store without it.

On the owner's decision HITLD-364 (2026-11-16), HITLD-160 (`rights record` leaves a decision item behind) joins the third clause as the one exception for rc.2, applied by the planning pass HITLD-343.
