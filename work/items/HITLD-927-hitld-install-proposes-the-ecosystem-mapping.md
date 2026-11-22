---
id: HITLD-927
title: hitld install proposes the ecosystem mapping and release packages from the manifests and workspace files it finds
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-189 c?]
---

## Why

The owner decided mapping is explicit, proposed once at install (HITLD-911), and install may propose release packages from workspace files once (HITLD-914).

## Done when

- `hitld install` detects manifests and workspace files (Cargo members, pnpm-workspace.yaml, package.json workspaces) and proposes the `ecosystems.use` mapping and `release.packages`, for the owner to accept; nothing is detected at run time.
- A test per workspace kind.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Decided in the build-systems walk-through of 2026-11-22: HITLD-886, 910 to 919 (the design item is HITLD-883, GitHub issue 553). rc.3; needs the schema (HITLD-920).
