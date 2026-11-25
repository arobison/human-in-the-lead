---
id: HITLD-1057
title: The version-check hook at session start returns in about a second, even when many sessions start at once in large repositories
kind: work
state: planned
created: 2026-11-25
project: HITLD-15
constraint_of: [HITLD-405 c?]
---

## Done when

- A measurement of the SessionStart version-check hook with many concurrent starts in a large repository, recorded in the PR, names where its time goes (the install drift check that builds the session-start notice is the suspect).
- The hook returns in about a second on that repository, with the drift check bounded (a time limit, a cache keyed on the pin and the install's mtime, or work moved off the start path); a test or benchmark covers the bound.
- A start that cannot finish the check still starts the session, and the notice says the check was skipped.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Why

GitHub issue 670: several copies of the hook ran at once, each using a noticeable share of CPU, some for several minutes before exiting on their own, on a machine where many sessions were starting in large repositories; every executor session pays this at start. Related: HITLD-110 (drift detection).

## Notes

rc.3. Measure first, then fix; do not guess the cause. Ordinary code, though a hook change reaches every session, so the owner may hold it: ask at review.
