---
id: HITLD-421
title: The Roadmap shows proposed milestones as dashed outlines and lays its columns out by release stage
kind: work
state: done
created: 2026-11-16
project: HITLD-15
needs: [HITLD-343]
claimed_by: D-33
---

## Done when




- **Proposed milestones on the board (decision HITLD-419).** The Roadmap draws proposed milestones too, with a dashed border and a "proposed" mark, in the position their release gives them; committing one (the owner's decision) makes it solid. The table of proposed milestones under the board stays, for what stands between each one and committing; design 12.1.2, which says proposed milestones are off the board, is changed to match.
- **Columns follow the release stages (decision HITLD-420).** A milestone sits in the column of the earliest release item that needs it, and each release flag sits at the right edge of its stage's column, so what lands in rc.2 is left of rc.3, then rc.4, then v0.1.0. Where milestone-to-milestone `needs` order two milestones the other way, the needs ordering wins and the board says so. The fewest-crossings layout keeps working and keeps the release flags in the same order.
- The edges from every milestone to a single milestone no longer run behind the release flags in a way that hides them (the owner saw this on the current board: HITLD-1's edges cross the flags); the board keeps them readable at the sizes the tracker has now (about 25 milestones, four releases).
- A fixture tracker with two release stages and proposed milestones tests the dashed outline, the stage order of the columns, and the flag positions; the page stays one file with no network request and no new script.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

The owner reviewed the Roadmap after the planning pass (HITLD-343) and said it looked wrong. The board draws only planned milestones, so the rc.3 and rc.4 flags hang over nothing, and every milestone sits in Step 1 with the four release flags stacked in one column, because the columns come only from milestone-to-milestone `needs`. The owner confirmed the chief of staff's reading and chose both changes (HITLD-419 and 420).

## Notes

Code, design and dashboard: needs the owner's own yes to merge. Needs HITLD-343 (merged). Related: HITLD-342 (the lane that no longer says long outcome), HITLD-412 (appetite shown on each milestone), HITLD-62 and HITLD-152 (the board and the views).
