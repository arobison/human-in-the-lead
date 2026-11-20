---
id: HITLD-400
title: "Release v0.1.0-rc.3"
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
release: 0.1.0-rc.3
needs: [HITLD-137, HITLD-189, HITLD-190, HITLD-191, HITLD-404]
---

## Why

The third release candidate is the self-hosted run holding up (the owner's decision HITLD-358): this repository's own run goes through a hand-over between containers and several merges with no hand fix and no prompt carried between sessions by hand. It follows v0.1.0-rc.2 (HITLD-137) and waits for the four milestones of this stage: fast, reliable CI and a planner that offers the right work (HITLD-189), two containers share one store (HITLD-190), routine jobs are done by commands (HITLD-191), and a dispatched item reaches main without a hand fix (HITLD-404). The owner's view (HITLD-192) and the chief of staff's behavior (HITLD-405) moved to the release after it, v0.1.0-rc.3.1 (HITLD-593, decisions HITLD-591 and 592).

## Done when

- Release v0.1.0-rc.2 (HITLD-137) is made, and the four milestones this item needs are done, each by its own check.
- The gate: `hitld release propose --pre rc` (which finds this item by its `release` key) reports no gates and no missing release notes.
- The committed offline eval baseline is from a clean run of the final main.
- The release is made through the release pull request, as for rc.2: `hitld release make --pre rc --branch release/v0.1.0-rc.3` in the owner's turn, merged with the owner's sign-off, the `release` environment approved, the draft published.
- Self-hosting moves its pin to v0.1.0-rc.3 by a pull request the owner merges, following `hitld upgrade plan`.

## Notes

Made by the planning pass HITLD-343 on the owner's decision HITLD-358 (release stages rc.2, rc.3, rc.4, then v0.1.0, each a release item that needs its milestones). The stages are expressed only by release items' `needs`; an item inherits its version through its milestone. HITLD-143 and HITLD-146, direct needs of v0.1.0 before the pass, land here through HITLD-191 and HITLD-405.

## Moved on 2026-11-20 (HITLD-591, 592)

The owner split this release: it now waits for the four milestones about the run holding up (HITLD-189, 190, 191, 404). HITLD-192 and 405 moved to the new v0.1.0-rc.3.1 (HITLD-593), which needs this release; v0.1.0-rc.4 (HITLD-401) now needs rc.3.1.
