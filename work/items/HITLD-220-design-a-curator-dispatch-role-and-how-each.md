---
id: HITLD-220
title: "Design: a curator dispatch role, and how each kind of sweep finding routes to an action"
kind: work
state: proposed
created: 2026-11-16
project: HITLD-15
needs: [HITLD-135]
---

## Why

HITLD-132 built `hitld work sweep` and a curator pass that is one ordinary tracker item per pass, because today's brief supports only that. The owner decided, on 2026-11-16, that a separate curator dispatch role should be designed, not just kept as one item per pass. The same item also left open how each kind of sweep finding routes to an action: an orphaned claim (unclaim it?), a merged item still open (close it, or ask?), a stale `proposed` item, a release-needs overlap, a missing release note.

## Done when

- The owner decides, in a design walk-through (HITLD-135), one question at a time, and the answers are recorded as decisions before anything is built:
  - What a curator dispatch role is: its brief, its tools, its model and effort, its budget, and what it may change on its own (wording inside an item's facts, per design part 10) and what it only asks about.
  - For each finding kind, the default action: fix, ask the owner, or report only.
  - How passes are scheduled and kept cheap (after merge batches today; the sweep is deterministic and a pass only reads what it flags).
- Design parts 2, 4, 10 and 13 say the chosen answers in one change the owner approves; build items follow, one per piece.

## Notes

`proposed` because it is a design choice. Raised from D-13's digest questions on HITLD-132 (merged as PR #163) and the owner's answer. The defaults chosen the same evening: `proposed` items are flagged after 30 days; the sweep runs after merges only.
