---
id: HITLD-905
title: "work add writes the links onto the named items instead of the retired constraints line"
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-189 c?]
---

## Why

`work add` still writes the retired `constraints` line for a new milestone filed with `--needs` (`core/lib/tracker/files/tracker.mjs`), which warns at once and stops being read at rc.3.

## Done when

- `work add` writes the links onto the named items instead of a `constraints` line.
- A test files a milestone with `--needs` and shows no warning.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

From the Fable independent read of the delegated merges (2026-11-22), finding R14; decision HITLD-897. rc.3 by the owner's decision.
