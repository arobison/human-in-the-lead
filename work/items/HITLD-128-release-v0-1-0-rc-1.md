---
id: HITLD-128
title: "Release v0.1.0-rc.1"
kind: work
state: planned
created: 2026-11-15
project: HITLD-15
needs: [HITLD-100, HITLD-121, HITLD-123, HITLD-129]
---

## Why

The first release candidate has its own release item, so what it waits for is exactly the work it needs and nothing that only the full release v0.1.0 (HITLD-24) needs. With HITLD-129, `hitld release make` refuses while any of these is open.

## Done when

- Every item this one needs is done, and `hitld release propose --pre rc --item HITLD-128` reports no gates and no missing release notes.
- The committed offline eval baseline is from a clean run of the final main (HITLD-100).
- `hitld release make --pre rc --item HITLD-128 --branch release/v0.1.0-rc.1`, in the owner's turn, writes the record; the release pull request is merged by the owner with their sign-off; the owner approves the `release` environment; the workflow tags `v0.1.0-rc.1` and drafts the release; the owner publishes it.
