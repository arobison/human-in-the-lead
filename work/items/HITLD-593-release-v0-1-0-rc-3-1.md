---
id: HITLD-593
title: Release v0.1.0-rc.3.1
kind: work
state: planned
created: 2026-11-20
project: HITLD-15
release: 0.1.0-rc.3.1
needs: [HITLD-400, HITLD-192, HITLD-405]
---

## Why

The release between rc.3 and rc.4 is the owner's view and the chief of staff's behavior: the owner sees the plan in one page, and what the chief of staff tells the owner is checked against a source, short and on time. It follows v0.1.0-rc.3 (HITLD-400) and waits for the two milestones of this stage: the owner sees the plan in one page (HITLD-192), and the chief of staff tells the owner what is true, briefly and on time (HITLD-405). Release v0.1.0-rc.4 (HITLD-401) follows this one.

## Done when

- Release v0.1.0-rc.3 (HITLD-400) is made, and the two milestones this item needs are done, each by its own check.
- The gate: `hitld release propose --pre rc` (which finds this item by its `release` key) reports no gates and no missing release notes.
- The committed offline eval baseline is from a clean run of the final main.
- The release is made through the release pull request, as for rc.3: `hitld release make --pre rc --branch release/v0.1.0-rc.3.1` in the owner's turn, merged with the owner's sign-off, the `release` environment approved, the draft published.
- Self-hosting moves its pin to v0.1.0-rc.3.1 by a pull request the owner merges, following `hitld upgrade plan`.

## Notes

Made by the curator on the owner's decisions HITLD-591 (rc.3 is split into rc.3 and a new rc.3.1) and HITLD-592 (the nine roadmap moves). The stages are expressed only by release items' `needs`; an item inherits its version through its milestone. Semantic versioning orders rc.3 before rc.3.1 before rc.4. HITLD-146 left HITLD-405 for v0.1.0 (HITLD-592), so this stage does not wait on the end-to-end eval runner HITLD-57.
