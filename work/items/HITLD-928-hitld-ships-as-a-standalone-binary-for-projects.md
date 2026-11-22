---
id: HITLD-928
title: HITLd ships as a standalone binary for projects with no Node toolchain
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-189 c?]
---

## Why

A team with no Node toolchain cannot run HITLd in rc.2 (HITLD-917).

## Done when

- Standalone binaries per operating system and architecture are built by the release workflow that already attests provenance, with a checksum, and the guide says how to install and verify one.
- Hooks find the binary.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Decided in the build-systems walk-through of 2026-11-22: HITLD-886, 910 to 919 (the design item is HITLD-883, GitHub issue 553). rc.3; large.
