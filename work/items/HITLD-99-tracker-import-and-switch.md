---
id: HITLD-99
title: "Import and switch: hitld work import, the dry run and report, the ID map"
kind: work
state: planned
created: 2026-11-15
project: HITLD-95
needs: [HITLD-98]
constraint_of: [HITLD-96 c6]
---

## Why

A project on a hosted tracker can move to HITLd's files backend without waiting for the full backends (design 0002, section 10 and Q8). This is the first slice of "Runs on a hosted tracker".

## Done when

- `hitld work import <interchange file>` writes the items as tracker files through the mapping, in one reviewable commit, as `hitld work migrate` does; `--dry-run` shows the files it would write and a report of what it could not map.
- An ID map (tracker ID to HITLd ID) is kept, so links and later imports resolve.
- A fixture project on a hosted tracker is imported and switched, and `hitld work check` passes on the result (milestone clause c6).
- `npm run check`, the offline eval gate and `hitld work check` pass.
