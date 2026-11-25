---
id: HITLD-1007
title: A work publish on main leaves the working tree clean, so no Stop hook asks the chief of staff to commit published tracker files
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- After `hitld work publish` pushes its branch on main, the working tree is clean: the published files are no longer left staged, modified or untracked, so a status-based Stop hook, including the platform's, has nothing to report. The published branch holds the files; the next fast-forward pull of the merged pull request brings them back. A test covers the tree after a publish on main with a new file, a changed file and a staged file, and that nothing the owner had in progress before the publish is touched.
- The publish output says where the files went (the pushed branch) and that main is clean, so the chief of staff knows no restore step is needed.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-202 left the published files staged on main by design (a pull request absorbs them), and its note says a status-based Stop hook can still fire on them. It still does, and the platform hook cannot be edited from the repository, so the fix belongs in publish itself: across the 2026-11-22 to 11-24 run the chief of staff was asked to commit tracker files to main at the end of almost every turn that published, and answered each time that it is by design. HITLD-202 recorded sightings on 2026-11-16 and 11-20; this is the third kind of evidence, repeated many times.

## Notes

rc.3. The owner gave permission on 2026-11-25 to fix the staging mess: until this lands the chief of staff restores a clean tree by hand after each publish (checks the copies equal the pushed branch, then resets and removes them). Rewritten from "do not report staged files" to "leave nothing to report". A nag the agent must answer by hand every turn wastes context and teaches the agent to ignore the hook. Not a ship blocker.
