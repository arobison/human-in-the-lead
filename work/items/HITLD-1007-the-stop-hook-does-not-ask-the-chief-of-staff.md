---
id: HITLD-1007
title: The Stop hook does not ask the chief of staff to commit published tracker files on every turn
kind: work
state: planned
created: 2026-11-24
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- After `hitld work publish` on main, the harness's Stop hook (or the hook this repository installs) does not report the staged published files as uncommitted work, or its message says the files were published and are absorbed by the next fast-forward pull; a test or eval scenario covers the status after a publish on main.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

HITLD-202 left the published files staged on main by design (a pull request absorbs them), and its note says a status-based Stop hook can still fire on them. It still does: across the 2026-11-22 to 11-24 run the chief of staff was asked to commit tracker files to main at the end of almost every turn that published, and answered each time that it is by design. HITLD-202 recorded sightings on 2026-11-16 and 11-20; this is the third kind of evidence, repeated many times.

## Notes

rc.3. A nag the agent must answer by hand every turn wastes context and teaches the agent to ignore the hook. Not a ship blocker.
