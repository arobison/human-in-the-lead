---
id: HITLD-606
title: The two status-line install fixes close when the quota probe lands
kind: decision
state: done
created: 2026-11-20
project: HITLD-15
decider: owner
answer: "A. Close both when the quota probe lands: The status-line capture is retired, so nothing is left to fix; they are noted and tied to HITLD-165; the other seven install fixes stay"
answered_at: 2026-11-20T01:07:23.370Z
answered_via: question-tool
answered_by: owner
---

## Question

Should the two status-line install fixes close with the quota probe?

HITLD-173: retire the status-line usage capture and use the probe everywhere. HITLD-263 (install replaces the pinned marketplace with a machine path) and HITLD-264 (machine paths in the hook warning and status-line command) fix the status-line install.

## Options and recommendation

- A. Close both when the quota probe lands: The status-line capture is retired, so nothing is left to fix; they are noted and tied to HITLD-165; the other seven install fixes stay
- B. Keep both and fix them now: Fix the status-line install
- C. Fold them into the retirement item: Part of removing the status-line capture

Recommended: Close both when the quota probe lands. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
