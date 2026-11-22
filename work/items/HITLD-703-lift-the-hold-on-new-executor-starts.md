---
id: HITLD-703
title: Lift the hold on new executor starts?
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "C. Lift it entirely: Also start the six unstarted items; more work in parallel and more reviews for the owner."
answered_at: 2026-11-22T00:10:50.762Z
answered_via: question-tool
answered_by: owner
---

## Question

The hold on new executor starts (HITLD-663) waited for the review queue to clear. Lift it so the shared-UI build and the release-note job can begin once batch 3 lands?

Rc.2 cannot finish without the shared UI (HITLD-691 to 695), the release notes for HITLD-41, 49, 55 and 202, and the curator rewording (HITLD-701). Six items of the original 20 (HITLD-251, 252, 296, 300, 342, 413) have never started.

## Options and recommendation

- A. Lift it for rc.2 items only: Start HITLD-691 first, then 692 and 694 after it, plus the release-note job and HITLD-701; the six unstarted items stay held.
- B. Keep the hold: Start nothing until the owner says.
- C. Lift it entirely: Also start the six unstarted items; more work in parallel and more reviews for the owner.

Recommended: Lift it for rc.2 items only. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
