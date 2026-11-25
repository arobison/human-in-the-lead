---
id: HITLD-1040
title: "Design the review-nit rule: small findings in the files a pull request already changes go back to the same warm executor before the pull request is presented, and the rest are filed"
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- The ledger gives the cost of a follow-up dispatch on an existing executor session against a fresh executor on a small item, for the dispatches of the 2026-11-24 run, in a note in this item; the rule below is kept, changed or dropped on that figure.
- A design note says which findings go back to the same executor (in the files the pull request already changes, small enough for a delta review, no new owner-held surface), which are filed as items, who decides (the chief of staff at the review verdict), and what the executor's remaining budget or context must be for it to be asked at all.
- The note says how the new head is reviewed (a delta review on the same pull request, not a full one), how approval binds to the final head, and that the owner sees one clean head instead of a merge-then-file decision.
- The owner approves the design in a question box before any code; then separate work items change the chief-of-staff skill and the delegation rule (HITLD-855 and HITLD-865).
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

On 2026-11-24 the chief of staff recommended 'merge, file the nits' for pull requests 632, 633, 634 and 639, and the nits became items 1030, 1034 to 1036 and 1039, each needing a fresh executor to reorient later. The owner pointed out that fixing them while the executor still holds the context is probably cheaper. [Likely: the saving is not measured; the first done-when measures it.]

## Notes

rc.3. A design item: the question to the owner comes before any code. The rule lands in the chief-of-staff skill and the delegation rule, so it is a skill change and needs the owner's own yes at merge. Until then the chief of staff applies it by hand and lists each case in the digest.
