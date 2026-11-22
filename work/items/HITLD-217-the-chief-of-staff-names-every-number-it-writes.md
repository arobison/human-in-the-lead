---
id: HITLD-217
title: "The chief of staff names every number it writes: a pull request, a tracker item or a dispatch, never a bare #N"
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
constraint_of: [HITLD-405 c2]
---

## Why

The tracker numbers items `HITLD-N` and GitHub numbers pull requests `#N`, and the two never mean the same thing. In the first self-hosted run the chief of staff wrote a bare `#135` while the item was HITLD-130, and the owner could not tell whether it meant an issue, a tracker item or a pull request.

## Done when

- The chief-of-staff and orchestrate skills say: write a pull request as "PR #N (HITLD-M)" or a link, a tracker item as `HITLD-N`, a dispatch as `D-N`; never a bare `#N`. A reference to a GitHub issue says "issue".
- The same rule holds for pull request titles and bodies that mention another number.
- An eval scenario checks a report for bare numbers.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

The owner's instruction, 2026-11-16: "I need more specificity when talking about issue numbers." Filed under HITLD-181.

## Affected by a decision (reconciliation, HITLD-578)

The audit of 2026-11-19 found that an open design touches this item (74/489): rule writes dispatch as D-N; display numbers change. The decisions since then are the ledger and no-run decisions (HITLD-484 to 490). The item stays `planned`; a builder reads those decisions first, and the item is reworded if they change what it builds.
