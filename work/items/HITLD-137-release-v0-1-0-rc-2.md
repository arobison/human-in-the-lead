---
id: HITLD-137
title: "Release v0.1.0-rc.2"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
release: 0.1.0-rc.2
needs: [HITLD-67]
---

## Why

The second release candidate is the first one HITLd builds while running itself. It waits for milestone HITLD-67, "Consumer live": this repository self-hosting on v0.1.0-rc.1, with the routine jobs done by `hitld`, checked by the owner's demo. The owner decided that nothing else from the design lands before it.

## Done when

- Milestone HITLD-67 is done, and `hitld release propose --pre rc` (which finds this item by its `release` key) reports no gates and no missing release notes.
- The committed offline eval baseline is from a clean run of the final main.
- The release is made through the release pull request, as for rc.1, from the self-hosting environment: `hitld release make --pre rc --branch release/v0.1.0-rc.2` in the owner's turn, merged with the owner's sign-off, the `release` environment approved, the draft published.
- Self-hosting moves its pin from v0.1.0-rc.1 to v0.1.0-rc.2 by a pull request the owner merges, following `hitld upgrade plan`.
