---
id: HITLD-926
title: Declared test result files name the failing tests in a send-back and the flake record
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-189 c?]
---

## Why

A failing full suite names no test. The owner decided exit status decides and result files only name tests (HITLD-916).

## Done when

- When a profile declares a result file (JUnit XML), the queue reads it only after a failing run, and names the failing tests in the send-back and the flake record; a missing or malformed file changes nothing.
- A test per case.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Decided in the build-systems walk-through of 2026-11-22: HITLD-886, 910 to 919 (the design item is HITLD-883, GitHub issue 553). rc.3.
