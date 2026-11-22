---
id: HITLD-728
title: "Shared UI kit: what happens to the build items 691 to 695"
kind: decision
state: done
created: 2026-11-22
project: HITLD-15
decider: owner
answer: "A. Keep 691 and 692, rewrite 693 to 695, add a new app item: 691 and 692 stand; 693 becomes components, 694 inlines data into the bundle, 695 is rewritten to the new design; a new item builds the React app, panels and the committed bundle with its CI check."
answered_at: 2026-11-22T01:08:46.512Z
answered_via: question-tool
answered_by: owner
---

## Question

HITLD-723 question 5: with the React app, static bundle with inlined data and installed package decided, what happens to HITLD-691 to 695?

691 (data contract) is already built; 692 views.json; 693 evidence panels; 694 regeneration; 695 the curator's design text.

## Options and recommendation

- A. Keep 691 and 692, rewrite 693 to 695, add a new app item: 691 and 692 stand; 693 becomes components, 694 inlines data into the bundle, 695 is rewritten to the new design; a new item builds the React app, panels and the committed bundle with its CI check.
- B. Replace 692 to 695 with one app item: One larger item.
- C. Pause the build, finish the design text first: Hold 692 to 695 until the curator pass.

Recommended: Keep 691 and 692, rewrite 693 to 695, add a new app item. The chief of staff recommended it.

## Answer

Recorded in the front matter once answered.
